import React, { useEffect, useMemo, useState } from 'react';
import { AcaoDisponivel, erpApi, Fila, formatarHora, formatarMoeda, mensagemDe, nomeCanal, PedidoErp, StatusKanban } from '../api';
import { IconeAtualizar } from './Icones';
import { MenuTresPontos } from './MenuTresPontos';
import { ModalPedido, novaIntencao, Prazo, ROTULO_MODALIDADE } from './ModalPedido';

const COLUNAS: Array<{ id: StatusKanban; titulo: string; pill: string }> = [
  { id: 'NOVO', titulo: 'Novos', pill: 'pill-warn' },
  { id: 'PREPARO', titulo: 'Em preparo', pill: 'pill-info' },
  { id: 'PRONTO', titulo: 'Prontos', pill: 'pill-ok' },
  { id: 'ENTREGA', titulo: 'Saiu para entrega', pill: 'pill-info' },
  { id: 'CONCLUIDO', titulo: 'Finalizados e cancelados', pill: '' },
];

/** Minutos que o pedido novo espera aceite: a 99Food e o iFood cancelam quem demora. */
function Espera({ desde }: { desde: string }) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  const min = Math.max(0, Math.floor((agora - new Date(desde).getTime()) / 60_000));
  return <span className={min >= 5 ? 'pill pill-err' : 'pill pill-warn'}>Aguardando há {min} min</span>;
}

