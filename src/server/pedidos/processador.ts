import crypto from 'crypto';
import { db, lerAjuste, obterConfig } from '../db.js';
import { atualizarEstadoConexao, hubFetch, lerJson, mensagemDoHub, registrarLog } from '../hubClient.js';
import { notificar } from '../stream.js';
import { detalheValido, extrasDe } from './detalhe.js';
import { Efeito, interpretarEvento } from './eventos.js';
import { avancarStatus, ehSimulado } from './regras.js';
import { mesclarDetalhe, obterPedido, paraTela, pedidoNovo, RegistroPedido, salvarPedido } from './repositorio.js';

/**
 * Chegada de pedidos em duas etapas:
 * 1) receberEvento grava o evento bruto (PUSH responde 200 e PULL confirma o cursor so depois disso);
 * 2) processarFila aplica no pedido, com nova tentativa se o detalhe nao puder ser lido. Nada se perde.
 */
export type Origem = 'PUSH' | 'PULL' | 'RECONCILIACAO';

export interface EventoRecebido {
  id: string;
  origem: Origem;
  seq: number | null;
  plataforma: string;
  pedidoId: string;
  tipo: string;
  corpo: string;
  ocorridoEm?: string;
  teste?: boolean;
}

interface LinhaEvento extends Omit<EventoRecebido, 'teste'> {
  ocorridoEm: string;
  tentativas: number;
}

const ESPERAS_S = [2, 5, 15, 30, 60, 120, 300];
const MAX_TENTATIVAS = 60;
/** Aceite automatico e alerta sonoro valem so para pedido que acabou de chegar. */
const RECENTE_MS = 10 * 60_000;

