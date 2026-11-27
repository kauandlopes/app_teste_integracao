import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { pedidoUnificado, prepararAmbiente } from './apoio.js';

let a: Awaited<ReturnType<typeof prepararAmbiente>>;
let proc: typeof import('../src/server/pedidos/processador.js');

before(async () => {
  a = await prepararAmbiente();
  proc = await import('../src/server/pedidos/processador.js');
});
after(() => a.fechar());
beforeEach(() => {
  a.limpar();
  a.banco.atualizarConfig({ transporte: 'PUSH' });
});

const detalhe = (extra: Record<string, unknown> = {}) =>
  a.quando('GET', /\/conexao\/pedidos\/([^/]+)$/, (_c, m) => ({ json: pedidoUnificado(m[1], extra) }));
const iFood = (code: string, fullCode: string, pedido: string, metadata: unknown = {}, createdAt = new Date().toISOString()) => ({ id: `${code}-${pedido}`, code, fullCode, orderId: pedido, merchantId: 'm', createdAt, metadata });
const chegar = async (pedido: string, tipo = 'PLACED', code = 'PLC', metadata: unknown = {}) => {
  const r = await a.webhook({ plataforma: 'IFOOD', tipo, pedido, corpo: iFood(code, tipo, pedido, metadata) });
  await proc.processarFila();
  return r;
};
const chegar99 = async (pedido: string, tipo: string, data: string) => {
  const r = await a.webhook({ plataforma: '99FOOD', tipo, pedido, corpo: `{"app_shop_id":"s","type":"${tipo}","timestamp":${Math.floor(Date.now() / 1000)},"data":${data}}` });
  await proc.processarFila();
  return r;
};
const obter = async (id: string) => (await a.erp('GET', '/pedidos')).json.pedidos.find((p: any) => p.id === id);
const acao = (id: string, nome: string, dados: Record<string, unknown> = {}, intencao?: string) => a.erp('POST', `/pedidos/${id}/acao`, { acao: nome, dados, intencao });
const enviadas = () => a.chamadasDe('POST', /\/acao$/).map((c) => c.corpo);

test('pedido novo aparece completo com itens, adicionais e codigos', async () => {
  detalhe({ bruto: { delivery: { pickupCode: '9911' }, payments: { methods: [{ method: 'CASH', type: 'OFFLINE', value: 89.9 }] }, benefits: [{ value: 5, sponsorshipValues: [{ name: 'MERCHANT', value: 5 }] }] } });
  assert.equal((await chegar('p1')).status, 200);
  const p = await obter('p1');
  assert.equal(p.clienteNome, 'Maria');
  assert.equal(p.totalReal, 89.9);
  assert.equal(p.itens[0].modificadores[0].nome, 'Calabresa');
  assert.equal(p.detalhePendente, false);
  assert.deepEqual(p.extras.codigos.map((c: any) => c.valor), ['12345678', '9911']);
  assert.equal(p.extras.beneficios[0].quemPaga, 'Loja');
  assert.deepEqual(p.acoes.map((x: any) => x.acao), ['confirm', 'requestCancellation']);
});

test('falha no detalhe mantem o card e tenta de novo sem apagar dados', async () => {
  let falhar = true;
  a.quando('GET', /\/conexao\/pedidos\/p2$/, () => (falhar ? { status: 500, json: { erro: 'falha temporaria' } } : { json: pedidoUnificado('p2') }));
  await chegar('p2');
  let p = await obter('p2');
  assert.equal(p.detalhePendente, true, 'o pedido ja aparece');
  assert.equal((await a.erp('GET', '/pedidos')).json.fila.comFalha, 1);
  falhar = false;
  proc.reprocessarFalhas();
  await proc.processarFila();
  p = await obter('p2');
  assert.equal(p.clienteNome, 'Maria');
  // um evento seguinte com o detalhe em erro nao sobrescreve o que ja existe
  falhar = true;
  await chegar('p2', 'ORDER_PATCHED', 'OPA');
  p = await obter('p2');
  assert.equal(p.clienteNome, 'Maria');
  assert.equal(p.totalReal, 89.9);
  assert.equal(p.itens.length, 1);
});

