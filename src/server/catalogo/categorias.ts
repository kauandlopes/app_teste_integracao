import { obterConfig } from '../db.js';
import { atualizarEstadoConexao, hubFetch, respostaLocal, RespostaHub } from '../hubClient.js';
import { semLojaAtiva } from '../conexao/estado.js';
import type { ListaCategorias } from '../../shared/tipos.js';

/** A 99Food aceita 1 leitura por minuto: abrir o cadastro varias vezes reaproveita a mesma resposta. */
const VALIDADE_MS = 60_000;
let guardada: { chave: string; em: number; resposta: RespostaHub<ListaCategorias> } | null = null;

export const esquecerCategorias = () => {
  guardada = null;
};

export async function lerCategorias(): Promise<RespostaHub<ListaCategorias>> {
  if (semLojaAtiva()) await atualizarEstadoConexao();
  if (semLojaAtiva()) return respostaLocal('LOJA_NAO_ENCONTRADA', 'Nenhuma loja ativa nesta conexão.');
  const c = obterConfig();
  const chave = `${c.conexaoId}|${c.tokenConexao}|${c.lojasVinculadasJson}`;
  if (guardada?.chave === chave && Date.now() - guardada.em < VALIDADE_MS) return guardada.resposta;
  const resposta = await hubFetch<ListaCategorias>('/hub/v1/conexao/catalogo/categorias', { timeoutMs: 65_000 });
  if ((resposta.json as any)?.codigo === 'LOJA_NAO_ENCONTRADA') await atualizarEstadoConexao();
  if (resposta.ok && resposta.json) guardada = { chave, em: Date.now(), resposta };
  return resposta;
}
