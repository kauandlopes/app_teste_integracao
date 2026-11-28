import type {
  AlteracaoLoja,
  AvisoCatalogo,
  CanalPublicacao,
  CategoriaEspelho,
  ComandoLoja,
  ConsultaLoja,
  ListaCategorias,
  MotivoCancelamento,
  PedidoErp,
  ProdutoCadastrado,
  ProdutoErp,
  ResultadoCategoria,
  ResultadoLoja,
  StatusKanban,
} from '../shared/tipos';

export * from '../shared/tipos';
export * from '../shared/disputa';
export * from '../shared/preco';

const BASE = '/erp-simulador/api';

export interface LojaVinculada {
  plataforma: string;
  estado: string;
  loja: string;
  lojaExterna?: string | null;
  nome?: string | null;
  pendencias?: Array<{ codigo: string; mensagem: string }>;
}

export interface Sessao {
  baseUrl: string;
  autenticado: boolean;
  integradorCodigo: string;
  cnpj: string;
  nomeLoja: string;
  conexaoId: string;
  temTokenConexao: boolean;
  /** O Hub recusou o token salvo: tudo parado ate conectar de novo. */
  conexaoEncerrada: boolean;
  transporte: string;
  webhookUrl?: string;
  temWebhookSegredo?: boolean;
  estadoConexao: string;
  lojas: LojaVinculada[];
  atualizadoEm: string;
}

export interface Credenciais {
  baseUrl: string;
  tokenIntegracao: string;
  tokenConexao: string;
  webhookSegredo: string;
  conexaoId: string;
  cnpj: string;
  webhookUrl: string;
}

export interface Fila {
  pendentes: number;
  comFalha: number;
  erro: number;
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
    // A tela mostra so o texto. O codigo ([PLATAFORMA_HTTP_500], [CONEXAO_ENCERRADA]...) segue em payload.erro
    // e fica gravado em Logs com requisicao, resposta e cURL.
    super(msg.replace(/^\[[A-Z0-9_]+\]\s*/, ''));
    this.status = status;
    this.payload = payload;
  }
}

export const mensagemDe = (err: unknown, padrao: string) => (err instanceof ApiErro ? err.message : padrao);

async function req<T = any>(caminho: string, metodo = 'GET', corpo?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await res.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new ApiErro(res.status, json?.erro || json?.mensagem || json?.message || `HTTP ${res.status}`, json ?? texto);
  return json as T;
}

const id = encodeURIComponent;