export function KanbanPedidos({
  pedidos,
  aceiteAutomatico,
  fila,
  somLigado,
  aoAlternarSom,
  notificar,
  aoRecarregar,
  aoAbrirLogs,
}: {
  pedidos: PedidoErp[];
  aceiteAutomatico: boolean;
  fila: Fila;
  somLigado: boolean;
  aoAlternarSom: () => void;
  notificar: (tipo: 'ok' | 'erro', msg: string) => void;
  aoRecarregar: () => Promise<void>;
  aoAbrirLogs: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [canal, setCanal] = useState<'TODOS' | 'IFOOD' | '99FOOD' | 'TD'>('TODOS');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aberto, setAberto] = useState<{ id: string; acao: AcaoDisponivel | null } | null>(null);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pedidos.filter(
      (p) => (canal === 'TODOS' || p.plataforma === canal) && (!q || `${p.codigoCurto} ${p.clienteNome} ${p.endereco} ${p.id}`.toLowerCase().includes(q)),
    );
  }, [pedidos, busca, canal]);

  const selecionado = aberto ? pedidos.find((p) => p.id === aberto.id) : undefined;

  async function executar(chave: string, tarefa: () => Promise<string>) {
    setOcupado(chave);
    try {
      notificar('ok', await tarefa());
      await aoRecarregar();
    } catch (err) {
      notificar('erro', mensagemDe(err, 'Falha na operação.'));
    } finally {
      setOcupado(null);
    }
  }

  const acaoDireta = (p: PedidoErp, a: AcaoDisponivel) => {
    if (a.pede) return setAberto({ id: p.id, acao: a });
    void executar(p.id, async () => {
      await erpApi.acaoPedido(p.id, a.acao, {}, novaIntencao());
      return `Pedido #${p.codigoCurto}: ${a.rotulo.toLowerCase()}.`;
    });
  };

  const simular = (plataforma: 'IFOOD' | '99FOOD', cenario?: 'solicitacao_cancelamento' | 'cancelado') =>
    executar('simular', async () => {
      await erpApi.avaliarPedido(plataforma, cenario);
      return `Pedido simulado ${nomeCanal(plataforma)} enviado pelo Hub.`;
    });

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-group">
          <input type="search" className="input input-sm" style={{ width: 230 }} placeholder="Buscar pedido, cliente ou endereço" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {(['TODOS', 'IFOOD', '99FOOD', 'TD'] as const).map((c) => (
            <button key={c} type="button" className={`btn btn-sm ${canal === c ? 'btn-primary' : ''}`} onClick={() => setCanal(c)}>
              {c === 'TODOS' ? 'Todos' : nomeCanal(c)}
            </button>
          ))}
        </div>
        <div className="toolbar-group">
          <label className="chave">
            <input
              type="checkbox"
              checked={aceiteAutomatico}
              onChange={(e) =>
                void executar('aceite', async () => {
                  await erpApi.definirAceiteAutomatico(e.target.checked);
                  return e.target.checked ? 'Aceite automático ligado.' : 'Aceite automático desligado.';
                })
              }
            />
            Aceite automático
          </label>
          <label className="chave">
            <input type="checkbox" checked={somLigado} onChange={aoAlternarSom} />
            Alerta sonoro
          </label>
          <button
            type="button"
            className="btn btn-sm"
            disabled={ocupado === 'sync'}
            onClick={() =>
              void executar('sync', async () => {
                const r = await erpApi.sincronizarPedidos();
                return r.novosEventos ? `${r.novosEventos} evento(s) importado(s).` : 'Pedidos conferidos com o Hub.';
              })
            }
          >
            <IconeAtualizar size={14} /> Sincronizar
          </button>
          <button type="button" className="btn btn-sm btn-primary" disabled={ocupado === 'simular'} onClick={() => void simular('IFOOD')}>
            Pedido de teste
          </button>
          <MenuTresPontos
            titulo="Testes e opções de pedidos"
            itens={[
              { rotulo: 'Simular pedido 99Food', aoClicar: () => void simular('99FOOD') },
              { rotulo: 'Simular pedido de cancelamento do cliente', aoClicar: () => void simular('IFOOD', 'solicitacao_cancelamento') },
              { rotulo: 'Simular pedido cancelado pela plataforma', aoClicar: () => void simular('IFOOD', 'cancelado') },
              {
                rotulo: 'Disparar evento de teste (ping)',
                aoClicar: () =>
                  void executar('ping', async () => {
                    await erpApi.criarPedidoTeste();
                    return 'Evento de teste enviado.';
                  }),
              },
              {
                rotulo: 'Importar pedidos do Delivery',
                separadorAntes: true,
                aoClicar: () =>
                  void executar('importar', async () => `${(await erpApi.importarSistema()).importados} pedido(s) importado(s).`),
              },
              {
                rotulo: 'Apagar pedidos simulados',
                perigo: true,
                aoClicar: () => void executar('limpar', async () => `${(await erpApi.limparSimulacoes()).removidos} simulado(s) apagado(s).`),
              },
              { rotulo: 'Abrir logs', separadorAntes: true, aoClicar: aoAbrirLogs },
            ]}
          />
        </div>
      </div>

      {fila.comFalha || fila.erro ? (
        <div className="banner banner-warn linha" style={{ marginBottom: 12 }}>
          <span>
            {fila.comFalha + fila.erro} evento(s) de pedido aguardando nova tentativa. Nada foi descartado.
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              void executar('sync', async () => {
                await erpApi.sincronizarPedidos();
                return 'Nova tentativa executada.';
              })
            }
          >
            Tentar agora
          </button>
          <button type="button" className="btn btn-sm" onClick={aoAbrirLogs}>
            Ver logs
          </button>
        </div>
      ) : null}

      <div className="kanban-board">
        {COLUNAS.map((col) => {
          const lista = filtrados.filter((p) => (col.id === 'CONCLUIDO' ? p.statusKanban === 'CONCLUIDO' || p.statusKanban === 'CANCELADO' : p.statusKanban === col.id));
          if (col.id === 'CONCLUIDO') lista.reverse();
          return (
            <div className="kanban-col" key={col.id}>
              <div className="kanban-col-head">
                <span>{col.titulo}</span>
                <span className={`pill ${col.pill}`}>{lista.length}</span>
              </div>
              <div className="kanban-col-body">
                {!lista.length ? <div className="vazio">Sem pedidos nesta etapa</div> : null}
                {lista.map((p) => {
                  const principal = p.acoes.find((a) => a.tipo === 'principal');
                  const { disputa, cancelamentoCliente, reembolso, cancelamentoLoja } = p.pendencias;
                  const prazo = cancelamentoCliente?.expiraEm ?? disputa?.expiraEm ?? reembolso?.expiraEm ?? null;
                  const pendente = !!(disputa || cancelamentoCliente || reembolso);
                  return (
                    <div key={p.id} className={`order-card${pendente ? ' alerta' : ''}${p.statusKanban === 'CANCELADO' ? ' cancelado' : ''}`} onClick={() => setAberto({ id: p.id, acao: null })}>
                      <div className="order-card-head">
                        <span className="order-code">#{p.codigoCurto}</span>
                        <span className="suave">{formatarHora(p.criadoEm)}</span>
                      </div>
                      <div className="linha">
                        <span className="pill">{nomeCanal(p.plataforma)}</span>
                        <span className="pill">{ROTULO_MODALIDADE[p.modalidade]}</span>
                        {p.simulado ? <span className="pill pill-info">Simulado</span> : null}
                        {p.statusKanban === 'CANCELADO' ? <span className="pill pill-err">Cancelado</span> : null}
                        {p.statusKanban === 'NOVO' ? <Espera desde={p.criadoEm} /> : null}
                        {cancelamentoCliente ? <span className="pill pill-err">Cliente quer cancelar</span> : null}
                        {disputa ? <span className="pill pill-err">Disputa</span> : null}
                        {reembolso ? <span className="pill pill-warn">Reembolso</span> : null}
                        {cancelamentoLoja ? <span className="pill pill-warn">Cancelamento em análise</span> : null}
                        {pendente ? <Prazo ate={prazo} /> : null}
                        {p.extras.agendamento ? <span className="pill pill-info">Agendado</span> : null}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{p.clienteNome}</div>
                        <div className="suave">{p.endereco}</div>
                        {p.entregador ? <div className="suave">Entregador: {p.entregador.nome}</div> : null}
                        {p.etapaEntrega ? <div className="suave">{p.etapaEntrega}</div> : null}
                      </div>
                      <div className="order-items-preview">
                        {p.detalhePendente ? <div>Carregando itens...</div> : null}
                        {p.itens.slice(0, 3).map((it, i) => (
                          <div key={i}>
                            {it.quantidade}x {it.nome}
                            {it.modificadores?.length ? ` (+${it.modificadores.length})` : ''}
                          </div>
                        ))}
                        {p.itens.length > 3 ? <div>+ {p.itens.length - 3} item(ns)</div> : null}
                      </div>
                      <div className="order-card-foot" onClick={(e) => e.stopPropagation()}>
                        <strong>{formatarMoeda(p.totalReal)}</strong>
                        {principal ? (
                          <button type="button" className="btn btn-sm btn-primary" disabled={ocupado === p.id} onClick={() => acaoDireta(p, principal)}>
                            {ocupado === p.id ? 'Enviando...' : principal.rotulo}
                          </button>
                        ) : (
                          <button type="button" className="btn btn-sm" onClick={() => setAberto({ id: p.id, acao: null })}>
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
        <ModalPedido key={selecionado.id} pedido={selecionado} acaoInicial={aberto!.acao} aoFechar={() => setAberto(null)} notificar={notificar} aoRecarregar={aoRecarregar} />
      ) : null}
    </div>
  );
}
