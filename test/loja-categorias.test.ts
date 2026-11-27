import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { prepararAmbiente } from './apoio.js';
import { ondeExiste } from '../src/shared/categorias.js';
import type { CategoriaHub, ListaCategorias } from '../src/shared/tipos.js';

let a: Awaited<ReturnType<typeof prepararAmbiente>>;
let pub: typeof import('../src/server/catalogo/publicador.js');
let categorias: typeof import('../src/server/catalogo/categorias.js');

before(async () => {
  a = await prepararAmbiente();
  pub = await import('../src/server/catalogo/publicador.js');
  categorias = await import('../src/server/catalogo/categorias.js');
});
after(() => a.fechar());
beforeEach(() => {
  a.limpar();
  categorias.esquecerCategorias();
});

const lanche = { codigo: 'X1', nome: 'X-Salada', categoria: 'Lanches', preco: 20 };
const esperar = async () => {
  for (let i = 0; i < 20; i++) {
    await pub.processarCatalogo();
    await new Promise((r) => setTimeout(r, 10));
  }
};
const publicado = (canais: Record<string, unknown>) => a.quando('POST', /\/catalogo\/produtos$/, () => ({ json: { ok: false, resultados: [{ canais }] } }));
const produtos = async () => (await a.erp('GET', '/catalogo/produtos')).json;

test('texto de onde a categoria existe e onde sera criada', () => {
  const lista = (ifood = 'OK', n99 = 'OK'): ListaCategorias => ({ plataformas: { IFOOD: { estado: ifood as 'OK' }, '99FOOD': { estado: n99 as 'OK' } }, categorias: [], avisos: [] });
  const c = (plataformas: CategoriaHub['plataformas'], extra: Partial<CategoriaHub> = {}): CategoriaHub => ({ nome: 'Lanches', plataformas, ausenteEm: [], ...extra });
  assert.equal(ondeExiste(c(['IFOOD']), lista()), 'só no iFood: será criada na 99Food');
  assert.equal(ondeExiste(c(['99FOOD']), lista()), 'só na 99Food: será criada no iFood');
  assert.equal(ondeExiste(c(['IFOOD', '99FOOD']), lista()), 'no iFood e na 99Food');
  assert.equal(ondeExiste(undefined, lista()), 'nova: será criada no iFood e na 99Food');
  assert.equal(ondeExiste(c(['IFOOD'], { publicandoEm: ['99FOOD'] }), lista()), 'só no iFood: sendo criada na 99Food');
  assert.equal(ondeExiste(c(['IFOOD']), lista('OK', 'ERRO')), 'no iFood; 99Food não consultada');
  assert.equal(ondeExiste(c(['IFOOD']), lista('OK', 'SEM_LOJA')), 'no iFood');
  // Secao de pizza nativa do iFood nao conta: um produto comum ganha categoria propria
  assert.equal(ondeExiste(c(['IFOOD'], { canais: { IFOOD: [{ template: 'PIZZA' }] } }), lista()), 'nova: será criada no iFood e na 99Food');
});

test('produto sem categoria e recusado com mensagem clara e nada e enviado', async () => {
  for (const categoria of ['', '   ', undefined]) {
    const r = await a.erp('PUT', '/catalogo/produtos', { ...lanche, categoria });
    assert.equal(r.status, 400);
    assert.match(r.json.erro, /Informe a categoria do produto.*criada ao publicar/);
  }
  assert.equal(a.chamadas.length, 0);
});

test('lista de categorias e reaproveitada por um minuto e relida depois de publicar', async () => {
  a.quando('GET', /\/catalogo\/categorias$/, () => ({ json: { plataformas: {}, categorias: [{ nome: 'Lanches', plataformas: ['IFOOD'], ausenteEm: ['99FOOD'] }], avisos: [] } }));
  publicado({ IFOOD: { estado: 'PUBLICADO' } });
  assert.equal((await a.erp('GET', '/catalogo/categorias')).json.categorias[0].nome, 'Lanches');
  await a.erp('GET', '/catalogo/categorias');
  assert.equal(a.chamadasDe('GET', /categorias$/).length, 1);
  await a.erp('PUT', '/catalogo/produtos', lanche);
  await esperar();
  await a.erp('GET', '/catalogo/categorias');
  assert.equal(a.chamadasDe('GET', /categorias$/).length, 2);
});

test('falha na consulta de categorias devolve o motivo e nao fica guardada', async () => {
  a.quando('GET', /\/catalogo\/categorias$/, () => ({ status: 503, json: { codigo: 'HUB_INDISPONIVEL', erro: 'Servico temporariamente indisponivel.' } }));
  const r = await a.erp('GET', '/catalogo/categorias');
  assert.equal(r.status, 503);
  assert.match(r.json.erro, /HUB_INDISPONIVEL/);
  await a.erp('GET', '/catalogo/categorias');
  assert.equal(a.chamadasDe('GET', /categorias$/).length, 2);
});

