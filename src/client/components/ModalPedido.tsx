import React, { useEffect, useRef, useState } from 'react';
import { AcaoDisponivel, erpApi, formatarHora, formatarMoeda, mensagemDe, MotivoCancelamento, nomeCanal, PedidoErp, StatusKanban } from '../api';
import { IconeFechar } from './Icones';

export const ROTULO_ETAPA: Record<StatusKanban, string> = {
  NOVO: 'Novo',
  PREPARO: 'Em preparo',
  PRONTO: 'Pronto',
  ENTREGA: 'Saiu para entrega',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
};
export const ROTULO_MODALIDADE = {
  ENTREGA_PROPRIA: 'Entrega própria',
  ENTREGA_PLATAFORMA: 'Entrega da plataforma',
  RETIRADA: 'Retirada',
  MESA: 'Consumo no local',
} as const;

const CONTRAPROPOSTAS: Record<string, string> = { REFUND: 'Reembolso parcial', ADDITIONAL_TIME: 'Tempo adicional' };

export const novaIntencao = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Tempo restante de uma solicitacao com prazo (disputa, cancelamento, reembolso). */
export function Prazo({ ate }: { ate: string | null }) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!ate) return null;
  const s = Math.floor((new Date(ate).getTime() - agora) / 1000);
  if (s <= 0) return <span className="pill pill-err">Prazo encerrado</span>;
  const texto = s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return <span className={s < 120 ? 'pill pill-err' : 'pill pill-warn'}>Responder em {texto}</span>;
}

