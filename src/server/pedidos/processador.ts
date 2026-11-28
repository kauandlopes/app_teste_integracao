import crypto from 'crypto';
import { db, lerAjuste, obterConfig } from '../db.js';
import { atualizarEstadoConexao, hubFetch, lerJson, mensagemDoHub, registrarLog } from '../hubClient.js';
import { notificar } from '../stream.js';
import { conexaoEncerrada, conexaoPronta } from '../conexao/estado.js';
import { detalheValido, extrasDe } from './detalhe.js';
import { Efeito, interpretarEvento } from './eventos.js';
import { avancarStatus, ehSimulado } from './regras.js';
import { falhaVigente, mesclarDetalhe, obterPedido, paraTela, pedidoNovo, RegistroPedido, salvarPedido } from './repositorio.js';
import { lerAlternativas } from '../../shared/disputa.js';
import { casasDemais, lerPreco } from '../../shared/preco.js';
import type { FalhaAutomatica } from '../../shared/tipos.js';

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
/** Prazo de aceite de cada plataforma, contado da criacao do pedido. */
const PRAZO_ACEITE_MIN: Record<string, number> = { IFOOD: 8, '99FOOD': 5 };
const ESPERAS_AUTO_S = [5, 10, 20, 30, 60];
/** Eventos que so servem com o corpo: sem ele faltam os ids para responder. */
const PRECISA_DO_CORPO: Record<string, string> = {
  HANDSHAKE_DISPUTE: 'Disputa do iFood',
  CANCELLATION_REQUESTED: 'Solicitação de cancelamento',
  orderCancelApply: 'Pedido de cancelamento do cliente',
  orderRefundApply: 'Pedido de reembolso do cliente',
};

function dataDoCorpo(corpo: any): string | null {
  const bruto = corpo?.createdAt ?? corpo?.criadoEm ?? corpo?.timestamp;
  if (bruto === undefined || bruto === null) return null;
  const n = Number(bruto);
  const d = new Date(Number.isFinite(n) && String(bruto).trim() !== '' ? (n < 1e12 ? n * 1000 : n) : bruto);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Passo 1. So grava: quem chama pode responder 200 ao Hub (PUSH) ou confirmar o cursor (PULL) logo depois.
 * Devolve false quando o evento ja existia. Exemplo real da sequencia: src/shared/exemplos/pedido-ifood.json.
 */
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
  // Sem token valido o detalhe nao pode ser lido: os eventos esperam sem gastar tentativa
  if (conexaoEncerrada()) return Promise.resolve();
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
      // So conclui se o corpo continua o mesmo: um webhook que chegou durante o processamento volta para a fila
      db.prepare("UPDATE eventos SET estado = 'PROCESSADO', erro = '' WHERE id = ? AND corpo = ?").run(ev.id, ev.corpo);
    } catch (err) {
      if (conexaoEncerrada()) return;
      const tentativas = ev.tentativas + 1;
      const erro = err instanceof Error ? err.message : String(err);
      const espera = ESPERAS_S[Math.min(tentativas - 1, ESPERAS_S.length - 1)];
      db.prepare('UPDATE eventos SET estado = ?, tentativas = ?, proximaEm = ?, erro = ? WHERE id = ? AND corpo = ?').run(
        tentativas >= MAX_TENTATIVAS ? 'ERRO' : 'PENDENTE',
        tentativas,
        Date.now() + espera * 1000,
        erro,
        ev.id,
        ev.corpo,
      );
      registrarLog({ metodo: 'EVENTO', url: `pedido ${pedidoId} · ${ev.tipo}`, status: 0, ms: 0, erroResumo: `Tentativa ${tentativas}: ${erro}`, reqBody: ev.corpo });
      notificar('pedidos', { pedidoId });
    }
  }
}

