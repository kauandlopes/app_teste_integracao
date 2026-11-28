import { db } from '../db.js';
import { conexaoPronta } from '../conexao/estado.js';
import { hubFetch, mensagemDoHub, RespostaHub } from '../hubClient.js';
import { segundosDoLimite } from '../hubErros.js';
import { notificar } from '../stream.js';
import type { CanalPublicacao, EstadoProduto, ProdutoCadastrado, ProdutoErp, SituacaoCanal } from '../../shared/tipos.js';
import { paraHub } from './produto.js';
import { guardarAvisosDaExclusao } from './avisos.js';
import { esquecerCategorias } from './categorias.js';

/**
 * Fila de publicacao: cada alteracao do cardapio e gravada no ERP e enviada em seguida ao Hub, que publica
 * no iFood e na 99Food. Um produto por requisicao e ate quatro produtos ao mesmo tempo (um de cada vez por
 * codigo), com nova tentativa em falha temporaria. A 99Food responde PROCESSANDO e o resultado e consultado depois.
 */
export type Operacao = 'PUBLICAR' | 'PATCH' | 'PATCH_OPCAO' | 'REMOVER';

const ESPERAS_S = [5, 15, 65, 120, 300];
const MAX_TENTATIVAS = 8;
/**
 * Recusas que passam sozinhas: limite de frequencia (429 ou errno 10005/12021), publicacao da 99Food em andamento e
 * resultado incerto. Confere o codigo do erro, a mensagem e o status HTTP que o Hub grava no canal.
 */
const TEMPORARIO = /10005|12021|429|HTTP 5\d\d|frequency|LIMITE_DA_INSTALACAO|limite de requisi|sendo publicado|RESULTADO_INCERTO|resultado incerto|indispon|CARDAPIO_99_(AGUARDE|OCUPADO)|CATEGORIA_EM_CRIACAO/i;

type DetalhesCanal = { statusHttp?: unknown; retryAfterSegundos?: unknown } | undefined;
const falhaTemporaria = (c: SituacaoCanal) => {
  const status = Number((c.detalhes as DetalhesCanal)?.statusHttp);
  return status === 429 || status >= 500 || TEMPORARIO.test(`${c.erroCodigo ?? ''} ${c.erro ?? ''}`);
};

type Canais = Partial<Record<CanalPublicacao, SituacaoCanal>>;

/** envioEmSegundos so vem na resposta da publicacao: vira horario previsto, mantido enquanto o canal processa. */
function comEnvioPrevisto(canais: Canais, anteriores: Canais): Canais {
  for (const [nome, c] of Object.entries(canais) as Array<[CanalPublicacao, SituacaoCanal]>) {
    if (c.estado !== 'PROCESSANDO') continue;
    const previsto = c.envioEmSegundos !== undefined ? new Date(Date.now() + c.envioEmSegundos * 1000).toISOString() : anteriores[nome]?.envioPrevistoEm;
    delete c.envioEmSegundos;
    if (previsto) c.envioPrevistoEm = previsto;
  }
  return canais;
}

/** Avisos do Hub que so fazem sentido enquanto a publicacao esta em andamento. */
const AVISO_DE_ESPERA = /^(A 99Food publica o card[aá]pio em at[eé]|H[aá] um envio de card[aá]pio em andamento|Na fila:)/i;

/** Ajusta o que vai para a tela: segundos que faltam e, fora do processamento, sem avisos de espera gravados antes. */
function paraTela(canais: Canais): Canais {
  for (const c of Object.values(canais)) {
    if (c.estado !== 'PROCESSANDO') c.avisos = c.avisos?.filter((a) => !AVISO_DE_ESPERA.test(a));
    else if (c.envioPrevistoEm) c.envioEmSegundos = Math.max(0, Math.ceil((Date.parse(c.envioPrevistoEm) - Date.now()) / 1000));
  }
  return canais;
}

