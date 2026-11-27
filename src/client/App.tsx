import React, { useCallback, useEffect, useState } from 'react';
import { ApiErro, CatalogoCategoria, PedidoErp, Sessao, erpApi, extrairStatus99, extrairStatusIfood } from './api';
import { GestorCatalogo } from './components/GestorCatalogo';
import { IconeTema } from './components/Icones';
import { KanbanPedidos } from './components/KanbanPedidos';
import { MenuTresPontos } from './components/MenuTresPontos';
import { ModalLogs } from './components/ModalLogs';
import { PainelConexao } from './components/PainelConexao';
import { PainelDocumentacao } from './components/PainelDocumentacao';
import { TelaEntrada } from './components/TelaEntrada';

type Aba = 'pedidos' | 'catalogo' | 'lojas' | 'docs';

export function App() {
  const [escuro, setEscuro] = useState<boolean>(() => localStorage.getItem('erp-tema') === 'dark');
  const [carregando, setCarregando] = useState(true);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [aba, setAba] = useState<Aba>('pedidos');

  const [pedidos, setPedidos] = useState<PedidoErp[]>([]);
  const [categorias, setCategorias] = useState<CatalogoCategoria[]>([]);
  const [statusLoja, setStatusLoja] = useState<any>(null);
  const [totalErrosLogs, setTotalErrosLogs] = useState(0);
  const [logsAberto, setLogsAberto] = useState(false);

  const [toasts, setToasts] = useState<Array<{ id: number; tipo: 'ok' | 'erro'; msg: string }>>([]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', escuro ? 'dark' : 'light');
    localStorage.setItem('erp-tema', escuro ? 'dark' : 'light');
  }, [escuro]);

  const notificar = useCallback((tipo: 'ok' | 'erro', msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur.slice(-3), { id, tipo, msg }]);
    if (tipo === 'erro') {
      void erpApi.listarLogs('erros').then((r) => setTotalErrosLogs(r.totalErros)).catch(() => undefined);
    }
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 4500);
  }, []);

  const carregarSessao = useCallback(async () => {
    const s = await erpApi.sessao();
    setSessao(s);
    if (!s.cnpj && s.autenticado) setAba('lojas');
    return s;
  }, []);

  const carregarPedidos = useCallback(async (sync = false) => {
    try {
      const lista = await erpApi.listarPedidos(sync);
      setPedidos(lista);
    } catch {
      // erro registrado automaticamente nos logs SQLite
    }
  }, []);

  const carregarCatalogo = useCallback(async (sincronizar = false) => {
    try {
      const c = await erpApi.catalogo(sincronizar);
      setCategorias(c.categorias ?? []);
    } catch (err) {
      if (sincronizar) throw err;
    }
  }, []);

  const carregarStatusLoja = useCallback(async () => {
    try {
      const st = await erpApi.statusLoja();
      setStatusLoja(st);
    } catch {
      // ignora silenciosamente se loja nao estiver vinculada ainda
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setCarregando(true);
    try {
      const s = await carregarSessao();
      const l = await erpApi.listarLogs('erros').catch(() => ({ totalErros: 0 }));
      setTotalErrosLogs(l.totalErros ?? 0);
      if (s.autenticado && s.cnpj) {
        await Promise.all([carregarPedidos(false), carregarCatalogo(false), carregarStatusLoja()]);
      }
    } finally {
      setCarregando(false);
    }
  }, [carregarSessao, carregarPedidos, carregarCatalogo, carregarStatusLoja]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Atualização em tempo real via SSE (Webhook PUSH) + fallback de backup em PULL
  useEffect(() => {
    if (!sessao?.autenticado || !sessao?.cnpj) return;
    const es = new EventSource('/erp-simulador/api/stream');
    es.addEventListener('webhook', (ev) => {
      void carregarPedidos(false);
      try {
        const d = JSON.parse((ev as MessageEvent).data);
        if (d?.pedidoId) {
          notificar('ok', `Webhook PUSH recebido (${d.plataforma || 'HUB'} · ${d.tipo || 'evento'}).`);
        }
      } catch {
        // ignora parse
      }
    });
    es.addEventListener('pedidos', () => {
      void carregarPedidos(false);
    });
    const t = setInterval(() => {
      if (sessao.transporte !== 'PUSH') void carregarPedidos(true);
    }, 12000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, [sessao?.autenticado, sessao?.cnpj, sessao?.transporte, carregarPedidos, notificar]);

  async function sair(limparDados = false) {
    await erpApi.sair(limparDados);
    setPedidos([]);
    setCategorias([]);
    setStatusLoja(null);
    await carregarSessao();
  }

  async function desvincularLojas() {
    if (!sessao?.lojas?.length) return;
    try {
      for (const l of sessao.lojas) {
        if (l.loja) {
          await erpApi.liberarLoja(l.plataforma, l.loja);
        }
      }
      setStatusLoja(null);
      await carregarSessao();
      setAba('lojas');
      notificar('ok', 'Loja desvinculada. Pronta para vincular novamente.');
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Falha ao desvincular loja.');
    }
  }

  if (carregando) {
    return (
      <div className="login-page">
        <div className="card" style={{ padding: '18px 24px' }}>
          Carregando sistema...
        </div>
      </div>
    );
  }

  if (!sessao?.autenticado) {
    return (
      <>
        <TelaEntrada
          baseUrlInicial={sessao?.baseUrl || 'https://delivery.targetx.com.br/api/v1'}
          totalErros={totalErrosLogs}
          escuro={escuro}
          aoAlternarTema={() => setEscuro((v) => !v)}
          aoAbrirLogs={() => setLogsAberto(true)}
          aoEntrar={() => void bootstrap()}
        />
        {logsAberto ? <ModalLogs aoFechar={() => setLogsAberto(false)} aoMudarContagem={setTotalErrosLogs} /> : null}
      </>
    );
  }

  const ativosCount = pedidos.filter((p) => p.statusKanban !== 'CONCLUIDO' && p.statusKanban !== 'CANCELADO').length;
  const totalItens = categorias.reduce((s, c) => s + c.itens.length, 0);
  const stIfood = extrairStatusIfood(statusLoja);
  const st99 = extrairStatus99(statusLoja);
  const lojaIfoodOk = stIfood.aberta;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand-mark">
            <div>
              <div className="brand-title">{sessao.nomeLoja || 'Gestor Delivery ERP'}</div>
              <div className="brand-sub">
                {sessao.cnpj ? `CNPJ ${sessao.cnpj}` : 'Nenhuma empresa conectada'} · {sessao.transporte}
              </div>
            </div>
          </div>

          <nav className="nav-tabs" aria-label="Navegação principal">
            <button type="button" className={`nav-tab${aba === 'pedidos' ? ' active' : ''}`} onClick={() => setAba('pedidos')}>
              Pedidos <span className="pill">{ativosCount}</span>
            </button>
            <button
              type="button"
              className={`nav-tab${aba === 'catalogo' ? ' active' : ''}`}
              onClick={() => {
                setAba('catalogo');
                if (categorias.length === 0) void carregarCatalogo(true);
              }}
            >
              Cardápio <span className="pill">{totalItens}</span>
            </button>
            <button type="button" className={`nav-tab${aba === 'lojas' ? ' active' : ''}`} onClick={() => setAba('lojas')}>
              Lojas e Operação
            </button>
            <button type="button" className={`nav-tab${aba === 'docs' ? ' active' : ''}`} onClick={() => setAba('docs')}>
              Documentação API
            </button>
          </nav>
        </div>

        <div className="topbar-right">
          {sessao.lojas.map((l) => {
            const aberto =
              l.plataforma === 'IFOOD' && stIfood.carregado
                ? lojaIfoodOk
                : l.plataforma === '99FOOD' && st99.carregado
                  ? st99.aberta
                  : l.estado === 'ATIVA';
            const textoStatus =
              l.plataforma === 'IFOOD' && stIfood.carregado
                ? lojaIfoodOk
                  ? 'Aberta'
                  : 'Fechada'
                : l.plataforma === '99FOOD' && st99.carregado
                  ? st99.aberta
                    ? 'Aberta'
                    : 'Fechada'
                  : l.estado;
            return (
              <span key={`${l.plataforma}-${l.loja}`} className={`pill ${aberto ? 'pill-ok' : 'pill-warn'}`}>
                <span className="dot" />
                {l.plataforma === 'IFOOD' ? 'iFood' : '99Food'}: {textoStatus}
              </span>
            );
          })}

          {sessao.lojas.some((l) => l.loja && l.estado === 'ATIVA') ? (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void desvincularLojas()}>
              Desvincular loja
            </button>
          ) : null}

          <button type="button" className="btn-icon" title={escuro ? 'Tema claro' : 'Tema escuro'} onClick={() => setEscuro((v) => !v)}>
            <IconeTema escuro={escuro} />
          </button>

          <MenuTresPontos
            titulo="Menu técnico, logs e sessão"
            temAlerta={totalErrosLogs > 0}
            itens={[
              {
                rotulo: 'Logs HTTP e Erros SQLite',
                badge: totalErrosLogs > 0 ? `${totalErrosLogs} erros` : undefined,
                aoClicar: () => setLogsAberto(true),
              },
              {
                rotulo: 'Sincronizar tudo agora',
                aoClicar: async () => {
                  try {
                    await Promise.all([carregarPedidos(true), carregarCatalogo(true), carregarStatusLoja()]);
                    notificar('ok', 'Pedidos e cardápio sincronizados.');
                  } catch (err) {
                    notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao sincronizar.');
                  }
                },
              },
              {
                rotulo: 'Sair e trocar token',
                separadorAntes: true,
                aoClicar: () => void sair(false),
              },
              {
                rotulo: 'Sair e limpar cache SQLite',
                perigo: true,
                aoClicar: () => void sair(true),
              },
            ]}
          />
        </div>
      </header>

      <main className="main-content">
        {aba === 'pedidos' ? (
          <KanbanPedidos
            pedidos={pedidos}
            notificar={notificar}
            aoRecarregar={carregarPedidos}
            aoAbrirLogs={() => setLogsAberto(true)}
          />
        ) : null}

        {aba === 'catalogo' ? (
          <GestorCatalogo
            categorias={categorias}
            statusLoja={statusLoja}
            notificar={notificar}
            aoRecarregarCatalogo={carregarCatalogo}
            aoRecarregarStatusLoja={carregarStatusLoja}
            aoAbrirLogs={() => setLogsAberto(true)}
          />
        ) : null}

        {aba === 'lojas' ? (
          <PainelConexao
            sessao={sessao}
            statusLoja={statusLoja}
            notificar={notificar}
            aoAtualizarSessao={async () => {
              await carregarSessao();
            }}
            aoAtualizarStatusLoja={carregarStatusLoja}
            aoAbrirLogs={() => setLogsAberto(true)}
          />
        ) : null}

        {aba === 'docs' ? <PainelDocumentacao sessao={sessao} notificar={notificar} /> : null}
      </main>

      {logsAberto ? <ModalLogs aoFechar={() => setLogsAberto(false)} aoMudarContagem={setTotalErrosLogs} /> : null}

      {toasts.length > 0 ? (
        <div className="toast-bar">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.tipo}`}>
              <span style={{ fontSize: 13 }}>{t.msg}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {t.tipo === 'erro' ? (
                  <button type="button" className="btn btn-sm" onClick={() => setLogsAberto(true)}>
                    Ver log
                  </button>
                ) : null}
                <button type="button" className="btn-icon" style={{ minWidth: 24, minHeight: 24 }} onClick={() => setToasts((c) => c.filter((x) => x.id !== t.id))}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
