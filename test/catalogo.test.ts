import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { prepararAmbiente } from './apoio.js';

let a: Awaited<ReturnType<typeof prepararAmbiente>>;
let pub: typeof import('../src/server/catalogo/publicador.js');

before(async () => {
  a = await prepararAmbiente();
  pub = await import('../src/server/catalogo/publicador.js');
});
after(() => a.fechar());
beforeEach(() => a.limpar());

const canais = (ifood = 'PUBLICADO', n99 = 'PUBLICADO', erro?: string) => ({ IFOOD: { estado: ifood }, '99FOOD': { estado: n99, ...(erro ? { erro } : {}) } });
const publicado = (c = canais()) => a.quando('POST', /\/catalogo\/produtos$/, () => ({ json: { ok: true, resultados: [{ canais: c }] } }));
const ajustes = () => {
  a.quando('PATCH', /\/catalogo\/produtos\//, () => ({ json: { ok: true, resultado: { canais: canais() } } }));
  a.quando('DELETE', /\/catalogo\/produtos\//, () => ({ json: { ok: true, resultado: { canais: canais('REMOVIDO', 'REMOVIDO') } } }));
};
const esperar = async () => {
  for (let i = 0; i < 40; i++) {
    await pub.processarCatalogo();
    await new Promise((r) => setTimeout(r, 15));
  }
};
const lanche = {
  nome: 'X-Salada',
  categoria: 'Lanches',
  preco: '22,50',
  grupos: [
    { nome: 'Ponto', min: 1, max: 1, opcoes: [{ nome: 'Ao ponto' }, { nome: 'Bem passado' }] },
    { nome: 'Adicionais', min: 0, max: 2, opcoes: [{ nome: 'Bacon', preco: 4 }, { nome: 'Queijo', preco: 3, disponivel: false }] },
  ],
};
const pizza = {
  nome: 'Pizza',
  categoria: 'Pizzas',
  tipo: 'PIZZA',
  pizza: {
    tamanhos: [{ codigo: 'G', nome: 'Grande', preco: 60, pedacos: 8, maxSabores: 2 }, { codigo: 'M', nome: 'Media', preco: 45, maxSabores: 2 }],
    sabores: [{ codigo: 'CAL', nome: 'Calabresa' }, { codigo: 'CAM', nome: 'Camarao', acrescimo: 10, disponivel: false }],
    massas: [{ nome: 'Tradicional' }],
    bordas: [{ nome: 'Catupiry', preco: 8 }],
  },
};

test('produto com adicionais vai completo ao Hub, com codigos estaveis', async () => {
  publicado();
  const r = await a.erp('PUT', '/catalogo/produtos', lanche);
  assert.equal(r.status, 202);
  await esperar();
  const enviado = a.chamadasDe('POST', /catalogo\/produtos$/)[0].corpo;
  assert.equal(enviado.preco, 22.5);
  assert.equal(enviado.disponivel, true);
  assert.equal(enviado.grupos.length, 2);
  assert.equal(enviado.grupos[1].opcoes[1].disponivel, false);
  assert.ok(enviado.grupos.every((g: any) => g.codigo && g.opcoes.every((o: any) => o.codigo)));
  const [salvo] = (await a.erp('GET', '/catalogo/produtos')).json;
  assert.equal(salvo.estado, 'PUBLICADO');
  // editar mantem os codigos
  await a.erp('PUT', '/catalogo/produtos', { ...salvo.produto, nome: 'X-Salada Especial' });
  await esperar();
  const segundo = a.chamadasDe('POST', /catalogo\/produtos$/)[1].corpo;
  assert.equal(segundo.codigo, enviado.codigo);
  assert.equal(segundo.grupos[0].opcoes[0].codigo, enviado.grupos[0].opcoes[0].codigo);
});

test('pizza envia tamanhos, sabores, massas e bordas com a pausa de cada um', async () => {
  publicado();
  ajustes();
  await a.erp('PUT', '/catalogo/produtos', pizza);
  await esperar();
  const enviado = a.chamadasDe('POST', /catalogo\/produtos$/)[0].corpo;
  assert.equal(enviado.preco, 45);
  assert.equal(enviado.pizza.tamanhos.length, 2);
  assert.equal(enviado.pizza.tamanhos[0].maxSabores, 2);
  assert.equal(enviado.pizza.sabores[1].acrescimo, 10);
  assert.equal(enviado.pizza.massas.length, 1);
  assert.equal(enviado.pizza.bordas[0].preco, 8);
  assert.equal(enviado.pizza.sabores[1].disponivel, false);
  assert.ok(enviado.pizza.tamanhos.every((t: any) => t.disponivel === true));
  assert.equal(a.chamadasDe('PATCH', /opcoes\//).length, 0, 'a pausa vai na propria publicacao');
});

test('preco e pausa rapidos usam PATCH; preco de opcao de pizza republica', async () => {
  publicado();
  ajustes();
  const { produto } = (await a.erp('PUT', '/catalogo/produtos', lanche)).json;
  await esperar();
  await a.erp('PATCH', `/catalogo/produtos/${produto.codigo}`, { preco: 25 });
  await a.erp('PATCH', `/catalogo/produtos/${produto.codigo}/opcoes/${produto.grupos[1].opcoes[0].codigo}`, { disponivel: false });
  await esperar();
  assert.deepEqual(a.chamadasDe('PATCH', new RegExp(`produtos/${produto.codigo}$`))[0].corpo, { preco: 25 });
  assert.equal(a.chamadasDe('PATCH', /opcoes\//).length, 1);

  const p = (await a.erp('PUT', '/catalogo/produtos', pizza)).json.produto;
  await esperar();
  assert.equal((await a.erp('PATCH', `/catalogo/produtos/${p.codigo}`, { preco: 1 })).status, 400);
  const antes = a.chamadasDe('POST', /catalogo\/produtos$/).length;
  await a.erp('PATCH', `/catalogo/produtos/${p.codigo}/opcoes/CAL`, { preco: 5 });
  await esperar();
  const depois = a.chamadasDe('POST', /catalogo\/produtos$/);
  assert.equal(depois.length, antes + 1);
  assert.equal(depois.at(-1)!.corpo.pizza.sabores[0].acrescimo, 5);
});

test('99Food processando e acompanhada ate publicar; exclusao remove dos dois canais', async () => {
  publicado(canais('PUBLICADO', 'PROCESSANDO'));
  ajustes();
  const { produto } = (await a.erp('PUT', '/catalogo/produtos', lanche)).json;
  await esperar();
  assert.equal((await a.erp('GET', '/catalogo/produtos')).json[0].estado, 'PROCESSANDO');
  a.quando('GET', /\/catalogo\/produtos\//, () => ({ json: { canais: canais() } }));
  await pub.acompanharProcessamento();
  assert.equal((await a.erp('GET', '/catalogo/produtos')).json[0].estado, 'PUBLICADO');
  await a.erp('DELETE', `/catalogo/produtos/${produto.codigo}`);
  await esperar();
  assert.equal((await a.erp('GET', '/catalogo/produtos')).json.length, 0);
});

test('limite de frequencia da 99Food fica na fila; recusa definitiva mostra o canal', async () => {
  publicado(canais('PUBLICADO', 'ERRO', 'errno 10005: The calling frequency exceeds the setting'));
  await a.erp('PUT', '/catalogo/produtos', lanche);
  await esperar();
  let [item] = (await a.erp('GET', '/catalogo/produtos')).json;
  assert.equal(item.estado, 'NA_FILA');
  assert.equal(item.operacoesPendentes, 1);
  assert.equal(a.chamadasDe('POST', /catalogo\/produtos$/).length, 1, 'so repete depois da espera');
  publicado(canais('PUBLICADO', 'ERRO', 'Imagem recusada'));
  await a.erp('POST', '/catalogo/produtos/processar');
  await esperar();
  [item] = (await a.erp('GET', '/catalogo/produtos')).json;
  assert.equal(item.estado, 'PARCIAL');
  assert.match(item.erro, /99Food: Imagem recusada/);
});

test('validacao devolve a mensagem sem enviar nada', async () => {
  const casos = [
    { ...lanche, grupos: [{ nome: 'G', min: 3, max: 3, opcoes: [{ nome: 'a' }] }] },
    { ...lanche, preco: 0, grupos: [] },
    { ...pizza, pizza: { ...pizza.pizza, tamanhos: [] } },
    { ...pizza, pizza: { ...pizza.pizza, bordas: [], bordaObrigatoria: true } },
    { ...lanche, nome: '' },
  ];
  for (const caso of casos) assert.equal((await a.erp('PUT', '/catalogo/produtos', caso)).status, 400);
  assert.equal(a.chamadas.length, 0);
});

test('ajustes direto na plataforma usam o formato de cada canal', async () => {
  await a.erp('PATCH', '/catalogo/plataformas/itens', { plataforma: '99FOOD', itemId: 'A', preco: 12.5 });
  await a.erp('PATCH', '/catalogo/plataformas/itens', { plataforma: 'IFOOD', itemId: 'B', preco: 12.5, status: 'UNAVAILABLE' });
  await a.erp('PATCH', '/catalogo/plataformas/opcoes', { plataforma: '99FOOD', optionId: 'O', groupId: 'G', preco: 2 });
  const corpos = a.chamadas.map((c) => [c.query.get('plataforma'), c.corpo]);
  assert.deepEqual(corpos[0], ['99FOOD', { itemId: 'A', preco: 12.5 }]);
  assert.deepEqual(corpos[1], ['IFOOD', { itemId: 'B', price: { value: 12.5 } }]);
  assert.deepEqual(corpos[2], ['IFOOD', { itemId: 'B', status: 'UNAVAILABLE' }]);
  assert.deepEqual(corpos[3], ['99FOOD', { optionId: 'O', groupId: 'G', price: 2 }]);
});

test('alteracao e salvamento durante um envio nao se perdem', async () => {
  ajustes();
  let durante: (() => void) | null = null;
  a.quando('POST', /\/catalogo\/produtos$/, () => {
    durante?.();
    durante = null;
    return { json: { ok: true, resultados: [{ canais: canais() }] } };
  });
  const rotas = await import('../src/server/catalogo/publicador.js');
  durante = () => {
    const p = rotas.obterProduto('LANCHE')!;
    rotas.gravarProduto({ ...p, disponivel: false });
    rotas.enfileirar('LANCHE', 'PATCH', { disponivel: false });
  };
  await a.erp('PUT', '/catalogo/produtos', { ...lanche, codigo: 'LANCHE' });
  await esperar();
  assert.deepEqual(a.chamadasDe('PATCH', /produtos\/LANCHE$/).map((c) => c.corpo), [{ disponivel: false }]);

  // salvar enquanto a exclusao esta no ar mantem o produto e republica
  a.quando('DELETE', /\/catalogo\/produtos\//, () => {
    rotas.gravarProduto({ ...rotas.obterProduto('LANCHE')!, nome: 'Novo nome' });
    rotas.enfileirar('LANCHE', 'PUBLICAR');
    return { json: { ok: true, resultado: { canais: canais('REMOVIDO', 'REMOVIDO') } } };
  });
  await a.erp('DELETE', '/catalogo/produtos/LANCHE');
  await esperar();
  const lista = (await a.erp('GET', '/catalogo/produtos')).json;
  assert.equal(lista[0]?.produto.nome, 'Novo nome');
  assert.equal(a.chamadasDe('POST', /catalogo\/produtos$/).at(-1)!.corpo.nome, 'Novo nome');
});

test('canal com erro nao interrompe o acompanhamento e 429 do canal e repetido', async () => {
  publicado({ IFOOD: { estado: 'ERRO', erro: 'Categoria recusada' }, '99FOOD': { estado: 'PROCESSANDO' } } as any);
  await a.erp('PUT', '/catalogo/produtos', lanche);
  await esperar();
  a.quando('GET', /\/catalogo\/produtos\//, () => ({ json: { canais: { IFOOD: { estado: 'ERRO', erro: 'Categoria recusada' }, '99FOOD': { estado: 'PUBLICADO' } } } }));
  await pub.acompanharProcessamento();
  assert.equal((await a.erp('GET', '/catalogo/produtos')).json[0].canais['99FOOD'].estado, 'PUBLICADO');

  a.limpar();
  publicado({ IFOOD: { estado: 'ERRO', erro: 'A plataforma respondeu HTTP 429.', detalhes: { statusHttp: 429 } }, '99FOOD': { estado: 'PUBLICADO' } } as any);
  await a.erp('PUT', '/catalogo/produtos', lanche);
  await esperar();
  assert.equal((await a.erp('GET', '/catalogo/produtos')).json[0].operacoesPendentes, 1);
});

test('preco rapido de sabor com acrescimo por tamanho e recusado', async () => {
  publicado();
  ajustes();
  const comTamanho = { ...pizza, pizza: { ...pizza.pizza, sabores: [{ codigo: 'CAL', nome: 'Calabresa', acrescimoPorTamanho: { G: 10, M: 5 } }] } };
  const { produto } = (await a.erp('PUT', '/catalogo/produtos', comTamanho)).json;
  assert.equal((await a.erp('PATCH', `/catalogo/produtos/${produto.codigo}/opcoes/CAL`, { preco: 12 })).status, 400);
});

test('preco por plataforma vai somente quando preenchido', async () => {
  publicado();
  await a.erp('PUT', '/catalogo/produtos', lanche);
  await esperar();
  const semPreco = a.chamadasDe('POST', /catalogo\/produtos$/)[0].corpo;
  assert.equal(JSON.stringify(semPreco).includes('precosPlataforma'), false);

  const comPreco = {
    ...pizza,
    codigo: 'PZPLAT',
    precosPlataforma: { IFOOD: 1 },
    pizza: {
      ...pizza.pizza,
      tamanhos: [{ codigo: 'G', nome: 'Grande', preco: 50, maxSabores: 2, precosPlataforma: { IFOOD: '55,90', '99FOOD': '', KEETA: 60, OUTRA: 1 } }],
      bordas: [{ nome: 'Catupiry', preco: 8, precosPlataforma: { '99FOOD': 9 } }],
    },
    grupos: [{ nome: 'Extras', min: 0, max: 1, opcoes: [{ nome: 'Mel', preco: 0, precosPlataforma: { AIQFOME: '2' } }] }],
  };
  assert.equal((await a.erp('PUT', '/catalogo/produtos', comPreco)).status, 202);
  await esperar();
  const enviado = a.chamadasDe('POST', /catalogo\/produtos$/).at(-1)!.corpo;
  assert.equal(enviado.precosPlataforma, undefined, 'na pizza o preco vem dos tamanhos');
  assert.equal(enviado.pizza.tamanhos[0].preco, 50);
  assert.deepEqual(enviado.pizza.tamanhos[0].precosPlataforma, { IFOOD: 55.9, KEETA: 60 });
  assert.deepEqual(enviado.pizza.bordas[0].precosPlataforma, { '99FOOD': 9 });
  assert.deepEqual(enviado.grupos[0].opcoes[0].precosPlataforma, { AIQFOME: 2 });
  assert.equal(enviado.pizza.sabores[0].precosPlataforma, undefined);
  const zero = { ...comPreco, codigo: 'Z', pizza: { ...comPreco.pizza, tamanhos: [{ codigo: 'G', nome: 'G', preco: 50, precosPlataforma: { IFOOD: 0 } }] } };
  assert.equal((await a.erp('PUT', '/catalogo/produtos', zero)).status, 400);
});

test('combo vai com as etapas e exige pelo menos uma', async () => {
  publicado();
  const combo = { nome: 'Combo', categoria: 'Combos', tipo: 'COMBO', preco: 30, precosPlataforma: { IFOOD: 33 }, grupos: [{ nome: 'Lanche', min: 1, max: 1, opcoes: [{ nome: 'X' }] }] };
  assert.equal((await a.erp('PUT', '/catalogo/produtos', { ...combo, grupos: [] })).status, 400);
  assert.equal((await a.erp('PUT', '/catalogo/produtos', combo)).status, 202);
  await esperar();
  const enviado = a.chamadasDe('POST', /catalogo\/produtos$/).at(-1)!.corpo;
  assert.equal(enviado.tipo, 'COMBO');
  assert.deepEqual(enviado.precosPlataforma, { IFOOD: 33 });
});

test('formato da pizza no iFood so e enviado quando for a nativa', async () => {
  publicado();
  await a.erp('PUT', '/catalogo/produtos', { ...pizza, codigo: 'F1' });
  await esperar();
  await a.erp('PUT', '/catalogo/produtos', { ...pizza, codigo: 'F2', formatoIfood: 'PIZZA' });
  await esperar();
  const enviados = a.chamadasDe('POST', /catalogo\/produtos$/).map((c) => [c.corpo.codigo, c.corpo.formatoIfood]);
  assert.deepEqual(enviados, [['F1', undefined], ['F2', 'PIZZA']]);
});
