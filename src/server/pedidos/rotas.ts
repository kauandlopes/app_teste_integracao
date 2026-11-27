import crypto from 'crypto';
import { Router } from 'express';
import { db, gravarAjuste, obterConfig } from '../db.js';
import { hubFetch, lerJson, mensagemDoHub, registrarLog } from '../hubClient.js';
import { conexaoEncerrada } from '../conexao/estado.js';
import { notificar } from '../stream.js';
import type { MotivoCancelamento, StatusKanban } from '../../shared/tipos.js';
import { aceiteAutomaticoLigado, contarFila, ErroDeAcao, executarAcao, processarFila, puxarEventos, receberEvento, reconciliar, reprocessarFalhas } from './processador.js';
import { ehSimulado } from './regras.js';
import { listarPedidos, obterPedido, salvarPedido } from './repositorio.js';

/** Motivos da 99Food que a plataforma so aceita quando a entrega e da propria loja. */
const SO_ENTREGA_PROPRIA_99 = new Set(['1060', '1071', '1072']);

/** Assinatura do PUSH: v1=HMAC_SHA256(segredo, "timestamp.notificacao.corpo"). Na troca de segredo vem duas. */
function assinaturaConfere(segredo: string, cabecalho: string, timestamp: string, notificacao: string, corpo: Buffer): boolean {
  const esperado = Buffer.from(`v1=${crypto.createHmac('sha256', segredo).update(`${timestamp}.${notificacao}.`).update(corpo).digest('hex')}`);
  return cabecalho.split(',').some((s) => {
    const recebido = Buffer.from(s.trim());
    return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
  });
}