interface LinhaProduto {
  codigo: string;
  definicaoJson: string;
  canaisJson: string;
  estado: EstadoProduto;
  erro: string;
  atualizadoEm: string;
  removendo: number;
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
    canais: paraTela(JSON.parse(l.canaisJson || '{}')),
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

const processando = (canais: Partial<Record<CanalPublicacao, SituacaoCanal>>) => Object.values(canais).some((c) => c.estado === 'PROCESSANDO');
const removidoDosCanais = (canais: Partial<Record<CanalPublicacao, SituacaoCanal>>) => Object.values(canais).every((c) => c.estado === 'REMOVIDO' || c.estado === 'SEM_LOJA');

function apagarDoErp(codigo: string) {
  db.prepare('DELETE FROM produtos WHERE codigo = ?').run(codigo);
  db.prepare('DELETE FROM fila_catalogo WHERE codigo = ?').run(codigo);
  notificar('catalogo', { codigo, removido: true });
}

function concluirExclusao(codigo: string, anteriores: Canais, finais: Canais) {
  guardarAvisosDaExclusao(codigo, obterProduto(codigo)?.nome ?? codigo, anteriores, finais);
  apagarDoErp(codigo);
}

/** Resume a situacao dos dois canais em um estado unico do produto. */
export function resumirCanais(canais: Partial<Record<CanalPublicacao, SituacaoCanal>>): { estado: EstadoProduto; erro: string } {
  const lista = Object.entries(canais) as Array<[CanalPublicacao, SituacaoCanal]>;
  const comErro = lista.filter(([, c]) => c.estado === 'ERRO');
  const erro = comErro.map(([n, c]) => `${n === 'IFOOD' ? 'iFood' : '99Food'}: ${c.erroCodigo ? `[${c.erroCodigo}] ` : ''}${c.erro ?? 'falha'}`).join(' | ');
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

function adiar(t: Tarefa, erro: string, minimoS = 0) {
  const tentativas = t.tentativas + 1;
  if (tentativas >= MAX_TENTATIVAS) {
    concluirTarefa(t.id);
    marcar(t.codigo, 'ERRO', `Desistiu apos ${tentativas} tentativas. ${erro}`);
    return;
  }
  // Limite da 99Food: repetir antes da janela so gasta tentativa
  const espera = Math.max(ESPERAS_S[Math.min(tentativas - 1, ESPERAS_S.length - 1)], segundosDoLimite(erro), minimoS);
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
    // Conexao encerrada ou token trocado durante o envio: a tarefa espera o token novo, sem gastar tentativa
    if (r.status === 401 || !conexaoPronta()) {
      db.prepare("UPDATE fila_catalogo SET estado = 'PENDENTE', proximaEm = ? WHERE id = ?").run(Date.now() + 5_000, t.id);
      return marcar(t.codigo, 'NA_FILA', 'Aguardando a conexão com o Hub.');
    }
    if (codigoErro === 'LOJA_NAO_ENCONTRADA') {
      concluirTarefa(t.id);
      return marcar(t.codigo, 'SEM_LOJA', mensagemDoHub(r));
    }
    // Ajuste de produto que o Hub ainda nao conhece vira publicacao completa
    if (r.status === 404 && codigoErro === 'NAO_ENCONTRADO') {
      concluirTarefa(t.id);
      if (t.operacao === 'REMOVER') return apagarDoErp(t.codigo);
      return enfileirar(t.codigo, 'PUBLICAR');
    }
    const temporario = r.status === 0 || r.status === 429 || r.status >= 500 || TEMPORARIO.test(`${codigoErro} ${(r.json as any)?.erro ?? ''}`);
    if (temporario) return adiar(t, mensagemDoHub(r), r.retryAfterS);
    concluirTarefa(t.id);
    return marcar(t.codigo, 'ERRO', mensagemDoHub(r));
  }

  const registro = (r.json as any)?.resultados?.[0] ?? (r.json as any)?.resultado;
  // Relida: a linha guardada antes do envio pode ter mudado enquanto a requisicao estava no ar
  const anteriores = JSON.parse(linha(t.codigo)?.canaisJson || '{}') as Canais;
  const canais = comEnvioPrevisto((registro?.canais ?? {}) as Canais, anteriores);
  const resumo = resumirCanais(canais);
  // O produto pode ter criado a categoria nas plataformas
  if (t.operacao === 'PUBLICAR') esquecerCategorias();
  // O Hub responde 200 mesmo quando um canal recusa: limite de frequencia e repetido sozinho
  const temporarios = Object.values(canais).filter((c) => c.estado === 'ERRO' && falhaTemporaria(c));
  if (temporarios.length) {
    marcar(t.codigo, 'NA_FILA', resumo.erro, canais);
    return adiar(t, resumo.erro, Math.max(0, ...temporarios.map((c) => Number((c.detalhes as DetalhesCanal)?.retryAfterSegundos) || 0)));
  }
  concluirTarefa(t.id);

  if (t.operacao === 'REMOVER') {
    if (removidoDosCanais(canais)) return concluirExclusao(t.codigo, anteriores, canais);
    return marcar(t.codigo, resumo.estado === 'PROCESSANDO' ? 'REMOVENDO' : resumo.estado, resumo.erro, canais);
  }

  marcar(t.codigo, resumo.estado, resumo.erro, canais);
}

/** Mais que isto passa do limite de comandos por segundo que o Hub aceita de uma conexao. */
const SIMULTANEOS = 4;
let rodando = false;

/** Proxima tarefa vencida de um produto que nao esta sendo enviado agora. */
function proximaTarefa(ocupados: string[]): Tarefa | undefined {
  // Ordem por produto: uma tarefa adiada segura as seguintes do mesmo codigo
  return db
    .prepare(`
      SELECT * FROM fila_catalogo f WHERE estado = 'PENDENTE' AND proximaEm <= ?
        AND codigo NOT IN (${ocupados.map(() => '?').join(',')})
        AND id = (SELECT MIN(id) FROM fila_catalogo g WHERE g.codigo = f.codigo AND g.estado = 'PENDENTE')
      ORDER BY id LIMIT 1
    `)
    .get(Date.now(), ...ocupados) as Tarefa | undefined;
}

export async function processarCatalogo(): Promise<void> {
  if (rodando || !conexaoPronta()) return;
  rodando = true;
  try {
    const emCurso = new Map<string, Promise<void>>();
    for (;;) {
      while (conexaoPronta() && emCurso.size < SIMULTANEOS) {
        const t = proximaTarefa([...emCurso.keys()]);
        if (!t) break;
        emCurso.set(
          t.codigo,
          executar(t)
            .catch((err: unknown) => adiar(t, err instanceof Error ? err.message : String(err)))
            .finally(() => void emCurso.delete(t.codigo)),
        );
      }
      if (!emCurso.size) return;
      await Promise.race(emCurso.values());
    }
  } finally {
    rodando = false;
  }
}

/** Com varios produtos em processamento, uma consulta da lista inteira substitui uma consulta por produto. */
async function situacoesNoHub(codigos: string[]): Promise<Map<string, RespostaHub<any>> | null> {
  if (codigos.length <= 3) return null;
  const r = await hubFetch<any>('/hub/v1/conexao/catalogo/produtos', {
    silenciarSucesso: () => true,
  });
  const lista = Array.isArray(r.json) ? r.json : (r.json as any)?.data;
  if (!r.ok || !Array.isArray(lista)) return null;
  return new Map(lista.map((p: any) => [String(p.codigo), { ...r, json: p }]));
}

/** Consulta o resultado das publicacoes que a 99Food processa em segundo plano (mesmo que o outro canal falhe). */
export async function acompanharProcessamento(): Promise<void> {
  if (!conexaoPronta()) return;
  const linhas = db.prepare(`SELECT * FROM produtos WHERE canaisJson LIKE '%"PROCESSANDO"%'`).all() as LinhaProduto[];
  const ocupado = (codigo: string) => !!db.prepare('SELECT 1 FROM fila_catalogo WHERE codigo = ? AND estado = \'ENVIANDO\'').get(codigo);
  const lista = await situacoesNoHub(linhas.map((l) => l.codigo));
  for (const l of linhas) {
    if (ocupado(l.codigo)) continue;
    const r =
      lista?.get(l.codigo) ??
      (await hubFetch<any>(`/hub/v1/conexao/catalogo/produtos/${encodeURIComponent(l.codigo)}`, {
        silenciarSucesso: (j: any) => Object.values(j?.canais ?? {}).some((c: any) => c.estado === 'PROCESSANDO'),
      }));
    // Loja desvinculada: o resultado nao vem mais, entao o produto para de ser consultado
    if ((r.json as any)?.codigo === 'LOJA_NAO_ENCONTRADA') {
      const semLoja = Object.fromEntries(Object.entries(JSON.parse(l.canaisJson) as Record<string, SituacaoCanal>).map(([n, c]) => [n, c.estado === 'PROCESSANDO' ? { ...c, estado: 'SEM_LOJA' as const } : c]));
      marcar(l.codigo, 'SEM_LOJA', mensagemDoHub(r), semLoja);
      continue;
    }
    if (!r.ok || !r.json?.canais) continue;
    // O produto mudou durante a consulta: a resposta ja esta velha
    const atual = linha(l.codigo);
    if (!atual || atual.canaisJson !== l.canaisJson || ocupado(l.codigo)) continue;
    const anteriores = JSON.parse(atual.canaisJson) as Canais;
    const canais = comEnvioPrevisto(r.json.canais as Canais, anteriores);
    if (atual.removendo && removidoDosCanais(canais)) {
      concluirExclusao(l.codigo, anteriores, canais);
      continue;
    }
    const resumo = resumirCanais(canais);
    const naEspera = !!db.prepare("SELECT 1 FROM fila_catalogo WHERE codigo = ? AND estado = 'PENDENTE'").get(l.codigo);
    const estado = atual.removendo && resumo.estado === 'PROCESSANDO' ? 'REMOVENDO' : naEspera ? 'NA_FILA' : resumo.estado;
    if (JSON.stringify(canais) !== atual.canaisJson || estado !== atual.estado) marcar(l.codigo, estado, resumo.erro, canais);
  }
  void processarCatalogo();
}
