import { db, obterConfig } from '../db.js';
import { hubFetch, mensagemDoHub, RespostaHub } from '../hubClient.js';
import { notificar } from '../stream.js';
import type { CanalPublicacao, EstadoProduto, ProdutoCadastrado, ProdutoErp, SituacaoCanal } from '../../shared/tipos.js';
import { opcoesPausadasDaPizza, paraHub } from './produto.js';

/**
 * Fila de publicacao: cada alteracao do cardapio e gravada no ERP e enviada em seguida ao Hub, que publica
 * no iFood e na 99Food. Uma operacao por vez, um produto por requisicao (limites das plataformas), com nova
 * tentativa em falha temporaria. A 99Food responde PROCESSANDO e o resultado e consultado depois.
 */
export type Operacao = 'PUBLICAR' | 'PATCH' | 'PATCH_OPCAO' | 'REMOVER';

const ESPERAS_S = [5, 15, 65, 120, 300];
const MAX_TENTATIVAS = 8;
/**
 * Recusas que passam sozinhas: limite de frequencia (429 ou errno 10005/12021), publicacao da 99Food em andamento e
 * resultado incerto. O Hub grava no canal so a mensagem e o status HTTP, sem o codigo do erro.
 */
const TEMPORARIO = /10005|12021|429|HTTP 5\d\d|frequency|LIMITE_DA_INSTALACAO|limite de requisi|sendo publicado|RESULTADO_INCERTO|resultado incerto|indispon/i;

const falhaTemporaria = (c: SituacaoCanal) => {
  const status = Number((c.detalhes as { statusHttp?: unknown } | undefined)?.statusHttp);
  return status === 429 || status >= 500 || TEMPORARIO.test(c.erro ?? '');
};



interface LinhaProduto {
  codigo: string;
  definicaoJson: string;
  canaisJson: string;
  estado: EstadoProduto;
  erro: string;
  atualizadoEm: string;
  removendo: number;
  pausadasJson: string;
  reaplicarPausas: number;
}
interface Tarefa {
  id: number;
  codigo: string;
  operacao: Operacao;
  opcao: string;
  dadosJson: string;
  tentativas: number;
}

const linha = (codigo: string) => db.prepare('SELECT * FROM produtos WHERE codigo = ?').get(codigo) as LinhaProduto | undefined;

export const obterProduto = (codigo: string): ProdutoErp | null => {
  const l = linha(codigo);
  return l ? (JSON.parse(l.definicaoJson) as ProdutoErp) : null;
};

export function listarProdutos(): ProdutoCadastrado[] {
  const linhas = db.prepare('SELECT * FROM produtos ORDER BY atualizadoEm DESC').all() as LinhaProduto[];
  const pendentes = new Map(
    (db.prepare("SELECT codigo, COUNT(*) AS n FROM fila_catalogo WHERE estado IN ('PENDENTE','ENVIANDO') GROUP BY codigo").all() as Array<{ codigo: string; n: number }>).map((l) => [l.codigo, l.n]),
  );
  return linhas.map((l) => ({
    produto: JSON.parse(l.definicaoJson),
    estado: l.estado,
    erro: l.erro,
    canais: JSON.parse(l.canaisJson || '{}'),
    operacoesPendentes: pendentes.get(l.codigo) ?? 0,
    atualizadoEm: l.atualizadoEm,
  }));
}

export function gravarProduto(p: ProdutoErp) {
  db.prepare(`
    INSERT INTO produtos (codigo, definicaoJson, estado, atualizadoEm) VALUES (?, ?, 'NA_FILA', ?)
    ON CONFLICT(codigo) DO UPDATE SET definicaoJson = excluded.definicaoJson, atualizadoEm = excluded.atualizadoEm
  `).run(p.codigo, JSON.stringify(p), new Date().toISOString());
}

function marcar(codigo: string, estado: EstadoProduto, erro = '', canais?: Partial<Record<CanalPublicacao, SituacaoCanal>>) {
  db.prepare('UPDATE produtos SET estado = ?, erro = ?, canaisJson = COALESCE(?, canaisJson), atualizadoEm = ? WHERE codigo = ?').run(
    estado,
    erro,
    canais ? JSON.stringify(canais) : null,
    new Date().toISOString(),
    codigo,
  );
  notificar('catalogo', { codigo, estado });
}

