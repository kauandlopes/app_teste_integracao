import crypto from 'crypto';
import { gravarAjuste, lerAjuste } from '../db.js';
import { registrarLog } from '../hubClient.js';
import type { AvisoCatalogo, CanalPublicacao, SituacaoCanal } from '../../shared/tipos.js';

type Canais = Partial<Record<CanalPublicacao, SituacaoCanal>>;

export const listarAvisos = (): AvisoCatalogo[] => JSON.parse(lerAjuste('avisosCatalogo', '[]')) as AvisoCatalogo[];
const gravar = (lista: AvisoCatalogo[]) => gravarAjuste('avisosCatalogo', JSON.stringify(lista.slice(0, 20)));
export const dispensarAviso = (id: string) => gravar(listarAvisos().filter((a) => a.id !== id));

/**
 * Chamado quando o produto sai do ERP: o aviso que chegou junto com a exclusao (a 99Food recusou apagar e o item so
 * ficou pausado) sumiria com ele. Avisos que o produto ja tinha antes nao contam.
 */
export function guardarAvisosDaExclusao(codigo: string, nome: string, anteriores: Canais, finais: Canais) {
  const novos = (Object.entries(finais) as Array<[CanalPublicacao, SituacaoCanal]>)
    .filter(([, c]) => c.estado === 'REMOVIDO')
    .flatMap(([canal, c]) => (c.avisos ?? []).filter((a) => !anteriores[canal]?.avisos?.includes(a)).map((a) => `${canal === 'IFOOD' ? 'iFood' : '99Food'}: ${a}`))
    .map((texto) => ({ id: crypto.randomUUID(), codigo, texto: `${nome} (excluído do ERP). ${texto}`, em: new Date().toISOString() }));
  if (!novos.length) return;
  gravar([...novos, ...listarAvisos()]);
  for (const a of novos) registrarLog({ metodo: 'CARDAPIO', url: codigo, status: 0, ms: 0, erroResumo: a.texto });
}
