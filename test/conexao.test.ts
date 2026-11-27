import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { pedidoUnificado, prepararAmbiente } from './apoio.js';

let a: Awaited<ReturnType<typeof prepararAmbiente>>;
let proc: typeof import('../src/server/pedidos/processador.js');
let pub: typeof import('../src/server/catalogo/publicador.js');
let hub: typeof import('../src/server/hubClient.js');

before(async () => {
  a = await prepararAmbiente();
  proc = await import('../src/server/pedidos/processador.js');
  pub = await import('../src/server/catalogo/publicador.js');
  hub = await import('../src/server/hubClient.js');
});
after(() => a.fechar());
beforeEach(() => {
  a.limpar();
  a.banco.atualizarConfig({ conexaoId: 'conexao-1', tokenConexao: 'hubi_teste', transporte: 'PULL', webhookSegredo: 'segredo-teste', lojasVinculadasJson: '[]' });
});

const recusado = { status: 401, json: { codigo: 'TOKEN_INVALIDO', erro: 'Credencial ausente, errada ou revogada.' } };
const revogar = () => {
  for (const metodo of ['GET', 'POST']) a.quando(metodo, /\/hub\/v1\/(conexao|eventos)(\/|$)/, (c) => (c.headers.authorization === 'Bearer hubi_teste' ? recusado : undefined));
};
const sessao = async () => (await a.erp('GET', '/sessao')).json;
const rodarWorkers = async () => {
  await hub.atualizarEstadoConexao();
  await proc.puxarEventos();
  await proc.reconciliar();
  await proc.processarFila();
  await proc.iniciarAgendados();
  await pub.processarCatalogo();
  await pub.acompanharProcessamento();
};
const lanche = { nome: 'X-Salada', categoria: 'Lanches', preco: 20 };

test('token recusado para tudo, sem recuperar sozinho, e volta quando um token novo e gravado', async () => {
  revogar();
  await a.webhook({ plataforma: 'IFOOD', tipo: 'PLACED', pedido: 'p1', corpo: { id: 'e1' } });
  await hub.atualizarEstadoConexao();
  await a.erp('PUT', '/catalogo/produtos', lanche);
  const antes = a.chamadas.length;
  await rodarWorkers();
  await rodarWorkers();
  assert.equal(a.chamadas.length, antes, 'nenhuma chamada ao Hub depois da recusa');
  assert.equal(a.chamadasDe('POST', /token/).length, 0);
  assert.equal((await sessao()).conexaoEncerrada, true);
  const livres = await a.erp('GET', '/lojas-livres?plataforma=99FOOD');
  assert.equal(livres.status, 409);
  assert.match(livres.json.erro, /CONEXAO_ENCERRADA.*Conectar de novo/);
  assert.equal(a.banco.db.prepare("SELECT tentativas FROM eventos WHERE pedidoId = 'p1'").pluck().get(), 0);
  assert.equal(a.banco.db.prepare('SELECT COUNT(*) FROM fila_catalogo').pluck().get(), 1);

  a.banco.atualizarConfig({ tokenConexao: 'hubi_novo' });
  assert.equal((await sessao()).conexaoEncerrada, false);
  a.quando('GET', /\/conexao\/pedidos\/p1$/, () => ({ json: pedidoUnificado('p1') }));
  await proc.processarFila();
  assert.equal((await a.erp('GET', '/pedidos')).json.pedidos[0].detalhePendente, false);
});

test('recusa durante o envio do cardapio nao marca erro nem perde a tarefa', async () => {
  revogar();
  await a.erp('PUT', '/catalogo/produtos', lanche);
  await new Promise((r) => setTimeout(r, 100));
  const [salvo] = (await a.erp('GET', '/catalogo/produtos')).json;
  assert.equal(salvo.estado, 'NA_FILA');
  assert.equal(salvo.operacoesPendentes, 1);
});

test('conectar de novo na mesma conexao gera token no mesmo clique e troca o segredo', async () => {
  revogar();
  a.quando('POST', /\/integracao\/conectar$/, () => ({ json: { conexaoId: 'conexao-1', cnpj: '11111111000191', transporte: { modo: 'PUSH', url: 'https://delivery.targetx.com.br/erp-simulador/api/webhook' }, lojas: [], credenciais: null } }));
  a.quando('POST', /\/conexoes\/conexao-1\/token$/, () => ({ json: { conexaoId: 'conexao-1', token: 'hubi_novo' } }));
  a.quando('POST', /\/segredo\/rotacionar$/, () => ({ json: { webhookSegredo: 'segredo-novo' } }));
  assert.equal((await a.erp('POST', '/conectar-cnpj', { cnpj: '11111111000191', transporte: 'PUSH' })).status, 200);
  const c = a.banco.obterConfig();
  assert.equal(c.tokenConexao, 'hubi_novo');
  assert.equal(c.webhookSegredo, 'segredo-novo');
  assert.equal((await sessao()).conexaoEncerrada, false);
  assert.equal((await a.webhook({ plataforma: 'HUB', tipo: 'TESTE', pedido: '', corpo: {}, segredo: 'segredo-novo' })).status, 200);
});

