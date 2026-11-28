import { Router, Response } from 'express';
import { db } from '../db.js';
import { hubFetch, mensagemDoHub, RespostaHub } from '../hubClient.js';
import { notificar } from '../stream.js';
import type { CanalPublicacao, ResultadoCategoria } from '../../shared/tipos.js';
import { dispensarAviso, listarAvisos } from './avisos.js';
import { esquecerCategorias, lerCategorias } from './categorias.js';
import { acrescentarCategoria, ajustarEspelho, atualizarEspelho, lerEspelho } from './espelho.js';
import { normalizarProduto, preco as lerValorDoPreco, ProdutoInvalido } from './produto.js';
import { enfileirar, gravarProduto, listarProdutos, obterProduto, processarCatalogo } from './publicador.js';

const plataformaDe = (v: unknown): CanalPublicacao => (String(v).toUpperCase() === '99FOOD' ? '99FOOD' : 'IFOOD');
function precoRecusado(v: unknown): string {
  try {
    lerValorDoPreco(v, 'Preço');
    return '';
  } catch (err) {
    if (!(err instanceof ProdutoInvalido)) throw err;
    return err.message;
  }
}
const falhaDoHub = (res: Response, r: RespostaHub) => res.status(r.status || 502).json({ erro: mensagemDoHub(r), resposta: r.json });

