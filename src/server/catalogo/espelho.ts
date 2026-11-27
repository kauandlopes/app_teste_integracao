import { db } from '../db.js';
import { atualizarEstadoConexao, hubFetch, respostaLocal } from '../hubClient.js';
import { semLojaAtiva } from '../conexao/estado.js';
import type { CanalPublicacao, CategoriaEspelho } from '../../shared/tipos.js';

/** Copia local do que esta publicado em cada plataforma (GET catalogo/unificado). */

export function lerEspelho(): { categorias: CategoriaEspelho[]; atualizadoEm: string | null } {
  const linhas = db.prepare('SELECT json, atualizadoEm FROM espelho_categorias ORDER BY plataforma, ordem').all() as Array<{ json: string; atualizadoEm: string }>;
  return {
    categorias: linhas.map((l) => JSON.parse(l.json) as CategoriaEspelho),
    atualizadoEm: linhas.reduce<string | null>((a, l) => (!a || l.atualizadoEm > a ? l.atualizadoEm : a), null),
  };
}

export function limparEspelho(plataforma?: string) {
  if (plataforma) db.prepare('DELETE FROM espelho_categorias WHERE plataforma = ?').run(plataforma);
  else db.prepare('DELETE FROM espelho_categorias').run();
}

function gravarCategoria(c: CategoriaEspelho, agora: string) {
  db.prepare('INSERT OR REPLACE INTO espelho_categorias (plataforma, id, ordem, json, atualizadoEm) VALUES (?, ?, ?, ?, ?)').run(c.plataforma, String(c.id), Number(c.ordem ?? 0), JSON.stringify(c), agora);
}

export async function atualizarEspelho() {
  // Sem loja ativa, confere uma vez no Hub (a Target pode ter acabado de ligar) antes de pedir o cardapio
  if (semLojaAtiva()) await atualizarEstadoConexao();
  if (semLojaAtiva()) {
    return { resposta: respostaLocal('LOJA_NAO_ENCONTRADA', 'Nenhuma loja ativa nesta conexão.'), avisos: [] as string[] };
  }
  // A 99Food limita a leitura do cardapio a 1 por minuto
  const r = await hubFetch<{ categorias: CategoriaEspelho[]; plataformasConectadas?: string[]; avisos?: string[] }>('/hub/v1/conexao/catalogo/unificado', { timeoutMs: 65_000 });
  if (!r.ok || !r.json) {
    if ((r.json as any)?.codigo === 'LOJA_NAO_ENCONTRADA') await atualizarEstadoConexao();
    return { resposta: r, avisos: [] as string[] };
  }
  const categorias = Array.isArray(r.json.categorias) ? r.json.categorias : [];
  const avisos = r.json.avisos ?? [];
  const agora = new Date().toISOString();
  db.transaction(() => {
    // Com avisos a leitura pode estar incompleta: so acrescenta e atualiza, nunca apaga
    if (!avisos.length) {
      const plataformas = new Set<string>([...(r.json!.plataformasConectadas ?? []), ...categorias.map((c) => c.plataforma)]);
      plataformas.forEach((p) => limparEspelho(p));
    }
    categorias.forEach((c) => gravarCategoria(c, agora));
  })();
  return { resposta: r, avisos };
}

/** Categoria recem-criada aparece na tela sem gastar outra leitura do cardapio. */
export function acrescentarCategoria(plataforma: CanalPublicacao, id: string, nome: string) {
  const doCanal = lerEspelho().categorias.filter((c) => c.plataforma === plataforma);
  if (doCanal.some((c) => c.id === id)) return;
  gravarCategoria({ id, plataforma, nome, status: 'AVAILABLE', ordem: doCanal.length, itens: [] }, new Date().toISOString());
}

/** Reflete no espelho um ajuste aceito pela plataforma, sem gastar outra leitura do cardapio. */
export function ajustarEspelho(plataforma: CanalPublicacao, alvo: { categoriaId?: string; itemId?: string; opcaoId?: string }, mudanca: { nome?: string; preco?: number; status?: 'AVAILABLE' | 'UNAVAILABLE'; ordem?: number }) {
  const agora = new Date().toISOString();
  const definidos = Object.fromEntries(Object.entries(mudanca).filter(([, v]) => v !== undefined));
  const { categorias } = lerEspelho();
  const nosGrupos = (grupos: CategoriaEspelho['itens'][number]['grupos']): boolean => {
    let mudou = false;
    for (const g of grupos ?? []) {
      for (const o of g.opcoes ?? []) {
        if (o.id === alvo.opcaoId) {
          Object.assign(o, definidos);
          mudou = true;
        }
        if (o.subgrupos) mudou = nosGrupos(o.subgrupos) || mudou;
      }
    }
    return mudou;
  };
  for (const c of categorias.filter((x) => x.plataforma === plataforma)) {
    let mudou = false;
    if (alvo.categoriaId && c.id === alvo.categoriaId) {
      Object.assign(c, definidos);
      mudou = true;
    }
    for (const item of c.itens) {
      if (alvo.itemId && item.id === alvo.itemId) {
        Object.assign(item, definidos);
        mudou = true;
      }
      if (alvo.opcaoId) mudou = nosGrupos(item.grupos) || mudou;
    }
    if (mudou) gravarCategoria(c, agora);
  }
}
