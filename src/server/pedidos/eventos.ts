import type { Disputa, Entregador, SolicitacaoCliente, SolicitacaoReembolso, StatusKanban } from '../../shared/tipos.js';

/**
 * Traduz um evento do iFood, da 99Food ou do simulador do Hub no efeito que ele tem sobre o pedido do ERP.
 * Funcao pura: sem banco e sem rede. Referencia de comportamento: workers de webhook do Target Delivery.
 */
export interface Efeito {
  tipo: string;
  rotulo: string;
  status?: StatusKanban;
  /** Buscar o pedido completo de novo (pedido novo, itens ou endereco alterados). */
  recarregar?: boolean;
  preparoIniciado?: boolean;
  disputa?: Disputa;
  disputaEncerrada?: string;
  cancelamentoCliente?: SolicitacaoCliente;
  reembolso?: SolicitacaoReembolso;
  /** A plataforma recusou o cancelamento pedido pela loja. */
  cancelamentoLojaRecusado?: boolean;
  /** CANCELLATION_REQUESTED sem disputa: confirmacao de que o pedido de cancelamento esta em analise. */
  cancelamentoEmAnalise?: string;
  entregador?: Entregador;
  etapaEntrega?: string;
  /** A entrega so termina com o codigo informado pelo cliente. */
  codigoEntregaPedido?: boolean;
  motivoCancelamento?: string;
  aviso?: { texto: string; nivel: 'info' | 'alerta' };
}

/** Codigos curtos do iFood. O PUSH manda fullCode; o PULL e a reconciliacao podem trazer o curto. */
const CODIGOS_IFOOD: Record<string, string> = {
  PLC: 'PLACED',
  CFM: 'CONFIRMED',
  PRS: 'PREPARATION_STARTED',
  SPS: 'PREPARATION_STARTED',
  RTP: 'READY_TO_PICKUP',
  DSP: 'DISPATCHED',
  CON: 'CONCLUDED',
  CAN: 'CANCELLED',
  CAR: 'CANCELLATION_REQUESTED',
  CARF: 'CANCELLATION_REQUEST_FAILED',
  HSD: 'HANDSHAKE_DISPUTE',
  HSS: 'HANDSHAKE_SETTLEMENT',
  ADR: 'ASSIGN_DRIVER',
  GTO: 'GOING_TO_ORIGIN',
  AAO: 'ARRIVED_AT_ORIGIN',
  CLT: 'COLLECTED',
  AAD: 'ARRIVED_AT_DESTINATION',
  DDCR: 'DELIVERY_DROP_CODE_REQUESTED',
};

const emIso = (v: unknown): string | null => {
  const d = typeof v === 'string' || typeof v === 'number' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};
const somar = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();
const texto = (...valores: unknown[]) => String(valores.find((v) => typeof v === 'string' && v.trim()) ?? '').trim();