function dataDoCorpo(corpo: any): string | null {
  const bruto = corpo?.createdAt ?? corpo?.criadoEm ?? corpo?.timestamp;
  if (bruto === undefined || bruto === null) return null;
  const n = Number(bruto);
  const d = new Date(Number.isFinite(n) && String(bruto).trim() !== '' ? (n < 1e12 ? n * 1000 : n) : bruto);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function receberEvento(ev: EventoRecebido): boolean {
  const conexaoId = obterConfig().conexaoId;
  const agora = new Date().toISOString();
  const ocorridoEm = ev.ocorridoEm ?? dataDoCorpo(lerJson(ev.corpo)) ?? agora;

  if (ev.seq !== null) {
    const mesmo = db.prepare('SELECT id, origem FROM eventos WHERE conexaoId = ? AND seq = ?').get(conexaoId, ev.seq) as { id: string; origem: Origem } | undefined;
    if (mesmo) {
      // A reconciliacao chegou antes do webhook: agora vem o corpo, com os dados da disputa ou solicitacao
      if (mesmo.origem !== 'RECONCILIACAO' || !ev.corpo) return false;
      db.prepare("UPDATE eventos SET corpo = ?, origem = ?, ocorridoEm = ?, estado = 'PENDENTE', tentativas = 0, proximaEm = 0 WHERE id = ?").run(ev.corpo, ev.origem, ocorridoEm, mesmo.id);
      return true;
    }
  }

  const semPedido = ev.teste || !ev.pedidoId || ev.plataforma === 'HUB';
  const r = db
    .prepare(`
      INSERT OR IGNORE INTO eventos (id, conexaoId, seq, origem, plataforma, pedidoId, tipo, corpo, ocorridoEm, recebidoEm, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(ev.id, conexaoId, ev.seq, ev.origem, ev.plataforma, ev.pedidoId, ev.tipo, ev.corpo, ocorridoEm, agora, semPedido ? 'PROCESSADO' : 'PENDENTE');
  return r.changes > 0;
}

// ── Processamento ────────────────────────────────────────────────────────────

/** Um pedido por vez dentro dele mesmo; pedidos diferentes em paralelo (um lento nao segura os outros). */
const emAndamento = new Map<string, Promise<void>>();

export function processarFila(): Promise<void> {
  const pendentes = db.prepare("SELECT DISTINCT pedidoId FROM eventos WHERE estado = 'PENDENTE' AND proximaEm <= ? LIMIT 100").all(Date.now()) as Array<{ pedidoId: string }>;
  for (const { pedidoId } of pendentes) {
    if (emAndamento.has(pedidoId)) continue;
    emAndamento.set(
      pedidoId,
      processarPedido(pedidoId).finally(() => emAndamento.delete(pedidoId)),
    );
  }
  return Promise.all(emAndamento.values()).then(() => undefined);
}

async function processarPedido(pedidoId: string) {
  for (;;) {
    const ev = db
      .prepare("SELECT * FROM eventos WHERE estado = 'PENDENTE' AND pedidoId = ? AND proximaEm <= ? ORDER BY ocorridoEm, seq LIMIT 1")
      .get(pedidoId, Date.now()) as LinhaEvento | undefined;
    if (!ev) return;
    try {
      await processarEvento(ev);
      db.prepare("UPDATE eventos SET estado = 'PROCESSADO', erro = '' WHERE id = ?").run(ev.id);
    } catch (err) {
      const tentativas = ev.tentativas + 1;
      const erro = err instanceof Error ? err.message : String(err);
      const espera = ESPERAS_S[Math.min(tentativas - 1, ESPERAS_S.length - 1)];
      db.prepare('UPDATE eventos SET estado = ?, tentativas = ?, proximaEm = ?, erro = ? WHERE id = ?').run(
        tentativas >= MAX_TENTATIVAS ? 'ERRO' : 'PENDENTE',
        tentativas,
        Date.now() + espera * 1000,
        erro,
        ev.id,
      );
      registrarLog({ metodo: 'EVENTO', url: `pedido ${pedidoId} · ${ev.tipo}`, status: 0, ms: 0, erroResumo: `Tentativa ${tentativas}: ${erro}`, reqBody: ev.corpo });
      notificar('pedidos', { pedidoId });
    }
  }
}

export function aplicarEfeito(p: RegistroPedido, efeito: Efeito, ev: { id: string; seq: number | null; origem: string; ocorridoEm: string; corpo: string }) {
  const est = p.estado;
  const pend = est.pendencias;
  if (!p.eventos.some((e) => e.id === ev.id)) {
    p.eventos.push({ id: ev.id, seq: ev.seq, tipo: efeito.tipo, rotulo: efeito.rotulo, ocorridoEm: ev.ocorridoEm, origem: ev.origem });
    p.eventos.sort((a, b) => b.ocorridoEm.localeCompare(a.ocorridoEm));
    p.eventos.length = Math.min(p.eventos.length, 60);
  }
  if (p.eventos[0]?.id === ev.id) p.etapaPlataforma = efeito.tipo;

  p.statusKanban = avancarStatus(p.statusKanban, efeito.status);
  if (efeito.preparoIniciado) est.preparoIniciado = true;
  if (efeito.entregador) est.entregador = efeito.entregador;
  if (efeito.etapaEntrega) est.etapaEntrega = efeito.etapaEntrega;
  if (efeito.motivoCancelamento) est.motivoCancelamento = efeito.motivoCancelamento;

  if (efeito.disputa && !est.resolvidas.includes(efeito.disputa.id)) pend.disputa = efeito.disputa;
  if (efeito.disputaEncerrada !== undefined) {
    if (efeito.disputaEncerrada) est.resolvidas.push(efeito.disputaEncerrada);
    if (!efeito.disputaEncerrada || pend.disputa?.id === efeito.disputaEncerrada) pend.disputa = null;
  }
  if (efeito.cancelamentoCliente && !est.resolvidas.includes(efeito.cancelamentoCliente.applyId)) pend.cancelamentoCliente = efeito.cancelamentoCliente;
  if (efeito.reembolso && !est.resolvidas.includes(efeito.reembolso.applyId)) pend.reembolso = efeito.reembolso;
  if (efeito.cancelamentoLojaRecusado) pend.cancelamentoLoja = null;
  // Se a recusa chegou antes da confirmacao de analise (fora de ordem), nao volta a marcar como em analise
  const jaRecusado = p.eventos.some((e) => e.tipo === 'CANCELLATION_REQUEST_FAILED' && e.ocorridoEm >= ev.ocorridoEm);
  if (efeito.cancelamentoEmAnalise && ev.corpo && !jaRecusado) pend.cancelamentoLoja = { motivo: efeito.cancelamentoEmAnalise, desde: ev.ocorridoEm };

  if (p.statusKanban === 'CANCELADO') {
    pend.cancelamentoCliente = null;
    pend.cancelamentoLoja = null;
  }
  if (efeito.aviso && !est.avisos.some((a) => a.id === ev.id)) {
    est.avisos = [{ id: ev.id, em: ev.ocorridoEm, ...efeito.aviso }, ...est.avisos].slice(0, 30);
  }
}

export async function buscarDetalhe(pedidoId: string, plataforma: string): Promise<any> {
  const plat = plataforma === 'IFOOD' || plataforma === '99FOOD' ? `plataforma=${plataforma}&` : '';
  const r = await hubFetch(`/hub/v1/conexao/pedidos/${encodeURIComponent(pedidoId)}?${plat}formato=unificado`);
  if (!r.ok || !detalheValido(r.json)) throw new Error(r.ok ? 'O Hub respondeu sem os itens do pedido.' : mensagemDoHub(r));
  return r.json;
}

async function processarEvento(ev: LinhaEvento) {
  const corpo = lerJson<any>(ev.corpo);
  const efeito = interpretarEvento(ev.plataforma, ev.tipo, corpo, ev.ocorridoEm);
  const existente = obterPedido(ev.pedidoId);
  const pedido = existente ?? pedidoNovo(ev.pedidoId, ev.plataforma, ev.ocorridoEm);
  aplicarEfeito(pedido, efeito, ev);

  const embutido = corpo?.pedido ?? (corpo?.dados?.itens ? corpo.dados : null);
  const temEmbutido = !!embutido && mesclarDetalhe(pedido, embutido);
  const recente = Date.now() - new Date(ev.ocorridoEm).getTime() < RECENTE_MS;
  salvarPedido(pedido);
  // O card aparece (e toca) na hora, mesmo antes de o detalhe chegar
  notificar('pedidos', { pedidoId: pedido.id, novo: !existente && pedido.statusKanban === 'NOVO' && recente, aviso: efeito.aviso?.texto ?? null, codigo: pedido.codigoCurto, canal: pedido.plataforma });

  if (recente) await aceitarAutomaticamente(pedido.id);

  if (!temEmbutido && (efeito.recarregar || pedido.detalhePendente)) {
    const detalhe = await buscarDetalhe(pedido.id, ev.plataforma);
    const atual = obterPedido(pedido.id)!;
    mesclarDetalhe(atual, detalhe);
    salvarPedido(atual);
    notificar('pedidos', { pedidoId: atual.id });
  }
  if (recente) await iniciarPreparoDoAceiteAutomatico(pedido.id);
}

// ── Acoes ────────────────────────────────────────────────────────────────────

export class ErroDeAcao extends Error {
  constructor(public status: number, mensagem: string, public resposta?: unknown) {
    super(mensagem);
  }
}

const RESPOSTAS_A_PENDENCIA = new Set(['acceptCancellation', 'denyCancellation', 'counterOffer', 'acceptRefund', 'denyRefund']);
const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Converte o que a tela informa para o formato que o Hub espera em cada plataforma. */
export function dadosDaAcao(p: RegistroPedido, acao: string, entrada: Record<string, unknown>): Record<string, unknown> {
  const e = entrada ?? {};
  const noventaENove = p.plataforma === '99FOOD';
  const pend = p.estado.pendencias;
  switch (acao) {
    case 'dispatch':
    case 'updateCourier':
      return texto(e.nome) ? { courierName: texto(e.nome), courierPhone: texto(e.telefone).replace(/\D/g, '') } : {};
    case 'validatePickupCode':
    case 'verifyDeliveryCode':
      return { code: texto(e.codigo) };
    case 'requestCancellation': {
      const codigo = texto(e.codigo);
      if (!codigo) throw new ErroDeAcao(400, 'Escolha o motivo do cancelamento.');
      const motivo = texto(e.texto) || 'Cancelamento solicitado pela loja';
      return noventaENove ? { reason_id: Number(codigo), cancellationCode: codigo, reason: motivo } : { cancellationCode: codigo, reason: motivo };
    }
    case 'acceptCancellation':
    case 'denyCancellation': {
      const motivo = texto(e.texto);
      if (pend.cancelamentoCliente) return { applyId: pend.cancelamentoCliente.applyId, ...(motivo ? { reason: motivo } : {}) };
      return { ...(pend.disputa ? { disputeId: pend.disputa.id } : {}), ...(motivo ? { detailReason: motivo } : {}) };
    }
    case 'counterOffer': {
      if (!pend.disputa) throw new ErroDeAcao(409, 'Não há disputa aberta.');
      const tipo = texto(e.tipo);
      if (tipo === 'REFUND') {
        const centavos = Math.round(Number(String(e.valor ?? '').replace(',', '.')) * 100);
        if (!(centavos > 0)) throw new ErroDeAcao(400, 'Informe o valor do reembolso proposto.');
        return { disputeId: pend.disputa.id, type: tipo, metadata: { amount: { value: String(centavos), currency: 'BRL' } } };
      }
      const minutos = Math.floor(Number(e.minutos));
      if (tipo !== 'ADDITIONAL_TIME' || !(minutos > 0) || !texto(e.motivoTempo)) throw new ErroDeAcao(400, 'Informe os minutos e o motivo do tempo adicional.');
      return { disputeId: pend.disputa.id, type: tipo, metadata: { additionalTimeInMinutes: minutos, additionalTimeReason: texto(e.motivoTempo) } };
    }
    case 'acceptRefund':
    case 'denyRefund': {
      if (!pend.reembolso) throw new ErroDeAcao(409, 'Não há pedido de reembolso aberto.');
      if (acao === 'acceptRefund') return { applyId: pend.reembolso.applyId };
      const escolhido = pend.reembolso.motivos.find((m) => m.id === texto(e.codigo));
      if (!escolhido) throw new ErroDeAcao(400, 'Escolha o motivo da recusa do reembolso.');
      return { applyId: pend.reembolso.applyId, baseReasonId: escolhido.id, baseReason: escolhido.texto, ...(texto(e.texto) ? { reason: texto(e.texto) } : {}) };
    }
    case 'assignDriver':
      return { workerName: texto(e.nome), workerPhone: texto(e.telefone).replace(/\D/g, ''), workerVehicleType: texto(e.veiculo) || 'MOTORCYCLE' };
    case 'adjustItem': {
      const linha = extrasDe(p.plataforma, p.detalhe).itensAjustaveis.find((i) => i.mduId === texto(e.mduId));
      const quantidade = Math.floor(Number(e.quantidade));
      if (!linha || quantidade < 1 || quantidade > linha.quantidade) throw new ErroDeAcao(400, 'Escolha o item e uma quantidade válida.');
      const mdu = Number(linha.mduId);
      return { cancel: { items: [{ app_item_id: linha.appItemId, mdu_id: Number.isSafeInteger(mdu) ? mdu : linha.mduId, cancel_amount: quantidade }] }, adjust: { items: [] } };
    }
    default:
      return {};
  }
}

/** Reflexo da acao aceita pelo Hub. O evento da plataforma confirma em seguida (a etapa nunca regride). */
function aplicarAcao(p: RegistroPedido, acao: string, dados: Record<string, any>) {
  const est = p.estado;
  const pend = est.pendencias;
  const imediato = ehSimulado(p.id) || p.plataforma === '99FOOD';
  const motivo = String(dados.reason ?? dados.detailReason ?? '');
  const resolver = (id?: string) => id && est.resolvidas.push(id);
  const status = (s: RegistroPedido['statusKanban']) => (p.statusKanban = avancarStatus(p.statusKanban, s));

  if (dados.courierName) est.entregador = { nome: dados.courierName, telefone: dados.courierPhone ?? '' };
  switch (acao) {
    case 'confirm':
      status('PREPARO');
      break;
    case 'startPreparation':
      status('PREPARO');
      est.preparoIniciado = true;
      break;
    case 'readyToPickup':
      status('PRONTO');
      break;
    case 'dispatch':
      status('ENTREGA');
      break;
    case 'conclude':
    case 'delivered':
    case 'pickedUp':
      status('CONCLUIDO');
      break;
    case 'assignDriver':
      est.entregador = { nome: dados.workerName, telefone: dados.workerPhone };
      break;
    case 'goingToOrigin':
      est.etapaEntrega = 'A caminho da loja';
      break;
    case 'arrivedAtOrigin':
      est.etapaEntrega = 'Na loja';
      break;
    case 'arrivedAtDestination':
      est.etapaEntrega = 'No endereço do cliente';
      break;
    case 'requestCancellation':
      // iFood e assincrono: so os eventos CANCELLED ou CANCELLATION_REQUEST_FAILED decidem
      if (imediato) {
        status('CANCELADO');
        est.motivoCancelamento = motivo;
      } else pend.cancelamentoLoja = { motivo, desde: new Date().toISOString() };
      break;
    case 'acceptCancellation':
      resolver(pend.cancelamentoCliente?.applyId ?? pend.disputa?.id);
      pend.cancelamentoCliente = null;
      pend.disputa = null;
      if (imediato) {
        status('CANCELADO');
        est.motivoCancelamento = motivo || 'Cancelamento do cliente aceito';
      }
      break;
    case 'counterOffer':
    case 'denyCancellation':
      resolver(pend.cancelamentoCliente?.applyId ?? pend.disputa?.id);
      pend.cancelamentoCliente = null;
      pend.disputa = null;
      break;
    case 'acceptRefund':
    case 'denyRefund':
      resolver(pend.reembolso?.applyId);
      pend.reembolso = null;
      break;
    case 'adjustItem':
      p.detalhePendente = true;
      break;
  }
  if (p.statusKanban === 'CANCELADO') {
    pend.cancelamentoCliente = null;
    pend.cancelamentoLoja = null;
  }
}

export async function executarAcao(pedidoId: string, acao: string, entrada: Record<string, unknown> = {}, intencao: string = crypto.randomUUID()) {
  const p = obterPedido(pedidoId);
  if (!p) throw new ErroDeAcao(404, 'Pedido não encontrado.');
  const tela = paraTela(p);
  const pendente =
    RESPOSTAS_A_PENDENCIA.has(acao) && (acao.endsWith('Refund') ? !!p.estado.pendencias.reembolso : !!(p.estado.pendencias.disputa || p.estado.pendencias.cancelamentoCliente));
  if (!pendente && !tela.acoes.some((a) => a.acao === acao)) throw new ErroDeAcao(409, 'Esta ação não vale para a etapa atual do pedido. Atualize a tela.');
  const dados = dadosDaAcao(p, acao, entrada);

  const enviar = async (nome: string, corpo: Record<string, unknown>, chave: string) => {
    const r = await hubFetch(`/hub/v1/conexao/pedidos/${encodeURIComponent(pedidoId)}/acao`, {
      metodo: 'POST',
      headers: { 'Idempotency-Key': chave },
      body: { acao: nome, ...(p.plataforma !== 'TD' ? { plataforma: p.plataforma } : {}), ...(Object.keys(corpo).length ? { dados: corpo } : {}) },
      timeoutMs: 45_000,
    });
    if (!r.ok) throw new ErroDeAcao(r.status || 502, mensagemDoHub(r), r.json);
    return r.json;
  };

  // O iFood exige "pronto" antes do despacho e o Hub nao encadeia. Se ja estiver pronto, segue para o despacho
  if (acao === 'dispatch' && p.plataforma === 'IFOOD' && p.statusKanban === 'PREPARO' && !ehSimulado(pedidoId)) {
    await enviar('readyToPickup', {}, `erp-${intencao}-pronto`).catch(() => undefined);
  }
  const resposta = await enviar(acao, dados, `erp-${intencao}`);

  const atual = obterPedido(pedidoId)!;
  aplicarAcao(atual, acao, dados as Record<string, any>);
  aplicarEfeito(atual, { tipo: `ERP_${acao}`, rotulo: tela.acoes.find((a) => a.acao === acao)?.rotulo ?? acao }, { id: `erp-${intencao}`, seq: null, origem: 'ERP', ocorridoEm: new Date().toISOString(), corpo: '' });
  salvarPedido(atual);
  notificar('pedidos', { pedidoId });

  if (acao === 'adjustItem') {
    await buscarDetalhe(pedidoId, atual.plataforma)
      .then((d) => {
        const fresco = obterPedido(pedidoId)!;
        mesclarDetalhe(fresco, d);
        salvarPedido(fresco);
        notificar('pedidos', { pedidoId });
      })
      .catch(() => undefined);
  }
  return resposta;
}

export const aceiteAutomaticoLigado = () => lerAjuste('aceiteAutomatico', 'false') === 'true';

function avisarFalhaAutomatica(pedidoId: string, err: unknown) {
  const p = obterPedido(pedidoId);
  if (!p) return;
  const id = `auto-${Date.now()}`;
  p.estado.avisos = [{ id, em: new Date().toISOString(), nivel: 'alerta' as const, texto: `Aceite automático falhou: ${err instanceof Error ? err.message : err}` }, ...p.estado.avisos].slice(0, 30);
  salvarPedido(p);
  notificar('pedidos', { pedidoId, aviso: 'Aceite automático falhou. Aceite manualmente.' });
}

async function aceitarAutomaticamente(pedidoId: string) {
  const p = obterPedido(pedidoId);
  if (!p || !aceiteAutomaticoLigado() || p.statusKanban !== 'NOVO' || p.plataforma === 'TD' || p.estado.aceiteAutomaticoFeito) return;
  p.estado.aceiteAutomaticoFeito = true;
  salvarPedido(p);
  await executarAcao(pedidoId, 'confirm').catch((err) => avisarFalhaAutomatica(pedidoId, err));
}

/** No iFood o aceite nao inicia o preparo; pedido agendado so inicia no horario (ver iniciarAgendados). */
async function iniciarPreparoDoAceiteAutomatico(pedidoId: string) {
  const p = obterPedido(pedidoId);
  if (!p || !p.estado.aceiteAutomaticoFeito || p.plataforma !== 'IFOOD' || p.statusKanban !== 'PREPARO' || p.estado.preparoIniciado || p.detalhePendente) return;
  if (extrasDe(p.plataforma, p.detalhe).agendamento) return;
  await executarAcao(pedidoId, 'startPreparation').catch((err) => avisarFalhaAutomatica(pedidoId, err));
}

/** Pedido agendado do iFood: o preparo comeca no horario que a plataforma informou. */
export async function iniciarAgendados() {
  const linhas = db.prepare("SELECT id FROM pedidos WHERE plataforma = 'IFOOD' AND statusKanban = 'PREPARO'").all() as Array<{ id: string }>;
  for (const { id } of linhas) {
    const p = obterPedido(id)!;
    const inicio = extrasDe(p.plataforma, p.detalhe).agendamento?.inicioPreparo;
    if (!inicio || p.estado.preparoIniciado || new Date(inicio).getTime() > Date.now()) continue;
    await executarAcao(id, 'startPreparation').catch((err) => avisarFalhaAutomatica(id, err));
  }
}

// ── PULL e reconciliacao ─────────────────────────────────────────────────────

interface EventoPull {
  seq: number;
  id: string;
  plataforma: string;
  pedido: string;
  tipo: string;
  recebidoEm: string;
  teste: boolean;
  corpo: string | null;
}

let puxando = false;

export async function puxarEventos(): Promise<number> {
  const cfg = obterConfig();
  if (puxando || !cfg.tokenConexao || cfg.transporte === 'PUSH') return 0;
  puxando = true;
  let total = 0;
  try {
    for (;;) {
      const r = await hubFetch<{ eventos: EventoPull[]; lacuna?: { de: number; ate: number } | null }>('/hub/v1/eventos?espera=0&limite=100', {
        silenciarSucesso: (j: any) => !j?.eventos?.length && !j?.lacuna,
      });
      if (!r.ok) {
        // O transporte mudou no Hub (ex.: PUSH ligado por outro lado): atualiza a configuracao local
        if ((r.json as any)?.codigo === 'TRANSPORTE_PUSH_ATIVO') await atualizarEstadoConexao();
        break;
      }
      const eventos = r.json?.eventos ?? [];
      if (r.json?.lacuna) await reconciliar();
      if (!eventos.length) break;
      db.transaction(() => {
        for (const ev of eventos) {
          receberEvento({ id: ev.id || `pull-${cfg.conexaoId}-${ev.seq}`, origem: 'PULL', seq: ev.seq, plataforma: ev.plataforma, pedidoId: ev.pedido ?? '', tipo: ev.tipo, corpo: ev.corpo ?? '', ocorridoEm: dataDoCorpo(lerJson(ev.corpo ?? '')) ?? ev.recebidoEm, teste: ev.teste });
        }
      })();
      total += eventos.length;
      // Cursor confirmado so depois de os eventos estarem gravados
      const confirmado = await hubFetch('/hub/v1/eventos/confirmar', { metodo: 'POST', body: { ate: eventos[eventos.length - 1].seq } });
      if (!confirmado.ok || eventos.length < 100) break;
    }
  } finally {
    puxando = false;
  }
  if (total) await processarFila();
  return total;
}

let reconciliando = false;

/** Rede de seguranca para PUSH e PULL: compara a lista de pedidos do Hub com o que o ERP recebeu. */
export async function reconciliar(): Promise<number> {
  const cfg = obterConfig();
  if (reconciliando || !cfg.tokenConexao) return 0;
  reconciliando = true;
  let novos = 0;
  try {
    const r = await hubFetch<Array<{ plataforma: string; pedidoId: string; eventos: Array<{ seq: number; tipo: string; em: string }> }>>('/hub/v1/conexao/pedidos?limite=50', {
      silenciarSucesso: () => true,
    });
    if (!r.ok || !Array.isArray(r.json)) return 0;
    const agora = Date.now();
    for (const pedido of r.json) {
      if (!pedido.pedidoId) continue;
      for (const ev of pedido.eventos ?? []) {
        const idade = agora - new Date(ev.em).getTime();
        // Da 60 s para o webhook entregar o corpo completo; historico com mais de 2 dias nao e importado
        if (idade < 60_000 || idade > 48 * 3600_000) continue;
        if (receberEvento({ id: `rec-${cfg.conexaoId}-${ev.seq}`, origem: 'RECONCILIACAO', seq: ev.seq, plataforma: pedido.plataforma, pedidoId: pedido.pedidoId, tipo: ev.tipo, corpo: '', ocorridoEm: ev.em })) novos += 1;
      }
    }
  } finally {
    reconciliando = false;
  }
  if (novos) await processarFila();
  return novos;
}

export function contarFila() {
  const linhas = db.prepare("SELECT estado, COUNT(*) AS n FROM eventos WHERE estado != 'PROCESSADO' GROUP BY estado").all() as Array<{ estado: string; n: number }>;
  const n = (e: string) => linhas.find((l) => l.estado === e)?.n ?? 0;
  const comFalha = (db.prepare("SELECT COUNT(*) AS n FROM eventos WHERE estado = 'PENDENTE' AND tentativas > 0").get() as { n: number }).n;
  return { pendentes: n('PENDENTE'), comFalha, erro: n('ERRO') };
}

export function reprocessarFalhas(): number {
  return db.prepare("UPDATE eventos SET estado = 'PENDENTE', tentativas = 0, proximaEm = 0 WHERE estado = 'ERRO' OR (estado = 'PENDENTE' AND tentativas > 0)").run().changes;
}

/** Eventos ja aplicados com mais de 7 dias saem da caixa de entrada. */
export function limparEventosAntigos() {
  db.prepare("DELETE FROM eventos WHERE estado = 'PROCESSADO' AND recebidoEm < ?").run(new Date(Date.now() - 7 * 86_400_000).toISOString());
}
