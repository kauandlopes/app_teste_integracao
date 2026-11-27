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
  const extras: ExtrasPedido = { codigos: [], pagamentos: [], beneficios: [], agendamento: null, valores: [], pedidoTeste: false, itensAjustaveis: [] };
  const codigo = (rotulo: string, valor: unknown) => {
    if (valor) extras.codigos.push({ rotulo, valor: String(valor) });
  };

  if (d?.cliente?.localizador) codigo('Localizador (ligação)', d.cliente.localizador);
  // O unificado do Hub traz codigos, pagamentos e ajustes; o bruto da plataforma cobre o que faltar
  const codigos = d?.codigos ?? {};
  if (plataforma === 'IFOOD') {
    codigo('Código de retirada', codigos.retirada ?? bruto.takeout?.takeoutCode ?? bruto.takeout?.code ?? bruto.pickupCode);
    codigo('Código de coleta', codigos.coleta ?? bruto.delivery?.pickupCode);
    codigo('Código de entrega', codigos.entrega);
  } else {
    codigo(extrasRetirada(d) ? 'Código de retirada' : 'Código de entrega', codigos.entrega ?? codigos.retirada ?? bruto.handover_code);
    codigo('Código de coleta', codigos.coleta);
  }

  const pagamentos: any[] = d?.pagamentos?.length ? d.pagamentos : (bruto.payments?.methods ?? []);
  extras.pagamentos = pagamentos.map((m: any) => ({
    metodo: String(m.forma ?? m.method ?? ''),
    bandeira: m.bandeira ?? m.card?.brand ?? null,
    valor: num(m.valor ?? m.value),
    online: m.pagoOnline ?? (m.type ? m.type === 'ONLINE' : !!m.prepaid),
  }));

  const ajustes = d?.ajustes ?? {};
  const desconto = (valor: unknown, quemPaga: string) => num(valor) > 0 && extras.beneficios.push({ valor: num(valor), quemPaga });
  desconto(ajustes.descontoPlataforma, plataforma === 'IFOOD' ? 'iFood' : '99Food');
  desconto(ajustes.descontoLoja, 'Loja');
  if (!d?.ajustes) {
    for (const b of bruto.benefits ?? []) {
      const patrocinios = Array.isArray(b.sponsorshipValues) ? b.sponsorshipValues.filter((s: any) => num(s.value) > 0) : [];
      if (patrocinios.length) patrocinios.forEach((s: any) => desconto(s.value, s.name === 'IFOOD' ? 'iFood' : 'Loja'));
      else desconto(b.value, 'iFood');
    }
  }
  for (const [chave, rotulo] of [['taxaServico', 'Taxa de serviço'], ['gorjeta', 'Gorjeta'], ['dinheiroAReceber', 'Receber em dinheiro'], ['repasseLoja', 'Repasse para a loja']] as const) {
    if (num(ajustes[chave]) > 0) extras.valores.push({ rotulo, valor: num(ajustes[chave]) });
  }

  const agendado = d?.agendamento?.agendado ?? bruto.orderTiming === 'SCHEDULED';
  if (agendado) {
    extras.agendamento = {
      inicioPreparo: d?.agendamento?.inicioPreparo ?? bruto.preparationStartDateTime ?? null,
      entregaInicio: bruto.schedule?.deliveryDateTimeStart ?? d?.agendamento?.previsaoEntrega ?? null,
      entregaFim: bruto.schedule?.deliveryDateTimeEnd ?? null,
    };
  }
  extras.pedidoTeste = !!d?.pedidoTeste || bruto.isTest === true || bruto.is_test === true || Number(bruto.is_test) === 1;

  if (plataforma === '99FOOD') {
    extras.itensAjustaveis = (bruto.order_items ?? [])
      .filter((i: any) => i?.app_item_id && i?.mdu_id !== undefined)
      // Número acima de 2^53 já chegou arredondado pelo Hub: enviar de volta cancelaria a linha errada
      .filter((i: any) => typeof i.mdu_id !== 'number' || Number.isSafeInteger(i.mdu_id))
      .map((i: any) => ({ appItemId: String(i.app_item_id), mduId: String(i.mdu_id), nome: String(i.name ?? i.app_item_id), quantidade: num(i.amount) || 1 }));
  }
  return extras;
}

const extrasRetirada = (d: any) => modalidadeDe(d) === 'RETIRADA';
