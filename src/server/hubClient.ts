import { db, obterConfig, atualizarConfig } from './db.js';

const MAX_LOGS = 1000;

export function registrarLog(entrada: {
  metodo: string;
  url: string;
  status: number;
  ms: number;
  erroResumo?: string;
  headers?: Record<string, string>;
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
  // Retem ate MAX_LOGS registros mais recentes
  db.prepare(`
    DELETE FROM logs_http WHERE id NOT IN (SELECT id FROM logs_http ORDER BY id DESC LIMIT ?)
  `).run(MAX_LOGS);
}

function montarCurl(metodo: string, url: string, headers: Record<string, string>, corpo?: string): string {
  const partes = [`curl -X ${metodo} '${url}'`];
  for (const [k, v] of Object.entries(headers)) {
    partes.push(`  -H '${k}: ${v}'`);
  }
  if (corpo !== undefined) {
    partes.push(`  -d '${corpo.replace(/'/g, "'\\''")}'`);
  }
  return partes.join(' \\\n');
}

export async function hubFetch<T = any>(
  caminho: string,
  opcoes: {
    metodo?: string;
    tokenTipo?: 'integrador' | 'conexao' | 'nenhum';
    tokenExplicito?: string;
    baseExplicita?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ ok: boolean; status: number; json: T | null; text: string }> {
  const cfg = obterConfig();
  const base = (opcoes.baseExplicita ?? cfg.baseUrl).replace(/\/$/, '');
  const url = `${base}${caminho.startsWith('/') ? caminho : `/${caminho}`}`;
  const metodo = (opcoes.metodo ?? 'GET').toUpperCase();
  const token =
    opcoes.tokenExplicito ??
    (opcoes.tokenTipo === 'integrador' ? cfg.tokenIntegracao : opcoes.tokenTipo === 'nenhum' ? '' : cfg.tokenConexao);

  const headers: Record<string, string> = { ...(opcoes.headers ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const reqBody = opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined;
  if (reqBody !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const inicio = Date.now();
  let status = 0;
  let text = '';
  let json: T | null = null;
  try {
    const res = await fetch(url, {
      method: metodo,
      headers,
      body: reqBody,
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    text = await res.text();
    try {
      json = text ? (JSON.parse(text) as T) : null;
    } catch {
      json = null;
    }
  } catch (err) {
    status = 0;
    text = err instanceof Error ? err.message : 'Falha de conexao com o Hub';
  }

  const ms = Date.now() - inicio;
  const jObj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  const erroResumo =
    status === 0 || status >= 400
      ? [jObj?.codigo, jObj?.erro ?? jObj?.message].filter(Boolean).join(' — ') || `HTTP ${status || 'REDE'}`
      : '';

  registrarLog({
    metodo,
    url,
    status,
    ms,
    erroResumo,
    headers,
    reqBody,
    resBody: json ? JSON.stringify(json, null, 2) : text,
    curl: montarCurl(metodo, url, headers, reqBody),
  });

  return { ok: status >= 200 && status < 300, status, json, text };
}

export function mapearEtapaParaKanban(etapa: string | null | undefined, atual?: string): string {
  const e = (etapa ?? '').toUpperCase();
  if (e === 'PLACED' || e === 'PLC') return 'NOVO';
  if (e === 'CONFIRMED' || e === 'CFM' || e === 'PREPARATION_STARTED') return 'PREPARO';
  if (e === 'READY_TO_PICKUP' || e === 'RTP') return 'PRONTO';
  if (e === 'DISPATCHED' || e === 'DSP') return 'ENTREGA';
  if (e === 'CONCLUDED' || e === 'CON') return 'CONCLUIDO';
  if (e === 'CANCELLED' || e === 'CAN') return 'CANCELADO';
  return atual || 'NOVO';
}

export function upsertPedidoDoDetalhe(pedidoId: string, plataforma: string, etapa: string, detalhe: any, eventoExtra?: any) {
  const existente = db.prepare('SELECT id, statusKanban, eventosJson FROM pedidos WHERE id = ?').get(pedidoId) as
    | { id: string; statusKanban: string; eventosJson: string }
    | undefined;
  const eventos = existente ? (JSON.parse(existente.eventosJson) as unknown[]) : [];
  if (eventoExtra) eventos.unshift(eventoExtra);

  const codigoCurto = String(detalhe?.displayId ?? detalhe?.order_index ?? pedidoId.slice(0, 6));
  const clienteNome = String(detalhe?.customer?.name ?? detalhe?.recipient?.name ?? 'Cliente Marketplace');
  const clienteTelefone = String(detalhe?.customer?.phone?.number ?? detalhe?.recipient?.phone ?? '');
  const endObj = detalhe?.delivery?.deliveryAddress;
  const endereco = endObj
    ? [endObj.streetName, endObj.streetNumber, endObj.neighborhood, endObj.city].filter(Boolean).join(', ')
    : String(detalhe?.orderType ?? 'RETIRADA');
  const totalReal = Number(detalhe?.total?.orderAmount ?? detalhe?.price?.order_price ?? 0);
  const itensJson = JSON.stringify(detalhe?.items ?? []);
  const statusKanban = mapearEtapaParaKanban(etapa, existente?.statusKanban);
  const agora = new Date().toISOString();

  db.prepare(`
    INSERT INTO pedidos (id, plataforma, codigoCurto, clienteNome, clienteTelefone, endereco, totalReal, statusKanban, etapaPlataforma, testeLocal, itensJson, detalheJson, eventosJson, criadoEm, atualizadoEm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      codigoCurto = excluded.codigoCurto,
      clienteNome = excluded.clienteNome,
      clienteTelefone = excluded.clienteTelefone,
      endereco = excluded.endereco,
      totalReal = excluded.totalReal,
      statusKanban = excluded.statusKanban,
      etapaPlataforma = excluded.etapaPlataforma,
      itensJson = excluded.itensJson,
      detalheJson = excluded.detalheJson,
      eventosJson = excluded.eventosJson,
      atualizadoEm = excluded.atualizadoEm
  `).run(
    pedidoId,
    plataforma,
    codigoCurto,
    clienteNome,
    clienteTelefone,
    endereco,
    totalReal,
    statusKanban,
    etapa,
    itensJson,
    JSON.stringify(detalhe ?? {}),
    JSON.stringify(eventos.slice(0, 30)),
    agora,
    agora,
  );
}

let syncRodando = false;

/** Worker leve: busca eventos PULL pendentes no Hub, importa detalhes de pedidos para SQLite e confirma cursor. */
export async function sincronizarComHub(): Promise<{ novosEventos: number }> {
  if (syncRodando) return { novosEventos: 0 };
  const cfg = obterConfig();
  if (!cfg.tokenConexao || cfg.transporte === 'PUSH') return { novosEventos: 0 };

  syncRodando = true;
  try {
    const res = await hubFetch<{ eventos: Array<{ seq: number; plataforma: string; pedido: string | null; tipo: string; recebidoEm: string; teste: boolean; corpo: string }> }>(
      '/hub/v1/eventos?espera=0&limite=50',
      { tokenTipo: 'conexao' },
    );
    if (!res.ok || !res.json?.eventos?.length) {
      return { novosEventos: 0 };
    }

    let maxSeq = 0;
    for (const ev of res.json.eventos) {
      if (ev.seq > maxSeq) maxSeq = ev.seq;
      if (ev.pedido && !ev.teste) {
        const det = await hubFetch(`/hub/v1/conexao/pedidos/${ev.pedido}?plataforma=${ev.plataforma}`, {
          tokenTipo: 'conexao',
        });
        upsertPedidoDoDetalhe(ev.pedido, ev.plataforma, ev.tipo, det.json ?? {}, {
          seq: ev.seq,
          tipo: ev.tipo,
          recebidoEm: ev.recebidoEm,
          corpo: ev.corpo,
        });
      }
    }

    if (maxSeq > 0) {
      await hubFetch('/hub/v1/eventos/confirmar', {
        metodo: 'POST',
        tokenTipo: 'conexao',
        body: { ate: maxSeq },
      });
    }

    // Atualiza estado das lojas vinculadas
    const est = await hubFetch<any>('/hub/v1/conexao', { tokenTipo: 'conexao' });
    if (est.ok && est.json) {
      atualizarConfig({
        estadoConexao: est.json.estado ?? cfg.estadoConexao,
        lojasVinculadasJson: JSON.stringify(est.json.lojas ?? []),
      });
    }

    return { novosEventos: res.json.eventos.length };
  } finally {
    syncRodando = false;
  }
}
