/** Contrato entre o servidor do ERP e a tela. Mudou aqui, os dois lados compilam juntos. */

export type Canal = 'IFOOD' | '99FOOD' | 'TD';
export type CanalPublicacao = 'IFOOD' | '99FOOD';
export type StatusKanban = 'NOVO' | 'PREPARO' | 'PRONTO' | 'ENTREGA' | 'CONCLUIDO' | 'CANCELADO';
export type Modalidade = 'ENTREGA_PROPRIA' | 'ENTREGA_PLATAFORMA' | 'RETIRADA' | 'MESA';

// ── Pedidos ──────────────────────────────────────────────────────────────────

/** Disputa do iFood (HANDSHAKE_DISPUTE): responder antes de expiraEm. */
export interface Disputa {
  id: string;
  mensagem: string;
  expiraEm: string | null;
  tipo: string | null;
  alternativas: unknown[];
}

/** Cliente pediu cancelamento na 99Food (orderCancelApply): sem resposta em 5 min a 99 recusa sozinha. */
export interface SolicitacaoCliente {
  applyId: string;
  motivo: string;
  motivos: string[];
  expiraEm: string | null;
}

/** Cliente pediu reembolso na 99Food (orderRefundApply): sem resposta em 24 h a 99 aceita sozinha. */
export interface SolicitacaoReembolso {
  applyId: string;
  motivo: string;
  motivos: Array<{ id: string; texto: string }>;
  imagens: string[];
  expiraEm: string | null;
}

export interface Pendencias {
  disputa: Disputa | null;
  cancelamentoCliente: SolicitacaoCliente | null;
  reembolso: SolicitacaoReembolso | null;
  /** Cancelamento pedido pela loja e ainda nao confirmado pela plataforma. */
  cancelamentoLoja: { motivo: string; desde: string } | null;
}

export interface Entregador {
  nome: string;
  telefone: string;
}

export interface Aviso {
  id: string;
  em: string;
  texto: string;
  nivel: 'info' | 'alerta';
}

export interface EventoPedido {
  id: string;
  seq: number | null;
  tipo: string;
  rotulo: string;
  ocorridoEm: string;
  origem: string;
}

/** O que a acao precisa que o operador informe antes de ser enviada. */
export type PedeDado = 'entregador' | 'entregadorOpcional' | 'codigo' | 'motivo' | 'itemFalta' | 'logistica';

export interface AcaoDisponivel {
  acao: string;
  rotulo: string;
  tipo: 'principal' | 'secundaria' | 'avancada' | 'perigo';
  pede?: PedeDado;
}

export interface ModificadorPedido {
  nome: string;
  quantidade: number;
  precoUnitario: number;
  codigoExterno: string | null;
  idExterno?: string | null;
}

export interface ItemPedido {
  id: string;
  nome: string;
  quantidade: number;
  precoUnitario: number;
  precoTotal: number;
  observacao: string | null;
  codigoExterno: string | null;
  modificadores: ModificadorPedido[];
}

export interface ExtrasPedido {
  codigos: Array<{ rotulo: string; valor: string }>;
  pagamentos: Array<{ metodo: string; bandeira: string | null; valor: number; online: boolean }>;
  beneficios: Array<{ valor: number; quemPaga: string }>;
  /** Taxas, gorjeta, valor a receber em dinheiro e repasse informados pela plataforma. */
  valores: Array<{ rotulo: string; valor: number }>;
  agendamento: { inicioPreparo: string | null; entregaInicio: string | null; entregaFim: string | null } | null;
  pedidoTeste: boolean;
  /** Linhas da 99Food que aceitam "item em falta" (cancelamento parcial). */
  itensAjustaveis: Array<{ appItemId: string; mduId: string; nome: string; quantidade: number }>;
}