export function rotasPedidos(): Router {
  const api = Router();

  /** Receptor PUSH do Hub. Grava e responde na hora; o processamento acontece em seguida. */
  api.post('/webhook', (req: any, res) => {
    const inicio = Date.now();
    const cfg = obterConfig();
    const corpo: Buffer = req.rawBody ?? Buffer.from('');
    const h = (nome: string) => String(req.headers[nome] ?? '');
    const log = (status: number, resposta: unknown, erro = '') =>
      registrarLog({ metodo: 'WEBHOOK_PUSH', url: '/erp-simulador/api/webhook', status, ms: Date.now() - inicio, erroResumo: erro, headers: req.headers, reqBody: corpo.toString('utf8'), resBody: JSON.stringify(resposta) });

    if (cfg.webhookSegredo && !assinaturaConfere(cfg.webhookSegredo, h('x-target-assinatura'), h('x-target-timestamp'), h('x-target-notificacao'), corpo)) {
      const erro = { erro: 'Assinatura HMAC ausente ou inválida' };
      log(401, erro, h('x-target-assinatura') ? 'Assinatura HMAC não confere com o segredo salvo. Em "Tokens e rotas", use "Novo segredo do webhook".' : 'Chamada sem assinatura HMAC (não veio do Hub).');
      return res.status(401).json(erro);
    }

    // Ids de 64 bits do corpo continuam texto (req.body ja os teria arredondado)
    const dados = lerJson<any>(corpo.toString('utf8')) ?? {};
    const pedidoId = (h('x-target-pedido') || String(dados.orderId ?? dados.pedidoId ?? dados.pedido?.id ?? '')).trim();
    const id = h('x-target-evento') || h('x-target-notificacao') || String(dados.id ?? crypto.createHash('sha256').update(corpo).digest('hex'));
    // Falha aqui responde 500 e o Hub reenvia
    const novo = receberEvento({
      id,
      origem: 'PUSH',
      seq: h('x-target-seq') ? Number(h('x-target-seq')) : null,
      plataforma: h('x-target-plataforma') || String(dados.plataforma ?? 'IFOOD'),
      pedidoId,
      tipo: h('x-target-tipo') || String(dados.fullCode ?? dados.code ?? dados.type ?? dados.tipo ?? 'EVENTO'),
      corpo: corpo.toString('utf8'),
      teste: dados.teste === true,
    });
    const resposta = { recebido: true, novo };
    log(200, resposta);
    res.json(resposta);
    void processarFila();
  });

  api.get('/pedidos', (_req, res) => {
    res.json({ pedidos: listarPedidos(), aceiteAutomatico: aceiteAutomaticoLigado(), fila: contarFila() });
  });

  api.put('/ajustes', (req, res) => {
    gravarAjuste('aceiteAutomatico', req.body?.aceiteAutomatico ? 'true' : 'false');
    res.json({ aceiteAutomatico: aceiteAutomaticoLigado() });
  });

  api.post('/pedidos/sincronizar', async (_req, res) => {
    if (conexaoEncerrada()) return res.status(409).json({ erro: 'Conexão encerrada. Clique em "Conectar de novo".' });
    reprocessarFalhas();
    const puxados = await puxarEventos();
    const reconciliados = await reconciliar();
    await processarFila();
    res.json({ ok: true, novosEventos: puxados + reconciliados, fila: contarFila() });
  });

  /** Pedido de avaliacao: percorre o fluxo real do Hub (fila, PUSH ou PULL, webhook) sem tocar nas plataformas. */
  api.post('/pedidos/avaliar', async (req, res) => {
    const { plataforma, cenario } = req.body ?? {};
    const r = await hubFetch<any>('/hub/v1/conexao/avaliar-pedido', {
      metodo: 'POST',
      body: { ...(plataforma ? { plataforma } : {}), ...(cenario ? { cenario } : {}), comAdicionais: req.body?.comAdicionais !== false },
    });
    if (!r.ok) return res.status(r.status || 502).json({ erro: mensagemDoHub(r) });
    await puxarEventos();
    res.status(201).json(r.json);
  });

  api.post('/pedidos/teste', async (_req, res) => {
    const r = await hubFetch('/hub/v1/conexao/eventos/teste', { metodo: 'POST' });
    if (!r.ok) return res.status(r.status || 502).json({ erro: mensagemDoHub(r) });
    res.status(202).json(r.json ?? { ok: true });
  });

  api.delete('/pedidos/simulacoes', (_req, res) => {
    const r = db.prepare("DELETE FROM pedidos WHERE id LIKE 'simhub-%'").run();
    db.prepare("DELETE FROM eventos WHERE pedidoId LIKE 'simhub-%'").run();
    notificar('pedidos', {});
    res.json({ removidos: r.changes });
  });

  api.get('/pedidos/:id/motivos', async (req, res) => {
    const p = obterPedido(req.params.id);
    if (!p) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    const r = await hubFetch<any>(`/hub/v1/conexao/pedidos/${encodeURIComponent(p.id)}/subrecurso?tipo=motivos&plataforma=${p.plataforma}`);
    if (!r.ok) return res.status(r.status || 502).json({ erro: mensagemDoHub(r) });
    const lista: any[] = Array.isArray(r.json) ? r.json : (r.json?.reasons ?? []);
    const motivos: MotivoCancelamento[] = lista
      .map((m) => ({ codigo: String(m.cancelCodeId ?? m.code ?? m.reason_id ?? ''), descricao: String(m.description ?? m.reason ?? '') }))
      .filter((m) => m.codigo)
      .filter((m) => !(p.plataforma === '99FOOD' && p.modalidade !== 'ENTREGA_PROPRIA' && !ehSimulado(p.id) && SO_ENTREGA_PROPRIA_99.has(m.codigo)));
    res.json(motivos);
  });

  api.get('/pedidos/:id/subrecurso', async (req, res) => {
    const p = obterPedido(req.params.id);
    const plat = p && p.plataforma !== 'TD' ? `&plataforma=${p.plataforma}` : '';
    const r = await hubFetch(`/hub/v1/conexao/pedidos/${encodeURIComponent(req.params.id)}/subrecurso?tipo=${encodeURIComponent(String(req.query.tipo ?? 'rastreio'))}${plat}`);
    res.status(r.status || 502).json(r.ok ? r.json : { erro: mensagemDoHub(r) });
  });

  api.post('/pedidos/:id/acao', async (req, res) => {
    try {
      const resposta = await executarAcao(req.params.id, String(req.body?.acao ?? ''), req.body?.dados ?? {}, req.body?.intencao || undefined);
      res.json({ ok: true, resposta });
    } catch (err) {
      if (!(err instanceof ErroDeAcao)) throw err;
      res.status(err.status).json({ erro: err.message, resposta: err.resposta });
    }
  });

  /** Ajuste interno do ERP (observacao ou etapa no quadro). Nada e enviado a plataforma. */
  api.patch('/pedidos/:id', (req, res) => {
    const p = obterPedido(req.params.id);
    if (!p) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    if (typeof req.body?.observacaoErp === 'string') p.estado.observacaoErp = req.body.observacaoErp.trim();
    const etapas: StatusKanban[] = ['NOVO', 'PREPARO', 'PRONTO', 'ENTREGA', 'CONCLUIDO', 'CANCELADO'];
    if (etapas.includes(req.body?.statusKanban)) p.statusKanban = req.body.statusKanban;
    salvarPedido(p);
    notificar('pedidos', { pedidoId: p.id });
    res.json({ ok: true });
  });

  return api;
}