export function ModalPedido({
  pedido,
  acaoInicial,
  aoFechar,
  notificar,
  aoRecarregar,
}: {
  pedido: PedidoErp;
  acaoInicial: AcaoDisponivel | null;
  aoFechar: () => void;
  notificar: (tipo: 'ok' | 'erro', msg: string) => void;
  aoRecarregar: () => Promise<void>;
}) {
  const [aba, setAba] = useState<'resumo' | 'eventos' | 'tecnico'>('resumo');
  const [acao, setAcao] = useState<AcaoDisponivel | null>(acaoInicial);
  const [ocupado, setOcupado] = useState(false);
  const [mostrarAvancadas, setMostrarAvancadas] = useState(false);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [motivos, setMotivos] = useState<MotivoCancelamento[] | null>(null);
  const [subrecurso, setSubrecurso] = useState('');
  const [observacao, setObservacao] = useState(pedido.observacaoErp);
  // Mesma intencao enquanto o operador repete a mesma acao: erro de rede nao duplica o comando
  const intencoes = useRef(new Map<string, string>());

  const p = pedido;
  const campo = (nome: string) => campos[nome] ?? '';
  const definir = (nome: string, valor: string) => setCampos((c) => ({ ...c, [nome]: valor }));

  useEffect(() => {
    setCampos({ nome: p.entregador?.nome ?? '', telefone: p.entregador?.telefone ?? '', veiculo: 'MOTORCYCLE' });
    if (acao?.pede === 'motivo') {
      setMotivos(null);
      erpApi
        .motivos(p.id)
        .then(setMotivos)
        .catch((err) => {
          setMotivos([]);
          notificar('erro', mensagemDe(err, 'Não foi possivel carregar os motivos.'));
        });
    }
  }, [acao?.acao, p.id]);

  async function executar(nome: string, dados: Record<string, unknown> = {}) {
    const chave = `${nome}:${JSON.stringify(dados)}`;
    const intencao = intencoes.current.get(chave) ?? novaIntencao();
    intencoes.current.set(chave, intencao);
    setOcupado(true);
    try {
      await erpApi.acaoPedido(p.id, nome, dados, intencao);
      intencoes.current.delete(chave);
      notificar('ok', `Pedido #${p.codigoCurto}: ação enviada.`);
      setAcao(null);
      setCampos({});
      await aoRecarregar();
    } catch (err) {
      // Recusa definitiva do Hub fica em cache por 24 h: a proxima tentativa precisa de outra intencao
      if ((err as any)?.status && (err as any).status < 500) intencoes.current.delete(chave);
      notificar('erro', mensagemDe(err, 'Falha ao enviar a ação.'));
    } finally {
      setOcupado(false);
    }
  }

  function enviarFormulario(e: React.FormEvent) {
    e.preventDefault();
    if (acao) void executar(acao.acao, campos);
  }

  const clicar = (a: AcaoDisponivel) => (a.pede ? setAcao(a) : void executar(a.acao));

  async function consultar(tipo: 'rastreio' | 'sacola') {
    try {
      setSubrecurso(JSON.stringify(await erpApi.subrecursoPedido(p.id, tipo), null, 2));
    } catch (err) {
      notificar('erro', mensagemDe(err, `Erro ao consultar ${tipo}.`));
    }
  }

  async function salvarAjuste(dados: { observacaoErp?: string; statusKanban?: StatusKanban }) {
    try {
      await erpApi.ajustarPedido(p.id, dados);
      await aoRecarregar();
      notificar('ok', 'Ajuste salvo somente no ERP.');
    } catch (err) {
      notificar('erro', mensagemDe(err, 'Erro ao salvar.'));
    }
  }

  const valores = p.detalhe?.valores;
  const pagamento = p.detalhe?.pagamento;
  const principais = p.acoes.filter((a) => a.tipo !== 'avancada');
  const avancadas = p.acoes.filter((a) => a.tipo === 'avancada');
  const { disputa, cancelamentoCliente, reembolso, cancelamentoLoja } = p.pendencias;
  // So os tipos que a propria disputa oferece
  const contrapropostas = [...new Set((disputa?.alternativas ?? []).map((a: any) => a?.type as string))].filter((t) => CONTRAPROPOSTAS[t]);

  return (
    <div className="modal-backdrop" onClick={aoFechar}>
      <div className="modal-panel wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="linha">
            <h2 style={{ margin: 0, fontSize: 18 }}>Pedido #{p.codigoCurto}</h2>
            <span className="pill">{nomeCanal(p.plataforma)}</span>
            <span className={p.statusKanban === 'CANCELADO' ? 'pill pill-err' : 'pill pill-info'}>{ROTULO_ETAPA[p.statusKanban]}</span>
            <span className="pill">{ROTULO_MODALIDADE[p.modalidade]}</span>
            {p.simulado ? <span className="pill pill-warn">Simulado</span> : null}
            {p.somenteLeitura ? <span className="pill">Somente leitura</span> : null}
            {p.extras.pedidoTeste ? <span className="pill pill-warn">Teste da plataforma</span> : null}
          </div>
          <div className="linha">
            <button type="button" className="btn btn-sm" onClick={() => window.print()}>
              Imprimir comanda
            </button>
            <button type="button" className="btn-icon" onClick={aoFechar} title="Fechar">
              <IconeFechar />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="linha">
            {(['resumo', 'eventos', 'tecnico'] as const).map((a) => (
              <button key={a} type="button" className={`btn btn-sm ${aba === a ? 'btn-primary' : ''}`} onClick={() => setAba(a)}>
                {a === 'resumo' ? 'Resumo' : a === 'eventos' ? `Eventos (${p.eventos.length})` : 'Técnico'}
              </button>
            ))}
          </div>

          {p.detalhePendente ? <div className="banner banner-warn">Buscando os itens do pedido no Hub. O sistema tenta de novo sozinho.</div> : null}
          {p.statusKanban === 'CANCELADO' && p.motivoCancelamento ? <div className="banner banner-err">Cancelado: {p.motivoCancelamento}</div> : null}
          {cancelamentoLoja ? <div className="banner banner-warn">Cancelamento enviado e aguardando a plataforma: {cancelamentoLoja.motivo}</div> : null}

          {disputa ? (
            <div className="card pendencia">
              <div className="linha">
                <strong>Disputa aberta</strong>
                <Prazo ate={disputa.expiraEm} />
              </div>
              <div>{disputa.mensagem}</div>
              {disputa.alternativas.length ? <pre className="code-block">{JSON.stringify(disputa.alternativas, null, 2)}</pre> : null}
              <input className="input input-sm" placeholder="Resposta ao cliente (opcional)" value={campo('texto')} onChange={(e) => definir('texto', e.target.value)} />
              <div className="linha">
                <button type="button" className="btn btn-sm btn-danger" disabled={ocupado} onClick={() => executar('acceptCancellation', { texto: campo('texto'), idPendencia: disputa.id })}>
                  Aceitar solicitação
                </button>
                <button type="button" className="btn btn-sm" disabled={ocupado} onClick={() => executar('denyCancellation', { texto: campo('texto'), idPendencia: disputa.id })}>
                  Recusar
                </button>
              </div>
              {p.plataforma === 'IFOOD' && !p.simulado && contrapropostas.length ? (
                <div className="linha">
                  <span className="field-label">Contraproposta</span>
                  <select className="select input-sm" style={{ width: 200 }} value={campo('tipo')} onChange={(e) => definir('tipo', e.target.value)}>
                    <option value="">Escolha o tipo</option>
                    {contrapropostas.map((t) => (
                      <option key={t} value={t}>
                        {CONTRAPROPOSTAS[t]}
                      </option>
                    ))}
                  </select>
                  {campo('tipo') === 'REFUND' ? <input className="input input-sm preco" inputMode="decimal" placeholder="Valor R$" value={campo('valor')} onChange={(e) => definir('valor', e.target.value)} /> : null}
                  {campo('tipo') === 'ADDITIONAL_TIME' ? (
                    <>
                      <input className="input input-sm preco" type="number" min={1} placeholder="Minutos" value={campo('minutos')} onChange={(e) => definir('minutos', e.target.value)} />
                      <input className="input input-sm" style={{ width: 220 }} placeholder="Motivo (código do iFood)" value={campo('motivoTempo')} onChange={(e) => definir('motivoTempo', e.target.value)} />
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={ocupado || !campo('tipo')}
                    onClick={() => executar('counterOffer', { tipo: campo('tipo'), valor: campo('valor'), minutos: campo('minutos'), motivoTempo: campo('motivoTempo'), idPendencia: disputa.id })}
                  >
                    Enviar contraproposta
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {cancelamentoCliente ? (
            <div className="card pendencia">
              <div className="linha">
                <strong>Cliente pediu cancelamento</strong>
                <Prazo ate={cancelamentoCliente.expiraEm} />
              </div>
              <div>{cancelamentoCliente.motivo}</div>
              <select className="select" value={campo('recusa')} onChange={(e) => definir('recusa', e.target.value)}>
                <option value="">Motivo da recusa</option>
                {cancelamentoCliente.motivos.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <div className="linha">
                <button type="button" className="btn btn-sm btn-danger" disabled={ocupado} onClick={() => executar('acceptCancellation', { idPendencia: cancelamentoCliente.applyId })}>
                  Aceitar cancelamento
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={ocupado || (cancelamentoCliente.motivos.length > 0 && !campo('recusa'))}
                  onClick={() => executar('denyCancellation', { texto: campo('recusa'), idPendencia: cancelamentoCliente.applyId })}
                >
                  Recusar
                </button>
              </div>
            </div>
          ) : null}

          {reembolso ? (
            <div className="card pendencia">
              <div className="linha">
                <strong>Cliente pediu reembolso</strong>
                <Prazo ate={reembolso.expiraEm} />
              </div>
              <div>{reembolso.motivo}</div>
              {reembolso.imagens.length ? (
                <div className="linha">
                  {reembolso.imagens.map((src) => (
                    <a key={src} href={src} target="_blank" rel="noreferrer">
                      Foto enviada
                    </a>
                  ))}
                </div>
              ) : null}
              <select className="select" value={campo('motivoReembolso')} onChange={(e) => definir('motivoReembolso', e.target.value)}>
                <option value="">Motivo da recusa</option>
                {reembolso.motivos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.texto}
                  </option>
                ))}
              </select>
              <input className="input input-sm" placeholder="Explicação (opcional)" value={campo('explicacao')} onChange={(e) => definir('explicacao', e.target.value)} />
              <div className="linha">
                <button type="button" className="btn btn-sm btn-danger" disabled={ocupado} onClick={() => executar('acceptRefund', { idPendencia: reembolso.applyId })}>
                  Aceitar reembolso
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={ocupado || !campo('motivoReembolso')}
                  onClick={() => executar('denyRefund', { codigo: campo('motivoReembolso'), texto: campo('explicacao'), idPendencia: reembolso.applyId })}
                >
                  Recusar reembolso
                </button>
              </div>
            </div>
          ) : null}

          {principais.length || avancadas.length ? (
            <div className="linha">
              {principais.map((a) => (
                <button
                  key={a.acao}
                  type="button"
                  className={`btn ${a.tipo === 'principal' ? 'btn-primary' : a.tipo === 'perigo' ? 'btn-danger' : ''}`}
                  disabled={ocupado}
                  onClick={() => clicar(a)}
                >
                  {a.rotulo}
                </button>
              ))}
              {avancadas.length ? (
                <button type="button" className="btn" onClick={() => setMostrarAvancadas((v) => !v)}>
                  {mostrarAvancadas ? 'Ocultar outras ações' : 'Outras ações'}
                </button>
              ) : null}
              {mostrarAvancadas
                ? avancadas.map((a) => (
                    <button key={a.acao} type="button" className="btn btn-sm" disabled={ocupado} onClick={() => clicar(a)}>
                      {a.rotulo}
                    </button>
                  ))
                : null}
            </div>
          ) : null}

          {acao?.pede ? (
            <form className="card pendencia" onSubmit={enviarFormulario}>
              <strong>{acao.rotulo}</strong>
              {acao.pede === 'entregador' || acao.pede === 'entregadorOpcional' || acao.pede === 'logistica' ? (
                <div className="grid-2">
                  <input className="input" placeholder="Nome do entregador" value={campo('nome')} onChange={(e) => definir('nome', e.target.value)} required={acao.pede !== 'entregadorOpcional'} />
                  <input className="input" placeholder="Telefone com DDD" value={campo('telefone')} onChange={(e) => definir('telefone', e.target.value)} required={acao.pede !== 'entregadorOpcional'} />
                  {acao.pede === 'logistica' ? (
                    <select className="select" value={campo('veiculo')} onChange={(e) => definir('veiculo', e.target.value)}>
                      <option value="MOTORCYCLE">Moto</option>
                      <option value="BICYCLE">Bicicleta</option>
                      <option value="CAR">Carro</option>
                    </select>
                  ) : null}
                </div>
              ) : null}
              {acao.pede === 'codigo' ? (
                <input className="input" inputMode="numeric" placeholder="Código informado" value={campo('codigo')} onChange={(e) => definir('codigo', e.target.value)} required autoFocus />
              ) : null}
              {acao.pede === 'motivo' ? (
                motivos === null ? (
                  <div className="suave">Carregando motivos da plataforma...</div>
                ) : (
                  <>
                    {motivos.length ? (
                      <select className="select" value={campo('codigo')} onChange={(e) => definir('codigo', e.target.value)} required>
                        <option value="">Escolha o motivo</option>
                        {motivos.map((m) => (
                          <option key={m.codigo} value={m.codigo}>
                            {m.codigo} · {m.descricao}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input className="input" placeholder="Código do motivo" value={campo('codigo')} onChange={(e) => definir('codigo', e.target.value)} required />
                    )}
                    <input className="input" placeholder="Descrição enviada à plataforma" value={campo('texto')} onChange={(e) => definir('texto', e.target.value)} required={campo('codigo') === '1080'} />
                  </>
                )
              ) : null}
              {acao.pede === 'itemFalta' ? (
                <div className="grid-2">
                  <select className="select" value={campo('mduId')} onChange={(e) => definir('mduId', e.target.value)} required>
                    <option value="">Item em falta</option>
                    {p.extras.itensAjustaveis.map((i) => (
                      <option key={i.mduId} value={i.mduId}>
                        {i.quantidade}x {i.nome}
                      </option>
                    ))}
                  </select>
                  <input className="input" type="number" min={1} placeholder="Quantidade em falta" value={campo('quantidade')} onChange={(e) => definir('quantidade', e.target.value)} required />
                </div>
              ) : null}
              <div className="linha">
                <button type="submit" className={`btn ${acao.tipo === 'perigo' ? 'btn-danger' : 'btn-primary'}`} disabled={ocupado}>
                  {ocupado ? 'Enviando...' : 'Confirmar'}
                </button>
                <button type="button" className="btn" onClick={() => setAcao(null)}>
                  Voltar
                </button>
              </div>
            </form>
          ) : null}

          {aba === 'resumo' ? (
            <>
              <div className="grid-2">
                <div className="card">
                  <div className="field-label">Cliente</div>
                  <strong>{p.clienteNome}</strong>
                  <div className="suave">Telefone: {p.clienteTelefone || 'não informado'}</div>
                  {p.detalhe?.cliente?.documento ? <div className="suave">CPF/CNPJ: {p.detalhe.cliente.documento}</div> : null}
                  <div className="suave">{p.endereco}</div>
                </div>
                <div className="card">
                  <div className="field-label">Pagamento e entrega</div>
                  {pagamento ? (
                    <div>
                      <strong>{pagamento.pagoOnline ? 'Pago pelo aplicativo' : 'Cobrar na entrega'}</strong>
                      <div className="suave">
                        {p.extras.pagamentos.length
                          ? p.extras.pagamentos.map((m) => `${m.metodo}${m.bandeira ? ` ${m.bandeira}` : ''} ${formatarMoeda(m.valor)}`).join(' · ')
                          : pagamento.forma}
                      </div>
                      {valores?.trocoPara ? <div className="suave">Troco para {formatarMoeda(valores.trocoPara)}</div> : null}
                    </div>
                  ) : (
                    <div className="suave">Aguardando detalhes</div>
                  )}
                  {p.entregador ? (
                    <div className="suave">
                      Entregador: {p.entregador.nome} {p.entregador.telefone}
                    </div>
                  ) : null}
                  {p.etapaEntrega ? <div className="suave">Entrega: {p.etapaEntrega}</div> : null}
                  {p.extras.agendamento ? (
                    <div className="suave">
                      Agendado: preparo {formatarHora(p.extras.agendamento.inicioPreparo ?? '')} · entrega {formatarHora(p.extras.agendamento.entregaInicio ?? '')}
                      {p.extras.agendamento.entregaFim ? ` a ${formatarHora(p.extras.agendamento.entregaFim)}` : ''}
                    </div>
                  ) : null}
                </div>
              </div>

              {p.extras.codigos.length ? (
                <div className="linha">
                  {p.extras.codigos.map((c) => (
                    <div className="codigo-destaque" key={c.rotulo}>
                      <span>{c.rotulo}</span>
                      <strong>{c.valor}</strong>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="item-table">
                  <tbody>
                    {p.itens.map((it, i) => (
                      <tr key={`${it.id}-${i}`}>
                        <td>
                          <strong>
                            {it.quantidade}x {it.nome}
                          </strong>
                          {it.codigoExterno ? <span className="suave"> · SKU {it.codigoExterno}</span> : null}
                          {(it.modificadores ?? []).map((m, j) => (
                            <div className="suave" key={j}>
                              {m.quantidade > 1 ? `${m.quantidade}x ` : '+ '}
                              {m.nome}
                              {m.precoUnitario > 0 ? ` (${formatarMoeda(m.precoUnitario)})` : ''}
                            </div>
                          ))}
                          {it.observacao ? <div className="observacao">Obs.: {it.observacao}</div> : null}
                        </td>
                        <td style={{ textAlign: 'right' }}>{formatarMoeda(it.precoTotal)}</td>
                      </tr>
                    ))}
                    {valores ? (
                      <>
                        <tr>
                          <td className="suave">Subtotal</td>
                          <td style={{ textAlign: 'right' }}>{formatarMoeda(valores.subtotal)}</td>
                        </tr>
                        <tr>
                          <td className="suave">Taxa de entrega</td>
                          <td style={{ textAlign: 'right' }}>{formatarMoeda(valores.taxaEntrega)}</td>
                        </tr>
                        {p.extras.beneficios.map((b, i) => (
                          <tr key={i}>
                            <td className="suave">Desconto pago por {b.quemPaga}</td>
                            <td style={{ textAlign: 'right' }}>- {formatarMoeda(b.valor)}</td>
                          </tr>
                        ))}
                      </>
                    ) : null}
                    <tr>
                      <td>
                        <strong>Total</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{formatarMoeda(p.totalReal)}</strong>
                      </td>
                    </tr>
                    {p.extras.valores.map((v) => (
                      <tr key={v.rotulo}>
                        <td className="suave">{v.rotulo}</td>
                        <td style={{ textAlign: 'right' }}>{formatarMoeda(v.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {p.detalhe?.observacoes ? <div className="banner banner-warn">Observações: {p.detalhe.observacoes}</div> : null}
              {p.avisos.length ? (
                <div className="card">
                  <div className="field-label">Avisos</div>
                  {p.avisos.slice(0, 5).map((a) => (
                    <div key={a.id} className={a.nivel === 'alerta' ? 'observacao' : 'suave'}>
                      {formatarHora(a.em)} · {a.texto}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="card">
                <div className="field-label">Somente no ERP (nada é enviado à plataforma)</div>
                <div className="linha">
                  <input className="input input-sm" style={{ flex: 1, minWidth: 200 }} placeholder="Observação interna" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
                  <button type="button" className="btn btn-sm" onClick={() => salvarAjuste({ observacaoErp: observacao })}>
                    Salvar observação
                  </button>
                  <select className="select input-sm" style={{ width: 190 }} value={p.statusKanban} onChange={(e) => salvarAjuste({ statusKanban: e.target.value as StatusKanban })}>
                    {Object.entries(ROTULO_ETAPA).map(([k, v]) => (
                      <option key={k} value={k}>
                        Mover para {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : null}

          {aba === 'eventos' ? (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="item-table">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Evento</th>
                    <th>Código</th>
                    <th>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {p.eventos.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.ocorridoEm).toLocaleString('pt-BR')}</td>
                      <td>{e.rotulo}</td>
                      <td>
                        <code>{e.tipo}</code>
                      </td>
                      <td>
                        {e.origem}
                        {e.seq ? ` #${e.seq}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {aba === 'tecnico' ? (
            <>
              <div className="suave">
                ID do pedido: <code>{p.id}</code>
              </div>
              {!p.simulado && p.plataforma !== 'TD' ? (
                <div className="linha">
                  <button type="button" className="btn btn-sm" onClick={() => consultar('rastreio')}>
                    {p.plataforma === 'IFOOD' ? 'Consultar rastreio' : 'Consultar na 99Food'}
                  </button>
                  {p.plataforma === 'IFOOD' ? (
                    <button type="button" className="btn btn-sm" onClick={() => consultar('sacola')}>
                      Consultar sacola virtual
                    </button>
                  ) : null}
                </div>
              ) : null}
              {subrecurso ? <pre className="code-block">{subrecurso}</pre> : null}
              <pre className="code-block">{JSON.stringify(p.detalhe, null, 2)}</pre>
            </>
          ) : null}
        </div>
      </div>

      <Comanda pedido={p} />
    </div>
  );
}

/** Via de cozinha: aparece somente na impressao (ver @media print). */
function Comanda({ pedido: p }: { pedido: PedidoErp }) {
  return (
    <div className="comanda">
      <h1>
        #{p.codigoCurto} {nomeCanal(p.plataforma)}
      </h1>
      <p>
        {ROTULO_MODALIDADE[p.modalidade]} · {new Date(p.criadoEm).toLocaleString('pt-BR')}
      </p>
      <p>
        {p.clienteNome} {p.clienteTelefone}
        <br />
        {p.endereco}
      </p>
      {p.extras.codigos.map((c) => (
        <p key={c.rotulo}>
          {c.rotulo}: <strong>{c.valor}</strong>
        </p>
      ))}
      <hr />
      {p.itens.map((it, i) => (
        <div key={i}>
          <strong>
            {it.quantidade}x {it.nome}
          </strong>
          {(it.modificadores ?? []).map((m, j) => (
            <div key={j}>
              &nbsp;&nbsp;{m.quantidade}x {m.nome}
            </div>
          ))}
          {it.observacao ? <div>&nbsp;&nbsp;Obs.: {it.observacao}</div> : null}
        </div>
      ))}
      <hr />
      {p.detalhe?.observacoes ? <p>{p.detalhe.observacoes}</p> : null}
      <p>
        <strong>Total {formatarMoeda(p.totalReal)}</strong>
        <br />
        {p.detalhe?.pagamento?.pagoOnline ? 'Pago pelo aplicativo' : 'Cobrar do cliente'}
        {p.detalhe?.valores?.trocoPara ? ` · troco para ${formatarMoeda(p.detalhe.valores.trocoPara)}` : ''}
      </p>
    </div>
  );
}
