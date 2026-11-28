/**
 * Integracao minima de um ERP com o Hub, sem framework. E o mesmo codigo mostrado na aba Documentacao
 * e em docs/EXEMPLOS-PEDIDOS-REAIS.md; os testes rodam estas funcoes sobre os dois pedidos reais.
 */
import crypto from 'crypto';

export interface Conexao {
  base: string; // https://<hub>/api/v1
  token: string; // hubi_ da conexao (um por CNPJ)
  webhookSegredo: string;
}

/**
 * 1. Webhook PUSH. A assinatura cobre "timestamp.notificacaoId." seguido dos bytes CRUS do corpo.
 * Na troca de segredo chegam duas assinaturas separadas por virgula: qualquer uma vale.
 * Timestamp fora de 300 s e recusado (repeticao de uma chamada antiga).
 */
export function assinaturaValida(segredo: string, cabecalhos: Record<string, string>, corpoCru: Buffer, agoraS = Math.floor(Date.now() / 1000)): boolean {
  const timestamp = cabecalhos['x-target-timestamp'] ?? '';
  if (!segredo || Math.abs(agoraS - Number(timestamp)) > 300) return false;
  const assinado = Buffer.concat([Buffer.from(`${timestamp}.${cabecalhos['x-target-notificacao'] ?? ''}.`), corpoCru]);
  const esperada = Buffer.from(`v1=${crypto.createHmac('sha256', segredo).update(assinado).digest('hex')}`);
  return (cabecalhos['x-target-assinatura'] ?? '').split(',').some((parte) => {
    const recebida = Buffer.from(parte.trim());
    return recebida.length === esperada.length && crypto.timingSafeEqual(recebida, esperada);
  });
}

/** Deduplique por plataforma + evento. x-target-notificacao muda quando o transporte e trocado. */
export const chaveDoEvento = (cabecalhos: Record<string, string>) => `${cabecalhos['x-target-plataforma']}:${cabecalhos['x-target-evento']}`;

/**
 * O order_id da 99Food tem 19 digitos: JSON.parse arredonda o numero. Converta para texto ANTES do parse
 * (ou use o cabecalho x-target-pedido, que ja vem como texto).
 */
export const lerJsonSemArredondar = <T = unknown>(texto: string): T => JSON.parse(texto.replace(/([:[,]\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"')) as T;

export interface ItemUnificado {
  nome: string;
  quantidade: number;
  /** Ja inclui os complementos. */
  precoUnitario: number;
  precoTotal: number;
  codigoExterno: string | null;
  modificadores: Array<{ nome: string; quantidade: number; precoUnitario: number; codigoExterno: string | null }>;
}

export interface PedidoUnificado {
  valores: { subtotal: number; taxaEntrega: number; total: number };
  ajustes?: { taxaServico: number; gorjeta: number; descontoLoja: number; descontoPlataforma: number };
  itens: ItemUnificado[];
}

/**
 * 2. Valores. O preco do item JA CONTEM os complementos: os precos dos modificadores explicam o item e
 * nunca sao somados de novo. Nos dois pedidos reais: soma dos itens = subtotal.
 */
export function conferirValores(p: PedidoUnificado) {
  const centavos = (v: number) => Math.round(v * 100);
  const itens = p.itens.reduce((s, i) => s + centavos(i.precoTotal), 0);
  const a = p.ajustes;
  const total = itens + centavos(p.valores.taxaEntrega) + centavos(a?.taxaServico ?? 0) + centavos(a?.gorjeta ?? 0) - centavos(a?.descontoLoja ?? 0) - centavos(a?.descontoPlataforma ?? 0);
  return { itensBatem: itens === centavos(p.valores.subtotal), totalBate: total === centavos(p.valores.total) };
}

export type Desfecho =
  | { tipo: 'feito'; resposta: unknown }
  | { tipo: 'repetir'; aposSegundos: number; motivo: string } // mesma Idempotency-Key
  | { tipo: 'conferir'; motivo: string } // pode ter sido executado: consulte o pedido antes de repetir
  | { tipo: 'recusado'; codigo: string; motivo: string }; // corrija e envie com chave NOVA

/** 3. Leitura da resposta de uma acao. */
export function desfecho(status: number, corpo: any, retryAfter = 0): Desfecho {
  const codigo = String(corpo?.codigo ?? '');
  const motivo = String(corpo?.erro ?? '');
  if (codigo === 'COMANDO_RESULTADO_INCERTO') return { tipo: 'conferir', motivo };
  if (status === 429 || codigo === 'COMANDO_EM_ANDAMENTO') return { tipo: 'repetir', aposSegundos: retryAfter || 30, motivo };
  if (status === 502 || status === 503) return { tipo: 'repetir', aposSegundos: retryAfter || 5, motivo };
  if (status >= 400) return { tipo: 'recusado', codigo, motivo };
  return { tipo: 'feito', resposta: corpo };
}

/**
 * 4. Envio de uma acao: confirm, readyToPickup, dispatch, verifyDeliveryCode, conclude, requestCancellation.
 * A intencao identifica o clique do operador: repetir a mesma intencao nunca duplica o comando.
 * No iFood o 200/202 significa "recebido": a etapa so muda de fato quando chega o evento.
 */
export async function enviarAcao(c: Conexao, plataforma: 'IFOOD' | '99FOOD', pedidoId: string, acao: string, dados: Record<string, unknown> | undefined, intencao: string): Promise<Desfecho> {
  try {
    const r = await fetch(`${c.base}/hub/v1/conexao/pedidos/${encodeURIComponent(pedidoId)}/acao`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': `erp-${intencao}`, 'User-Agent': 'MeuERP/1.0' },
      body: JSON.stringify({ acao, plataforma, ...(dados ? { dados } : {}) }),
      signal: AbortSignal.timeout(45_000),
    });
    return desfecho(r.status, await r.json().catch(() => null), Number(r.headers.get('retry-after')) || 0);
  } catch {
    return { tipo: 'conferir', motivo: 'Sem resposta do Hub.' };
  }
}

/** 5. Detalhe para gravar o pedido e imprimir a comanda. */
export async function buscarPedido(c: Conexao, plataforma: 'IFOOD' | '99FOOD', pedidoId: string) {
  const r = await fetch(`${c.base}/hub/v1/conexao/pedidos/${encodeURIComponent(pedidoId)}?plataforma=${plataforma}&formato=unificado`, {
    headers: { Authorization: `Bearer ${c.token}`, 'User-Agent': 'MeuERP/1.0' },
  });
  if (!r.ok) throw new Error(`Hub respondeu ${r.status}`);
  return lerJsonSemArredondar<PedidoUnificado & Record<string, unknown>>(await r.text());
}
