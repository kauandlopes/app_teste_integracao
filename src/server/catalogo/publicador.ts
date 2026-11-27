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
/** Recusas que passam sozinhas: limite de frequencia da 99Food, tarefa de cardapio em andamento e 429. */
const TEMPORARIO = /10005|12021|HTTP_429|frequency|LIMITE_DA_INSTALACAO|RESULTADO_INCERTO/i;

interface LinhaProduto {
  codigo: string;
  definicaoJson: string;
  canaisJson: string;
  estado: EstadoProduto;
  erro: string;
  atualizadoEm: string;
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
    (db.prepare("SELECT codigo, COUNT(*) AS n FROM fila_catalogo WHERE estado = 'PENDENTE' GROUP BY codigo").all() as Array<{ codigo: string; n: number }>).map((l) => [l.codigo, l.n]),
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
  // Publicacao completa leva a definicao atual: ajustes pendentes ficam redundantes
  if (operacao === 'PUBLICAR' || operacao === 'REMOVER') db.prepare("DELETE FROM fila_catalogo WHERE codigo = ?").run(codigo);
  else if (operacao === 'PATCH' && temPendente(codigo, 'PUBLICAR')) return;
  db.prepare('INSERT INTO fila_catalogo (codigo, operacao, opcao, dadosJson) VALUES (?, ?, ?, ?)').run(codigo, operacao, opcao, JSON.stringify(dados));
  marcar(codigo, operacao === 'REMOVER' ? 'REMOVENDO' : 'NA_FILA');
  void processarCatalogo();
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
  db.prepare('UPDATE fila_catalogo SET tentativas = ?, proximaEm = ?, erro = ? WHERE id = ?').run(tentativas, Date.now() + espera * 1000, erro, t.id);
  marcar(t.codigo, 'NA_FILA', `Nova tentativa em ${espera} s. ${erro}`);
}

async function executar(t: Tarefa) {
  if (!linha(t.codigo)) return concluirTarefa(t.id);
  marcar(t.codigo, t.operacao === 'REMOVER' ? 'REMOVENDO' : 'ENVIANDO');
  const r = await enviar(t);
  const codigoErro = String((r.json as any)?.codigo ?? '');

  if (!r.ok) {
    // Ajuste de produto que o Hub ainda nao conhece vira publicacao completa
    if (r.status === 404 && codigoErro === 'NAO_ENCONTRADO') {
      concluirTarefa(t.id);
      if (t.operacao === 'REMOVER') {
        db.prepare('DELETE FROM produtos WHERE codigo = ?').run(t.codigo);
        notificar('catalogo', { codigo: t.codigo, removido: true });
        return;
      }
      return enfileirar(t.codigo, 'PUBLICAR');
    }
    const temporario = r.status === 0 || r.status === 429 || r.status >= 500 || TEMPORARIO.test(`${codigoErro} ${r.text}`);
    if (temporario) return adiar(t, mensagemDoHub(r));
    concluirTarefa(t.id);
    return marcar(t.codigo, 'ERRO', mensagemDoHub(r));
  }

  const registro = (r.json as any)?.resultados?.[0] ?? (r.json as any)?.resultado;
  const canais = (registro?.canais ?? {}) as Partial<Record<CanalPublicacao, SituacaoCanal>>;
  const resumo = resumirCanais(canais);
  // O Hub responde 200 mesmo quando um canal recusa: limite de frequencia e repetido sozinho
  if (resumo.erro && TEMPORARIO.test(JSON.stringify(canais))) {
    marcar(t.codigo, 'NA_FILA', resumo.erro, canais);
    return adiar(t, resumo.erro);
  }
  concluirTarefa(t.id);

  if (t.operacao === 'REMOVER') {
    const removido = Object.values(canais).every((c) => c.estado === 'REMOVIDO' || c.estado === 'SEM_LOJA');
    if (removido) {
      db.prepare('DELETE FROM produtos WHERE codigo = ?').run(t.codigo);
      notificar('catalogo', { codigo: t.codigo, removido: true });
      return;
    }
    return marcar(t.codigo, resumo.estado === 'PROCESSANDO' ? 'REMOVENDO' : resumo.estado, resumo.erro, canais);
  }

  marcar(t.codigo, resumo.estado, resumo.erro, canais);
  if (t.operacao === 'PUBLICAR') {
    for (const opcao of opcoesPausadasDaPizza(obterProduto(t.codigo)!)) enfileirar(t.codigo, 'PATCH_OPCAO', { disponivel: false }, opcao);
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

/** Consulta o resultado das publicacoes que a 99Food processa em segundo plano. */
export async function acompanharProcessamento(): Promise<void> {
  const linhas = db.prepare("SELECT codigo, estado, canaisJson FROM produtos WHERE estado IN ('PROCESSANDO','REMOVENDO')").all() as LinhaProduto[];
  for (const l of linhas) {
    if (db.prepare("SELECT 1 FROM fila_catalogo WHERE codigo = ? AND estado = 'PENDENTE'").get(l.codigo)) continue;
    const r = await hubFetch<any>(`/hub/v1/conexao/catalogo/produtos/${encodeURIComponent(l.codigo)}`, {
      silenciarSucesso: (j: any) => Object.values(j?.canais ?? {}).some((c: any) => c.estado === 'PROCESSANDO'),
    });
    if (!r.ok || !r.json?.canais) continue;
    const canais = r.json.canais as Partial<Record<CanalPublicacao, SituacaoCanal>>;
    const resumo = resumirCanais(canais);
    if (resumo.estado === 'PROCESSANDO') continue;
    if (l.estado === 'REMOVENDO' && Object.values(canais).every((c) => c.estado === 'REMOVIDO' || c.estado === 'SEM_LOJA')) {
      db.prepare('DELETE FROM produtos WHERE codigo = ?').run(l.codigo);
      notificar('catalogo', { codigo: l.codigo, removido: true });
      continue;
    }
    marcar(l.codigo, resumo.estado, resumo.erro, canais);
  }
}