export interface PedidoErp {
  id: string;
  plataforma: Canal;
  codigoCurto: string;
  clienteNome: string;
  clienteTelefone: string;
  endereco: string;
  totalReal: number;
  statusKanban: StatusKanban;
  etapaPlataforma: string;
  modalidade: Modalidade;
  detalhePendente: boolean;
  simulado: boolean;
  /** Pedido importado do Delivery: sem acoes pelo ERP. */
  somenteLeitura: boolean;
  itens: ItemPedido[];
  /** Pedido unificado do Hub (com o bruto da plataforma dentro). */
  detalhe: any;
  extras: ExtrasPedido;
  eventos: EventoPedido[];
  pendencias: Pendencias;
  entregador: Entregador | null;
  etapaEntrega: string | null;
  avisos: Aviso[];
  motivoCancelamento: string | null;
  observacaoErp: string;
  preparoIniciado: boolean;
  criadoEm: string;
  atualizadoEm: string;
  acoes: AcaoDisponivel[];
}

export interface MotivoCancelamento {
  codigo: string;
  descricao: string;
}

// ── Cardapio ─────────────────────────────────────────────────────────────────

export interface OpcaoProduto {
  codigo: string;
  nome: string;
  preco: number;
  disponivel: boolean;
}

export interface GrupoProduto {
  codigo: string;
  nome: string;
  min: number;
  max: number;
  opcoes: OpcaoProduto[];
}

export interface TamanhoPizza {
  codigo: string;
  nome: string;
  preco: number;
  pedacos?: number;
  maxSabores: number;
}

export interface SaborPizza {
  codigo: string;
  nome: string;
  acrescimo: number;
  acrescimoPorTamanho?: Record<string, number>;
  disponivel: boolean;
}

export interface ComplementoPizza {
  codigo: string;
  nome: string;
  preco: number;
  disponivel: boolean;
}

export interface PizzaProduto {
  tamanhos: TamanhoPizza[];
  sabores: SaborPizza[];
  massas: ComplementoPizza[];
  bordas: ComplementoPizza[];
  bordaObrigatoria: boolean;
}

/** Produto do ERP: um cadastro, publicado no iFood e na 99Food pela rota catalogo/produtos do Hub. */
export interface ProdutoErp {
  codigo: string;
  nome: string;
  categoria: string;
  descricao: string;
  tipo: 'SIMPLES' | 'PIZZA';
  preco: number;
  disponivel: boolean;
  /** data:image/... ou URL https (URL vale so para a 99Food). Vazio mantem a foto atual na plataforma. */
  foto: string;
  grupos: GrupoProduto[];
  pizza: PizzaProduto | null;
}

export type EstadoCanal = 'PUBLICADO' | 'PROCESSANDO' | 'REMOVIDO' | 'ERRO' | 'SEM_LOJA';

export interface SituacaoCanal {
  estado: EstadoCanal;
  erro?: string;
  detalhes?: unknown;
  avisos?: string[];
  atualizadoEm?: string;
}

export type EstadoProduto = 'NA_FILA' | 'ENVIANDO' | 'PROCESSANDO' | 'PUBLICADO' | 'PARCIAL' | 'ERRO' | 'SEM_LOJA' | 'REMOVENDO';

export interface ProdutoCadastrado {
  produto: ProdutoErp;
  estado: EstadoProduto;
  erro: string;
  canais: Partial<Record<CanalPublicacao, SituacaoCanal>>;
  operacoesPendentes: number;
  atualizadoEm: string;
}

export interface OpcaoEspelho {
  id: string;
  nome: string;
  sku: string;
  preco: number;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  precosPorTamanho?: Array<{ tamanhoId: string; preco: number; status: string }>;
  subgrupos?: GrupoEspelho[];
}

export interface GrupoEspelho {
  id: string;
  nome: string;
  tipoGrupo?: string;
  min: number;
  max: number;
  opcoes: OpcaoEspelho[];
}

export interface ItemEspelho {
  id: string;
  productId?: string;
  categoriaId: string;
  plataforma: CanalPublicacao;
  tipo: string;
  nome: string;
  descricao: string;
  sku: string;
  imagemUrl: string | null;
  preco: number;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  grupos: GrupoEspelho[];
}

export interface CategoriaEspelho {
  id: string;
  plataforma: CanalPublicacao;
  nome: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  ordem: number;
  itens: ItemEspelho[];
}
