import { db, obterConfig, atualizarConfig } from './db.js';

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

/**
 * Le JSON sem arredondar inteiros com 16+ digitos (order_id e apply_id da 99Food sao 64 bits):
 * eles viram texto. Strings sao casadas primeiro e ficam intactas.
 */
export function lerJson<T = any>(texto: string): T | null {
  if (!texto) return null;
  try {
    return JSON.parse(texto.replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![\d.eE])/g, (t) => (t.startsWith('"') ? t : `"${t}"`))) as T;
  } catch {
    return null;
  }
}

export interface RespostaHub<T = any> {
  ok: boolean;
  status: number;
  json: T | null;
  text: string;
}

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

  const headers: Record<string, string> = { ...(opcoes.headers ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const reqBody = opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined;
  if (reqBody !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const inicio = Date.now();
  let status = 0;
  let text = '';
  try {
    const res = await fetch(url, { method: metodo, headers, body: reqBody, signal: AbortSignal.timeout(opcoes.timeoutMs ?? 30_000) });
    status = res.status;
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
      erroResumo: ok ? '' : [j?.codigo, j?.erro ?? j?.message].filter(Boolean).join(' — ') || `HTTP ${status || 'REDE'}`,
      headers,
      reqBody,
      resBody: json ? JSON.stringify(json, null, 2) : text,
      curl: montarCurl(metodo, url, headers, reqBody),
    });
  }

  return { ok, status, json, text };
}

/** Mensagem legivel de uma resposta de erro do Hub, com o codigo para consulta. */
export function mensagemDoHub(r: RespostaHub<any>): string {
  const j = r.json as any;
  const texto = j?.erro ?? j?.message ?? j?.mensagem ?? (r.status === 0 ? `Sem resposta do Hub: ${r.text}` : `Hub respondeu HTTP ${r.status}`);
  const detalhe = j?.detalhes?.resposta?.errmsg ?? j?.detalhes?.resposta?.error?.message ?? j?.detalhes?.motivo;
  return `${j?.codigo ? `[${j.codigo}] ` : ''}${texto}${detalhe ? ` (${detalhe})` : ''}`;
}

/** Atualiza estado, transporte e lojas vinculadas a partir do Hub. */
export async function atualizarEstadoConexao() {
  const cfg = obterConfig();
  if (!cfg.tokenConexao) return;
  const r = await hubFetch<any>('/hub/v1/conexao', { silenciarSucesso: () => true });
  if (r.ok && r.json) {
    atualizarConfig({
      estadoConexao: r.json.estado ?? cfg.estadoConexao,
      lojasVinculadasJson: JSON.stringify(r.json.lojas ?? []),
      ...(r.json.transporte?.modo ? { transporte: r.json.transporte.modo } : {}),
    });
  }
}