test('evento repetido e processado uma vez e assinatura errada e recusada', async () => {
  detalhe();
  const corpo = iFood('PLC', 'PLACED', 'p3');
  const um = await a.webhook({ plataforma: 'IFOOD', tipo: 'PLACED', pedido: 'p3', corpo, evento: 'unico', seq: 900 });
  const dois = await a.webhook({ plataforma: 'IFOOD', tipo: 'PLACED', pedido: 'p3', corpo, evento: 'unico', seq: 900 });
  await proc.processarFila();
  assert.equal(um.json.novo, true);
  assert.equal(dois.json.novo, false);
  assert.equal((await obter('p3')).eventos.length, 1);
  assert.equal((await a.webhook({ plataforma: 'IFOOD', tipo: 'PLACED', pedido: 'p4', corpo, segredo: 'errado' })).status, 401);
});

test('evento atrasado nao volta o pedido e cancelamento vence', async () => {
  detalhe();
  await chegar('p5', 'CONCLUDED', 'CON');
  await chegar('p5', 'DISPATCHED', 'DSP');
  assert.equal((await obter('p5')).statusKanban, 'CONCLUIDO');
  await chegar('p5', 'CANCELLED', 'CAN', { reason: 'Estorno' });
  const p = await obter('p5');
  assert.equal(p.statusKanban, 'CANCELADO');
  assert.equal(p.motivoCancelamento, 'Estorno');
});

test('todas as etapas do iFood atualizam o quadro', async () => {
  detalhe();
  await chegar('p6');
  const passos: Array<[string, string, string]> = [['CONFIRMED', 'CFM', 'PREPARO'], ['PREPARATION_STARTED', 'PRS', 'PREPARO'], ['READY_TO_PICKUP', 'RTP', 'PRONTO'], ['DISPATCHED', 'DSP', 'ENTREGA'], ['CONCLUDED', 'CON', 'CONCLUIDO']];
  for (const [tipo, code, esperado] of passos) {
    await chegar('p6', tipo, code);
    assert.equal((await obter('p6')).statusKanban, esperado, tipo);
  }
  await chegar('p6', 'ASSIGN_DRIVER', 'ADR', { workerName: 'Joao', workerPhone: '11999' });
  assert.equal((await obter('p6')).entregador.nome, 'Joao');
});

test('entrega propria iFood: despacho a partir do preparo marca pronto antes e a chave de idempotencia e estavel', async () => {
  detalhe();
  await chegar('p7');
  await acao('p7', 'confirm', {}, 'abc');
  assert.equal((await acao('p7', 'dispatch', { nome: 'Joao', telefone: '(11) 99999-0000' }, 'def')).status, 200);
  const todas = a.chamadasDe('POST', /\/acao$/);
  assert.deepEqual(todas.map((c) => c.corpo.acao), ['confirm', 'readyToPickup', 'dispatch']);
  assert.deepEqual(todas[2].corpo.dados, { courierName: 'Joao', courierPhone: '11999990000' });
  assert.equal(todas[2].headers['idempotency-key'], 'erp-def');
  assert.equal((await obter('p7')).statusKanban, 'ENTREGA');
});

test('cancelamento da loja no iFood espera a plataforma; recusa devolve o pedido ao normal', async () => {
  detalhe();
  await chegar('p8');
  await acao('p8', 'confirm');
  await acao('p8', 'requestCancellation', { codigo: '503', texto: 'Item em falta' });
  let p = await obter('p8');
  assert.equal(p.statusKanban, 'PREPARO');
  assert.ok(p.pendencias.cancelamentoLoja);
  assert.deepEqual(enviadas().at(-1).dados, { cancellationCode: '503', reason: 'Item em falta' });
  await chegar('p8', 'CANCELLATION_REQUEST_FAILED', 'CARF');
  p = await obter('p8');
  assert.equal(p.pendencias.cancelamentoLoja, null);
  assert.ok(p.acoes.some((x: any) => x.acao === 'requestCancellation'));
});

