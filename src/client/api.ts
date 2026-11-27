const BASE = '/erp-simulador/api';

export interface LojaVinculada {
  plataforma: string;
  estado: string;
  loja: string;
  lojaExterna?: string | null;
  nome?: string | null;
  pendencias?: number;
}

export interface Sessao {
  baseUrl: string;
  autenticado: boolean;
  integradorCodigo: string;
  cnpj: string;
  nomeLoja: string;
  conexaoId: string;
  temTokenConexao: boolean;
  transporte: string;
  webhookUrl?: string;
  temWebhookSegredo?: boolean;
  estadoConexao: string;
  lojas: LojaVinculada[];
  atualizadoEm: string;
}

export type StatusKanban = 'NOVO' | 'PREPARO' | 'PRONTO' | 'ENTREGA' | 'CONCLUIDO' | 'CANCELADO';

export interface PedidoErp {
  id: string;
  plataforma: string;
  codigoCurto: string;
  clienteNome: string;
  clienteTelefone: string;
  endereco: string;
  totalReal: number;
  statusKanban: StatusKanban;
  etapaPlataforma: string;
  testeLocal: boolean;
  itens: any[];
  detalhe: any;
  eventos: any[];
  criadoEm: string;
  atualizadoEm: string;
}

export interface CatalogoItem {
  id: string;
  categoriaId: string;
  plataforma: string;
  tipo?: 'DEFAULT' | 'PIZZA';
  nome: string;
  descricao: string;
  sku: string;
  imagemUrl?: string | null;
  preco: number;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  ordem: number;
  grupos?: any[];
  payload?: any;
}

export interface CatalogoCategoria {
  id: string;
  plataforma: string;
  nome: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  ordem: number;
  payload?: any;
  itens: CatalogoItem[];
}

export interface LogHttp {
  id: number;
  quando: string;
  metodo: string;
  url: string;
  status: number;
  ms: number;
  erroResumo: string;
  reqHeaders: string;
  reqBody: string;
  resBody: string;
  curl: string;
}

export class ApiErro extends Error {
  status: number;
  payload: any;
  constructor(status: number, msg: string, payload?: any) {
    super(msg);
    this.status = status;
    this.payload = payload;
  }
}

async function req<T = any>(caminho: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${caminho}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const texto = await res.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.mensagem || json?.erro || json?.message || `HTTP ${res.status}`;
    throw new ApiErro(res.status, msg, json ?? texto);
  }
  return json as T;
}

