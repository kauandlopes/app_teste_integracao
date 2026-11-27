import { db } from '../db.js';
import type { Aviso, Entregador, EventoPedido, ItemPedido, Modalidade, PedidoErp, Pendencias, StatusKanban } from '../../shared/tipos.js';
import { colunasDe, detalheValido, extrasDe } from './detalhe.js';
import { acoesDisponiveis, avancarStatus, ehSimulado } from './regras.js';

/** Parte do pedido que e do ERP (nao vem pronta da plataforma). */
export interface EstadoPedido {
  pendencias: Pendencias;
  entregador: Entregador | null;
  etapaEntrega: string | null;
  avisos: Aviso[];
  motivoCancelamento: string | null;
  observacaoErp: string;
  preparoIniciado: boolean;
  /** Ids de disputas e solicitacoes ja respondidas ou encerradas: evento atrasado nao as reabre. */
  resolvidas: string[];
  aceiteAutomaticoFeito: boolean;
}

export interface RegistroPedido {
  id: string;
  plataforma: string;
  codigoCurto: string;
  clienteNome: string;
  clienteTelefone: string;
  endereco: string;
  totalReal: number;
  statusKanban: StatusKanban;
  etapaPlataforma: string;
  modalidade: Modalidade;
  detalhePendente: boolean;
  itens: ItemPedido[];
  detalhe: any;
  eventos: EventoPedido[];
  estado: EstadoPedido;
  criadoEm: string;
  atualizadoEm: string;
}

const estadoVazio = (): EstadoPedido => ({
  pendencias: { disputa: null, cancelamentoCliente: null, reembolso: null, cancelamentoLoja: null },
  entregador: null,
  etapaEntrega: null,
  avisos: [],
  motivoCancelamento: null,
  observacaoErp: '',
  preparoIniciado: false,
  resolvidas: [],
  aceiteAutomaticoFeito: false,
});

function deLinha(l: any): RegistroPedido {
  const estado = JSON.parse(l.estadoJson || '{}');
  return {
    id: l.id,
    plataforma: l.plataforma,
    codigoCurto: l.codigoCurto,
    clienteNome: l.clienteNome,
    clienteTelefone: l.clienteTelefone,
    endereco: l.endereco,
    totalReal: l.totalReal,
    statusKanban: l.statusKanban,
    etapaPlataforma: l.etapaPlataforma,
    modalidade: l.modalidade,
    detalhePendente: !!l.detalhePendente,
    itens: JSON.parse(l.itensJson || '[]'),
    detalhe: JSON.parse(l.detalheJson || '{}'),
    eventos: JSON.parse(l.eventosJson || '[]'),
    estado: { ...estadoVazio(), ...estado, pendencias: { ...estadoVazio().pendencias, ...estado.pendencias } },
    criadoEm: l.criadoEm,
    atualizadoEm: l.atualizadoEm,
  };
}

export function obterPedido(id: string): RegistroPedido | null {
  const l = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  return l ? deLinha(l) : null;
}

export function pedidoNovo(id: string, plataforma: string, criadoEm: string): RegistroPedido {
  return {
    id,
    plataforma,
    codigoCurto: id.slice(-4),
    clienteNome: 'Carregando pedido',
    clienteTelefone: '',
    endereco: '',
    totalReal: 0,
    statusKanban: 'NOVO',
    etapaPlataforma: 'PLACED',
    modalidade: 'ENTREGA_PROPRIA',
    detalhePendente: true,
    itens: [],
    detalhe: {},
    eventos: [],
    estado: estadoVazio(),
    criadoEm,
    atualizadoEm: criadoEm,
  };
}

