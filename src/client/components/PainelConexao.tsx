import React, { useEffect, useState } from 'react';
import { ApiErro, Sessao, erpApi, extrairStatusIfood } from '../api';
import { IconeAtualizar } from './Icones';
import { MenuTresPontos } from './MenuTresPontos';

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
  aoAtualizarStatusLoja: () => Promise<void>;
  aoAbrirLogs: () => void;
}) {
  const [cnpj, setCnpj] = useState(sessao.cnpj || '');
  const [nome, setNome] = useState(sessao.nomeLoja || '');
  const [transporte, setTransporte] = useState<'PULL' | 'PUSH'>(sessao.transporte === 'PUSH' ? 'PUSH' : 'PULL');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [salvandoCnpj, setSalvandoCnpj] = useState(false);

  const [livresIfood, setLivresIfood] = useState<any[]>([]);
  const [livres99, setLivres99] = useState<any[]>([]);
  const [buscandoLivres, setBuscandoLivres] = useState(false);
  const [ocupadoLoja, setOcupadoLoja] = useState<string | null>(null);

  const [pausaDesc, setPausaDesc] = useState('Pausa operacional');
  const [pausaMin, setPausaMin] = useState(30);
  const [mostrarDetalhesTecnicos, setMostrarDetalhesTecnicos] = useState(false);

  async function carregarLivres() {
    if (!sessao.cnpj || !sessao.temTokenConexao) return;
    setBuscandoLivres(true);
    try {
      const r = await erpApi.lojasLivres();
      setLivresIfood(Array.isArray(r.ifood) ? r.ifood : []);
      setLivres99(Array.isArray(r.ninenine) ? r.ninenine : []);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao consultar lojas disponíveis.');
    } finally {
      setBuscandoLivres(false);
    }
  }

  useEffect(() => {
    setCnpj(sessao.cnpj || '');
    setNome(sessao.nomeLoja || '');
    setTransporte(sessao.transporte === 'PUSH' ? 'PUSH' : 'PULL');
    if (sessao.cnpj) void carregarLivres();
  }, [sessao.cnpj, sessao.nomeLoja, sessao.transporte]);

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
      notificar('ok', 'Empresa vinculada à conexão 1:1 com sucesso.');
      await aoAtualizarSessao();
      await carregarLivres();
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao conectar CNPJ.');
    } finally {
      setSalvandoCnpj(false);
    }
  }

  async function vincular(plataforma: string, loja: string) {
    setOcupadoLoja(loja);
    try {
      await erpApi.vincularLoja(plataforma, loja);
      notificar('ok', `Loja ${plataforma} vinculada.`);
      await aoAtualizarSessao();
      await carregarLivres();
      await aoAtualizarStatusLoja();
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Falha ao vincular loja.');
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
      await carregarLivres();
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
                rotulo: 'Recuperar / regenerar token da conexão',
                aoClicar: async () => {
                  try {
                    await erpApi.recuperarToken();
                    await aoAtualizarSessao();
                    notificar('ok', 'Token da loja atualizado no SQLite.');
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
              <option value="PULL">PULL automático (sem URL pública)</option>
              <option value="PUSH">PUSH via Webhook HTTPS</option>
            </select>
          </div>
          {transporte === 'PUSH' ? (
            <div className="field">
              <label className="field-label">URL do Webhook receptor</label>
              <input className="input" placeholder="https://..." value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
            </div>
          ) : null}
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={salvandoCnpj}>
              {salvandoCnpj ? 'Conectando...' : sessao.cnpj ? 'Atualizar Empresa Conectada' : 'Conectar Empresa ao Hub'}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>2. Lojas iFood e 99Food</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Vincule ou libere canais disponíveis para receber pedidos e editar cardápios.
            </span>
          </div>
          <button type="button" className="btn btn-sm" onClick={carregarLivres} disabled={buscandoLivres || !sessao.cnpj}>
            <IconeAtualizar size={14} /> {buscandoLivres ? 'Buscando...' : 'Atualizar Lojas'}
          </button>
        </div>

        <div className="grid-2">
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>
              Lojas Conectadas Nesta Empresa ({sessao.lojas.length})
            </div>
            {sessao.lojas.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhuma loja vinculada ainda.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sessao.lojas.map((l) => (
                  <div
                    key={`${l.plataforma}-${l.loja}`}
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
                        {l.nome || l.loja} <span className="pill">{l.plataforma}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Status: {l.estado}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={ocupadoLoja === l.loja}
                      onClick={() => liberar(l.plataforma, l.loja)}
                    >
                      Desvincular
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>
              Lojas Livres Disponíveis para Vincular
            </div>
            {livresIfood.length === 0 && livres99.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Nenhuma loja livre encontrada no momento.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[...livresIfood, ...livres99].map((l) => (
                  <div
                    key={`${l.plataforma}-${l.loja}`}
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
                        {l.nome || l.loja} <span className="pill">{l.plataforma}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={ocupadoLoja === l.loja}
                      onClick={() => vincular(l.plataforma, l.loja)}
                    >
                      Vincular loja
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Passo 3: Status e Pausas Programadas */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>3. Horário e Pausas Temporárias (iFood)</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Estado atual: {stIfood.carregado ? stIfood.titulo : 'Não consultado'}
            </span>
          </div>
          <button type="button" className="btn btn-sm" onClick={aoAtualizarStatusLoja}>
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
    </div>
  );
}