test('disputa do iFood: responder envia o disputeId e disputa encerrada nao reabre', async () => {
  detalhe();
  await chegar('p9', 'HANDSHAKE_DISPUTE', 'HSD', { disputeId: 'd1', message: 'Pedido incompleto', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal((await obter('p9')).pendencias.disputa.mensagem, 'Pedido incompleto');
  await acao('p9', 'denyCancellation', { texto: 'Foi entregue completo' });
  assert.deepEqual(enviadas().at(-1).dados, { disputeId: 'd1', detailReason: 'Foi entregue completo' });
  await chegar('p9', 'HANDSHAKE_DISPUTE', 'HSD', { disputeId: 'd1', message: 'repetida' });
  assert.equal((await obter('p9')).pendencias.disputa, null);
});

test('99Food: ids de 64 bits sao preservados na solicitacao de cancelamento', async () => {
  detalhe({ canal: '99FOOD' });
  await chegar99('5764617634637940830', 'orderNew', '{"order_id":5764617634637940830}');
  await chegar99('5764617634637940830', 'orderCancelApply', '{"order_id":5764617634637940830,"apply_id":9223372036854775807,"apply_reason":"Demora","reason_list":[{"reason":"Ja saiu"}]}');
  const p = await obter('5764617634637940830');
  assert.equal(p.pendencias.cancelamentoCliente.applyId, '9223372036854775807');
  await acao(p.id, 'denyCancellation', { texto: 'Ja saiu' });
  assert.deepEqual(enviadas().at(-1).dados, { applyId: '9223372036854775807', reason: 'Ja saiu' });
});

test('99Food: reembolso, entrega e retirada seguem os endpoints certos', async () => {
  detalhe({ canal: '99FOOD' });
  await chegar99('n1', 'orderNew', '{}');
  await chegar99('n1', 'deliveryStatus', '{"delivery_status":140,"rider_name":"Rita","rider_phone":"119"}');
  let p = await obter('n1');
  assert.equal(p.statusKanban, 'ENTREGA');
  assert.equal(p.entregador.nome, 'Rita');
  await chegar99('n1', 'orderFinish', '{}');
  await chegar99('n1', 'orderRefundApply', '{"apply_id":77,"apply_reason":"Veio errado","base_reason_list":[{"base_reason_id":3,"base_reason":"Conferido"}]}');
  await acao('n1', 'denyRefund', { codigo: '3' });
  assert.deepEqual(enviadas().at(-1).dados, { applyId: '77', baseReasonId: '3', baseReason: 'Conferido' });

  a.limpar();
  detalhe({ canal: '99FOOD', tipoEntrega: 'RETIRADA', modalidadePlataforma: 'TAKEOUT', entreguePor: 'CUSTOMER' });
  await chegar99('n2', 'orderNew', '{}');
  await acao('n2', 'confirm');
  await acao('n2', 'readyToPickup');
  await acao('n2', 'pickedUp');
  assert.deepEqual(enviadas().map((c) => c.acao), ['confirm', 'readyToPickup', 'pickedUp']);
  assert.equal((await obter('n2')).statusKanban, 'CONCLUIDO');
});

test('99Food entrega propria pede entregador e cancelamento envia reason_id', async () => {
  detalhe({ canal: '99FOOD' });
  await chegar99('n3', 'orderNew', '{}');
  await acao('n3', 'confirm');
  await acao('n3', 'readyToPickup');
  const dispatch = (await obter('n3')).acoes.find((x: any) => x.acao === 'dispatch');
  assert.equal(dispatch.pede, 'entregador');
  await acao('n3', 'requestCancellation', { codigo: '1010' });
  assert.equal(enviadas().at(-1).dados.reason_id, 1010);
  assert.equal((await obter('n3')).statusKanban, 'CANCELADO');
});

test('acao fora de etapa e recusada e erro do Hub volta com a mensagem', async () => {
  detalhe();
  await chegar('p10');
  assert.equal((await acao('p10', 'dispatch')).status, 409);
  a.quando('POST', /\/acao$/, () => ({ status: 400, json: { codigo: 'PLATAFORMA_HTTP_400', erro: 'A plataforma recusou.' } }));
  const r = await acao('p10', 'confirm');
  assert.equal(r.status, 400);
  assert.match(r.json.erro, /PLATAFORMA_HTTP_400/);
  assert.equal((await obter('p10')).statusKanban, 'NOVO');
});

test('aceite automatico confirma e inicia o preparo; agendado espera o horario', async () => {
  detalhe();
  await a.erp('PUT', '/ajustes', { aceiteAutomatico: true });
  await chegar('p11');
  assert.deepEqual(enviadas().map((c) => c.acao), ['confirm', 'startPreparation']);
  a.limpar();
  detalhe({ bruto: { orderTiming: 'SCHEDULED', preparationStartDateTime: new Date(Date.now() + 3600_000).toISOString() } });
  await a.erp('PUT', '/ajustes', { aceiteAutomatico: true });
  await chegar('p12');
  await proc.iniciarAgendados();
  assert.deepEqual(enviadas().map((c) => c.acao), ['confirm']);
});

test('PULL grava antes de confirmar o cursor e preserva o pedido se o detalhe falhar', async () => {
  a.banco.atualizarConfig({ transporte: 'PULL' });
  let entregue = false;
  a.quando('GET', /\/hub\/v1\/eventos$/, () => {
    const eventos = entregue ? [] : [{ v: 1, seq: 7, id: 'pull-7', tipo: 'PLACED', plataforma: 'IFOOD', pedido: 'p13', recebidoEm: new Date().toISOString(), teste: false, corpo: JSON.stringify(iFood('PLC', 'PLACED', 'p13')) }];
    entregue = true;
    return { json: { eventos } };
  });
  a.quando('GET', /\/conexao\/pedidos\/p13$/, () => ({ status: 503, json: { erro: 'fora' } }));
  a.quando('POST', /\/eventos\/confirmar$/, () => {
    assert.equal((a.banco.db.prepare('SELECT COUNT(*) AS n FROM eventos').get() as any).n, 1, 'gravado antes de confirmar');
    return { json: { cursor: 7 } };
  });
  await proc.puxarEventos();
  assert.deepEqual(a.chamadasDe('POST', /confirmar$/)[0].corpo, { ate: 7 });
  assert.equal((await obter('p13')).detalhePendente, true);
  assert.equal((a.banco.db.prepare("SELECT estado FROM eventos WHERE id = 'pull-7'").get() as any).estado, 'PENDENTE');
});

test('reconciliacao recupera pedido perdido e o webhook atrasado completa os dados', async () => {
  detalhe();
  const em = new Date(Date.now() - 120_000).toISOString();
  a.quando('GET', /\/conexao\/pedidos$/, () => ({ json: [{ plataforma: 'IFOOD', pedidoId: 'p14', eventos: [{ seq: 50, tipo: 'HANDSHAKE_DISPUTE', em }] }] }));
  assert.equal(await proc.reconciliar(), 1);
  assert.ok(await obter('p14'));
  assert.equal((await obter('p14')).pendencias.disputa, null);
  await a.webhook({ plataforma: 'IFOOD', tipo: 'HANDSHAKE_DISPUTE', pedido: 'p14', seq: 50, corpo: iFood('HSD', 'HANDSHAKE_DISPUTE', 'p14', { disputeId: 'd9' }) });
  await proc.processarFila();
  assert.equal((await obter('p14')).pendencias.disputa.id, 'd9');
});

test('pedido simulado do Hub chega com o pedido embutido', async () => {
  const corpo = { id: 'x', tipo: 'CANCELLATION_REQUESTED', teste: false, disputeId: 'disp-1', metadata: { disputeId: 'disp-1', reason: 'Quero cancelar' }, pedido: pedidoUnificado('simhub-1', { statusKanban: 'PREPARO' }) };
  await a.webhook({ plataforma: 'IFOOD', tipo: 'CANCELLATION_REQUESTED', pedido: 'simhub-1', corpo });
  await proc.processarFila();
  const p = await obter('simhub-1');
  assert.equal(p.statusKanban, 'PREPARO');
  assert.equal(p.pendencias.disputa.id, 'disp-1');
  assert.equal(a.chamadasDe('GET', /simhub-1/).length, 0);
});

test('entrar valida o token sem trocar o token de nenhuma conexao', async () => {
  a.quando('GET', /\/hub\/v1\/integracao$/, () => ({ json: { conectada: true, integrador: { codigo: 'teste' }, conexao: { conexaoId: 'de-outra-loja' } } }));
  const r = await a.erp('POST', '/entrar', { baseUrl: a.banco.obterConfig().baseUrl, tokenIntegracao: 'hubp_novo' });
  assert.equal(r.status, 200);
  assert.equal(a.chamadas.filter((c) => /recuperar-token|\/token$/.test(c.caminho)).length, 0);
  assert.equal(a.banco.obterConfig().conexaoId, 'conexao-1');
  assert.equal(a.banco.obterConfig().tokenConexao, 'hubi_teste');
});
