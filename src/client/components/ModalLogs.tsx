import React, { useEffect, useState } from 'react';
import { erpApi, LogHttp, formatarHora } from '../api';
import { useConfirmar } from './Comuns';
import { IconeAtualizar, IconeFechar } from './Icones';
import { Modal } from './Modal';
import { lerJson } from '../../shared/json';

export function ModalLogs({ aoFechar, aoMudarContagem }: { aoFechar: () => void; aoMudarContagem: (erros: number) => void }) {
  const [filtro, setFiltro] = useState<'todos' | 'erros' | 'sucesso'>('todos');
  const [busca, setBusca] = useState('');
  const [logs, setLogs] = useState<LogHttp[]>([]);
  const [total, setTotal] = useState(0);
  const [totalErros, setTotalErros] = useState(0);
  const [expandidoId, setExpandidoId] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(false);
  const { pedir, dialogo } = useConfirmar();

  async function carregar(filtroAtu = filtro, qAtu = busca) {
    setCarregando(true);
    try {
      const r = await erpApi.listarLogs(filtroAtu, qAtu);
      setLogs(r.logs);
      setTotal(r.total);
      setTotalErros(r.totalErros);
      aoMudarContagem(r.totalErros);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, [filtro]);

  async function limpar() {
    await erpApi.limparLogs();
    await carregar();
  }

  function formatarJson(txt: string): string {
    if (!txt) return '';
    const json = lerJson(txt);
    return json === null ? txt : JSON.stringify(json, null, 2);
  }

  function statusPill(st: number) {
    if (st === 0 || st >= 500) return 'pill pill-err';
    if (st >= 400) return 'pill pill-warn';
    if (st >= 200 && st < 300) return 'pill pill-ok';
    return 'pill';
  }

  return (
    <Modal aoFechar={aoFechar}>
      <div className="modal-panel wide" role="dialog" aria-modal="true" aria-label="Logs">
        <div className="modal-head">
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Histórico HTTP & Logs SQLite</h2>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {total} registros salvos localmente · {totalErros} falhas (4xx / 5xx)
            </span>
          </div>
          <button type="button" className="btn-icon" onClick={aoFechar} title="Fechar" aria-label="Fechar">
            <IconeFechar />
          </button>
        </div>

        <div className="modal-body">
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <div className="toolbar-group">
              {(['todos', 'erros', 'sucesso'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`btn btn-sm ${filtro === f ? 'btn-primary' : ''}`}
                  onClick={() => setFiltro(f)}
                >
                  {f === 'todos' ? `Todos (${total})` : f === 'erros' ? `Erros (${totalErros})` : 'Sucesso (2xx)'}
                </button>
              ))}
            </div>
            <div className="toolbar-group">
              <input
                type="search"
                className="input input-sm"
                style={{ width: 250 }}
                placeholder="Filtrar por 400, URL, erro..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void carregar(filtro, busca);
                }}
              />
              <button type="button" className="btn btn-sm" onClick={() => carregar(filtro, busca)} disabled={carregando}>
                <IconeAtualizar size={14} /> Atualizar
              </button>
              <a className="btn btn-sm" href="/erp-simulador/api/logs/exportar" style={{ textDecoration: 'none' }}>
                Exportar JSON
              </a>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() =>
                  pedir({
                    titulo: 'Limpar logs?',
                    confirmar: 'Limpar logs',
                    aviso: 'Não é possível desfazer.',
                    perigo: true,
                    conteudo: <span>Apaga os {total} registros salvos neste ERP.</span>,
                    acao: limpar,
                  })
                }
              >
                Limpar logs
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {logs.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                Nenhum log encontrado para este filtro.
              </div>
            ) : null}

            {logs.map((l) => {
              const aberto = expandidoId === l.id;
              return (
                <div key={l.id} className="card" style={{ padding: '10px 12px' }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer' }}
                    onClick={() => setExpandidoId(aberto ? null : l.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                      <span className={statusPill(l.status)}>{l.status || 'REDE'}</span>
                      <strong>{l.metodo}</strong>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{l.url}</span>
                      {l.erroResumo ? (
                        <span style={{ color: 'var(--err)', fontSize: 12, fontWeight: 500 }}>{l.erroResumo}</span>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, color: 'var(--text-muted)', fontSize: 12 }}>
                      <span>{l.ms} ms</span>
                      <span>{formatarHora(l.quando)}</span>
                    </div>
                  </div>

                  {aberto ? (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      {l.reqBody ? (
                        <div>
                          <div className="field-label">Corpo Enviado (Request)</div>
                          <pre className="code-block">{formatarJson(l.reqBody)}</pre>
                        </div>
                      ) : null}
                      {l.reqHeaders && l.reqHeaders !== '{}' ? (
                        <div>
                          <div className="field-label">Cabeçalhos</div>
                          <pre className="code-block">{formatarJson(l.reqHeaders)}</pre>
                        </div>
                      ) : null}
                      <div>
                        <div className="field-label">Resposta Recebida (Response)</div>
                        <pre className="code-block">{formatarJson(l.resBody) || '(sem corpo)'}</pre>
                      </div>
                      {l.curl ? (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span className="field-label">Comando cURL</span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => navigator.clipboard?.writeText(l.curl)}
                            >
                              Copiar cURL
                            </button>
                          </div>
                          <pre className="code-block">{l.curl}</pre>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {dialogo}
    </Modal>
  );
}
