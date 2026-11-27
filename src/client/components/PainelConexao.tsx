import React, { useEffect, useState } from 'react';
import { ApiErro, Sessao, erpApi, extrairStatusIfood } from '../api';
import { IconeAtualizar } from './Icones';
import { MenuTresPontos } from './MenuTresPontos';

interface LojaLivre {
  plataforma: string;
  loja: string;
  nome?: string;
  ambiente?: 'PRODUCAO' | 'TESTE';
  appId?: string;
  appNome?: string;
}

/** Lojas por aplicativo da 99Food, producao primeiro. Resposta sem esses campos vira uma lista unica, sem titulo. */
function agruparLojas(lojas: LojaLivre[]) {
  const grupos = new Map<string, { chave: string; titulo: string; teste: boolean; lojas: LojaLivre[] }>();
  for (const l of lojas) {
    const chave = `${l.ambiente ?? ''}|${l.appId ?? ''}`;
    const ambiente = l.ambiente === 'TESTE' ? 'Teste' : l.ambiente === 'PRODUCAO' ? 'Produção' : '';
    const grupo = grupos.get(chave) ?? { chave, titulo: [ambiente, l.appNome || l.appId].filter(Boolean).join(' · '), teste: l.ambiente === 'TESTE', lojas: [] };
    grupo.lojas.push(l);
    grupos.set(chave, grupo);
  }
  return [...grupos.values()].sort((a, b) => Number(a.teste) - Number(b.teste));
}