test('categoria avulsa vai sem plataforma, devolve o resultado de cada uma e aparece no cardapio sem nova leitura', async () => {
  const plataformas = { IFOOD: { estado: 'CRIADA', id: 'c-1' }, '99FOOD': { estado: 'ERRO', erroCodigo: 'CARDAPIO_99_AGUARDE', erro: 'Repita em 40 segundos.', retryAfterSegundos: 40 } };
  a.quando('POST', /\/catalogo\/categorias$/, () => ({ json: { ok: false, nome: 'Bebidas', plataformas, avisos: [] } }));
  const r = await a.erp('POST', '/catalogo/plataformas/categorias', { nome: ' Bebidas ' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.plataformas, plataformas);
  const [chamada] = a.chamadas;
  assert.equal(chamada.query.get('plataforma'), null);
  assert.deepEqual(chamada.corpo, { name: 'Bebidas' });
  assert.deepEqual((await a.erp('GET', '/catalogo/plataformas')).json.categorias.map((c: any) => [c.plataforma, c.id, c.nome]), [['IFOOD', 'c-1', 'Bebidas']]);
  assert.equal(a.chamadas.length, 1, 'nao le o cardapio de novo');
  // Com plataforma continua como antes
  await a.erp('POST', '/catalogo/plataformas/categorias', { nome: 'Sucos', plataforma: '99FOOD' });
  assert.equal(a.chamadas[1].query.get('plataforma'), '99FOOD');
});

test('envio na fila mostra os segundos que faltam, mantidos nas consultas seguintes', async () => {
  publicado({ IFOOD: { estado: 'PUBLICADO' }, '99FOOD': { estado: 'PROCESSANDO', envioEmSegundos: 45, avisos: ['Na fila: aguarde.'] } });
  await a.erp('PUT', '/catalogo/produtos', lanche);
  await esperar();
  let [item] = await produtos();
  assert.ok(item.canais['99FOOD'].envioEmSegundos > 40 && item.canais['99FOOD'].envioEmSegundos <= 45);
  // A consulta do Hub nao traz envioEmSegundos
  a.quando('GET', /\/catalogo\/produtos\//, () => ({ json: { canais: { IFOOD: { estado: 'PUBLICADO' }, '99FOOD': { estado: 'PROCESSANDO' } } } }));
  await pub.acompanharProcessamento();
  [item] = await produtos();
  assert.ok(item.canais['99FOOD'].envioEmSegundos > 40);
  a.quando('GET', /\/catalogo\/produtos\//, () => ({ json: { canais: { IFOOD: { estado: 'PUBLICADO' }, '99FOOD': { estado: 'PUBLICADO' } } } }));
  await pub.acompanharProcessamento();
  [item] = await produtos();
  assert.equal(item.canais['99FOOD'].envioEmSegundos, undefined);
  assert.equal(item.estado, 'PUBLICADO');
});

test('erroCodigo aparece na mensagem e codigo temporario volta para a fila respeitando a espera', async () => {
  publicado({ IFOOD: { estado: 'PUBLICADO' }, '99FOOD': { estado: 'ERRO', erroCodigo: 'CARDAPIO_99_ITEM_RECUSADO', erro: 'Item recusado.' } });
  await a.erp('PUT', '/catalogo/produtos', lanche);
  await esperar();
  let [item] = await produtos();
  assert.equal(item.estado, 'PARCIAL');
  assert.match(item.erro, /99Food: \[CARDAPIO_99_ITEM_RECUSADO\] Item recusado/);
  assert.equal(item.operacoesPendentes, 0);

  publicado({ IFOOD: { estado: 'PUBLICADO' }, '99FOOD': { estado: 'ERRO', erroCodigo: 'CARDAPIO_99_AGUARDE', erro: 'Espere a janela.', detalhes: { retryAfterSegundos: 200 } } });
  const antes = Date.now();
  // Reenviar continua disponivel depois de um erro (ou de um item apagado no painel da plataforma)
  assert.equal((await a.erp('POST', '/catalogo/produtos/X1/reenviar')).status, 202);
  await esperar();
  [item] = await produtos();
  assert.equal(item.operacoesPendentes, 1);
  const proxima = a.banco.db.prepare('SELECT proximaEm FROM fila_catalogo').pluck().get() as number;
  assert.ok(proxima >= antes + 200_000);
});

test('reenviar publica de novo um produto ja publicado', async () => {
  publicado({ IFOOD: { estado: 'PUBLICADO' }, '99FOOD': { estado: 'PUBLICADO' } });
  await a.erp('PUT', '/catalogo/produtos', lanche);
  await esperar();
  await a.erp('POST', '/catalogo/produtos/X1/reenviar');
  await esperar();
  assert.equal(a.chamadasDe('POST', /catalogo\/produtos$/).length, 2);
});

test('aviso da exclusao fica na tela depois que o produto sai do ERP', async () => {
  const antigo = 'A 99Food publica o cardapio em ate alguns minutos.';
  const pausado = 'A 99Food recusou apagar o item. Ele ficou indisponivel para venda.';
  publicado({ IFOOD: { estado: 'PUBLICADO' }, '99FOOD': { estado: 'PUBLICADO', avisos: [antigo] } });
  await a.erp('PUT', '/catalogo/produtos', lanche);
  await esperar();
  a.quando('DELETE', /\/catalogo\/produtos\//, () => ({ json: { ok: true, resultado: { canais: { IFOOD: { estado: 'REMOVIDO' }, '99FOOD': { estado: 'PROCESSANDO', avisos: [antigo] } } } } }));
  await a.erp('DELETE', '/catalogo/produtos/X1');
  await esperar();
  a.quando('GET', /\/catalogo\/produtos\//, () => ({ json: { canais: { IFOOD: { estado: 'REMOVIDO' }, '99FOOD': { estado: 'REMOVIDO', avisos: [pausado] } } } }));
  await pub.acompanharProcessamento();
  assert.equal((await produtos()).length, 0);
  const avisos = (await a.erp('GET', '/catalogo/avisos')).json;
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].texto, /X-Salada.*99Food: A 99Food recusou apagar/);
  await a.erp('DELETE', `/catalogo/avisos/${avisos[0].id}`);
  assert.deepEqual((await a.erp('GET', '/catalogo/avisos')).json, []);
});

test('dados e funcionamento da loja repassam plataforma e corpo ao Hub', async () => {
  const resposta = { ok: true, parcial: false, plataformas: { IFOOD: { estado: 'APLICADO' } } };
  a.quando('GET', /\/loja\/dados$/, () => ({ json: { plataformas: {} } }));
  a.quando('PATCH', /\/loja\/dados$/, () => ({ json: resposta }));
  a.quando('POST', /\/loja\/funcionamento$/, () => ({ json: resposta }));
  assert.equal((await a.erp('GET', '/loja/dados')).status, 200);
  const corpo = { horarios: [{ dia: 1, faixas: [{ inicio: '11:00', fim: '24:00' }] }] };
  assert.deepEqual((await a.erp('PATCH', '/loja/dados?plataforma=IFOOD', corpo)).json, resposta);
  await a.erp('POST', '/loja/funcionamento', { acao: 'FECHAR' });
  assert.deepEqual(a.chamadas.map((c) => [c.metodo, c.query.get('plataforma'), c.corpo]), [
    ['GET', null, null],
    ['PATCH', 'IFOOD', corpo],
    ['POST', null, { acao: 'FECHAR' }],
  ]);
});

test('plataforma invalida nao chega ao Hub, para nao alterar as duas lojas', async () => {
  for (const plataforma of ['ifood', '99', '']) {
    assert.equal((await a.erp('POST', `/loja/funcionamento?plataforma=${plataforma}`, { acao: 'FECHAR' })).status, 400);
  }
  assert.equal(a.chamadas.length, 0);
});

test('falha total preserva o detalhe por plataforma e o tempo de espera; sem resposta avisa para consultar', async () => {
  const detalhes = { plataformas: { '99FOOD': { estado: 'FALHOU', erro: { codigo: 'PLATAFORMA_ERRNO_10005', erro: 'Limite.', retryAfterSegundos: 42 } } } };
  a.quando('PATCH', /\/loja\/dados$/, () => ({ status: 429, json: { codigo: 'PLATAFORMA_ERRNO_10005', erro: 'Limite de frequencia da 99Food: aguarde 42 segundos e repita.', detalhes: { retryAfterSegundos: 42, ...detalhes } } }));
  const r = await a.erp('PATCH', '/loja/dados', { tempoPreparoMinutos: 30 });
  assert.equal(r.status, 429);
  assert.match(r.json.erro, /aguarde 42 segundos/);
  assert.deepEqual(r.json.detalhes.plataformas, detalhes.plataformas);

  a.quando('POST', /\/loja\/funcionamento$/, () => ({ status: 504, bruto: '<html>Gateway Time-out</html>' }));
  const s = await a.erp('POST', '/loja/funcionamento', { acao: 'ABRIR' });
  assert.equal(s.status, 502);
  assert.match(s.json.erro, /pode ter sido aplicada/);
});