test('conexao nova descarta filas e arquiva pedidos da anterior e usa o segredo novo', async () => {
  a.quando('GET', /\/conexao\/pedidos\/velho$/, () => ({ json: pedidoUnificado('velho') }));
  a.banco.atualizarConfig({ transporte: 'PUSH' });
  await a.webhook({ plataforma: 'IFOOD', tipo: 'PLACED', pedido: 'velho', corpo: { id: 'e2' } });
  await proc.processarFila();
  revogar();
  await hub.atualizarEstadoConexao();
  await a.erp('PUT', '/catalogo/produtos', lanche);
  a.quando('POST', /\/integracao\/conectar$/, () => ({ status: 201, json: { conexaoId: 'conexao-2', cnpj: '11111111000191', transporte: { modo: 'PUSH', url: 'https://delivery.targetx.com.br/erp-simulador/api/webhook' }, lojas: [], credenciais: { token: 'hubi_2', webhookSegredo: 'segredo-2' } } }));
  assert.equal((await a.erp('POST', '/conectar-cnpj', { cnpj: '11111111000191', transporte: 'PUSH' })).status, 201);
  assert.equal(a.banco.obterConfig().webhookSegredo, 'segredo-2');
  assert.equal(a.chamadasDe('POST', /rotacionar$|token$/).length, 0);
  assert.equal(a.banco.db.prepare('SELECT COUNT(*) FROM fila_catalogo').pluck().get(), 0);
  assert.equal((await a.erp('GET', '/catalogo/produtos')).json[0].estado, 'SEM_LOJA');
  assert.equal((await a.erp('GET', '/pedidos')).json.pedidos[0].statusKanban, 'CANCELADO');
});

test('id de loja de 19 digitos chega ao Hub como texto, mesmo enviado como numero', async () => {
  const r = await fetchBruto('/lojas/vincular', '{"plataforma":"99FOOD","loja":5764619676102952248}');
  assert.equal(r, 200);
  assert.equal(a.chamadasDe('POST', /\/conexao\/lojas$/)[0].corpoBruto, '{"plataforma":"99FOOD","loja":"5764619676102952248"}');
  assert.equal(await fetchBruto('/lojas/liberar', '{"plataforma":"IFOOD","loja":null}'), 400);
  assert.deepEqual(hub.lerJson('{"id":5764619676102952248,"lat":-23.5505199999999999,"x":0.30000000000000004}'), { id: '5764619676102952248', lat: -23.55052, x: 0.30000000000000004 });
});

test('sem loja ativa nao consulta loja nem cardapio e explica o que fazer', async () => {
  const lojas = [{ plataforma: '99FOOD', estado: 'PENDENTE', loja: null }];
  a.banco.atualizarConfig({ lojasVinculadasJson: JSON.stringify(lojas) });
  a.quando('GET', /\/hub\/v1\/conexao$/, () => ({ json: { estado: 'PENDENTE', lojas } }));
  assert.deepEqual((await a.erp('GET', '/loja/status')).json, {});
  const r = await a.erp('GET', '/catalogo/plataformas?atualizar=true');
  assert.match(r.json.erro, /LOJA_NAO_ENCONTRADA.*Vincule/);
  assert.equal(a.chamadasDe('GET', /loja\/status|catalogo/).length, 0);
});

test('erro do Hub chega a tela com mensagem real e orientacao', async () => {
  a.quando('GET', /lojas-disponiveis$/, () => ({ status: 400, json: { codigo: 'PLATAFORMA_ERRNO_10005', erro: 'A 99Food recusou a operacao (errno 10005): window: 120s, limit: 2' } }));
  assert.match((await a.erp('GET', '/lojas-livres')).json.erro, /errno 10005.*aguarde 120 segundos/);
  a.quando('POST', /\/conexao\/lojas$/, () => ({ status: 409, json: { codigo: 'SELECAO_REQUER_TARGET', erro: 'Este estabelecimento ja usa o Target Delivery.' } }));
  assert.match((await a.erp('POST', '/lojas/vincular', { plataforma: 'IFOOD', loja: 'm' })).json.erro, /Target Delivery.*confirmar a loja/);
});

/** Envia o corpo como texto, para o numero grande nao passar pelo JSON.stringify. */
async function fetchBruto(caminho: string, corpo: string) {
  const { criarApp } = await import('../src/server/app.js');
  const servidor = criarApp().listen(0, '127.0.0.1');
  await new Promise((ok) => servidor.once('listening', ok));
  const r = await fetch(`http://127.0.0.1:${(servidor.address() as any).port}/api${caminho}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: corpo });
  servidor.close();
  return r.status;
}