/** Fotos e itens citados na reclamacao: o iFood os manda em metadata ou em metadata.metadata. */
function anexosDaDisputa(m: any) {
  const primeiraLista = (...v: unknown[]): any[] => (v.find(Array.isArray) as any[]) ?? [];
  const evidencias = primeiraLista(m.evidences, m.metadata?.evidences)
    .map((x: any) => ({ url: String(x?.url ?? x ?? ''), tipo: String(x?.contentType ?? '') }))
    .filter((x) => /^https?:\/\//i.test(x.url));
  const itens = primeiraLista(m.items, m.metadata?.items)
    .map((i: any) => {
      const nome = texto(i?.name, i?.description);
      const motivo = texto(i?.reason);
      if (!nome && !motivo) return '';
      return `${i?.quantity ? `${i.quantity}x ` : ''}${nome || 'Item'}${motivo ? `: ${motivo}` : ''}`;
    })
    .filter(Boolean);
  return { evidencias, itens };
}

const alerta = (t: string) => ({ texto: t, nivel: 'alerta' as const });
const info = (t: string) => ({ texto: t, nivel: 'info' as const });

export function interpretarEvento(plataforma: string, tipoBruto: string, corpo: any, ocorridoEm: string): Efeito {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  if (plataforma === '99FOOD' && !/^[A-Z_]+$/.test(tipoBruto)) return evento99(tipoBruto || String(c.type ?? ''), c, ocorridoEm);
  const bruto = String(c.fullCode || tipoBruto || c.code || '').toUpperCase();
  return eventoIfood(CODIGOS_IFOOD[bruto] ?? bruto, c, ocorridoEm);
}

/** iFood (e o simulador do Hub, que usa os mesmos nomes para as duas plataformas). */
function eventoIfood(tipo: string, c: any, ocorridoEm: string): Efeito {
  const m = c.metadata ?? {};
  const e = (rotulo: string, resto: Partial<Efeito> = {}): Efeito => ({ tipo, rotulo, ...resto });

  switch (tipo) {
    case 'PLACED':
      return e('Pedido recebido', { status: 'NOVO', recarregar: true });
    case 'CONFIRMED':
      return e('Pedido confirmado', { status: 'PREPARO' });
    case 'PREPARATION_STARTED':
      return e('Preparo iniciado', { status: 'PREPARO', preparoIniciado: true });
    case 'PREPARATION_ENDED':
      return e('Preparo finalizado');
    case 'READY_TO_PICKUP':
      return e('Pronto', { status: 'PRONTO' });
    case 'DISPATCHED':
      return e('Saiu para entrega', { status: 'ENTREGA' });
    case 'COLLECTED':
      return e('Entregador coletou o pedido', { status: 'ENTREGA', etapaEntrega: 'Pedido coletado' });
    case 'CONCLUDED':
      return e('Pedido concluído', { status: 'CONCLUIDO' });
    case 'CANCELLED':
      return e('Pedido cancelado', {
        status: 'CANCELADO',
        motivoCancelamento: texto(m.reason_code_description, m.details, m.cancel_reason, m.reason, c.reason) || 'Cancelado pela plataforma',
        aviso: alerta('Pedido cancelado na plataforma.'),
      });
    case 'CANCELLATION_REQUESTED': {
      const id = texto(m.disputeId, c.disputeId);
      const motivo = texto(m.reason, m.message, c.reason) || 'Solicitação de cancelamento';
      return id
        ? e('Cancelamento solicitado', {
            disputa: { id, mensagem: motivo, expiraEm: emIso(m.expiresAt), tipo: 'CANCELLATION', alternativas: [], aoExpirar: texto(m.timeoutAction) || null, ...anexosDaDisputa(m) },
            aviso: alerta('Solicitação de cancelamento aguardando resposta.'),
          })
        : e('Cancelamento em análise', { cancelamentoEmAnalise: motivo, aviso: info('Cancelamento em análise na plataforma.') });
    }
    case 'CANCELLATION_REQUEST_FAILED':
      return e('Cancelamento recusado pela plataforma', { cancelamentoLojaRecusado: true, aviso: alerta('A plataforma recusou o cancelamento. O pedido continua ativo.') });
    case 'HANDSHAKE_DISPUTE': {
      const id = texto(m.disputeId, m.id, c.disputeId);
      if (!id) return e('Disputa sem identificador', { aviso: alerta('Disputa recebida sem identificador. Verifique no portal do iFood.') });
      return e('Disputa aberta', {
        disputa: {
          id,
          mensagem: texto(m.message, m.reason) || 'O cliente abriu uma disputa.',
          expiraEm: emIso(m.expiresAt) ?? somar(ocorridoEm, 30 * 60_000),
          tipo: texto(m.handshakeType, m.action) || null,
          alternativas: Array.isArray(m.alternatives) ? m.alternatives : [],
          aoExpirar: texto(m.timeoutAction) || null,
          ...anexosDaDisputa(m),
        },
        aviso: alerta('Disputa aguardando resposta.'),
      });
    }
    case 'HANDSHAKE_SETTLEMENT':
      return e('Disputa encerrada', {
        disputaEncerrada: texto(m.disputeId, m.id, c.disputeId),
        aviso: info(`Disputa encerrada${m.action || m.status ? `: ${m.action ?? m.status}` : ''}.`),
      });
    case 'ASSIGN_DRIVER':
      return e('Entregador designado', {
        entregador: m.workerName ? { nome: String(m.workerName), telefone: String(m.workerPhone ?? '') } : undefined,
        etapaEntrega: 'Entregador designado',
      });
    case 'GOING_TO_ORIGIN':
      return e('Entregador a caminho da loja', { etapaEntrega: 'A caminho da loja' });
    case 'ARRIVED_AT_ORIGIN':
      return e('Entregador chegou na loja', { etapaEntrega: 'Na loja', aviso: alerta('Entregador chegou na loja.') });
    case 'ARRIVED_AT_DESTINATION':
      return e('Entregador chegou no cliente', { etapaEntrega: 'No endereço do cliente' });
    case 'DELIVERY_RETURNING_TO_ORIGIN':
      return e('Entrega voltando para a loja', { etapaEntrega: 'Retornando', aviso: alerta('A entrega está voltando para a loja.') });
    case 'DELIVERY_RETURNED_TO_ORIGIN':
      return e('Entrega devolvida à loja', { etapaEntrega: 'Devolvida', aviso: alerta('O pedido foi devolvido à loja.') });
    case 'ORDER_PATCHED':
      return e('Pedido alterado', { recarregar: true, aviso: alerta('O pedido foi alterado. Confira os itens.') });
    case 'DELIVERY_ADDRESS_CHANGE':
    case 'DELIVERY_ADDRESS_CHANGE_ACCEPTED':
      return e('Endereço alterado', { recarregar: true, aviso: alerta('O endereço de entrega mudou.') });
    case 'DELIVERY_PHONE_CHANGE':
      return e('Telefone alterado', { recarregar: true, aviso: info('O telefone do cliente mudou.') });
    case 'PICKUP_AREA_ASSIGNED':
      return e('Área de retirada definida', { recarregar: true });
    case 'DELIVERY_PICKUP_CODE_REQUESTED':
      return e('Código de coleta solicitado', { aviso: alerta('Confira o código de coleta com o entregador.') });
    case 'DELIVERY_DROP_CODE_REQUESTED':
      return e('Código de entrega solicitado', { codigoEntregaPedido: true, aviso: alerta('A entrega exige o código informado pelo cliente.') });
    default:
      // Evento novo ou nao mapeado: entra no historico e o pedido e relido para nao perder mudanca
      return e(tipo.replace(/_/g, ' ').toLowerCase() || 'evento', { recarregar: true });
  }
}

/** deliveryStatus numerico da 99Food (entrega da plataforma ou propria). */
const ENTREGA_99: Record<number, { etapa: string; status?: StatusKanban; alerta?: string; recarregar?: boolean }> = {
  120: { etapa: 'Entregador designado', recarregar: true },
  130: { etapa: 'Entregador a caminho da loja', alerta: 'Entregador a caminho.' },
  140: { etapa: 'Pedido coletado', status: 'ENTREGA' },
  150: { etapa: 'Entregador próximo do cliente' },
  160: { etapa: 'Entregue', status: 'CONCLUIDO' },
  170: { etapa: 'Problema na entrega', alerta: 'Problema na entrega. Verifique no app da 99Food.' },
  180: { etapa: 'Entregador trocado', recarregar: true },
  190: { etapa: 'Ação necessaria', alerta: 'A 99Food pede uma ação da loja nesta entrega.' },
};

function evento99(tipo: string, c: any, ocorridoEm: string): Efeito {
  const d = c.data ?? {};
  const e = (rotulo: string, resto: Partial<Efeito> = {}): Efeito => ({ tipo, rotulo, ...resto });

  switch (tipo) {
    case 'orderNew':
      return e('Pedido recebido', { status: 'NOVO', recarregar: true });
    case 'orderConfirm':
      return e('Pedido confirmado', { status: 'PREPARO', preparoIniciado: true });
    case 'orderReady':
      return e('Pronto', { status: 'PRONTO' });
    case 'orderFinish':
      return e('Pedido concluído', { status: 'CONCLUIDO' });
    case 'orderCancel':
      return e('Pedido cancelado', {
        status: 'CANCELADO',
        recarregar: true,
        motivoCancelamento: texto(d.reason, d.cancel_reason, d.apply_reason) || 'Cancelado na 99Food',
        aviso: alerta('Pedido cancelado na 99Food.'),
      });
    case 'orderPartialCancel':
      return e('Cancelamento parcial', { recarregar: true, aviso: alerta('Parte do pedido foi cancelada. Confira os itens e o total.') });
    case 'orderCancelApply': {
      const applyId = String(d.apply_id ?? '');
      return e('Cliente pediu cancelamento', {
        cancelamentoCliente: applyId
          ? {
              applyId,
              motivo: texto(d.apply_reason) || 'Sem motivo informado',
              motivos: (Array.isArray(d.reason_list) ? d.reason_list : []).map((r: any) => String(r?.reason ?? r)).filter(Boolean),
              expiraEm: somar(ocorridoEm, 5 * 60_000),
            }
          : undefined,
        aviso: alerta('Cliente pediu cancelamento: responda em até 5 minutos.'),
      });
    }
    case 'orderRefundApply': {
      const applyId = String(d.apply_id ?? '');
      return e('Cliente pediu reembolso', {
        reembolso: applyId
          ? {
              applyId,
              motivo: texto(d.apply_reason) || 'Sem motivo informado',
              motivos: (Array.isArray(d.base_reason_list) ? d.base_reason_list : []).map((r: any) => ({ id: String(r?.base_reason_id ?? ''), texto: String(r?.base_reason ?? '') })),
              imagens: Array.isArray(d.images) ? d.images.map(String) : [],
              expiraEm: somar(ocorridoEm, 24 * 3600_000),
            }
          : undefined,
        aviso: alerta('Cliente pediu reembolso: sem resposta em 24 horas a 99Food aceita.'),
      });
    }
    case 'deliveryStatus': {
      const entregador = d.rider_name ? { nome: String(d.rider_name), telefone: String(d.rider_phone ?? '') } : undefined;
      const conhecido = ENTREGA_99[Number(d.delivery_status)];
      if (conhecido) {
        return e(conhecido.etapa, {
          status: conhecido.status,
          etapaEntrega: conhecido.etapa,
          recarregar: conhecido.recarregar,
          entregador,
          aviso: conhecido.alerta ? alerta(conhecido.alerta) : undefined,
        });
      }
      // 99Entrega (entrega propria feita por motoboy da 99) informa o status em texto
      const etapa = texto(d.status) || String(d.delivery_status ?? 'atualizacao');
      return e(`Entrega: ${etapa}`, { etapaEntrega: etapa, entregador: entregador ?? (d.driver_info?.name ? { nome: String(d.driver_info.name), telefone: String(d.driver_info.phone ?? '') } : undefined) });
    }
    default:
      return e(tipo, { recarregar: true });
  }
}