const temPendente = (codigo: string, operacao: Operacao) =>
  !!db.prepare("SELECT 1 FROM fila_catalogo WHERE codigo = ? AND operacao = ? AND estado = 'PENDENTE'").get(codigo, operacao);

export function enfileirar(codigo: string, operacao: Operacao, dados: Record<string, unknown> = {}, opcao = '') {
  // Publicacao completa leva a definicao atual: ajustes ainda nao enviados ficam redundantes. A tarefa em envio
  // tambem sai da fila, e o resultado dela e ignorado quando voltar
  if (operacao === 'PUBLICAR' || operacao === 'REMOVER') {
    db.prepare('DELETE FROM fila_catalogo WHERE codigo = ?').run(codigo);
    db.prepare('UPDATE produtos SET removendo = ? WHERE codigo = ?').run(operacao === 'REMOVER' ? 1 : 0, codigo);
  } else if (operacao === 'PATCH' && temPendente(codigo, 'PUBLICAR')) return;
  db.prepare('INSERT INTO fila_catalogo (codigo, operacao, opcao, dadosJson) VALUES (?, ?, ?, ?)').run(codigo, operacao, opcao, JSON.stringify(dados));
  marcar(codigo, operacao === 'REMOVER' ? 'REMOVENDO' : 'NA_FILA');
  void processarCatalogo();
}

/**
 * Sabores, massas e bordas: o Hub nao leva "disponivel" deles na publicacao. Depois que os dois canais terminam,
 * o ERP envia as pausas e reativa o que estava pausado nas plataformas e voltou a ficar disponivel.
 */
function sincronizarPausas(codigo: string) {
  const produto = obterProduto(codigo);
  const l = linha(codigo);
  if (!produto?.pizza || !l) return;
  const pausadas = opcoesPausadasDaPizza(produto);
  const existentes = new Set([...produto.pizza.sabores, ...produto.pizza.massas, ...produto.pizza.bordas].map((o) => o.codigo));
  const anteriores = (JSON.parse(l.pausadasJson || '[]') as string[]).filter((o) => existentes.has(o));
  db.prepare('UPDATE produtos SET reaplicarPausas = 0 WHERE codigo = ?').run(codigo);
  for (const opcao of pausadas) enfileirar(codigo, 'PATCH_OPCAO', { disponivel: false }, opcao);
  for (const opcao of anteriores.filter((o) => !pausadas.includes(o))) enfileirar(codigo, 'PATCH_OPCAO', { disponivel: true }, opcao);
}

/** Registra o que esta pausado nas plataformas depois de um ajuste de opcao aceito. */
function registrarPausa(codigo: string, opcao: string, disponivel: boolean) {
  const l = linha(codigo);
  if (!l) return;
  const lista = new Set(JSON.parse(l.pausadasJson || '[]') as string[]);
  if (disponivel) lista.delete(opcao);
  else lista.add(opcao);
  db.prepare('UPDATE produtos SET pausadasJson = ? WHERE codigo = ?').run(JSON.stringify([...lista]), codigo);
}

const processando = (canais: Partial<Record<CanalPublicacao, SituacaoCanal>>) => Object.values(canais).some((c) => c.estado === 'PROCESSANDO');
const removidoDosCanais = (canais: Partial<Record<CanalPublicacao, SituacaoCanal>>) => Object.values(canais).every((c) => c.estado === 'REMOVIDO' || c.estado === 'SEM_LOJA');

function apagarDoErp(codigo: string) {
  db.prepare('DELETE FROM produtos WHERE codigo = ?').run(codigo);
  db.prepare('DELETE FROM fila_catalogo WHERE codigo = ?').run(codigo);
  notificar('catalogo', { codigo, removido: true });
}

/** Resume a situacao dos dois canais em um estado unico do produto. */
export function resumirCanais(canais: Partial<Record<CanalPublicacao, SituacaoCanal>>): { estado: EstadoProduto; erro: string } {
  const lista = Object.entries(canais) as Array<[CanalPublicacao, SituacaoCanal]>;
  const comErro = lista.filter(([, c]) => c.estado === 'ERRO');
  const erro = comErro.map(([n, c]) => `${n === 'IFOOD' ? 'iFood' : '99Food'}: ${c.erro ?? 'falha'}`).join(' | ');
  if (comErro.length) return { estado: lista.some(([, c]) => c.estado === 'PUBLICADO' || c.estado === 'PROCESSANDO') ? 'PARCIAL' : 'ERRO', erro };
  if (lista.some(([, c]) => c.estado === 'PROCESSANDO')) return { estado: 'PROCESSANDO', erro: '' };
  if (lista.length && lista.every(([, c]) => c.estado === 'SEM_LOJA')) return { estado: 'SEM_LOJA', erro: 'Nenhuma loja vinculada. Vincule o iFood ou a 99Food e reenvie.' };
  return { estado: 'PUBLICADO', erro: '' };
}

