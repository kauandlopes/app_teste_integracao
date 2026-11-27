import crypto from 'crypto';
import type { ComplementoPizza, GrupoProduto, PizzaProduto, ProdutoErp, SaborPizza, TamanhoPizza } from '../../shared/tipos.js';

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

function preco(v: unknown, onde: string): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 100_000) falha(`${onde}: preço inválido.`);
  return Math.round(n * 100) / 100;
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
      return { codigo: codigo(o.codigo, rotulo, usados, rotulo), nome: rotulo, preco: preco(o.preco, rotulo), disponivel: o.disponivel !== false };
    });
    if (!opcoes.length) falha(`${titulo}: inclua pelo menos uma opção.`);
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
    return { codigo: codigo(t.codigo, `TAM-${rotulo}`, usados, rotulo), nome: rotulo, preco: valor, ...(pedacos > 0 ? { pedacos: Math.min(pedacos, 64) } : {}), maxSabores };
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
    };
  });
  const complementos = (itens: unknown, prefixo: string, onde: string): ComplementoPizza[] =>
    lista(itens).map((m, i) => {
      const rotulo = nome(m.nome, `${onde} ${i + 1}`);
      return { codigo: codigo(m.codigo, `${prefixo}-${rotulo}`, usados, rotulo), nome: rotulo, preco: preco(m.preco, `${onde} ${rotulo}`), disponivel: m.disponivel !== false };
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
  const categoria = nome(entrada?.categoria, 'Categoria', 100);
  const descricao = String(entrada?.descricao ?? '').trim();
  if (descricao.length > 1000) falha('A descrição passa de 1000 caracteres.');
  const foto = String(entrada?.foto ?? '').trim();
  if (foto && !/^data:image\/(png|jpe?g);base64,/.test(foto) && !/^https:\/\//.test(foto)) falha('Foto: envie um arquivo JPG ou PNG, ou um endereço https.');
  if (foto.length > LIMITE_FOTO) falha('Foto muito grande. Use uma imagem menor que 700 KB.');
  const tipo = entrada?.tipo === 'PIZZA' ? 'PIZZA' : 'SIMPLES';
  const listaGrupos = grupos(entrada?.grupos, new Set([codigoProduto]));
  const base = { codigo: codigoProduto, nome: titulo, categoria, descricao, tipo, disponivel: entrada?.disponivel !== false, foto, grupos: listaGrupos } as const;

  if (tipo === 'PIZZA') {
    const p = pizza(entrada.pizza);
    return { ...base, preco: Math.min(...p.tamanhos.map((t) => t.preco)), pizza: p };
  }
  const valor = preco(entrada?.preco, titulo);
  const precoNoAdicional = listaGrupos.some((g) => g.min > 0 && g.opcoes.every((o) => o.preco > 0));
  if (valor === 0 && !precoNoAdicional) falha('Preço zero só vale quando um grupo obrigatório tem preço em todas as opções.');
  return { ...base, preco: valor, pizza: null };
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

/** Sabores, massas e bordas pausados: o Hub reativa na republicacao, entao a pausa e reaplicada depois. */
export function opcoesPausadasDaPizza(p: ProdutoErp): string[] {
  if (!p.pizza) return [];
  return [...p.pizza.sabores, ...p.pizza.massas, ...p.pizza.bordas].filter((o) => !o.disponivel).map((o) => o.codigo);
}
