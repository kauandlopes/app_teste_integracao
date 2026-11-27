import type { AcaoDisponivel, Canal, Modalidade, StatusKanban } from '../../shared/tipos.js';

/**
 * Quais acoes um pedido aceita agora. Fonte unica usada pela tela e pelo servidor.
 * Segue a matriz do Target Delivery por plataforma e modalidade (o campo acoesPermitidas do Hub nao serve:
 * ignora a etapa e a modalidade).
 */
export interface SituacaoPedido {
  id: string;
  plataforma: Canal;
  statusKanban: StatusKanban;
  modalidade: Modalidade;
  preparoIniciado: boolean;
  cancelamentoEmAnalise: boolean;
  pagamentoNaEntrega: boolean;
  temItensAjustaveis: boolean;
}

/** Pedidos criados por avaliar-pedido: o Hub trata localmente e aceita so um subconjunto de acoes. */
export const ehSimulado = (id: string) => id.startsWith('simhub-');
const ACEITAS_NO_SIMULADO = new Set(['confirm', 'startPreparation', 'readyToPickup', 'dispatch', 'updateCourier', 'conclude', 'delivered', 'requestCancellation', 'acceptCancellation', 'denyCancellation']);

export function acoesDisponiveis(p: SituacaoPedido): AcaoDisponivel[] {
  // Pedidos do proprio Delivery sao operados no painel do Delivery
  if (p.plataforma === 'TD') return [];
  const s = p.statusKanban;
  if (s === 'CONCLUIDO' || s === 'CANCELADO') return [];

  const lista: AcaoDisponivel[] = [];
  const add = (acao: string, rotulo: string, tipo: AcaoDisponivel['tipo'] = 'secundaria', pede?: AcaoDisponivel['pede']) =>
    lista.push({ acao, rotulo, tipo, ...(pede ? { pede } : {}) });
  const propria = p.modalidade === 'ENTREGA_PROPRIA';
  const daPlataforma = p.modalidade === 'ENTREGA_PLATAFORMA';
  const noLocal = p.modalidade === 'RETIRADA' || p.modalidade === 'MESA';
  const simulado = ehSimulado(p.id);

  if (s === 'NOVO') add('confirm', 'Aceitar pedido', 'principal');

  if (p.plataforma === 'IFOOD') {
    if (s === 'PREPARO') {
      if (!p.preparoIniciado) add('startPreparation', 'Iniciar preparo', daPlataforma ? 'principal' : 'secundaria');
      // Na entrega do iFood o pedido avanca pelos eventos do entregador
      if (!daPlataforma) add('readyToPickup', 'Marcar pronto', 'principal');
      if (propria) add('dispatch', 'Despachar agora', 'secundaria', 'entregadorOpcional');
    }
    if (s === 'PRONTO') {
      if (propria) add('dispatch', 'Despachar', 'principal', 'entregadorOpcional');
      if (noLocal) add('conclude', p.modalidade === 'MESA' ? 'Concluir' : 'Cliente retirou', 'principal');
    }
    if (s === 'ENTREGA' && propria) {
      add('conclude', 'Concluir entrega', 'principal');
      add('updateCourier', 'Trocar entregador', 'secundaria', 'entregador');
    }
    if (daPlataforma && s !== 'NOVO') add('validatePickupCode', 'Validar código de coleta', 'avancada', 'codigo');
    if (propria && s !== 'NOVO') {
      add('assignDriver', 'Informar entregador ao iFood', 'avancada', 'logistica');
      add('goingToOrigin', 'Entregador a caminho da loja', 'avancada');
      add('arrivedAtOrigin', 'Entregador chegou na loja', 'avancada');
      add('arrivedAtDestination', 'Entregador chegou no cliente', 'avancada');
      add('verifyDeliveryCode', 'Validar código de entrega', 'avancada', 'codigo');
    }
  } else {
    if (s === 'PREPARO') {
      add('readyToPickup', 'Marcar pronto', 'principal');
      if (p.temItensAjustaveis) add('adjustItem', 'Informar item em falta', 'avancada', 'itemFalta');
    }
    if (s === 'PRONTO') {
      if (propria) {
        add('dispatch', 'Despachar com entregador', 'principal', 'entregador');
        add('conclude', 'Concluir entrega', 'secundaria');
      }
      // Retirada na 99Food termina com /finish (acao pickedUp). No simulador o Hub so aceita conclude
      if (noLocal) add(simulado ? 'conclude' : 'pickedUp', 'Cliente retirou', 'principal');
    }
    if (s === 'ENTREGA' && propria) {
      add('conclude', 'Concluir entrega', 'principal');
      add('updateCourier', 'Trocar entregador', 'secundaria', 'entregador');
    }
    if (propria && (s === 'PRONTO' || s === 'ENTREGA')) add('validatePickupCode', 'Validar código do cliente', 'avancada', 'codigo');
    if (daPlataforma && p.pagamentoNaEntrega && s !== 'NOVO') add('payConfirm', 'Confirmar dinheiro recebido', 'secundaria');
  }

  if (!p.cancelamentoEmAnalise) add('requestCancellation', s === 'NOVO' ? 'Recusar pedido' : 'Cancelar pedido', 'perigo', 'motivo');

  return simulado ? lista.filter((a) => ACEITAS_NO_SIMULADO.has(a.acao)) : lista;
}

/** Ordem das etapas: um evento atrasado nunca volta o pedido. Cancelado vence qualquer etapa e e definitivo. */
const PESO: Record<StatusKanban, number> = { NOVO: 1, PREPARO: 2, PRONTO: 3, ENTREGA: 4, CONCLUIDO: 5, CANCELADO: 6 };
export function avancarStatus(atual: StatusKanban, novo: StatusKanban | undefined): StatusKanban {
  return novo && PESO[novo] > PESO[atual] ? novo : atual;
}