export function PainelConexao({
  sessao,
  statusLoja,
  notificar,
  aoAtualizarSessao,
  aoAtualizarStatusLoja,
  aoAbrirLogs,
}: {
  sessao: Sessao;
  statusLoja: any;
  notificar: (tipo: 'ok' | 'erro', msg: string) => void;
  aoAtualizarSessao: () => Promise<void>;
  aoAtualizarStatusLoja: (avisar?: boolean) => Promise<void>;
  aoAbrirLogs: () => void;
}) {
  const [cnpj, setCnpj] = useState(sessao.cnpj || '');
  const [nome, setNome] = useState(sessao.nomeLoja || '');
  const [transporte, setTransporte] = useState<'PULL' | 'PUSH'>(sessao.transporte === 'PULL' ? 'PULL' : 'PUSH');
  const [webhookUrl, setWebhookUrl] = useState(sessao.webhookUrl || 'https://delivery.targetx.com.br/erp-simulador/api/webhook');
  const [salvandoCnpj, setSalvandoCnpj] = useState(false);

  const [livresIfood, setLivresIfood] = useState<any[]>([]);
  const [livres99, setLivres99] = useState<any[]>([]);
  const [buscandoLivres, setBuscandoLivres] = useState(false);
  const [modalPlat, setModalPlat] = useState<'IFOOD' | '99FOOD' | null>(null);
  const [erroLojas, setErroLojas] = useState('');
  const conectada = !!sessao.cnpj && sessao.temTokenConexao && !sessao.conexaoEncerrada;
  const [ocupadoLoja, setOcupadoLoja] = useState<string | null>(null);
  const [entregas, setEntregas] = useState<any[]>([]);
  const [carregandoEntregas, setCarregandoEntregas] = useState(false);

  const [pausaDesc, setPausaDesc] = useState('Pausa operacional');
  const [pausaMin, setPausaMin] = useState(30);
  const [mostrarDetalhesTecnicos, setMostrarDetalhesTecnicos] = useState(false);
  const [mostrarHomologacaoHub, setMostrarHomologacaoHub] = useState(false);

  async function carregarEntregas(avisar = false) {
    if (!conectada) return setEntregas([]);
    setCarregandoEntregas(true);
    try {
      const lista = await erpApi.listarEntregas();
      setEntregas(Array.isArray(lista) ? lista.slice(0, 15) : []);
    } catch (err) {
      if (avisar) notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao consultar a fila PUSH.');
    } finally {
      setCarregandoEntregas(false);
    }
  }

  async function abrirModalPlataforma(plat: 'IFOOD' | '99FOOD') {
    if (!conectada) {
      notificar('erro', sessao.conexaoEncerrada ? 'Conexão encerrada. Clique em "Conectar de novo".' : 'Conecte o CNPJ da empresa primeiro.');
      return;
    }
    setModalPlat(plat);
    setErroLojas('');
    setLivresIfood([]);
    setLivres99([]);
    setBuscandoLivres(true);
    try {
      const r = await erpApi.lojasLivres(plat);
      const lista = Array.isArray(r) ? r : plat === 'IFOOD' ? (Array.isArray(r?.ifood) ? r.ifood : []) : Array.isArray(r?.ninenine) ? r.ninenine : [];
      if (plat === 'IFOOD') setLivresIfood(lista);
      else setLivres99(lista);
    } catch (err) {
      setErroLojas(err instanceof ApiErro ? err.message : `Erro ao consultar lojas disponíveis (${plat}).`);
    } finally {
      setBuscandoLivres(false);
    }
  }

  useEffect(() => {
    setCnpj(sessao.cnpj || '');
    setNome(sessao.nomeLoja || '');
    setTransporte(sessao.transporte === 'PULL' ? 'PULL' : 'PUSH');
    if (sessao.webhookUrl) setWebhookUrl(sessao.webhookUrl);
  }, [sessao.cnpj, sessao.nomeLoja, sessao.transporte, sessao.webhookUrl]);

  useEffect(() => {
    if (sessao.conexaoEncerrada) setModalPlat(null);
    void carregarEntregas();
  }, [sessao.conexaoId, conectada]);

  async function conectarCnpj(e: React.FormEvent) {
    e.preventDefault();
    setSalvandoCnpj(true);
    try {
      await erpApi.conectarCnpj({
        cnpj,
        nome,
        transporte,
        ...(transporte === 'PUSH' && webhookUrl ? { webhookUrl } : {}),
      });
      notificar('ok', `Empresa conectada via ${transporte}. Escolha agora o iFood e/ou 99Food para vincular.`);
      await aoAtualizarSessao();
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao conectar CNPJ.');
      await aoAtualizarSessao();
    } finally {
      setSalvandoCnpj(false);
    }
  }

  async function vincular(plataforma: string, loja: string) {
    setOcupadoLoja(loja);
    try {
      const r = await erpApi.vincularLoja(plataforma, loja);
      // O Hub responde 200 mesmo com o vinculo ainda pendente: mostra a situacao real
      const vinculo = r?.lojas?.find((l) => l.plataforma === plataforma);
      if (vinculo && vinculo.estado !== 'ATIVA') notificar('erro', `Loja ${plataforma} ainda não está ativa: ${vinculo.pendencias?.map((p) => p.mensagem).join(' ') || vinculo.estado}`);
      else notificar('ok', `Loja ${plataforma} vinculada.`);
      setModalPlat(null);
      await aoAtualizarSessao();
      await aoAtualizarStatusLoja();
    } catch (err) {
      const msg = err instanceof ApiErro ? err.message : 'Falha ao vincular loja.';
      setErroLojas(msg);
      notificar('erro', msg);
      await aoAtualizarSessao();
    } finally {
      setOcupadoLoja(null);
    }
  }

  async function liberar(plataforma: string, loja: string) {
    setOcupadoLoja(loja);
    try {
      await erpApi.liberarLoja(plataforma, loja);
      notificar('ok', `Loja ${plataforma} desvinculada.`);
      await aoAtualizarSessao();
      await aoAtualizarStatusLoja();
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Falha ao desvincular loja.');
    } finally {
      setOcupadoLoja(null);
    }
  }

  async function criarPausa(e: React.FormEvent) {
    e.preventDefault();
    try {
      await erpApi.criarInterrupcao({ description: pausaDesc, durationMinutes: pausaMin });
      notificar('ok', `Pausa programada aplicada por ${pausaMin} min.`);
      await aoAtualizarStatusLoja();
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao criar pausa.');
    }
  }

  async function removerPausa(id: string) {
    try {
      await erpApi.removerInterrupcao(id);
      notificar('ok', 'Pausa removida e loja retomada.');
      await aoAtualizarStatusLoja();
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao remover pausa.');
    }
  }

  const interrupcoes: any[] = Array.isArray(statusLoja?.ifood?.interrupcoes) ? statusLoja.ifood.interrupcoes : [];
  const stIfood = extrairStatusIfood(statusLoja);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Passo 1: Empresa */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>1. Empresa Vinculada</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Cada token do integrador opera 1 loja (CNPJ) por vez.
            </span>
          </div>
          <MenuTresPontos
            titulo="Opções técnicas da conexão"
            itens={[
              {
                rotulo: mostrarDetalhesTecnicos ? 'Ocultar dados técnicos' : 'Mostrar Conexão ID e detalhes técnicos',
                aoClicar: () => setMostrarDetalhesTecnicos((v) => !v),
              },
              {
                rotulo: 'Gerar novo token desta conexão (invalida o anterior)',
                aoClicar: async () => {
                  try {
                    await erpApi.recuperarToken();
                    await aoAtualizarSessao();
                    notificar('ok', 'Novo token da loja gravado. O anterior deixou de valer.');
                  } catch (err) {
                    notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao recuperar token.');
                  }
                },
              },
              { rotulo: 'Abrir logs HTTP SQLite', separadorAntes: true, aoClicar: aoAbrirLogs },
            ]}
          />
        </div>

        <form onSubmit={conectarCnpj} className="grid-2">
          <div className="field">
            <label className="field-label">CNPJ da Loja</label>
            <input className="input" placeholder="Ex: 11111111000191" value={cnpj} onChange={(e) => setCnpj(e.target.value)} required />
          </div>
          <div className="field">
            <label className="field-label">Nome Fantasia / Identificação</label>
            <input className="input" placeholder="Ex: Lanchonete Target Testes" value={nome} onChange={(e) => setNome(e.target.value)} required />
          </div>
          <div className="field">
            <label className="field-label">Recebimento de pedidos</label>
            <select className="select" value={transporte} onChange={(e) => setTransporte(e.target.value as 'PULL' | 'PUSH')}>
              <option value="PUSH">PUSH via Webhook Instantâneo (Recomendado)</option>
              <option value="PULL">PULL automático (Long-poll legado)</option>
            </select>
          </div>
          {transporte === 'PUSH' ? (
            <div className="field">
              <label className="field-label">URL do Webhook receptor (Túnel)</label>
              <input className="input" placeholder="https://delivery.targetx.com.br/erp-simulador/api/webhook" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
            </div>
          ) : null}
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={salvandoCnpj}>
              {salvandoCnpj ? 'Conectando...' : sessao.conexaoEncerrada ? 'Conectar de novo' : sessao.cnpj ? 'Atualizar Empresa Conectada' : 'Conectar Empresa ao Hub'}
            </button>
          </div>
        </form>

        {mostrarDetalhesTecnicos ? (
          <pre className="code-block" style={{ marginTop: 12 }}>
            {JSON.stringify(
              {
                integradorCodigo: sessao.integradorCodigo,
                conexaoId: sessao.conexaoId,
                estadoConexao: sessao.estadoConexao,
                temTokenConexao: sessao.temTokenConexao,
                baseUrl: sessao.baseUrl,
              },
              null,
              2,
            )}
          </pre>
        ) : null}
      </div>

      {/* Passo 2: Lojas */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>2. Lojas iFood e 99Food</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Conecte manualmente cada canal escolhendo a loja na lista disponível.
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void abrirModalPlataforma('IFOOD')} disabled={!conectada}>
              Conectar iFood
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void abrirModalPlataforma('99FOOD')} disabled={!conectada}>
              Conectar 99Food
            </button>
          </div>
        </div>

        <div>
          <div className="field-label" style={{ marginBottom: 6 }}>
            Lojas Conectadas Nesta Empresa ({sessao.lojas.filter((l) => l.estado === 'ATIVA').length})
          </div>
          {sessao.lojas.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhuma loja vinculada ainda. Use os botões acima para escolher iFood ou 99Food.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sessao.lojas.map((l) => (
                <div
                  key={`${l.plataforma}-${l.loja || l.estado}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 10,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {l.nome || (l.loja ? l.loja : 'Aguardando seleção manual')} <span className="pill">{l.plataforma}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Status: {l.estado} {l.loja ? `· ID: ${l.loja}` : ''} {l.lojaExterna ? `· ID na 99Food: ${l.lojaExterna}` : ''}
                    </div>
                    {l.pendencias?.map((p) => (
                      <div key={p.codigo} style={{ fontSize: 12, color: 'var(--warn)' }}>
                        {p.mensagem}
                      </div>
                    ))}
                  </div>
                  {l.loja && l.estado === 'ATIVA' ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={ocupadoLoja === l.loja}
                      onClick={() => liberar(l.plataforma, l.loja)}
                    >
                      Desvincular
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!sessao.cnpj}
                      onClick={() => void abrirModalPlataforma(l.plataforma === '99FOOD' ? '99FOOD' : 'IFOOD')}
                    >
                      Escolher loja
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {modalPlat ? (
        <div className="modal-backdrop" onClick={() => setModalPlat(null)}>
          <div className="modal-panel" style={{ maxWidth: 520, width: '92%' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>
                  Lojas disponíveis — {modalPlat === 'IFOOD' ? 'iFood' : '99Food'}
                </h3>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Escolha qual loja autorizada deseja vincular a este CNPJ.
                </span>
              </div>
              <button type="button" className="btn-icon" onClick={() => setModalPlat(null)}>
                ×
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {erroLojas ? (
                <div className="banner banner-err" role="alert">
                  {erroLojas}
                </div>
              ) : null}
              {buscandoLivres ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
                  Consultando lojas disponíveis na plataforma {modalPlat === 'IFOOD' ? 'iFood' : '99Food'}...
                </div>
              ) : (modalPlat === 'IFOOD' ? livresIfood : livres99).length === 0 ? (
                erroLojas ? null : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
                  Nenhuma loja livre para {modalPlat === 'IFOOD' ? 'iFood' : '99Food'}. Autorize o aplicativo da Target no portal da plataforma e abra esta lista de novo.
                </div>
                )
              ) : (
                agruparLojas(modalPlat === 'IFOOD' ? livresIfood : livres99).map((g) => (
                  <React.Fragment key={g.chave}>
                    {g.titulo ? (
                      <div className="field-label" style={{ marginTop: 4 }}>
                        {g.titulo}
                      </div>
                    ) : null}
                    {g.lojas.map((l) => (
                      <div
                        key={`${l.plataforma}-${l.loja}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          padding: 10,
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{l.nome || l.loja}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{l.loja}</div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={ocupadoLoja === l.loja}
                          onClick={() => void vincular(l.plataforma, String(l.loja))}
                        >
                          {ocupadoLoja === l.loja ? 'Vinculando...' : 'Vincular'}
                        </button>
                      </div>
                    ))}
                  </React.Fragment>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Passo 3: Status e Pausas Programadas */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>3. Horário e Pausas Temporárias (iFood)</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Estado atual: {stIfood.carregado ? stIfood.titulo : sessao.lojas.some((l) => l.estado === 'ATIVA') ? 'Não consultado' : 'Nenhuma loja ativa'}
            </span>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => void aoAtualizarStatusLoja(true)}>
            <IconeAtualizar size={14} /> Verificar status
          </button>
        </div>

        <form onSubmit={criarPausa} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label className="field-label">Motivo da pausa</label>
            <input className="input input-sm" value={pausaDesc} onChange={(e) => setPausaDesc(e.target.value)} required />
          </div>
          <div className="field" style={{ width: 140 }}>
            <label className="field-label">Duração (min)</label>
            <input
              type="number"
              min={5}
              max={1440}
              className="input input-sm"
              value={pausaMin}
              onChange={(e) => setPausaMin(Number(e.target.value))}
            />
          </div>
          <button type="submit" className="btn btn-sm btn-danger">
            Pausar loja agora
          </button>
        </form>

        {interrupcoes.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {interrupcoes.map((it: any) => (
              <div
                key={it.id}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, border: '1px solid var(--border)', borderRadius: 6 }}
              >
                <span style={{ fontSize: 13 }}>{it.description || 'Pausa ativa'}</span>
                <button type="button" className="btn btn-sm" onClick={() => removerPausa(it.id)}>
                  Retomar / Remover
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Passo 4: Webhook & Homologação (Inspeção interna - apenas para testes, não vai para tela final do lojista) */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>4. Webhook PUSH & Ferramentas de Homologação</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Transporte: <strong>{sessao.transporte || 'PUSH'}</strong> · Assinatura HMAC: {sessao.temWebhookSegredo ? 'Ativa' : 'Pendente'} · Fila/logs internos são serviço do Delivery (opcional em testes)
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={async () => {
                try {
                  const r = await erpApi.avaliarPedido();
                  notificar('ok', `Pedido ${r.pedido?.codigoExibicao || r.pedidoId} disparado via Webhook PUSH.`);
                  if (mostrarHomologacaoHub) setTimeout(() => void carregarEntregas(), 400);
                } catch (err) {
                  notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao disparar avaliação.');
                }
              }}
              disabled={!sessao.cnpj}
            >
              Testar Webhook (Pedido Completo)
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const prox = !mostrarHomologacaoHub;
                setMostrarHomologacaoHub(prox);
                if (prox) void carregarEntregas(true);
              }}
            >
              {mostrarHomologacaoHub ? 'Ocultar fila interna' : 'Inspecionar fila PUSH'}
            </button>
          </div>
        </div>

        {mostrarHomologacaoHub ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Diagnóstico de entregas do Hub (apenas homologação — o ERP de produção confia no seu próprio receptor <code>/webhook</code>).
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    try {
                      await erpApi.reativarPush();
                      const r = await erpApi.reprocessarEntregas();
                      notificar('ok', `PUSH reativado. Reprocessadas: ${r.reprocessadas}.`);
                      await carregarEntregas(true);
                    } catch (err) {
                      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao reativar o PUSH.');
                    }
                  }}
                  disabled={!sessao.cnpj}
                >
                  Reativar / Reprocessar PUSH
                </button>
                <button type="button" className="btn btn-sm" onClick={() => void carregarEntregas(true)} disabled={carregandoEntregas || !sessao.cnpj}>
                  <IconeAtualizar size={14} /> {carregandoEntregas ? 'Carregando...' : 'Atualizar'}
                </button>
              </div>
            </div>

            {entregas.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhuma entrega PUSH registrada ainda nesta conexão.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="item-table">
                  <thead>
                    <tr>
                      <th>Seq</th>
                      <th>Canal / Tipo</th>
                      <th>Pedido</th>
                      <th>Estado</th>
                      <th>HTTP / Tentativas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entregas.map((en: any) => (
                      <tr key={en.notificacaoId || en.evento}>
                        <td>#{en.seq}</td>
                        <td>
                          <span className="pill">{en.plataforma}</span> {en.tipo}
                        </td>
                        <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{en.pedido || '-'}</td>
                        <td>
                          <span className={`pill ${en.estado === 'DELIVERED' ? 'pill-ok' : en.estado === 'DEAD' ? 'pill-err' : 'pill-warn'}`}>
                            {en.estado}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          HTTP {en.ultimoStatus ?? '-'} · {en.tentativas}x {en.ultimoErro ? `(${en.ultimoErro})` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
