import crypto from 'crypto';
import { casasDemais, lerPreco } from '../../shared/preco.js';
import { PLATAFORMAS_PRECO, type ComplementoPizza, type GrupoProduto, type PizzaProduto, type PrecosPlataforma, type ProdutoErp, type SaborPizza, type TamanhoPizza } from '../../shared/tipos.js';

/**
 * Cadastro de produto do ERP. As regras repetem as do Hub (catalogo/produtos) para o erro aparecer na hora,
 * em portugues, antes de ir para a fila.
 */
export class ProdutoInvalido extends Error {}

const CODIGO = /^[A-Za-z0-9_-]{1,40}$/;
const LIMITE_FOTO = 950_000;

/** Codigo estavel gravado no ERP: e o que liga o mesmo item no ERP, no iFood e na 99Food. */
export function gerarCodigo(base: string): string {
  const limpo = base.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);
  return `${limpo || 'ITEM'}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const falha = (mensagem: string): never => {
  throw new ProdutoInvalido(mensagem);
};
const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);

function nome(v: unknown, onde: string, max = 150): string {
  const t = String(v ?? '').trim();
  if (!t) falha(`${onde}: informe o nome.`);
  if (t.length > max) falha(`${onde}: o nome passa de ${max} caracteres.`);
  return t;
}

export function preco(v: unknown, onde: string): number {
  // null e o que sobra de um numero invalido depois do JSON: nao vira zero
  const n = typeof v === 'string' ? lerPreco(v) : v === null ? NaN : Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 100_000) falha(`${onde}: preço inválido. Use um valor como 10,99.`);
  if (casasDemais(n)) falha(`${onde}: o preço aceita no máximo duas casas decimais (como 10,99).`);
  return Math.round(n * 100) / 100;
}

/** Preco por plataforma: vazio nao entra; sem nenhum preenchido, o campo nem e enviado. */
function porPlataforma(v: unknown, onde: string, maiorQueZero = false): { precosPlataforma?: PrecosPlataforma } {
  const saida: PrecosPlataforma = {};
  for (const plataforma of PLATAFORMAS_PRECO) {
    const informado = (v as Record<string, unknown> | undefined)?.[plataforma];
    if (informado === undefined || informado === null || String(informado).trim() === '') continue;
    const valor = preco(informado, `${onde} (${plataforma})`);
    if (maiorQueZero && valor <= 0) falha(`${onde} (${plataforma}): o preço deve ser maior que zero.`);
    saida[plataforma] = valor;
  }
  return Object.keys(saida).length ? { precosPlataforma: saida } : {};
}

/** Garante codigo valido e sem repeticao dentro do produto; quem nao tem recebe um e o mantem para sempre. */
function codigo(v: unknown, base: string, usados: Set<string>, onde: string): string {
  const informado = String(v ?? '').trim();
  if (informado && !CODIGO.test(informado)) falha(`${onde}: o código aceita até 40 letras, numeros, "-" e "_".`);
  const final = informado || gerarCodigo(base);
  if (usados.has(final)) falha(`${onde}: o código ${final} esta repetido neste produto.`);
  usados.add(final);
  return final;
}

function grupos(entrada: unknown, usados: Set<string>): GrupoProduto[] {
  const saida = lista(entrada).map((g, i) => {
    const onde = `Grupo ${i + 1}`;
    const titulo = nome(g.nome, onde, 100);
    const codigoGrupo = codigo(g.codigo, titulo, usados, titulo);
    const opcoes = lista(g.opcoes).map((o, j) => {
      const rotulo = nome(o.nome, `${titulo}, opção ${j + 1}`);
      return { codigo: codigo(o.codigo, rotulo, usados, rotulo), nome: rotulo, preco: preco(o.preco, rotulo), disponivel: o.disponivel !== false, ...porPlataforma(o.precosPlataforma, rotulo) };
    });
    if (!opcoes.length) falha(`${titulo}: inclua pelo menos uma opção.`);
    if (opcoes.length > 100) falha(`${titulo}: o limite é de 100 opções por grupo.`);
    const min = Math.max(0, Math.floor(Number(g.min ?? 0)) || 0);
    const max = Math.floor(Number(g.max ?? 1)) || 1;
    if (max < 1 || max > 99 || min > 99) falha(`${titulo}: mínimo e máximo devem ficar entre 0 e 99.`);
    if (min > max) falha(`${titulo}: o mínimo e maior que o máximo.`);
    if (min > opcoes.length) falha(`${titulo}: o mínimo e maior que o número de opções.`);
    return { codigo: codigoGrupo, nome: titulo, min, max, opcoes };
  });
  if (saida.length > 30) falha('O produto aceita até 30 grupos de complementos.');
  return saida;
}

function pizza(entrada: any): PizzaProduto {
  if (!entrada) falha('Pizza: cadastre tamanhos e sabores.');
  const usados = new Set<string>();
  const tamanhos: TamanhoPizza[] = lista(entrada.tamanhos).map((t, i) => {
    const rotulo = nome(t.nome, `Tamanho ${i + 1}`);
    const valor = preco(t.preco, `Tamanho ${rotulo}`);
    if (valor <= 0) falha(`Tamanho ${rotulo}: o preço deve ser maior que zero.`);
    const pedacos = Math.floor(Number(t.pedacos ?? 0));
    const maxSabores = Math.floor(Number(t.maxSabores ?? 1)) || 1;
    if (maxSabores < 1 || maxSabores > 4) falha(`Tamanho ${rotulo}: de 1 a 4 sabores.`);
    return { codigo: codigo(t.codigo, `TAM-${rotulo}`, usados, rotulo), nome: rotulo, preco: valor, ...(pedacos > 0 ? { pedacos: Math.min(pedacos, 64) } : {}), maxSabores, disponivel: t.disponivel !== false, ...porPlataforma(t.precosPlataforma, `Tamanho ${rotulo}`, true) };
  });
  const sabores: SaborPizza[] = lista(entrada.sabores).map((s, i) => {
    const rotulo = nome(s.nome, `Sabor ${i + 1}`);
    const porTamanho: Record<string, number> = {};
    for (const [chave, v] of Object.entries(s.acrescimoPorTamanho ?? {})) porTamanho[chave] = preco(v, `Sabor ${rotulo}`);
    return {
      codigo: codigo(s.codigo, `SAB-${rotulo}`, usados, rotulo),
      nome: rotulo,
      acrescimo: preco(s.acrescimo, `Sabor ${rotulo}`),
      ...(Object.keys(porTamanho).length ? { acrescimoPorTamanho: porTamanho } : {}),
      disponivel: s.disponivel !== false,
      ...porPlataforma(s.precosPlataforma, `Sabor ${rotulo}`),
    };
  });
  const complementos = (itens: unknown, prefixo: string, onde: string): ComplementoPizza[] =>
    lista(itens).map((m, i) => {
      const rotulo = nome(m.nome, `${onde} ${i + 1}`);
      return { codigo: codigo(m.codigo, `${prefixo}-${rotulo}`, usados, rotulo), nome: rotulo, preco: preco(m.preco, `${onde} ${rotulo}`), disponivel: m.disponivel !== false, ...porPlataforma(m.precosPlataforma, `${onde} ${rotulo}`) };
    });
  if (!tamanhos.length) falha('Pizza: cadastre pelo menos um tamanho.');
  if (!sabores.length) falha('Pizza: cadastre pelo menos um sabor.');
  if (tamanhos.length > 10 || sabores.length > 100) falha('Pizza: até 10 tamanhos e 100 sabores.');
  const massas = complementos(entrada.massas, 'MAS', 'Massa');
  const bordas = complementos(entrada.bordas, 'BOR', 'Borda');
  if (massas.length > 20 || bordas.length > 20) falha('Pizza: até 20 massas e 20 bordas.');
  if (entrada.bordaObrigatoria && !bordas.length) falha('Pizza: marcou borda obrigatória sem cadastrar bordas.');
  // Acrescimo por tamanho so vale para tamanhos que existem (chave errada seria ignorada em silencio pelo Hub)
  const validos = new Set(tamanhos.map((t) => t.codigo));
  for (const s of sabores) {
    for (const chave of Object.keys(s.acrescimoPorTamanho ?? {})) if (!validos.has(chave)) delete s.acrescimoPorTamanho![chave];
  }
  return { tamanhos, sabores, massas, bordas, bordaObrigatoria: !!entrada.bordaObrigatoria };
}

export function normalizarProduto(entrada: any): ProdutoErp {
  const titulo = nome(entrada?.nome, 'Produto');
  const codigoProduto = codigo(entrada?.codigo, titulo, new Set(), titulo);
  if (!String(entrada?.categoria ?? '').trim()) falha('Informe a categoria do produto: escolha uma da lista ou digite um nome novo. Se ela não existir na plataforma, é criada ao publicar.');
  const categoria = nome(entrada.categoria, 'Categoria', 100);
  const descricao = String(entrada?.descricao ?? '').trim();
  if (descricao.length > 1000) falha('A descrição passa de 1000 caracteres.');
  const foto = String(entrada?.foto ?? '').trim();
  if (foto && !/^data:image\/(png|jpe?g);base64,/.test(foto) && !/^https:\/\//.test(foto)) falha('Foto: envie um arquivo JPG ou PNG, ou um endereço https.');
  if (foto.length > LIMITE_FOTO) falha('Foto muito grande. Use uma imagem menor que 700 KB.');
  const tipo: ProdutoErp['tipo'] = entrada?.tipo === 'PIZZA' ? 'PIZZA' : entrada?.tipo === 'COMBO' ? 'COMBO' : 'SIMPLES';
  const listaGrupos = grupos(entrada?.grupos, new Set([codigoProduto]));
  const base = { codigo: codigoProduto, nome: titulo, categoria, descricao, tipo, disponivel: entrada?.disponivel !== false, foto, grupos: listaGrupos };

  if (tipo === 'PIZZA') {
    // O preco da pizza (e o preco por plataforma) vem dos tamanhos
    const p = pizza(entrada.pizza);
    return { ...base, preco: Math.min(...p.tamanhos.map((t) => t.preco)), pizza: p, ...(entrada.formatoIfood === 'PIZZA' ? { formatoIfood: 'PIZZA' as const } : {}) };
  }
  const valor = preco(entrada?.preco, titulo);
  if (tipo === 'COMBO' && !listaGrupos.length) falha('Combo: cadastre pelo menos uma etapa (grupo) com opções.');
  const precoNoAdicional = listaGrupos.some((g) => g.min > 0 && g.opcoes.every((o) => o.preco > 0));
  // Vale tambem para combo: sem preco no produto nem em etapa obrigatoria ele sairia de graca nas plataformas
  if (valor === 0 && !precoNoAdicional) falha('Preço zero só vale quando um grupo obrigatório tem preço em todas as opções.');
  return { ...base, preco: valor, ...porPlataforma(entrada?.precosPlataforma, titulo), pizza: null };
}

/** Corpo aceito pelo Hub. disponivel vai sempre (omitido reativaria o produto); foto vazia nao vai (mantem a atual). */
export function paraHub(p: ProdutoErp): Record<string, unknown> {
  const { pizza: dadosPizza, foto, descricao, ...resto } = p;
  return {
    ...resto,
    descricao,
    ...(foto ? { foto } : {}),
    ...(p.tipo === 'PIZZA' && dadosPizza ? { pizza: dadosPizza } : {}),
  };
}