export const erpApi = {
  sessao: () => req<Sessao>('/sessao'),
  entrar: (baseUrl: string, tokenIntegracao: string) =>
    req('/entrar', { method: 'POST', body: JSON.stringify({ baseUrl, tokenIntegracao }) }),
  sair: (limparDados = false) =>
    req(`/sair${limparDados ? '?limparDados=true' : ''}`, { method: 'POST' }),
  conectarCnpj: (dados: { cnpj: string; nome: string; transporte: 'PULL' | 'PUSH'; webhookUrl?: string }) =>
    req('/conectar-cnpj', { method: 'POST', body: JSON.stringify(dados) }),
  recuperarToken: () => req<{ conexaoId: string; token: string; cnpj: string }>('/recuperar-token', { method: 'POST' }),
  lojasLivres: (plataforma?: 'IFOOD' | '99FOOD') =>
    req<any>(`/lojas-livres${plataforma ? `?plataforma=${encodeURIComponent(plataforma)}` : ''}`),
  vincularLoja: (plataforma: string, loja: string) =>
    req('/lojas/vincular', { method: 'POST', body: JSON.stringify({ plataforma, loja }) }),
  liberarLoja: (plataforma: string, loja: string) =>
    req('/lojas/liberar', { method: 'POST', body: JSON.stringify({ plataforma, loja }) }),

  statusLoja: () => req<any>('/loja/status'),
  criarInterrupcao: (dados: { description: string; durationMinutes?: number; start?: string; end?: string }) =>
    req('/loja/interrupcoes', { method: 'POST', body: JSON.stringify(dados) }),
  removerInterrupcao: (id: string) => req(`/loja/interrupcoes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listarPedidos: (sync = false) => req<PedidoErp[]>(`/pedidos${sync ? '?sync=true' : ''}`),
  sincronizarPedidos: () => req<{ ok: boolean; novosEventos: number }>('/pedidos/sincronizar', { method: 'POST' }),
  importarSistema: () => req<{ ok: boolean; importados: number }>('/pedidos/importar-sistema', { method: 'POST' }),
  avaliarPedido: (plataforma?: 'IFOOD' | '99FOOD', cenario?: 'normal' | 'solicitacao_cancelamento' | 'cancelado') =>
    req<{ ok: boolean; seq: number; eventoId: string; pedidoId: string; pedido: any }>('/pedidos/avaliar', {
      method: 'POST',
      body: JSON.stringify({ ...(plataforma ? { plataforma } : {}), ...(cenario ? { cenario } : {}) }),
    }),
  criarPedidoTeste: (criarCardKanban = true) =>
    req('/pedidos/teste', { method: 'POST', body: JSON.stringify({ criarCardKanban }) }),
  listarEntregas: () => req<any[]>('/entregas'),
  reprocessarEntregas: () => req<{ reprocessadas: number }>('/entregas/reprocessar', { method: 'POST' }),
  reativarPush: () => req('/webhook/reativar', { method: 'POST' }),
  limparSimulacoes: () => req<{ removidos: number }>('/pedidos/simulacoes', { method: 'DELETE' }),
  subrecursoPedido: (id: string, tipo: 'motivos' | 'rastreio' | 'sacola') =>
    req<any>(`/pedidos/${encodeURIComponent(id)}/subrecurso?tipo=${tipo}`),
  acaoPedido: (id: string, acao: string, dados?: Record<string, unknown>) =>
    req(`/pedidos/${encodeURIComponent(id)}/acao`, { method: 'POST', body: JSON.stringify({ acao, dados }) }),
  editarPedidoManual: (
    id: string,
    dados: { clienteNome?: string; clienteTelefone?: string; endereco?: string; statusKanban?: string; observacao?: string },
  ) => req(`/pedidos/${encodeURIComponent(id)}/manual`, { method: 'PATCH', body: JSON.stringify(dados) }),

  catalogo: (sincronizar = false) => req<{ categorias: CatalogoCategoria[] }>(`/catalogo${sincronizar ? '?sincronizar=true' : ''}`),
  criarCategoria: (nome: string, status = 'AVAILABLE') =>
    req('/catalogo/categorias', { method: 'POST', body: JSON.stringify({ nome, status }) }),
  atualizarCategoria: (id: string, dados: { status?: string; nome?: string; sequence?: number }) =>
    req(`/catalogo/categorias/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(dados) }),
  moverCategoria: (id: string, direcao: 'subir' | 'descer') =>
    req(`/catalogo/categorias/${encodeURIComponent(id)}/mover`, { method: 'POST', body: JSON.stringify({ direcao }) }),
  salvarItem: (dados: any) => req('/catalogo/itens', { method: 'PUT', body: JSON.stringify(dados) }),
  statusItem: (itemId: string, status: 'AVAILABLE' | 'UNAVAILABLE', plataforma = 'IFOOD') =>
    req('/catalogo/itens/status', { method: 'PATCH', body: JSON.stringify({ itemId, status, plataforma }) }),
  precoItem: (itemId: string, valor: number, plataforma = 'IFOOD') =>
    req('/catalogo/itens/preco', { method: 'PATCH', body: JSON.stringify({ itemId, price: { value: valor }, plataforma }) }),
  moverItem: (id: string, direcao: 'subir' | 'descer') =>
    req(`/catalogo/itens/${encodeURIComponent(id)}/mover`, { method: 'POST', body: JSON.stringify({ direcao }) }),
  detalheItem: (itemId: string) => req<any>(`/catalogo/itens/${encodeURIComponent(itemId)}`),
  statusOpcao: (optionId: string, status: 'AVAILABLE' | 'UNAVAILABLE', plataforma = 'IFOOD') =>
    req('/catalogo/opcoes/status', { method: 'PATCH', body: JSON.stringify({ optionId, status, plataforma }) }),
  precoOpcao: (optionId: string, valor: number, plataforma = 'IFOOD') =>
    req('/catalogo/opcoes/preco', { method: 'PATCH', body: JSON.stringify({ optionId, price: { value: valor }, plataforma }) }),
  enviarImagem: (image: string, plataforma = 'IFOOD') =>
    req<{ ok?: boolean; id?: string; url?: string; imagePath?: string }>('/catalogo/imagem', {
      method: 'POST',
      body: JSON.stringify({ image, plataforma }),
    }),
  naoVendaveis: () => req<any>('/catalogo/nao-vendaveis'),

  listarLogs: (filtro: 'todos' | 'erros' | 'sucesso' = 'todos', q = '') =>
    req<{ total: number; totalErros: number; logs: LogHttp[] }>(
      `/logs?filtro=${filtro}&q=${encodeURIComponent(q)}&limite=400`,
    ),
  limparLogs: () => req('/logs', { method: 'DELETE' }),
};

export function extrairStatusIfood(statusLoja: any): { carregado: boolean; aberta: boolean; titulo: string } {
  const unif = statusLoja?.unificado?.ifood;
  if (unif) return { carregado: true, aberta: !!unif.aberta, titulo: unif.titulo || '' };
  const bruto = statusLoja?.ifood?.status;
  const item = Array.isArray(bruto) ? bruto.find((s: any) => s?.salesChannel === 'ifood-app') ?? bruto[0] : bruto;
  if (!item) return { carregado: false, aberta: false, titulo: '' };
  const aberta = item.state === 'OK' || item.available === true;
  const titulo = item.message?.title || item.message?.status || (aberta ? 'Loja aberta' : 'Loja fechada');
  return { carregado: true, aberta, titulo };
}

export function extrairStatus99(statusLoja: any): { carregado: boolean; aberta: boolean; titulo: string } {
  const unif = statusLoja?.unificado?.ninenine;
  if (unif) return { carregado: true, aberta: !!unif.aberta, titulo: unif.titulo || '' };
  const det = statusLoja?.ninenine?.detalhe?.data ?? statusLoja?.ninenine?.detalhe;
  if (!det) return { carregado: false, aberta: false, titulo: '' };
  const aberta = Number(det.biz_status) === 1 || det.status === 'OPEN';
  return { carregado: true, aberta, titulo: aberta ? 'Loja aberta' : 'Loja fechada' };
}

export function formatarMoeda(valor: number): string {
  return (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatarHora(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