export function aplicarEfeito(p: RegistroPedido, efeito: Efeito, ev: { id: string; seq: number | null; origem: string; ocorridoEm: string; corpo: string }) {
  const est = p.estado;
  const pend = est.pendencias;
  const semCorpo = PRECISA_DO_CORPO[efeito.tipo];
  if (semCorpo) {
    const marcado = est.semDados.some((s) => s.id === ev.id);
    // CANCELLATION_REQUESTED depois de um cancelamento pedido pela loja e so a confirmacao: nada a responder
    const daLoja = efeito.tipo === 'CANCELLATION_REQUESTED' && !!pend.cancelamentoLoja;
    if (!ev.corpo && ev.origem === 'RECONCILIACAO' && !daLoja) {
      if (!marcado) est.semDados = [{ id: ev.id, rotulo: semCorpo, em: ev.ocorridoEm }, ...est.semDados].slice(0, 10);
      efeito = { ...efeito, rotulo: `${semCorpo} (sem os dados)`, aviso: { texto: `${semCorpo} sem os dados para responder. Confira no portal da plataforma.`, nivel: 'alerta' } };
    } else if (ev.corpo && marcado) {
      est.semDados = est.semDados.filter((s) => s.id !== ev.id);
      // O aviso provisorio da lugar ao do evento completo
      est.avisos = est.avisos.filter((a) => a.id !== ev.id);
      for (const e of p.eventos) if (e.id === ev.id) e.rotulo = efeito.rotulo;
    }
  }
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
  if (efeito.codigoEntregaPedido && est.codigoEntrega !== 'CONFIRMADO') est.codigoEntrega = 'PEDIDO';
  if (efeito.status === 'CANCELADO') est.arquivado = false;

  if (efeito.disputa && !est.resolvidas.includes(efeito.disputa.id)) pend.disputa = efeito.disputa;
  // Encerramento reconciliado sem corpo nao diz qual disputa acabou: nao apaga a que esta aberta
  if (efeito.disputaEncerrada !== undefined && (efeito.disputaEncerrada || ev.corpo)) {
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
  // Pedido que acabou de ser cancelado nao tem mais disputa nem solicitacao a responder
  if (efeito.status === 'CANCELADO') {
    pend.disputa = null;
    est.semDados = [];
  }
  if (efeito.disputaEncerrada !== undefined) est.semDados = est.semDados.filter((s) => s.rotulo !== PRECISA_DO_CORPO.HANDSHAKE_DISPUTE || s.em > ev.ocorridoEm);
  if (!falhaVigente(p)) est.falhaAutomatica = null;
  if (!efeito.aviso || est.avisos.some((a) => a.id === ev.id)) return null;
  est.avisos = [{ id: ev.id, em: ev.ocorridoEm, ...efeito.aviso }, ...est.avisos].slice(0, 30);
  return efeito.aviso;
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
  // So avisa na tela o que e novidade: repetir o evento nao repete o alerta
  const aviso = aplicarEfeito(pedido, efeito, ev);

  const embutido = corpo?.pedido ?? (corpo?.dados?.itens ? corpo.dados : null);
  const temEmbutido = !!embutido && mesclarDetalhe(pedido, embutido);
  const recente = Date.now() - new Date(ev.ocorridoEm).getTime() < RECENTE_MS;
  salvarPedido(pedido);
  // O card aparece (e toca) na hora, mesmo antes de o detalhe chegar
  notificar('pedidos', { pedidoId: pedido.id, novo: !existente && pedido.statusKanban === 'NOVO' && recente, aviso: aviso?.texto ?? null, nivel: aviso?.nivel, codigo: pedido.codigoCurto, canal: pedido.plataforma });

  if (recente) await aceitarAutomaticamente(pedido.id);

  // Entrega da 99Food importada sem corpo: a etapa atual so vem do detalhe
  if (!temEmbutido && (efeito.recarregar || (!ev.corpo && efeito.tipo === 'deliveryStatus') || pedido.detalhePendente)) {
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
  constructor(public status: number, mensagem: string, public resposta?: unknown, public retryAfterS?: number) {
    super(mensagem);
  }
}

/** Falha que pode dar certo se repetida: rede, 5xx, limite de chamadas ou comando ainda em andamento. */
export function falhaPassageira(err: unknown): boolean {
  if (!(err instanceof ErroDeAcao)) return true;
  const codigo = codigoDoHub(err);
  return (
    err.status >= 500 ||
    [408, 425, 429].includes(err.status) ||
    codigo === 'COMANDO_EM_ANDAMENTO' ||
    /^PLATAFORMA_(HTTP_(408|425|429|5\d\d)|ERRNO_(10005|12021))$/.test(codigo)
  );
}

const codigoDoHub = (err: unknown) => (err instanceof ErroDeAcao ? String((err.resposta as { codigo?: unknown } | null | undefined)?.codigo ?? '') : '');

/**
 * Chave da proxima tentativa. O Hub guarda recusa definitiva e resultado incerto na chave por 24 h: usa outra.
 * Comando ainda em andamento mantem a mesma, para nao duplicar. Aceite e preparo podem ser repetidos sem dano.
 */
function proximaIntencao(err: unknown, atual: string): string {
  const codigo = codigoDoHub(err);
  if (codigo === 'COMANDO_EM_ANDAMENTO') return atual;
  return codigo === 'COMANDO_RESULTADO_INCERTO' || (err instanceof ErroDeAcao && err.status < 500) ? crypto.randomUUID() : atual;
}

const CODIGO_RECUSADO = 'Código incorreto. Nada foi confirmado. Confira o código e digite de novo.';
const ACOES_DE_CODIGO = new Set(['validatePickupCode', 'verifyDeliveryCode']);
/** Resposta em que o Hub ou a plataforma avisam que nada mudou la: conclusao do iFood e etapas implicitas. */
export const somenteNoErp = (resposta: any) => resposta?.localOnly === true || resposta?.implicit === true || resposta?.implicito === true;

const RESPOSTAS_A_PENDENCIA = new Set(['acceptCancellation', 'denyCancellation', 'counterOffer', 'acceptRefund', 'denyRefund']);
const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Converte o que a tela informa para o formato que o Hub espera em cada plataforma. */
export function dadosDaAcao(p: RegistroPedido, acao: string, entrada: Record<string, unknown>): Record<string, unknown> {
  const e = entrada ?? {};
  const noventaENove = p.plataforma === '99FOOD';
  const pend = p.estado.pendencias;
  // A tela informa a qual solicitacao esta respondendo: se outra tomou o lugar, o operador precisa ler de novo
  const exibida = texto(e.idPendencia);
  if (exibida) {
    const atual = acao.endsWith('Refund') ? pend.reembolso?.applyId : (pend.cancelamentoCliente?.applyId ?? pend.disputa?.id);
    if (exibida !== atual) throw new ErroDeAcao(409, 'A solicitação mudou. Confira e responda novamente.');
  }
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
      // A alternativa escolhida vem do evento da disputa: o Hub exige o id dela
      const alternativa = (pend.disputa.alternativas as Array<{ id?: string; type?: string }>).find((a) => !!a?.id && a.id === texto(e.alternativeId));
      if (!alternativa) throw new ErroDeAcao(400, 'Escolha uma das alternativas oferecidas pela disputa.');
      const base = { disputeId: pend.disputa.id, alternativeId: alternativa.id, type: alternativa.type };
      const oferta = lerAlternativas([alternativa])[0];
      if (alternativa.type === 'REFUND') {
        const valor = lerPreco(String(e.valor ?? ''));
        if (!(valor > 0)) throw new ErroDeAcao(400, 'Informe o valor do reembolso proposto.');
        if (casasDemais(valor)) throw new ErroDeAcao(400, 'Valor do reembolso: use no máximo duas casas decimais.');
        if (oferta?.valorMaximo && valor > oferta.valorMaximo) throw new ErroDeAcao(400, `O reembolso proposto passa do máximo da disputa (R$ ${oferta.valorMaximo.toFixed(2).replace('.', ',')}).`);
        const centavos = Math.round(valor * 100);
        return { ...base, metadata: { amount: { value: String(centavos), currency: 'BRL' } } };
      }
      const minutos = Math.floor(Number(e.minutos));
      if (alternativa.type !== 'ADDITIONAL_TIME' || !(minutos > 0) || !texto(e.motivoTempo)) throw new ErroDeAcao(400, 'Informe os minutos e o motivo do tempo adicional.');
      if (oferta?.minutos.length && !oferta.minutos.includes(String(minutos))) throw new ErroDeAcao(400, `Escolha um dos tempos oferecidos: ${oferta.minutos.join(', ')} minutos.`);
      if (oferta?.motivos.length && !oferta.motivos.includes(texto(e.motivoTempo))) throw new ErroDeAcao(400, 'Escolha um dos motivos oferecidos pela disputa.');
      return { ...base, metadata: { additionalTimeInMinutes: minutos, additionalTimeReason: texto(e.motivoTempo) } };
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
// iFood responde 202 (recebido) e confirma por evento. Na 99Food errno 0 ja vale: pronto e saida nao geram webhook
// nas lojas de teste, e o orderFinish nem sempre chega (ou chega minutos depois). A etapa vem desta resposta.
function aplicarAcao(p: RegistroPedido, acao: string, dados: Record<string, any>, resposta: unknown) {
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
      // Sem confirmacao da plataforma o pedido nao aparece como concluido
      if (ehSimulado(p.id) || !somenteNoErp(resposta)) status('CONCLUIDO');
      break;
    case 'verifyDeliveryCode':
      est.codigoEntrega = 'CONFIRMADO';
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
    case 'counterOffer':
    case 'denyCancellation': {
      // Resolve somente a solicitacao respondida: outra pode ter chegado enquanto a resposta estava no ar
      resolver(dados.applyId ?? dados.disputeId);
      if (pend.cancelamentoCliente?.applyId === dados.applyId) pend.cancelamentoCliente = null;
      if (pend.disputa && (!dados.disputeId || pend.disputa.id === dados.disputeId) && !dados.applyId) pend.disputa = null;
      if (acao === 'acceptCancellation' && imediato) {
        status('CANCELADO');
        est.motivoCancelamento = motivo || 'Cancelamento do cliente aceito';
      }
      break;
    }
    case 'acceptRefund':
    case 'denyRefund':
      resolver(dados.applyId);
      if (pend.reembolso?.applyId === dados.applyId) pend.reembolso = null;
      break;
    case 'adjustItem':
      p.detalhePendente = true;
      break;
  }
  if (p.statusKanban === 'CANCELADO') {
    pend.cancelamentoCliente = null;
    pend.cancelamentoLoja = null;
    pend.disputa = null;
  }
}

/** Evita o mesmo comando duas vezes no ar (dois cliques, ou o clique junto com a repeticao automatica). */
const enviando = new Set<string>();

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
    if (!r.ok) {
      if ((r.json as any)?.codigo === 'CODIGO_INVALIDO') throw new ErroDeAcao(422, CODIGO_RECUSADO, r.json);
      throw new ErroDeAcao(r.status || 502, mensagemDoHub(r), r.json, r.retryAfterS);
    }
    // O iFood responde 200 com success false quando o codigo esta errado
    if (ACOES_DE_CODIGO.has(nome) && ((r.json as any)?.success === false || (r.json as any)?.data?.success === false)) throw new ErroDeAcao(422, CODIGO_RECUSADO, r.json);
    return r.json;
  };

  const emVoo = `${pedidoId}:${acao}`;
  if (enviando.has(emVoo)) throw new ErroDeAcao(409, 'Esta ação já está sendo enviada. Aguarde a resposta.', { codigo: 'COMANDO_EM_ANDAMENTO' });
  enviando.add(emVoo);
  let resposta: unknown;
  try {
    // O iFood exige "pronto" antes do despacho e o Hub nao encadeia. Se ja estiver pronto, segue para o despacho
    if (acao === 'dispatch' && p.plataforma === 'IFOOD' && p.statusKanban === 'PREPARO' && !ehSimulado(pedidoId)) {
      await enviar('readyToPickup', {}, `erp-${intencao}-pronto`).catch(() => undefined);
    }
    resposta = await enviar(acao, dados, `erp-${intencao}`);
  } finally {
    enviando.delete(emVoo);
  }

  const atual = obterPedido(pedidoId)!;
  aplicarAcao(atual, acao, dados as Record<string, any>, resposta);
  const rotulo = tela.acoes.find((a) => a.acao === acao)?.rotulo ?? acao;
  const soErp = !ehSimulado(pedidoId) && somenteNoErp(resposta);
  aplicarEfeito(atual, { tipo: `ERP_${acao}`, rotulo: soErp ? `${rotulo} (somente no ERP)` : rotulo }, { id: `erp-${intencao}`, seq: null, origem: 'ERP', ocorridoEm: new Date().toISOString(), corpo: '' });
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

// ── Aceite e preparo automaticos ─────────────────────────────────────────────

type AcaoAutomatica = FalhaAutomatica['acao'];
const NOME_AUTOMATICO: Record<AcaoAutomatica, string> = { confirm: 'Aceite automático', startPreparation: 'Início automático do preparo' };

/** Grava a falha no pedido (a tela mostra ate ele avancar) e agenda a proxima tentativa dentro do prazo. */
function registrarFalhaAutomatica(pedidoId: string, acao: AcaoAutomatica, err: unknown, intencao: string, tentativas: number) {
  const p = obterPedido(pedidoId);
  if (!p) return;
  const agora = Date.now();
  const limite = acao === 'confirm' ? new Date(p.criadoEm).getTime() + (PRAZO_ACEITE_MIN[p.plataforma] ?? 5) * 60_000 : null;
  let proximaEm: number | null = null;
  if (falhaPassageira(err) && tentativas < MAX_TENTATIVAS) {
    const pedido = err instanceof ErroDeAcao ? (err.retryAfterS ?? 0) : 0;
    proximaEm = agora + Math.max(ESPERAS_AUTO_S[Math.min(tentativas - 1, ESPERAS_AUTO_S.length - 1)], pedido) * 1000;
    // A ultima tentativa acontece pouco antes do fim do prazo de aceite
    if (limite !== null && proximaEm > limite - 5000) proximaEm = limite - 5000 > agora + 2000 ? limite - 5000 : null;
  }
  const erro = err instanceof Error ? err.message : String(err);
  p.estado.falhaAutomatica = {
    acao,
    erro,
    tentativas,
    proximaEm,
    limiteEm: limite === null ? null : new Date(limite).toISOString(),
    intencao: proximaIntencao(err, intencao),
  };
  if (!falhaVigente(p)) return;
  // Avisa na primeira falha e quando desiste: as repeticoes ficam so no quadro
  const avisar = tentativas === 1 || proximaEm === null;
  const oQue = `${NOME_AUTOMATICO[acao]} falhou`;
  const depois = proximaEm === null ? 'Faça manualmente agora.' : 'O sistema vai tentar de novo.';
  if (avisar) {
    p.estado.avisos = [{ id: `auto-${agora}-${acao}`, em: new Date(agora).toISOString(), nivel: 'alerta' as const, texto: `${oQue}: ${erro} ${depois}` }, ...p.estado.avisos].slice(0, 30);
  }
  salvarPedido(p);
  notificar('pedidos', { pedidoId, codigo: p.codigoCurto, ...(avisar ? { aviso: `${oQue}. ${depois}`, nivel: 'alerta' } : {}) });
}

async function tentarAutomatico(pedidoId: string, acao: AcaoAutomatica): Promise<boolean> {
  const p = obterPedido(pedidoId);
  if (!p) return false;
  const anterior = p.estado.falhaAutomatica?.acao === acao ? p.estado.falhaAutomatica : null;
  const intencao = anterior?.intencao ?? crypto.randomUUID();
  try {
    await executarAcao(pedidoId, acao, {}, intencao);
    return true;
  } catch (err) {
    // Conexao recusada nao gasta tentativa
    if (!conexaoEncerrada()) registrarFalhaAutomatica(pedidoId, acao, err, intencao, (anterior?.tentativas ?? 0) + 1);
    return false;
  }
}

async function aceitarAutomaticamente(pedidoId: string) {
  const p = obterPedido(pedidoId);
  if (!p || !aceiteAutomaticoLigado() || p.statusKanban !== 'NOVO' || p.plataforma === 'TD' || p.estado.aceiteAutomaticoFeito) return;
  p.estado.aceiteAutomaticoFeito = true;
  salvarPedido(p);
  await tentarAutomatico(pedidoId, 'confirm');
}

/** No iFood o aceite nao inicia o preparo; pedido agendado so inicia no horario (ver iniciarAgendados). */
async function iniciarPreparoDoAceiteAutomatico(pedidoId: string) {
  const p = obterPedido(pedidoId);
  if (!p || !p.estado.aceiteAutomaticoFeito || p.plataforma !== 'IFOOD' || p.statusKanban !== 'PREPARO' || p.estado.preparoIniciado || p.detalhePendente) return;
  if (p.estado.falhaAutomatica?.acao === 'startPreparation' || extrasDe(p.plataforma, p.detalhe).agendamento) return;
  await tentarAutomatico(pedidoId, 'startPreparation');
}

/** Pedido agendado do iFood: o preparo comeca no horario que a plataforma informou. */
export async function iniciarAgendados() {
  if (!conexaoPronta()) return;
  const linhas = db.prepare("SELECT id FROM pedidos WHERE plataforma = 'IFOOD' AND statusKanban = 'PREPARO'").all() as Array<{ id: string }>;
  for (const { id } of linhas) {
    const p = obterPedido(id)!;
    const inicio = extrasDe(p.plataforma, p.detalhe).agendamento?.inicioPreparo;
    // Quem ja falhou segue o calendario de repetirAutomaticos
    if (!inicio || p.estado.preparoIniciado || p.estado.falhaAutomatica?.acao === 'startPreparation' || new Date(inicio).getTime() > Date.now()) continue;
    await tentarAutomatico(id, 'startPreparation');
  }
}

const repetindo = new Set<string>();

/** Repete o aceite e o inicio de preparo que falharam por motivo passageiro. */
export async function repetirAutomaticos(): Promise<void> {
  if (!conexaoPronta()) return;
  const linhas = db
    .prepare("SELECT id FROM pedidos WHERE statusKanban IN ('NOVO','PREPARO') AND json_extract(estadoJson, '$.falhaAutomatica.proximaEm') <= ?")
    .all(Date.now()) as Array<{ id: string }>;
  await Promise.all(
    linhas
      .filter(({ id }) => !repetindo.has(id))
      .map(async ({ id }) => {
        repetindo.add(id);
        try {
          const p = obterPedido(id)!;
          const falha = falhaVigente(p);
          if (!falha) {
            p.estado.falhaAutomatica = null;
            return salvarPedido(p);
          }
          // Desligar o aceite automatico interrompe as repeticoes (o preparo agendado nao depende dele)
          if (!aceiteAutomaticoLigado() && (falha.acao === 'confirm' || !extrasDe(p.plataforma, p.detalhe).agendamento)) {
            falha.proximaEm = null;
            salvarPedido(p);
            return notificar('pedidos', { pedidoId: id });
          }
          if ((await tentarAutomatico(id, falha.acao)) && falha.acao === 'confirm') await iniciarPreparoDoAceiteAutomatico(id);
        } catch (err) {
          registrarLog({ metodo: 'TAREFA', url: `aceite automático · pedido ${id}`, status: 0, ms: 0, erroResumo: err instanceof Error ? err.message : String(err) });
        } finally {
          repetindo.delete(id);
        }
      }),
  );
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

// PULL: GET /hub/v1/eventos, gravar tudo e so entao POST /hub/v1/eventos/confirmar com o ultimo seq.
// "lacuna" na resposta significa eventos apagados pela retencao: a reconciliacao cobre.
export async function puxarEventos(): Promise<number> {
  const cfg = obterConfig();
  if (puxando || !conexaoPronta() || cfg.transporte === 'PUSH') return 0;
  puxando = true;
  let total = 0;
  let houveLacuna = false;
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
      if (r.json?.lacuna) houveLacuna = true;
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
  // So depois de gravar o lote: o que veio com corpo nao e reimportado vazio pela reconciliacao
  if (houveLacuna) await reconciliar();
  if (total) await processarFila();
  return total;
}

let reconciliando = false;

/** Rede de seguranca para PUSH e PULL: compara a lista de pedidos do Hub com o que o ERP recebeu. */
export async function reconciliar(): Promise<number> {
  const cfg = obterConfig();
  if (reconciliando || !conexaoPronta()) return 0;
  reconciliando = true;
  let novos = 0;
  let faltaCorpo = false;
  try {
    const r = await hubFetch<Array<{ plataforma: string; pedidoId: string; eventos: Array<{ seq: number; tipo: string; em: string }> }>>('/hub/v1/conexao/pedidos?limite=100', {
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
        if (!receberEvento({ id: `rec-${cfg.conexaoId}-${ev.seq}`, origem: 'RECONCILIACAO', seq: ev.seq, plataforma: pedido.plataforma, pedidoId: pedido.pedidoId, tipo: ev.tipo, corpo: '', ocorridoEm: ev.em })) continue;
        novos += 1;
        if (interpretarEvento(pedido.plataforma, ev.tipo, null, ev.em).tipo in PRECISA_DO_CORPO) faltaCorpo = true;
      }
    }
  } finally {
    reconciliando = false;
  }
  if (novos) await processarFila();
  // No PUSH o corpo pode estar parado em uma entrega que o Hub desistiu de enviar: pede o reenvio
  if (faltaCorpo && cfg.transporte === 'PUSH') await hubFetch('/hub/v1/conexao/entregas/reprocessar', { metodo: 'POST', body: {} });
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