export const erpApi = {
  sessao: () => req<Sessao>('/sessao'),
  entrar: (baseUrl: string, tokenIntegracao: string, confirmarTroca = false) => req('/entrar', 'POST', { baseUrl, tokenIntegracao, confirmarTroca }),
  sair: (limparDados = false) => req(`/sair${limparDados ? '?limparDados=true' : ''}`, 'POST'),
  conectarCnpj: (dados: { cnpj: string; nome: string; transporte: 'PULL' | 'PUSH'; webhookUrl?: string; confirmarTroca?: boolean }) => req('/conectar-cnpj', 'POST', dados),
  recuperarToken: () => req('/recuperar-token', 'POST'),
  rotacionarSegredo: () => req('/webhook/segredo/rotacionar', 'POST'),
  credenciais: () => req<Credenciais>('/credenciais'),

  lojasLivres: (plataforma?: 'IFOOD' | '99FOOD') => req<any>(`/lojas-livres${plataforma ? `?plataforma=${id(plataforma)}` : ''}`),
  vincularLoja: (plataforma: string, loja: string) => req<{ lojas?: LojaVinculada[] }>('/lojas/vincular', 'POST', { plataforma, loja }),
  liberarLoja: (plataforma: string, loja: string) => req('/lojas/liberar', 'POST', { plataforma, loja }),
  statusLoja: () => req<any>('/loja/status'),
  criarInterrupcao: (dados: { description: string; durationMinutes?: number; start?: string; end?: string }) => req('/loja/interrupcoes', 'POST', dados),
  removerInterrupcao: (interrupcao: string) => req(`/loja/interrupcoes/${id(interrupcao)}`, 'DELETE'),
  dadosLoja: () => req<ConsultaLoja>('/loja/dados'),
  alterarLoja: (dados: AlteracaoLoja, plataforma?: CanalPublicacao) => req<ResultadoLoja>(`/loja/dados${plataforma ? `?plataforma=${plataforma}` : ''}`, 'PATCH', dados),
  funcionamentoLoja: (comando: ComandoLoja, plataforma?: CanalPublicacao) => req<ResultadoLoja>(`/loja/funcionamento${plataforma ? `?plataforma=${plataforma}` : ''}`, 'POST', comando),
  listarEntregas: () => req<any[]>('/entregas'),
  reprocessarEntregas: () => req<{ reprocessadas: number }>('/entregas/reprocessar', 'POST'),
  reativarPush: () => req('/webhook/reativar', 'POST'),

  // Pedidos
  listarPedidos: () => req<{ pedidos: PedidoErp[]; aceiteAutomatico: boolean; fila: Fila }>('/pedidos'),
  definirAceiteAutomatico: (ligado: boolean) => req('/ajustes', 'PUT', { aceiteAutomatico: ligado }),
  sincronizarPedidos: () => req<{ ok: boolean; novosEventos: number }>('/pedidos/sincronizar', 'POST'),
  avaliarPedido: (plataforma?: 'IFOOD' | '99FOOD', cenario?: 'normal' | 'solicitacao_cancelamento' | 'cancelado') =>
    req<{ pedidoId: string; pedido: any }>('/pedidos/avaliar', 'POST', { plataforma, cenario }),
  criarPedidoTeste: () => req('/pedidos/teste', 'POST'),
  limparSimulacoes: () => req<{ removidos: number }>('/pedidos/simulacoes', 'DELETE'),
  motivos: (pedido: string) => req<MotivoCancelamento[]>(`/pedidos/${id(pedido)}/motivos`),
  subrecursoPedido: (pedido: string, tipo: 'rastreio' | 'sacola') => req<any>(`/pedidos/${id(pedido)}/subrecurso?tipo=${tipo}`),
  /** intencao identifica o clique: repetir a mesma nao duplica o comando na plataforma. */
  acaoPedido: (pedido: string, acao: string, dados: Record<string, unknown>, intencao: string) => req<{ ok: boolean; resposta?: any }>(`/pedidos/${id(pedido)}/acao`, 'POST', { acao, dados, intencao }),
  ajustarPedido: (pedido: string, dados: { observacaoErp?: string; statusKanban?: StatusKanban }) => req(`/pedidos/${id(pedido)}`, 'PATCH', dados),

  // Cardapio do ERP
  produtos: () => req<ProdutoCadastrado[]>('/catalogo/produtos'),
  salvarProduto: (produto: Partial<ProdutoErp> & { novo?: boolean }) => req<{ produto: ProdutoErp }>('/catalogo/produtos', 'PUT', produto),
  ajustarProduto: (codigo: string, dados: { preco?: number; disponivel?: boolean }) => req(`/catalogo/produtos/${id(codigo)}`, 'PATCH', dados),
  ajustarOpcao: (codigo: string, opcao: string, dados: { preco?: number; disponivel?: boolean }) => req(`/catalogo/produtos/${id(codigo)}/opcoes/${id(opcao)}`, 'PATCH', dados),
  reenviarProduto: (codigo: string) => req(`/catalogo/produtos/${id(codigo)}/reenviar`, 'POST'),
  excluirProduto: (codigo: string, somenteErp = false) => req(`/catalogo/produtos/${id(codigo)}${somenteErp ? '?somenteErp=true' : ''}`, 'DELETE'),
  processarFilaCatalogo: () => req('/catalogo/produtos/processar', 'POST'),

  // Plataformas
  plataformas: (atualizar = false) => req<{ categorias: CategoriaEspelho[]; atualizadoEm: string | null; avisos: string[] }>(`/catalogo/plataformas${atualizar ? '?atualizar=true' : ''}`),
  ajustarItemPlataforma: (dados: { plataforma: string; itemId: string; preco?: number; status?: string }) => req('/catalogo/plataformas/itens', 'PATCH', dados),
  ajustarOpcaoPlataforma: (dados: { plataforma: string; optionId: string; groupId?: string; preco?: number; status?: string }) => req('/catalogo/plataformas/opcoes', 'PATCH', dados),
  categorias: () => req<ListaCategorias>('/catalogo/categorias'),
  /** Cria nas duas plataformas. */
  criarCategoria: (nome: string) => req<ResultadoCategoria>('/catalogo/plataformas/categorias', 'POST', { nome }),
  avisosCatalogo: () => req<AvisoCatalogo[]>('/catalogo/avisos'),
  dispensarAviso: (aviso: string) => req(`/catalogo/avisos/${id(aviso)}`, 'DELETE'),
  alterarCategoria: (categoria: string, dados: { plataforma: string; nome?: string; status?: string; mover?: 'subir' | 'descer' }) =>
    req(`/catalogo/plataformas/categorias/${id(categoria)}`, 'PATCH', dados),
  naoVendaveis: (plataforma: string) => req<any>(`/catalogo/plataformas/nao-vendaveis?plataforma=${id(plataforma)}`),

  listarLogs: (filtro: 'todos' | 'erros' | 'sucesso' = 'todos', q = '') => req<{ total: number; totalErros: number; logs: LogHttp[] }>(`/logs?filtro=${filtro}&q=${id(q)}&limite=400`),
  limparLogs: () => req('/logs', 'DELETE'),
};

export function extrairStatusIfood(statusLoja: any): { carregado: boolean; aberta: boolean; titulo: string } {
  const unif = statusLoja?.unificado?.ifood;
  if (unif) return { carregado: true, aberta: !!unif.aberta, titulo: unif.titulo || '' };
  const bruto = statusLoja?.ifood?.status;
  const item = Array.isArray(bruto) ? (bruto.find((s: any) => s?.salesChannel === 'ifood-app') ?? bruto[0]) : bruto;
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

/** O pedido de troca de conexao precisa da confirmacao do operador. */
export const pedeConfirmacaoDeTroca = (err: unknown): err is ApiErro => err instanceof ApiErro && err.payload?.codigo === 'CONFIRMAR_TROCA';

/** Texto do aviso depois de uma acao: so diz que a plataforma recebeu quando ela recebeu. */
export function resultadoDaAcao(p: PedidoErp, acao: string, rotulo: string, resposta: any): string {
  if (!p.simulado && (resposta?.localOnly === true || resposta?.implicit === true || resposta?.implicito === true)) return `${rotulo}: registrado somente no ERP. A plataforma não foi avisada.`;
  if (acao === 'validatePickupCode' || acao === 'verifyDeliveryCode') return 'Código confirmado pela plataforma.';
  return `${rotulo}: enviado.`;
}

export const nomeCanal = (c: string) => (c === 'IFOOD' ? 'iFood' : c === '99FOOD' ? '99Food' : 'Delivery');
