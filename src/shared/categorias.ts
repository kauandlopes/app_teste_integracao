import type { CanalPublicacao, CategoriaHub, ListaCategorias } from './tipos.js';

const CANAIS: CanalPublicacao[] = ['IFOOD', '99FOOD'];
const NOME: Record<CanalPublicacao, string> = { IFOOD: 'iFood', '99FOOD': '99Food' };
const EM: Record<CanalPublicacao, string> = { IFOOD: 'no iFood', '99FOOD': 'na 99Food' };

/** Mesma comparacao do Hub: sem diferenca de maiusculas, acentos e espacos. */
export const chaveCategoria = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ\s]/g, '').toLowerCase();

/** Secao que o iFood cria para cada pizza nativa: nao serve de categoria para outros produtos. */
export const soSecaoDePizza = (c: CategoriaHub) => c.plataformas.join() === 'IFOOD' && !!c.canais?.IFOOD?.length && c.canais.IFOOD.every((x) => x.template === 'PIZZA');

/** Onde a categoria existe e o que acontece ao publicar. `categoria` ausente = nome que as plataformas nao tem. */
export function ondeExiste(categoria: CategoriaHub | undefined, lista: ListaCategorias | null): string {
  if (!lista) return '';
  const existe = categoria && !soSecaoDePizza(categoria) ? categoria.plataformas : [];
  const publicando = categoria?.publicandoEm ?? [];
  const faltando = CANAIS.filter((c) => !existe.includes(c) && lista.plataformas[c]?.estado === 'OK');
  const criar = faltando.filter((c) => !publicando.includes(c));
  const inicio = !existe.length ? (publicando.length ? '' : 'nova') : `${existe.length === 1 && faltando.length ? 'só ' : ''}${existe.map((c) => EM[c]).join(' e ')}`;
  const acoes = [
    publicando.length ? `sendo criada ${publicando.map((c) => EM[c]).join(' e ')}` : '',
    criar.length ? `será criada ${criar.map((c) => EM[c]).join(' e ')}` : '',
  ].filter(Boolean);
  const semLeitura = CANAIS.filter((c) => !existe.includes(c) && !publicando.includes(c) && lista.plataformas[c]?.estado === 'ERRO');
  return [[inicio, acoes.join(', ')].filter(Boolean).join(': '), ...semLeitura.map((c) => `${NOME[c]} não consultada`)].filter(Boolean).join('; ');
}
