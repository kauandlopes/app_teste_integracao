import type { ExtrasPedido, Modalidade } from '../../shared/tipos.js';

/** Leitura do pedido unificado do Hub (formato=unificado). Funcoes puras. */

export const detalheValido = (d: any): boolean => !!d && typeof d === 'object' && Array.isArray(d.itens) && !!d.valores;

export function modalidadeDe(d: any): Modalidade {
  if (d?.modalidadePlataforma === 'DINE_IN') return 'MESA';
  if (d?.modalidadePlataforma === 'TAKEOUT' || d?.tipoEntrega === 'RETIRADA' || d?.entreguePor === 'CUSTOMER') return 'RETIRADA';
  if (d?.entreguePor === 'IFOOD' || d?.entreguePor === 'PLATFORM') return 'ENTREGA_PLATAFORMA';
  return 'ENTREGA_PROPRIA';
}

export function colunasDe(d: any, pedidoId: string) {
  const modalidade = modalidadeDe(d);
  const endereco =
    d.enderecoEntrega?.formatado || (modalidade === 'RETIRADA' ? 'Retirada no balcão' : modalidade === 'MESA' ? 'Consumo no local' : '');
  const complemento = [d.enderecoEntrega?.complemento, d.enderecoEntrega?.referencia].filter(Boolean).join(' · ');
  return {
    codigoCurto: String(d.codigoExibicao ?? pedidoId.slice(-4)).replace(/^#/, ''),
    clienteNome: String(d.cliente?.nome || 'Cliente'),
    clienteTelefone: String(d.cliente?.telefone || ''),
    endereco: complemento ? `${endereco} (${complemento})` : String(endereco),
    totalReal: Number(d.valores?.total ?? 0),
    modalidade,
  };
}

const num = (v: unknown) => Number(v ?? 0) || 0;

/** Dados que o Delivery mostra e o unificado so traz dentro do bruto da plataforma. */
export function extrasDe(plataforma: string, d: any): ExtrasPedido {
  const bruto = d?.bruto?.data ?? d?.bruto ?? {};
  const extras: ExtrasPedido = { codigos: [], pagamentos: [], beneficios: [], agendamento: null, pedidoTeste: false, itensAjustaveis: [] };
  const codigo = (rotulo: string, valor: unknown) => {
    if (valor) extras.codigos.push({ rotulo, valor: String(valor) });
  };

  if (d?.cliente?.localizador) codigo('Localizador (ligação)', d.cliente.localizador);

  if (plataforma === 'IFOOD') {
    codigo('Código de retirada', bruto.takeout?.takeoutCode ?? bruto.takeout?.code ?? bruto.pickupCode);
    codigo('Código de coleta', bruto.delivery?.pickupCode);
    extras.pagamentos = (bruto.payments?.methods ?? []).map((m: any) => ({
      metodo: String(m.method ?? ''),
      bandeira: m.card?.brand ?? null,
      valor: num(m.value),
      online: m.type ? m.type === 'ONLINE' : !!m.prepaid,
    }));
    for (const b of bruto.benefits ?? []) {
      const patrocinios = Array.isArray(b.sponsorshipValues) ? b.sponsorshipValues.filter((s: any) => num(s.value) > 0) : [];
      if (patrocinios.length) patrocinios.forEach((s: any) => extras.beneficios.push({ valor: num(s.value), quemPaga: s.name === 'IFOOD' ? 'iFood' : 'Loja' }));
      else if (num(b.value) > 0) extras.beneficios.push({ valor: num(b.value), quemPaga: 'iFood' });
    }
    if (bruto.orderTiming === 'SCHEDULED') {
      extras.agendamento = {
        inicioPreparo: bruto.preparationStartDateTime ?? null,
        entregaInicio: bruto.schedule?.deliveryDateTimeStart ?? null,
        entregaFim: bruto.schedule?.deliveryDateTimeEnd ?? null,
      };
    }
    extras.pedidoTeste = bruto.isTest === true;
  }

  if (plataforma === '99FOOD') {
    codigo(extrasRetirada(d) ? 'Código de retirada' : 'Código de entrega', bruto.handover_code);
    extras.pedidoTeste = bruto.is_test === true || Number(bruto.is_test) === 1;
    extras.itensAjustaveis = (bruto.order_items ?? [])
      .filter((i: any) => i?.app_item_id && i?.mdu_id !== undefined)
      // Numero acima de 2^53 ja chegou arredondado pelo Hub: enviar de volta cancelaria a linha errada
      .filter((i: any) => typeof i.mdu_id !== 'number' || Number.isSafeInteger(i.mdu_id))
      .map((i: any) => ({ appItemId: String(i.app_item_id), mduId: String(i.mdu_id), nome: String(i.name ?? i.app_item_id), quantidade: num(i.amount) || 1 }));
  }
  return extras;
}

const extrasRetirada = (d: any) => modalidadeDe(d) === 'RETIRADA';
