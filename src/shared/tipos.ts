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

/** Plataformas que podem ter preco proprio. aiqfome e Keeta ficam guardadas para as proximas integracoes. */
export const PLATAFORMAS_PRECO = ['IFOOD', '99FOOD', 'AIQFOME', 'KEETA'] as const;
export type PlataformaPreco = (typeof PLATAFORMAS_PRECO)[number];
/** Opcional: so existe a chave preenchida. Plataforma sem chave usa o preco padrao. */
export type PrecosPlataforma = Partial<Record<PlataformaPreco, number>>;

export interface OpcaoProduto {
  precosPlataforma?: PrecosPlataforma;
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
  precosPlataforma?: PrecosPlataforma;
  disponivel: boolean;
  codigo: string;
  nome: string;
  preco: number;
  pedacos?: number;
  maxSabores: number;
}

export interface SaborPizza {
  /** Substitui o acrescimo (inclusive o por tamanho) naquela plataforma. */
  precosPlataforma?: PrecosPlataforma;
  codigo: string;
  nome: string;
  acrescimo: number;
  acrescimoPorTamanho?: Record<string, number>;
  disponivel: boolean;
}

export interface ComplementoPizza {
  precosPlataforma?: PrecosPlataforma;
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
  /** COMBO: cada grupo e uma etapa de escolha e o primeiro e o principal. */
  tipo: 'SIMPLES' | 'PIZZA' | 'COMBO';
  preco: number;
  precosPlataforma?: PrecosPlataforma;
  disponivel: boolean;
  /** data:image/... ou URL https (URL vale so para a 99Food). Vazio mantem a foto atual na plataforma. */
  foto: string;
  grupos: GrupoProduto[];
  pizza: PizzaProduto | null;
  /** So para pizza. Ausente = item na categoria com grupos de escolha (padrao do Hub). PIZZA = nativa do iFood, em secao propria. */
  formatoIfood?: 'PIZZA';
}

export type EstadoCanal = 'PUBLICADO' | 'PROCESSANDO' | 'REMOVIDO' | 'ERRO' | 'SEM_LOJA';

export interface SituacaoCanal {
  estado: EstadoCanal;
  erro?: string;
  /** Codigo estavel do erro informado pelo Hub. */
  erroCodigo?: string;
  detalhes?: unknown;
  avisos?: string[];
  /** Segundos que faltam para o envio na fila da 99Food (calculado a cada leitura). */
  envioEmSegundos?: number;
  /** Guardado pelo ERP: o Hub so informa os segundos na resposta da publicacao. */
  envioPrevistoEm?: string;
  atualizadoEm?: string;
}

/** Aviso que continua na tela depois que o produto saiu do ERP (ex.: a 99Food so pausou o item excluido). */
export interface AvisoCatalogo {
  id: string;
  codigo: string;
  texto: string;
  em: string;
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

// ── Categorias nas plataformas (GET catalogo/categorias) ─────────────────────

export interface LeituraCategorias {
  estado: 'OK' | 'SEM_LOJA' | 'ERRO';
  erro?: string;
  erroCodigo?: string;
  retryAfterSegundos?: number;
  lidoEm?: string;
  ultimaRecusa?: { erro: string; em: string };
}

export interface CategoriaHub {
  nome: string;
  plataformas: CanalPublicacao[];
  ausenteEm: CanalPublicacao[];
  publicandoEm?: CanalPublicacao[];
  canais?: Partial<Record<CanalPublicacao, Array<{ template?: string }>>>;
}

export interface ListaCategorias {
  plataformas: Partial<Record<CanalPublicacao, LeituraCategorias>>;
  categorias: CategoriaHub[];
  avisos: string[];
}

export interface CategoriaCriada {
  estado: 'CRIADA' | 'JA_EXISTE' | 'PROCESSANDO' | 'PENDENTE' | 'SEM_LOJA' | 'ERRO';
  id?: string;
  aviso?: string;
  erro?: string;
  erroCodigo?: string;
  retryAfterSegundos?: number;
}

export interface ResultadoCategoria {
  ok: boolean;
  nome: string;
  plataformas: Partial<Record<CanalPublicacao, CategoriaCriada>>;
  avisos?: string[];
}

// ── Dados e funcionamento da loja (loja/dados e loja/funcionamento) ──────────

export type AcaoLoja = 'ABRIR' | 'FECHAR' | 'PAUSAR' | 'OCUPADO' | 'NORMAL';

export interface HorarioDia {
  /** 1 = segunda ... 7 = domingo */
  dia: number;
  faixas: Array<{ inicio: string; fim: string }>;
}

export interface TelefoneLoja {
  ddi: string;
  numero: string;
  tipo: 'CELULAR' | 'FIXO';
}

export interface ErroLoja {
  status: number;
  codigo: string;
  erro: string;
  retryAfterSegundos?: number;
}

/** Campo ausente ou null: a plataforma nao informa. */
export interface DadosLoja {
  horarios?: HorarioDia[] | null;
  tempoPreparoMinutos?: number | null;
  telefones?: TelefoneLoja[] | null;
  situacao?: { aberta: boolean | null; titulo?: string | null; motivos?: Array<{ titulo?: string | null }> } | null;
  pausas?: Array<{ id: string; descricao?: string | null; inicio?: string | null; fim?: string | null; ativa?: boolean }> | null;
  aberturaAutomatica?: boolean | null;
  modoOcupado?: { ativo: boolean; duracaoMinutos?: number | null; acrescimoPreparoMinutos?: number | null } | null;
  aceitePedidos?: string | null;
}

export interface LojaPlataforma {
  loja: { id?: string; nome?: string | null };
  editaveis?: string[];
  naoEditaveis?: string[];
  funcionamento?: AcaoLoja[];
  observacoes?: string[];
  /** 99Food: presente quando os dados sao uma leitura guardada; horario em que ela respondeu. */
  lidoEm?: string;
  dados: DadosLoja | null;
  erro?: ErroLoja;
  falhas?: Array<ErroLoja & { secao: string }>;
}

export interface ConsultaLoja {
  plataformas: Partial<Record<CanalPublicacao, LojaPlataforma>>;
}

export interface AlteracaoLoja {
  horarios?: HorarioDia[];
  tempoPreparoMinutos?: number;
  telefones?: TelefoneLoja[];
}

export interface ComandoLoja {
  acao: AcaoLoja;
  duracaoMinutos?: number;
  ateFimDoDia?: boolean;
  acrescimoPreparoMinutos?: number;
  aberturaAutomatica?: boolean;
}

export interface CampoAlterado {
  estado: 'APLICADO' | 'EM_ANALISE' | 'FALHOU' | 'NAO_SUPORTADO';
  erro?: ErroLoja;
  motivo?: string;
  avisos?: string[];
}

/** Resposta por plataforma de PATCH loja/dados (com campos) e de loja/funcionamento. */
export interface ResultadoLoja {
  ok?: boolean;
  parcial?: boolean;
  plataformas: Partial<
    Record<
      CanalPublicacao,
      {
        estado: 'APLICADO' | 'ENVIADO' | 'PARCIAL' | 'FALHOU' | 'NAO_SUPORTADO';
        motivo?: string;
        erro?: ErroLoja;
        avisos?: string[];
        campos?: Record<string, CampoAlterado>;
        pausa?: { fim?: string };
        pausasAgendadas?: string[];
      }
    >
  >;
}