async function enviar(t: Tarefa): Promise<RespostaHub<any>> {
  const base = '/hub/v1/conexao/catalogo/produtos';
  // O Nginx do Hub corta em 60 s
  const timeoutMs = 65_000;
  const caminho = `${base}/${encodeURIComponent(t.codigo)}`;
  if (t.operacao === 'PUBLICAR') return hubFetch(base, { metodo: 'POST', body: paraHub(obterProduto(t.codigo)!), timeoutMs });
  if (t.operacao === 'REMOVER') return hubFetch(caminho, { metodo: 'DELETE', timeoutMs });
  const alvo = t.operacao === 'PATCH_OPCAO' ? `${caminho}/opcoes/${encodeURIComponent(t.opcao)}` : caminho;
  return hubFetch(alvo, { metodo: 'PATCH', body: JSON.parse(t.dadosJson), timeoutMs });
}

function concluirTarefa(id: number) {
  db.prepare('DELETE FROM fila_catalogo WHERE id = ?').run(id);
}

function adiar(t: Tarefa, erro: string) {
  const tentativas = t.tentativas + 1;
  if (tentativas >= MAX_TENTATIVAS) {
    concluirTarefa(t.id);
    marcar(t.codigo, 'ERRO', `Desistiu apos ${tentativas} tentativas. ${erro}`);
    return;
  }
  const espera = ESPERAS_S[Math.min(tentativas - 1, ESPERAS_S.length - 1)];
  db.prepare("UPDATE fila_catalogo SET estado = 'PENDENTE', tentativas = ?, proximaEm = ?, erro = ? WHERE id = ?").run(tentativas, Date.now() + espera * 1000, erro, t.id);
  marcar(t.codigo, 'NA_FILA', `Nova tentativa em ${espera} s. ${erro}`);
}

const naFila = (id: number) => !!db.prepare('SELECT 1 FROM fila_catalogo WHERE id = ?').get(id);

async function executar(t: Tarefa) {
  const l = linha(t.codigo);
  if (!l) return concluirTarefa(t.id);
  // Ajuste enquanto a 99Food ainda processa a publicacao seria recusado: espera, sem gastar tentativa
  if ((t.operacao === 'PATCH' || t.operacao === 'PATCH_OPCAO') && processando(JSON.parse(l.canaisJson || '{}'))) {
    db.prepare('UPDATE fila_catalogo SET proximaEm = ? WHERE id = ?').run(Date.now() + 15_000, t.id);
    return;
  }
  db.prepare("UPDATE fila_catalogo SET estado = 'ENVIANDO' WHERE id = ?").run(t.id);
  marcar(t.codigo, t.operacao === 'REMOVER' ? 'REMOVENDO' : 'ENVIANDO');
  const r = await enviar(t);
  // Enquanto a requisicao estava no ar, uma publicacao ou exclusao mais nova substituiu esta tarefa
  if (!naFila(t.id)) return;
  const codigoErro = String((r.json as any)?.codigo ?? '');

  if (!r.ok) {
    // Ajuste de produto que o Hub ainda nao conhece vira publicacao completa
    if (r.status === 404 && codigoErro === 'NAO_ENCONTRADO') {
      concluirTarefa(t.id);
      if (t.operacao === 'REMOVER') return apagarDoErp(t.codigo);
      return enfileirar(t.codigo, 'PUBLICAR');
    }
    const temporario = r.status === 0 || r.status === 429 || r.status >= 500 || TEMPORARIO.test(`${codigoErro} ${(r.json as any)?.erro ?? ''}`);
    if (temporario) return adiar(t, mensagemDoHub(r));
    concluirTarefa(t.id);
    return marcar(t.codigo, 'ERRO', mensagemDoHub(r));
  }

  const registro = (r.json as any)?.resultados?.[0] ?? (r.json as any)?.resultado;
  const canais = (registro?.canais ?? {}) as Partial<Record<CanalPublicacao, SituacaoCanal>>;
  const resumo = resumirCanais(canais);
  // O Hub responde 200 mesmo quando um canal recusa: limite de frequencia e repetido sozinho
  if (Object.values(canais).some((c) => c.estado === 'ERRO' && falhaTemporaria(c))) {
    marcar(t.codigo, 'NA_FILA', resumo.erro, canais);
    return adiar(t, resumo.erro);
  }
  concluirTarefa(t.id);

  if (t.operacao === 'REMOVER') {
    if (removidoDosCanais(canais)) return apagarDoErp(t.codigo);
    return marcar(t.codigo, resumo.estado === 'PROCESSANDO' ? 'REMOVENDO' : resumo.estado, resumo.erro, canais);
  }

  marcar(t.codigo, resumo.estado, resumo.erro, canais);
  if (t.operacao === 'PATCH_OPCAO' && !resumo.erro) {
    const disponivel = JSON.parse(t.dadosJson).disponivel;
    if (typeof disponivel === 'boolean') registrarPausa(t.codigo, t.opcao, disponivel);
  }
  if (t.operacao === 'PUBLICAR') {
    if (processando(canais)) db.prepare('UPDATE produtos SET reaplicarPausas = 1 WHERE codigo = ?').run(t.codigo);
    else sincronizarPausas(t.codigo);
  }
}

