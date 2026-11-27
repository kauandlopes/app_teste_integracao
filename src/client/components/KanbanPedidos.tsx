import React, { useMemo, useState } from 'react';
import { ApiErro, PedidoErp, StatusKanban, erpApi, formatarHora, formatarMoeda } from '../api';
import { IconeAtualizar, IconeFechar } from './Icones';
import { MenuTresPontos } from './MenuTresPontos';

const COLUNAS: Array<{ id: StatusKanban; titulo: string; pill: string }> = [
  { id: 'NOVO', titulo: 'Novos', pill: 'pill-warn' },
  { id: 'PREPARO', titulo: 'Em Preparo', pill: 'pill-info' },
  { id: 'PRONTO', titulo: 'Prontos', pill: 'pill-ok' },
  { id: 'ENTREGA', titulo: 'Saiu para Entrega', pill: 'pill-info' },
  { id: 'CONCLUIDO', titulo: 'Finalizados / Cancelados', pill: 'pill' },
];

export function KanbanPedidos({
  pedidos,
  notificar,
  aoRecarregar,
  aoAbrirLogs,
}: {
  pedidos: PedidoErp[];
  notificar: (tipo: 'ok' | 'erro', msg: string) => void;
  aoRecarregar: (sync?: boolean) => Promise<void>;
  aoAbrirLogs: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [filtroPlat, setFiltroPlat] = useState<'TODAS' | 'IFOOD' | '99FOOD'>('TODAS');
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [criandoTeste, setCriandoTeste] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  // Modal Detalhe / Edição / Cancelamento
  const [selecionado, setSelecionado] = useState<PedidoErp | null>(null);
  const [abaModal, setAbaModal] = useState<'resumo' | 'editar' | 'cancelar' | 'tecnico'>('resumo');
  const [motivos, setMotivos] = useState<Array<{ cancelCodeId: string; description: string }>>([]);
  const [codigoCancel, setCodigoCancel] = useState('');
  const [motivoCancelTexto, setMotivoCancelTexto] = useState('');
  const [subDadosJson, setSubDadosJson] = useState<string | null>(null);

  // Form edição manual do pedido
  const [editNome, setEditNome] = useState('');
  const [editTel, setEditTel] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editObs, setEditObs] = useState('');
  const [editCol, setEditCol] = useState<StatusKanban>('NOVO');

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (filtroPlat !== 'TODAS' && p.plataforma !== filtroPlat) return false;
      if (!q) return true;
      return `${p.codigoCurto} ${p.clienteNome} ${p.endereco} ${p.plataforma}`.toLowerCase().includes(q);
    });
  }, [pedidos, busca, filtroPlat]);

  function abrirPedido(p: PedidoErp, abaInicial: 'resumo' | 'editar' | 'cancelar' | 'tecnico' = 'resumo') {
    setSelecionado(p);
    setAbaModal(abaInicial);
    setSubDadosJson(null);
    setEditNome(p.clienteNome);
    setEditTel(p.clienteTelefone);
    setEditEnd(p.endereco);
    setEditObs(p.detalhe?.observacaoErp ?? '');
    setEditCol(p.statusKanban);
    if (abaInicial === 'cancelar') void carregarMotivos(p);
  }

  async function carregarMotivos(p: PedidoErp) {
    try {
      const r = await erpApi.subrecursoPedido(p.id, 'motivos');
      const lista = Array.isArray(r) ? r : r?.reasons ?? [];
      setMotivos(lista);
      if (lista[0]) {
        setCodigoCancel(lista[0].cancelCodeId ?? '501');
        setMotivoCancelTexto(lista[0].description ?? '');
      }
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao buscar motivos de cancelamento.');
    }
  }

  async function executarAcao(p: PedidoErp, acao: string, dados?: Record<string, unknown>) {
    setOcupadoId(p.id);
    try {
      await erpApi.acaoPedido(p.id, acao, dados);
      notificar('ok', `Pedido #${p.codigoCurto} atualizado.`);
      await aoRecarregar(false);
      setSelecionado(null);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Falha ao atualizar pedido.');
    } finally {
      setOcupadoId(null);
    }
  }

  async function salvarEdicaoManual(e: React.FormEvent) {
    e.preventDefault();
    if (!selecionado) return;
    setOcupadoId(selecionado.id);
    try {
      await erpApi.editarPedidoManual(selecionado.id, {
        clienteNome: editNome,
        clienteTelefone: editTel,
        endereco: editEnd,
        observacao: editObs,
        statusKanban: editCol,
      });
      notificar('ok', `Alterações salvas no pedido #${selecionado.codigoCurto}.`);
      await aoRecarregar(false);
      setSelecionado(null);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao salvar edição.');
    } finally {
      setOcupadoId(null);
    }
  }

  async function criarTeste(criarCard: boolean) {
    setCriandoTeste(true);
    try {
      await erpApi.criarPedidoTeste(criarCard);
      notificar('ok', criarCard ? 'Pedido de simulação criado no Kanban e enviado ao Hub.' : 'Evento de teste disparado para fila PULL do Hub.');
      await aoRecarregar(false);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao gerar pedido teste.');
    } finally {
      setCriandoTeste(false);
    }
  }

  async function sincronizarAgora() {
    setSincronizando(true);
    try {
      const r = await erpApi.sincronizarPedidos();
      notificar('ok', r.novosEventos > 0 ? `${r.novosEventos} novo(s) evento(s) importado(s).` : 'Kanban sincronizado com o Hub.');
      await aoRecarregar(false);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao sincronizar pedidos.');
    } finally {
      setSincronizando(false);
    }
  }

  async function consultarSubrecurso(tipo: 'rastreio' | 'sacola') {
    if (!selecionado) return;
    try {
      const r = await erpApi.subrecursoPedido(selecionado.id, tipo);
      setSubDadosJson(JSON.stringify(r, null, 2));
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : `Erro ao consultar ${tipo}.`);
    }
  }

  function proximaAcao(p: PedidoErp): { acao: string; rotulo: string } | null {
    if (p.statusKanban === 'NOVO') return { acao: 'confirm', rotulo: 'Aceitar pedido' };
    if (p.statusKanban === 'PREPARO') return { acao: 'readyToPickup', rotulo: 'Marcar pronto' };
    if (p.statusKanban === 'PRONTO') return { acao: 'dispatch', rotulo: 'Despachar' };
    if (p.statusKanban === 'ENTREGA') return { acao: 'conclude', rotulo: 'Concluir entrega' };
    return null;
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-group">
          <input
            type="search"
            className="input input-sm"
            style={{ width: 240 }}
            placeholder="Buscar pedido, cliente ou endereço..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {(['TODAS', 'IFOOD', '99FOOD'] as const).map((pl) => (
            <button
              key={pl}
              type="button"
              className={`btn btn-sm ${filtroPlat === pl ? 'btn-primary' : ''}`}
              onClick={() => setFiltroPlat(pl)}
            >
              {pl === 'TODAS' ? 'Todos canais' : pl === 'IFOOD' ? 'iFood' : '99Food'}
            </button>
          ))}
        </div>

        <div className="toolbar-group">
          <button type="button" className="btn btn-sm" onClick={sincronizarAgora} disabled={sincronizando}>
            <IconeAtualizar size={14} /> {sincronizando ? 'Sincronizando...' : 'Sincronizar'}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => criarTeste(true)} disabled={criandoTeste}>
            {criandoTeste ? 'Gerando...' : '+ Novo Pedido Teste'}
          </button>
          <MenuTresPontos
            titulo="Opções de pedidos e testes"
            itens={[
              { rotulo: 'Disparar só evento PING/Teste no Hub', aoClicar: () => criarTeste(false) },
              {
                rotulo: 'Limpar pedidos de simulação local',
                perigo: true,
                aoClicar: async () => {
                  const r = await erpApi.limparSimulacoes();
                  notificar('ok', `${r.removidos} simulação(ões) removida(s).`);
                  await aoRecarregar(false);
                },
              },
              { rotulo: 'Logs HTTP e Webhooks SQLite', separadorAntes: true, aoClicar: aoAbrirLogs },
            ]}
          />
        </div>
      </div>

      <div className="kanban-board">
        {COLUNAS.map((col) => {
          const lista = filtrados.filter((p) =>
            col.id === 'CONCLUIDO' ? p.statusKanban === 'CONCLUIDO' || p.statusKanban === 'CANCELADO' : p.statusKanban === col.id,
          );
          return (
            <div className="kanban-col" key={col.id}>
              <div className="kanban-col-head">
                <span>{col.titulo}</span>
                <span className={`pill ${col.pill}`}>{lista.length}</span>
              </div>

              <div className="kanban-col-body">
                {lista.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--text-subtle)', fontSize: 12 }}>
                    Sem pedidos nesta etapa
                  </div>
                ) : null}

                {lista.map((p) => {
                  const prox = proximaAcao(p);
                  const cancelado = p.statusKanban === 'CANCELADO';
                  return (
                    <div
                      key={p.id}
                      className="order-card"
                      style={{ cursor: 'pointer', borderColor: cancelado ? 'var(--err)' : undefined }}
                      onClick={() => abrirPedido(p)}
                    >
                      <div className="order-card-head">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className="order-code">#{p.codigoCurto}</span>
                          <span className="pill">{p.plataforma === '99FOOD' ? '99Food' : 'iFood'}</span>
                          {p.testeLocal ? <span className="pill pill-info">Teste</span> : null}
                          {cancelado ? <span className="pill pill-err">Cancelado</span> : null}
                        </div>
                        <MenuTresPontos
                          compacto
                          titulo={`Ações do pedido ${p.codigoCurto}`}
                          itens={[
                            { rotulo: 'Abrir detalhes', aoClicar: () => abrirPedido(p, 'resumo') },
                            { rotulo: 'Editar pedido / mover etapa', aoClicar: () => abrirPedido(p, 'editar') },
                            ...(!cancelado && p.statusKanban !== 'CONCLUIDO'
                              ? [{ rotulo: 'Solicitar cancelamento', perigo: true, aoClicar: () => abrirPedido(p, 'cancelar') }]
                              : []),
                            { rotulo: 'Ver JSON & eventos técnicos', separadorAntes: true, aoClicar: () => abrirPedido(p, 'tecnico') },
                          ]}
                        />
                      </div>

                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{p.clienteNome}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {formatarHora(p.atualizadoEm)} · {p.endereco || 'Retirada'}
                        </div>
                      </div>

                      <div className="order-items-preview">
                        {(p.itens ?? []).slice(0, 3).map((it: any, i: number) => (
                          <div key={i}>
                            {it.quantity ?? 1}x {it.name ?? it.item_name}
                          </div>
                        ))}
                        {(p.itens ?? []).length > 3 ? <div>+ {p.itens.length - 3} item(ns)</div> : null}
                      </div>

                      <div className="order-card-foot" onClick={(e) => e.stopPropagation()}>
                        <strong>{formatarMoeda(p.totalReal)}</strong>
                        {prox ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            disabled={ocupadoId === p.id}
                            onClick={() => executarAcao(p, prox.acao)}
                          >
                            {ocupadoId === p.id ? '...' : prox.rotulo}
                          </button>
                        ) : (
                          <button type="button" className="btn btn-sm" onClick={() => abrirPedido(p)}>
                            Detalhes
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {selecionado ? (
        <div className="modal-backdrop" onClick={() => setSelecionado(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 16 }}>Pedido #{selecionado.codigoCurto}</h2>
                <span className="pill">{selecionado.plataforma}</span>
                <span className={selecionado.statusKanban === 'CANCELADO' ? 'pill pill-err' : 'pill pill-info'}>
                  {selecionado.statusKanban}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <MenuTresPontos
                  titulo="Mais ações e JSON técnico"
                  itens={[
                    { rotulo: 'Resumo do pedido', aoClicar: () => setAbaModal('resumo') },
                    { rotulo: 'Editar dados ou etapa', aoClicar: () => setAbaModal('editar') },
                    { rotulo: 'Inspecionar JSON e eventos', separadorAntes: true, aoClicar: () => setAbaModal('tecnico') },
                  ]}
                />
                <button type="button" className="btn-icon" onClick={() => setSelecionado(null)} title="Fechar">
                  <IconeFechar />
                </button>
              </div>
            </div>

            <div className="modal-body">
              {abaModal === 'resumo' ? (
                <>
                  <div className="card" style={{ padding: 12 }}>
                    <div style={{ fontWeight: 600 }}>{selecionado.clienteNome}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      Telefone: {selecionado.clienteTelefone || 'Não informado'}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                      Entrega: {selecionado.endereco || 'Retirada no balcão'}
                    </div>
                    {selecionado.detalhe?.observacaoErp ? (
                      <div style={{ fontSize: 13, marginTop: 6, color: 'var(--warn)' }}>
                        Obs. ERP: {selecionado.detalhe.observacaoErp}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div className="field-label" style={{ marginBottom: 6 }}>
                      Itens do pedido
                    </div>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <table className="item-table">
                        <tbody>
                          {(selecionado.itens ?? []).map((it: any, i: number) => (
                            <tr key={i}>
                              <td>
                                <strong>{it.quantity ?? 1}x {it.name ?? it.item_name}</strong>
                                {Array.isArray(it.options) && it.options.length > 0 ? (
                                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                                    {it.options.map((op: any, idx: number) => {
                                      const qtd = op.quantity && op.quantity > 1 ? `${op.quantity}x ` : '+ ';
                                      const preco = Number(op.price ?? 0) > 0 ? ` (${formatarMoeda(Number(op.price))})` : '';
                                      return (
                                        <div key={idx}>
                                          {qtd}{op.name}{preco}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : null}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 500 }}>
                                {formatarMoeda(Number(it.totalPrice ?? it.price ?? 0))}
                              </td>
                            </tr>
                          ))}
                          <tr>
                            <td>
                              <strong>Total do pedido</strong>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>
                              {formatarMoeda(selecionado.totalReal)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button type="button" className="btn btn-sm" onClick={() => executarAcao(selecionado, 'confirm')}>
                      Aceitar pedido
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => executarAcao(selecionado, 'startPreparation')}>
                      Iniciar preparo
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => executarAcao(selecionado, 'readyToPickup')}>
                      Marcar pronto
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => executarAcao(selecionado, 'dispatch')}>
                      Despachar
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => executarAcao(selecionado, 'conclude')}>
                      Concluir
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setAbaModal('editar')}>
                      Editar pedido
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        setAbaModal('cancelar');
                        void carregarMotivos(selecionado);
                      }}
                    >
                      Cancelar pedido
                    </button>
                  </div>
                </>
              ) : null}

              {abaModal === 'editar' ? (
                <form onSubmit={salvarEdicaoManual} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="grid-2">
                    <div className="field">
                      <label className="field-label">Nome do cliente</label>
                      <input className="input" value={editNome} onChange={(e) => setEditNome(e.target.value)} required />
                    </div>
                    <div className="field">
                      <label className="field-label">Telefone</label>
                      <input className="input" value={editTel} onChange={(e) => setEditTel(e.target.value)} />
                    </div>
                  </div>
                  <div className="field">
                    <label className="field-label">Endereço de entrega</label>
                    <input className="input" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
                  </div>
                  <div className="grid-2">
                    <div className="field">
                      <label className="field-label">Etapa no Kanban</label>
                      <select className="select" value={editCol} onChange={(e) => setEditCol(e.target.value as StatusKanban)}>
                        <option value="NOVO">Novos</option>
                        <option value="PREPARO">Em Preparo</option>
                        <option value="PRONTO">Pronto</option>
                        <option value="ENTREGA">Saiu para Entrega</option>
                        <option value="CONCLUIDO">Concluído</option>
                        <option value="CANCELADO">Cancelado</option>
                      </select>
                    </div>
                    <div className="field">
                      <label className="field-label">Observação interna ERP</label>
                      <input className="input" value={editObs} onChange={(e) => setEditObs(e.target.value)} placeholder="Opcional" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" className="btn" onClick={() => setAbaModal('resumo')}>
                      Voltar
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={ocupadoId === selecionado.id}>
                      Salvar alterações
                    </button>
                  </div>
                </form>
              ) : null}

              {abaModal === 'cancelar' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="field">
                    <label className="field-label">Motivo do cancelamento</label>
                    {motivos.length > 0 ? (
                      <select
                        className="select"
                        value={codigoCancel}
                        onChange={(e) => {
                          setCodigoCancel(e.target.value);
                          const m = motivos.find((x) => x.cancelCodeId === e.target.value);
                          if (m) setMotivoCancelTexto(m.description);
                        }}
                      >
                        {motivos.map((m) => (
                          <option key={m.cancelCodeId} value={m.cancelCodeId}>
                            {m.cancelCodeId} — {m.description}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="input"
                        placeholder="Código (ex: 501)"
                        value={codigoCancel}
                        onChange={(e) => setCodigoCancel(e.target.value)}
                      />
                    )}
                  </div>
                  <div className="field">
                    <label className="field-label">Justificativa enviada à plataforma</label>
                    <input
                      className="input"
                      value={motivoCancelTexto}
                      onChange={(e) => setMotivoCancelTexto(e.target.value)}
                      placeholder="Ex: Produto esgotado"
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" className="btn" onClick={() => setAbaModal('resumo')}>
                      Voltar
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() =>
                        executarAcao(selecionado, 'requestCancellation', {
                          reason: motivoCancelTexto || 'Cancelamento solicitado pelo ERP',
                          cancellationCode: codigoCancel || '501',
                        })
                      }
                    >
                      Confirmar cancelamento
                    </button>
                  </div>
                </div>
              ) : null}

              {abaModal === 'tecnico' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    ID interno/externo: <code>{selecionado.id}</code> · Etapa plataforma:{' '}
                    <code>{selecionado.etapaPlataforma}</code>
                  </div>
                  {!selecionado.testeLocal && selecionado.plataforma === 'IFOOD' ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn btn-sm" onClick={() => consultarSubrecurso('rastreio')}>
                        Consultar Rastreio
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => consultarSubrecurso('sacola')}>
                        Consultar Sacola Virtual
                      </button>
                    </div>
                  ) : null}
                  {subDadosJson ? <pre className="code-block">{subDadosJson}</pre> : null}
                  <div>
                    <div className="field-label">Eventos registrados (SQLite)</div>
                    <pre className="code-block">{JSON.stringify(selecionado.eventos, null, 2)}</pre>
                  </div>
                  <div>
                    <div className="field-label">Payload Completo do Pedido</div>
                    <pre className="code-block">{JSON.stringify(selecionado.detalhe, null, 2)}</pre>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