export function salvarPedido(p: RegistroPedido) {
  p.atualizadoEm = new Date().toISOString();
  db.prepare(`
    INSERT INTO pedidos (id, plataforma, codigoCurto, clienteNome, clienteTelefone, endereco, totalReal, statusKanban, etapaPlataforma,
      modalidade, detalhePendente, itensJson, detalheJson, eventosJson, estadoJson, criadoEm, atualizadoEm)
    VALUES (@id, @plataforma, @codigoCurto, @clienteNome, @clienteTelefone, @endereco, @totalReal, @statusKanban, @etapaPlataforma,
      @modalidade, @detalhePendente, @itensJson, @detalheJson, @eventosJson, @estadoJson, @criadoEm, @atualizadoEm)
    ON CONFLICT(id) DO UPDATE SET
      plataforma = @plataforma, codigoCurto = @codigoCurto, clienteNome = @clienteNome, clienteTelefone = @clienteTelefone,
      endereco = @endereco, totalReal = @totalReal, statusKanban = @statusKanban, etapaPlataforma = @etapaPlataforma,
      modalidade = @modalidade, detalhePendente = @detalhePendente, itensJson = @itensJson, detalheJson = @detalheJson,
      eventosJson = @eventosJson, estadoJson = @estadoJson, atualizadoEm = @atualizadoEm
  `).run({
    ...p,
    detalhePendente: p.detalhePendente ? 1 : 0,
    itensJson: JSON.stringify(p.itens),
    detalheJson: JSON.stringify(p.detalhe),
    eventosJson: JSON.stringify(p.eventos),
    estadoJson: JSON.stringify(p.estado),
  });
}

/** Aplica o pedido unificado. Resposta incompleta ou de erro nunca apaga o que ja esta gravado. */
export function mesclarDetalhe(p: RegistroPedido, d: any): boolean {
  if (!detalheValido(d)) return false;
  const colunas = colunasDe(d, p.id);
  Object.assign(p, colunas);
  p.itens = d.itens;
  p.detalhe = d;
  p.detalhePendente = false;
  if (d.canal) p.plataforma = d.canal;
  // O unificado do iFood sempre diz NOVO; so vale quando adianta a etapa
  p.statusKanban = avancarStatus(p.statusKanban, d.statusKanban);
  if (d.criadoEm && !d.bruto && new Date(d.criadoEm) < new Date(p.criadoEm)) p.criadoEm = d.criadoEm;
  const criado = d.bruto?.createdAt ?? null;
  if (criado) p.criadoEm = criado;
  return true;
}

const pagamentoNaEntrega = (p: RegistroPedido) => p.detalhe?.pagamento?.forma === 'DINHEIRO' || p.detalhe?.pagamento?.pagoOnline === false;

export function paraTela(p: RegistroPedido): PedidoErp {
  const extras = extrasDe(p.plataforma, p.detalhe);
  const plataforma = p.plataforma as PedidoErp['plataforma'];
  return {
    id: p.id,
    plataforma,
    codigoCurto: p.codigoCurto,
    clienteNome: p.clienteNome,
    clienteTelefone: p.clienteTelefone,
    endereco: p.endereco,
    totalReal: p.totalReal,
    statusKanban: p.statusKanban,
    etapaPlataforma: p.etapaPlataforma,
    modalidade: p.modalidade,
    detalhePendente: p.detalhePendente,
    simulado: ehSimulado(p.id),
    itens: p.itens,
    detalhe: p.detalhe,
    extras,
    eventos: p.eventos,
    pendencias: p.estado.pendencias,
    entregador: p.estado.entregador,
    etapaEntrega: p.estado.etapaEntrega,
    avisos: p.estado.avisos,
    motivoCancelamento: p.estado.motivoCancelamento,
    observacaoErp: p.estado.observacaoErp,
    preparoIniciado: p.estado.preparoIniciado,
    criadoEm: p.criadoEm,
    atualizadoEm: p.atualizadoEm,
    acoes: acoesDisponiveis({
      id: p.id,
      plataforma,
      statusKanban: p.statusKanban,
      modalidade: p.modalidade,
      preparoIniciado: p.estado.preparoIniciado,
      cancelamentoEmAnalise: !!p.estado.pendencias.cancelamentoLoja,
      pagamentoNaEntrega: pagamentoNaEntrega(p),
      temItensAjustaveis: extras.itensAjustaveis.length > 0,
    }),
  };
}

/** Ativos sempre aparecem; finalizados entram os mais recentes. */
export function listarPedidos(): PedidoErp[] {
  const linhas = db
    .prepare(`
      SELECT * FROM pedidos WHERE statusKanban NOT IN ('CONCLUIDO','CANCELADO')
      UNION ALL
      SELECT * FROM (SELECT * FROM pedidos WHERE statusKanban IN ('CONCLUIDO','CANCELADO') ORDER BY atualizadoEm DESC LIMIT 100)
    `)
    .all();
  return linhas.map(deLinha).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm)).map(paraTela);
}
