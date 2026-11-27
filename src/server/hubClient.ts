import { db, obterConfig, atualizarConfig } from './db.js';
import { conexaoEncerrada, conexaoPronta, encerrarConexao } from './conexao/estado.js';
import { lerJson } from '../shared/json.js';
import { mensagemDoHub } from './hubErros.js';

export { lerJson, mensagemDoHub };

const MAX_LOGS = 1500;

export function registrarLog(entrada: {
  metodo: string;
  url: string;
  status: number;
  ms: number;
  erroResumo?: string;
  headers?: Record<string, unknown>;
  reqBody?: string;
  resBody?: string;
  curl?: string;
}) {
  db.prepare(`
    INSERT INTO logs_http (quando, metodo, url, status, ms, erroResumo, reqHeaders, reqBody, resBody, curl)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    entrada.metodo,
    entrada.url,
    entrada.status,
    entrada.ms,
    entrada.erroResumo ?? '',
    JSON.stringify(entrada.headers ?? {}),
    entrada.reqBody ?? '',
    entrada.resBody ?? '',
    entrada.curl ?? '',
  );
  // Retem apenas os MAX_LOGS registros mais recentes
  db.prepare('DELETE FROM logs_http WHERE id <= (SELECT MAX(id) FROM logs_http) - ?').run(MAX_LOGS);
}

/** cURL completo, com o token: ferramenta de homologacao, o comando copiado precisa funcionar. */
function montarCurl(metodo: string, url: string, headers: Record<string, string>, corpo?: string): string {
  const partes = [`curl -X ${metodo} '${url}'`];
  for (const [k, v] of Object.entries(headers)) partes.push(`  -H '${k}: ${v}'`);
  if (corpo !== undefined) partes.push(`  -d '${corpo.replace(/'/g, "'\\''")}'`);
  return partes.join(' \\\n');
}

export interface RespostaHub<T = any> {
  ok: boolean;
  status: number;
  json: T | null;
  text: string;
  /** Cabecalho Retry-After do Hub, em segundos. */
  retryAfterS?: number;
}

/** Resposta dada pelo proprio ERP, sem chamar o Hub: nao ha token que valha. */
export const respostaLocal = (codigo: string, erro: string): RespostaHub<any> => ({ ok: false, status: 409, json: { codigo, erro }, text: '' });
const encerrada = () => respostaLocal('CONEXAO_ENCERRADA', 'Conexão encerrada: o Hub recusou o token desta conexão.');

export interface OpcoesHub {
  metodo?: string;
  tokenTipo?: 'integrador' | 'conexao' | 'nenhum';
  tokenExplicito?: string;
  baseExplicita?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Consultas de rotina (ex.: PULL sem eventos) nao enchem o historico: so sao gravadas se falharem. */
  silenciarSucesso?: (json: unknown) => boolean;
}

export async function hubFetch<T = any>(caminho: string, opcoes: OpcoesHub = {}): Promise<RespostaHub<T>> {
  const cfg = obterConfig();
  const base = (opcoes.baseExplicita ?? cfg.baseUrl).replace(/\/$/, '');
  const url = `${base}${caminho.startsWith('/') ? caminho : `/${caminho}`}`;
  const metodo = (opcoes.metodo ?? 'GET').toUpperCase();
  const token = opcoes.tokenExplicito ?? (opcoes.tokenTipo === 'integrador' ? cfg.tokenIntegracao : opcoes.tokenTipo === 'nenhum' ? '' : cfg.tokenConexao);

  const usaConexao = opcoes.tokenExplicito === undefined && (opcoes.tokenTipo ?? 'conexao') === 'conexao';
  if (usaConexao && !token) return respostaLocal('SEM_CONEXAO', 'Nenhuma empresa conectada.');
  if (usaConexao && conexaoEncerrada()) return encerrada();

  const headers: Record<string, string> = { ...(opcoes.headers ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const reqBody = opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined;
  if (reqBody !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const inicio = Date.now();
  let status = 0;
  let text = '';
  let retryAfterS: number | undefined;
  try {
    const res = await fetch(url, { method: metodo, headers, body: reqBody, signal: AbortSignal.timeout(opcoes.timeoutMs ?? 30_000) });
    status = res.status;
    retryAfterS = Number(res.headers.get('retry-after')) || undefined;
    text = await res.text();
  } catch (err) {
    status = 0;
    text = err instanceof Error ? err.message : 'Falha de conexão com o Hub';
  }
  const json = lerJson<T>(text);
  const ok = status >= 200 && status < 300;

  if (!(ok && opcoes.silenciarSucesso?.(json))) {
    const j = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
    registrarLog({
      metodo,
      url,
      status,
      ms: Date.now() - inicio,
      erroResumo: ok ? '' : [j?.codigo, j?.erro ?? j?.message].filter(Boolean).join(' — ') || (status ? `HTTP ${status}` : `REDE — ${text}`),
      headers,
      reqBody,
      resBody: json ? JSON.stringify(json, null, 2) : text,
      curl: montarCurl(metodo, url, headers, reqBody),
    });
  }

  // Conexao excluida, revogada ou token trocado. So vale se o token recusado ainda e o salvo
  if (usaConexao && status === 401 && (json as any)?.codigo === 'TOKEN_INVALIDO' && obterConfig().tokenConexao === token) {
    encerrarConexao();
    return encerrada();
  }

  return { ok, status, json, text, retryAfterS };
}

/** Atualiza estado, transporte e lojas vinculadas a partir do Hub. */
export async function atualizarEstadoConexao() {
  const cfg = obterConfig();
  if (!conexaoPronta()) return;
  const r = await hubFetch<any>('/hub/v1/conexao', { silenciarSucesso: () => true });
  if (r.ok && r.json && obterConfig().tokenConexao === cfg.tokenConexao) {
    atualizarConfig({
      estadoConexao: r.json.estado ?? cfg.estadoConexao,
      lojasVinculadasJson: JSON.stringify(r.json.lojas ?? []),
      ...(r.json.transporte?.modo ? { transporte: r.json.transporte.modo } : {}),
    });
  }
}