export function rotasCatalogo(): Router {
  const api = Router();

  // ── Produtos do ERP: um cadastro, publicado nos dois canais ────────────────

  api.get('/produtos', (_req, res) => res.json(listarProdutos()));

  api.put('/produtos', (req, res) => {
    try {
      const produto = normalizarProduto(req.body);
      if (req.body?.novo && obterProduto(produto.codigo)) return res.status(409).json({ erro: `Já existe um produto com o código ${produto.codigo}.` });
      gravarProduto(produto);
      enfileirar(produto.codigo, 'PUBLICAR');
      res.status(202).json({ ok: true, produto });
    } catch (err) {
      if (!(err instanceof ProdutoInvalido)) throw err;
      res.status(400).json({ erro: err.message });
    }
  });

  /** Preco e pausa rapidos. Preco de pizza muda o cadastro e republica (o Hub nao aceita ajuste direto). */
  api.patch('/produtos/:codigo', (req, res) => {
    const produto = obterProduto(req.params.codigo);
    if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });
    const mudanca: { preco?: number; disponivel?: boolean } = {};
    if (req.body?.preco !== undefined) {
      if (produto.tipo === 'PIZZA') return res.status(400).json({ erro: 'O preço da pizza vem dos tamanhos. Edite o produto.' });
      mudanca.preco = req.body.preco === null ? NaN : Number(req.body.preco);
    }
    if (typeof req.body?.disponivel === 'boolean') mudanca.disponivel = req.body.disponivel;
    if (!Object.keys(mudanca).length) return res.status(400).json({ erro: 'Informe preço ou disponível.' });
    try {
      const atualizado = normalizarProduto({ ...produto, ...mudanca });
      gravarProduto(atualizado);
      enfileirar(atualizado.codigo, 'PATCH', mudanca);
      res.status(202).json({ ok: true, produto: atualizado });
    } catch (err) {
      if (!(err instanceof ProdutoInvalido)) throw err;
      res.status(400).json({ erro: err.message });
    }
  });

  api.patch('/produtos/:codigo/opcoes/:opcao', (req, res) => {
    const produto = obterProduto(req.params.codigo);
    if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });
    const alvo = req.params.opcao;
    const daPizza = produto.pizza ? [...produto.pizza.tamanhos, ...produto.pizza.sabores, ...produto.pizza.massas, ...produto.pizza.bordas].find((o) => o.codigo === alvo) : undefined;
    const doGrupo = produto.grupos.flatMap((g) => g.opcoes).find((o) => o.codigo === alvo);
    const opcao: any = daPizza ?? doGrupo;
    if (!opcao) return res.status(404).json({ erro: 'Opção não encontrada neste produto.' });

    const mudanca: { preco?: number; disponivel?: boolean } = {};
    if (typeof req.body?.disponivel === 'boolean') mudanca.disponivel = req.body.disponivel;
    if (req.body?.preco !== undefined) {
      if (opcao.acrescimoPorTamanho) return res.status(400).json({ erro: 'Este sabor tem acréscimo por tamanho. Edite o produto.' });
      mudanca.preco = req.body.preco === null ? NaN : Number(req.body.preco);
    }
    if (!Object.keys(mudanca).length) return res.status(400).json({ erro: 'Informe preço ou disponível.' });
    try {
      if (mudanca.disponivel !== undefined) opcao.disponivel = mudanca.disponivel;
      if (mudanca.preco !== undefined) opcao[daPizza && 'acrescimo' in opcao ? 'acrescimo' : 'preco'] = mudanca.preco;
      const atualizado = normalizarProduto(produto);
      gravarProduto(atualizado);
      if (produto.pizza && mudanca.preco !== undefined) enfileirar(produto.codigo, 'PUBLICAR');
      else enfileirar(produto.codigo, 'PATCH_OPCAO', mudanca, alvo);
      res.status(202).json({ ok: true, produto: atualizado });
    } catch (err) {
      if (!(err instanceof ProdutoInvalido)) throw err;
      res.status(400).json({ erro: err.message });
    }
  });

  api.post('/produtos/:codigo/reenviar', (req, res) => {
    if (!obterProduto(req.params.codigo)) return res.status(404).json({ erro: 'Produto não encontrado.' });
    enfileirar(req.params.codigo, 'PUBLICAR');
    res.status(202).json({ ok: true });
  });

  api.delete('/produtos/:codigo', (req, res) => {
    if (!obterProduto(req.params.codigo)) return res.status(404).json({ erro: 'Produto não encontrado.' });
    // somenteErp: tira do ERP sem pedir exclusao nas plataformas (cadastro que nunca publicou, por exemplo)
    if (req.query.somenteErp === 'true') {
      db.prepare('DELETE FROM fila_catalogo WHERE codigo = ?').run(req.params.codigo);
      db.prepare('DELETE FROM produtos WHERE codigo = ?').run(req.params.codigo);
      notificar('catalogo', { codigo: req.params.codigo, removido: true });
      return res.json({ ok: true });
    }
    enfileirar(req.params.codigo, 'REMOVER');
    res.status(202).json({ ok: true });
  });

  api.post('/produtos/processar', async (_req, res) => {
    db.prepare("UPDATE fila_catalogo SET proximaEm = 0 WHERE estado = 'PENDENTE'").run();
    await processarCatalogo();
    res.json({ ok: true });
  });

  api.get('/avisos', (_req, res) => res.json(listarAvisos()));
  api.delete('/avisos/:id', (req, res) => {
    dispensarAviso(req.params.id);
    res.json({ ok: true });
  });

  /** Categorias das duas plataformas, com onde cada uma existe (cadastro de produto). */
  api.get('/categorias', async (_req, res) => {
    const r = await lerCategorias();
    if (!r.ok || !r.json?.plataformas) return falhaDoHub(res, r.ok ? { ...r, status: 502 } : r);
    res.json(r.json);
  });

  // ── O que esta nas plataformas (espelho e ajustes diretos) ─────────────────

  api.get('/plataformas', async (req, res) => {
    let avisos: string[] = [];
    if (req.query.atualizar === 'true') {
      const r = await atualizarEspelho();
      if (!r.resposta.ok) return falhaDoHub(res, r.resposta);
      avisos = r.avisos;
    }
    res.json({ ...lerEspelho(), avisos });
  });

  api.patch('/plataformas/itens', async (req, res) => {
    const { itemId, preco, status } = req.body ?? {};
    const plat = plataformaDe(req.body?.plataforma);
    if (!itemId) return res.status(400).json({ erro: 'Informe o item.' });
    const recusa = preco === undefined ? '' : precoRecusado(preco);
    if (recusa) return res.status(400).json({ erro: recusa });
    const base = '/hub/v1/conexao/catalogo/itens';
    if (preco !== undefined) {
      // iFood recebe reais em price.value; a 99Food recebe reais no campo preco (o Hub converte para centavos)
      const corpo = plat === 'IFOOD' ? { itemId, price: { value: Number(preco) } } : { itemId, preco: Number(preco) };
      const r = await hubFetch(`${base}/preco?plataforma=${plat}`, { metodo: 'PATCH', body: corpo, timeoutMs: 65_000 });
      if (!r.ok) return falhaDoHub(res, r);
    }
    if (status !== undefined) {
      const r = await hubFetch(`${base}/status?plataforma=${plat}`, { metodo: 'PATCH', body: { itemId, status }, timeoutMs: 65_000 });
      if (!r.ok) return falhaDoHub(res, r);
    }
    ajustarEspelho(plat, { itemId }, { preco: preco === undefined ? undefined : Number(preco), status });
    res.json({ ok: true });
  });

  api.patch('/plataformas/opcoes', async (req, res) => {
    const { optionId, groupId, preco, status } = req.body ?? {};
    const plat = plataformaDe(req.body?.plataforma);
    if (!optionId) return res.status(400).json({ erro: 'Informe a opção.' });
    const recusa = preco === undefined ? '' : precoRecusado(preco);
    if (recusa) return res.status(400).json({ erro: recusa });
    const base = '/hub/v1/conexao/catalogo/opcoes';
    if (preco !== undefined) {
      const corpo = plat === 'IFOOD' ? { optionId, price: { value: Number(preco) } } : { optionId, groupId, price: Number(preco) };
      const r = await hubFetch(`${base}/preco?plataforma=${plat}`, { metodo: 'PATCH', body: corpo, timeoutMs: 65_000 });
      if (!r.ok) return falhaDoHub(res, r);
    }
    if (status !== undefined) {
      const r = await hubFetch(`${base}/status?plataforma=${plat}`, { metodo: 'PATCH', body: { optionId, status }, timeoutMs: 65_000 });
      if (!r.ok) return falhaDoHub(res, r);
    }
    ajustarEspelho(plat, { opcaoId: optionId }, { preco: preco === undefined ? undefined : Number(preco), status });
    res.json({ ok: true });
  });

  /** Sem plataforma o Hub cria nas duas lojas e responde por plataforma. */
  api.post('/plataformas/categorias', async (req, res) => {
    const plat = req.body?.plataforma ? plataformaDe(req.body.plataforma) : null;
    const nome = String(req.body?.nome ?? '').trim();
    if (!nome) return res.status(400).json({ erro: 'Informe o nome da categoria.' });
    const r = await hubFetch<ResultadoCategoria>(`/hub/v1/conexao/catalogo/categorias${plat ? `?plataforma=${plat}` : ''}`, {
      metodo: 'POST',
      body: plat ? { name: nome, status: 'AVAILABLE', template: 'DEFAULT' } : { name: nome },
      timeoutMs: 65_000,
    });
    esquecerCategorias();
    if (!r.ok) return falhaDoHub(res, r);
    for (const [canal, c] of Object.entries(r.json?.plataformas ?? {})) {
      if (c.estado === 'CRIADA' && c.id) acrescentarCategoria(plataformaDe(canal), c.id, nome);
    }
    res.status(201).json(r.json ?? { ok: true });
  });

  /** Renomear, pausar (so iFood) e ordenar. A ordem e a posicao dentro da propria plataforma. */
  api.patch('/plataformas/categorias/:id', async (req, res) => {
    const plat = plataformaDe(req.body?.plataforma);
    const corpo: Record<string, unknown> = {};
    if (req.body?.nome) corpo.name = String(req.body.nome).trim();
    if (req.body?.status) {
      if (plat === '99FOOD') return res.status(400).json({ erro: 'A 99Food não permite pausar categoria. Pause os itens.' });
      corpo.status = req.body.status;
    }
    const mover = req.body?.mover as 'subir' | 'descer' | undefined;
    const enviar = (id: string, dados: Record<string, unknown>) =>
      hubFetch(`/hub/v1/conexao/catalogo/categorias/${encodeURIComponent(id)}?plataforma=${plat}`, { metodo: 'PATCH', body: dados, timeoutMs: 65_000 });

    if (mover) {
      if (plat === '99FOOD') return res.status(400).json({ erro: 'A ordem das categorias da 99Food não é alterada aqui: cada troca reenvia o cardápio inteiro (limite de 1 por minuto).' });
      const lista = lerEspelho().categorias.filter((c) => c.plataforma === plat);
      const de = lista.findIndex((c) => c.id === req.params.id);
      const para = de + (mover === 'subir' ? -1 : 1);
      if (de < 0 || para < 0 || para >= lista.length) return res.json({ ok: true, semAlteracao: true });
      for (const [categoria, posicao] of [[lista[de], para], [lista[para], de]] as const) {
        const r = await enviar(categoria.id, { sequence: posicao });
        if (!r.ok) return falhaDoHub(res, r);
        ajustarEspelho(plat, { categoriaId: categoria.id }, { ordem: posicao });
      }
      return res.json({ ok: true });
    }
    if (!Object.keys(corpo).length) return res.status(400).json({ erro: 'Nada para alterar.' });
    const r = await enviar(req.params.id, corpo);
    if (!r.ok) return falhaDoHub(res, r);
    ajustarEspelho(plat, { categoriaId: req.params.id }, { nome: corpo.name as string | undefined, status: corpo.status as 'AVAILABLE' | 'UNAVAILABLE' | undefined });
    res.json({ ok: true });
  });

  api.get('/plataformas/nao-vendaveis', async (req, res) => {
    const r = await hubFetch(`/hub/v1/conexao/catalogo/nao-vendaveis?plataforma=${plataformaDe(req.query.plataforma)}`);
    if (!r.ok) return falhaDoHub(res, r);
    res.json(r.json ?? {});
  });

  return api;
}