let rodando = false;

export async function processarCatalogo(): Promise<void> {
  if (rodando || !obterConfig().tokenConexao) return;
  rodando = true;
  try {
    for (;;) {
      // Ordem por produto: uma tarefa adiada segura as seguintes do mesmo codigo
      const t = db
        .prepare(`
          SELECT * FROM fila_catalogo f WHERE estado = 'PENDENTE' AND proximaEm <= ?
            AND id = (SELECT MIN(id) FROM fila_catalogo g WHERE g.codigo = f.codigo AND g.estado = 'PENDENTE')
          ORDER BY id LIMIT 1
        `)
        .get(Date.now()) as Tarefa | undefined;
      if (!t) return;
      try {
        await executar(t);
      } catch (err) {
        adiar(t, err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
    rodando = false;
  }
}

/** Consulta o resultado das publicacoes que a 99Food processa em segundo plano (mesmo que o outro canal falhe). */
export async function acompanharProcessamento(): Promise<void> {
  const linhas = db.prepare(`SELECT * FROM produtos WHERE canaisJson LIKE '%"PROCESSANDO"%'`).all() as LinhaProduto[];
  const ocupado = (codigo: string) => !!db.prepare('SELECT 1 FROM fila_catalogo WHERE codigo = ? AND estado = \'ENVIANDO\'').get(codigo);
  for (const l of linhas) {
    if (ocupado(l.codigo)) continue;
    const r = await hubFetch<any>(`/hub/v1/conexao/catalogo/produtos/${encodeURIComponent(l.codigo)}`, {
      silenciarSucesso: (j: any) => Object.values(j?.canais ?? {}).some((c: any) => c.estado === 'PROCESSANDO'),
    });
    if (!r.ok || !r.json?.canais) continue;
    // O produto mudou durante a consulta: a resposta ja esta velha
    const atual = linha(l.codigo);
    if (!atual || atual.canaisJson !== l.canaisJson || ocupado(l.codigo)) continue;
    const canais = r.json.canais as Partial<Record<CanalPublicacao, SituacaoCanal>>;
    if (atual.removendo && removidoDosCanais(canais)) {
      apagarDoErp(l.codigo);
      continue;
    }
    const resumo = resumirCanais(canais);
    const naEspera = !!db.prepare("SELECT 1 FROM fila_catalogo WHERE codigo = ? AND estado = 'PENDENTE'").get(l.codigo);
    const estado = atual.removendo && resumo.estado === 'PROCESSANDO' ? 'REMOVENDO' : naEspera ? 'NA_FILA' : resumo.estado;
    if (JSON.stringify(canais) !== atual.canaisJson || estado !== atual.estado) marcar(l.codigo, estado, resumo.erro, canais);
    if (!processando(canais) && atual.reaplicarPausas) sincronizarPausas(l.codigo);
  }
  void processarCatalogo();
}
