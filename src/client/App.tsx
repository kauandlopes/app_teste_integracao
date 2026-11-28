import React, { useCallback, useEffect, useRef, useState } from 'react';
import { erpApi, extrairStatus99, extrairStatusIfood, Fila, mensagemDe, nomeCanal, PedidoErp, ProdutoCadastrado, Sessao } from './api';
import { Confirmacao } from './components/Comuns';
import { DadosLoja } from './components/DadosLoja';
import { GestorCatalogo } from './components/GestorCatalogo';
import { IconeTema } from './components/Icones';
import { KanbanPedidos } from './components/KanbanPedidos';
import { MenuTresPontos } from './components/MenuTresPontos';
import { ModalLogs } from './components/ModalLogs';
import { PainelConexao } from './components/PainelConexao';
import { PainelDocumentacao } from './components/PainelDocumentacao';
import { TelaEntrada } from './components/TelaEntrada';
import { TokensRotas } from './components/TokensRotas';
import { liberarAudio, tocarAlerta } from './som';

type Aba = 'pedidos' | 'catalogo' | 'lojas' | 'dados' | 'tokens' | 'docs';
const ABAS: Array<[Aba, string]> = [
  ['pedidos', 'Pedidos'],
  ['catalogo', 'Cardápio'],
  ['lojas', 'Lojas e operação'],
  ['dados', 'Dados da loja'],
  ['tokens', 'Tokens e rotas'],
  ['docs', 'Documentação'],
];

const lerPreferencia = (chave: string) => {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
};
const gravarPreferencia = (chave: string, valor: string) => {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    // navegacao privada: a preferencia vale so nesta aba
  }
};

export function App() {
  const [escuro, setEscuro] = useState(() => lerPreferencia('erp-tema') === 'dark');
  const [somLigado, setSomLigado] = useState(() => lerPreferencia('erp-som') !== 'off');
  const [carregando, setCarregando] = useState(true);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [aba, setAba] = useState<Aba>('pedidos');

  const [pedidos, setPedidos] = useState<PedidoErp[]>([]);
  const [aceiteAutomatico, setAceiteAutomatico] = useState(false);
  const [fila, setFila] = useState<Fila>({ pendentes: 0, comFalha: 0, erro: 0 });
  const [produtos, setProdutos] = useState<ProdutoCadastrado[]>([]);
  const [statusLoja, setStatusLoja] = useState<any>(null);
  const [totalErrosLogs, setTotalErrosLogs] = useState(0);
  const [logsAberto, setLogsAberto] = useState(false);
  const [reconectando, setReconectando] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: number; tipo: 'ok' | 'erro'; msg: string }>>([]);
  /** Alteracao digitada em "Dados da loja": sair da aba apagaria, entao pergunta antes. */
  const rascunhoLoja = useRef(false);
  const [abaPedida, setAbaPedida] = useState<Aba | null>(null);
  const [saindo, setSaindo] = useState(false);
  const somRef = useRef(somLigado);
  somRef.current = somLigado;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', escuro ? 'dark' : 'light');
    gravarPreferencia('erp-tema', escuro ? 'dark' : 'light');
  }, [escuro]);

  // O navegador so permite audio depois de um clique na pagina
  useEffect(() => {
    document.addEventListener('pointerdown', liberarAudio);
    return () => document.removeEventListener('pointerdown', liberarAudio);
  }, []);

  const notificar = useCallback((tipo: 'ok' | 'erro', msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((atual) => [...atual.slice(-3), { id, tipo, msg }]);
    if (tipo === 'erro') void erpApi.listarLogs('erros').then((r) => setTotalErrosLogs(r.totalErros)).catch(() => undefined);
    setTimeout(() => setToasts((atual) => atual.filter((t) => t.id !== id)), tipo === 'erro' ? 9000 : 4500);
  }, []);

  const carregarSessao = useCallback(async () => {
    const s = await erpApi.sessao();
    setSessao(s);
    return s;
  }, []);

  const carregarPedidos = useCallback(async () => {
    try {
      const r = await erpApi.listarPedidos();
      setPedidos(r.pedidos);
      setAceiteAutomatico(r.aceiteAutomatico);
      setFila(r.fila);
    } catch {
      // sem conexao com o ERP: a proxima atualizacao tenta de novo
    }
  }, []);

  const carregarProdutos = useCallback(async () => {
    try {
      setProdutos(await erpApi.produtos());
    } catch {
      // idem
    }
  }, []);

  const carregarStatusLoja = useCallback(
    async (avisar = false) => {
      try {
        setStatusLoja(await erpApi.statusLoja());
      } catch (err) {
        // Na carga automatica o erro fica so no log; no clique do operador aparece na tela
        if (avisar) notificar('erro', mensagemDe(err, 'Não foi possível consultar a loja.'));
      }
    },
    [notificar],
  );

  const bootstrap = useCallback(async () => {
    setCarregando(true);
    try {
      const s = await carregarSessao();
      if (s.autenticado && !s.cnpj) setAba('lojas');
      setTotalErrosLogs((await erpApi.listarLogs('erros').catch(() => ({ totalErros: 0 }))).totalErros);
      if (s.autenticado) {
        await Promise.all([carregarPedidos(), carregarProdutos()]);
        if (s.cnpj) void carregarStatusLoja();
      }
    } catch (err) {
      notificar('erro', mensagemDe(err, 'Servidor do ERP indisponível.'));
    } finally {
      setCarregando(false);
    }
  }, [carregarSessao, carregarPedidos, carregarProdutos, carregarStatusLoja, notificar]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Tempo real pelo servidor do ERP, com consulta periodica caso a conexao ao vivo caia
  useEffect(() => {
    if (!sessao?.autenticado) return;
    const es = new EventSource('/erp-simulador/api/stream');
    es.addEventListener('pedidos', (ev) => {
      void carregarPedidos();
      const d = JSON.parse((ev as MessageEvent).data || '{}');
      if (d.novo) {
        if (somRef.current) tocarAlerta();
        notificar('ok', `Pedido novo ${nomeCanal(d.canal)}.`);
      }
      if (d.aviso) notificar('erro', `Pedido #${d.codigo ?? ''}: ${d.aviso}`);
    });
    es.addEventListener('catalogo', () => void carregarProdutos());
    const atualizarSessao = () => void carregarSessao().catch(() => undefined);
    es.addEventListener('conexao', atualizarSessao);
    es.addEventListener('conectado', () => {
      void carregarPedidos();
      void carregarProdutos();
    });
    const t = setInterval(() => {
      atualizarSessao();
      void carregarPedidos();
      void carregarProdutos();
    }, 15_000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, [sessao?.autenticado, carregarSessao, carregarPedidos, carregarProdutos, notificar]);

  const encerrada = !!sessao?.conexaoEncerrada;
  useEffect(() => {
    if (encerrada) setStatusLoja(null);
  }, [encerrada]);

  const novos = pedidos.filter((p) => p.statusKanban === 'NOVO' && p.plataforma !== 'TD').length;
  const urgentes = pedidos.filter((p) => p.pendencias.disputa || p.pendencias.cancelamentoCliente).length;

  // Enquanto houver pedido sem aceite ou solicitacao com prazo curto, o alerta se repete
  useEffect(() => {
    document.title = novos ? `(${novos}) Pedido novo` : 'Gestor Delivery ERP';
    if (!somLigado || encerrada || (!novos && !urgentes)) return;
    const t = setInterval(tocarAlerta, 8000);
    return () => clearInterval(t);
  }, [novos, urgentes, somLigado, encerrada]);

  /** Mesmo fluxo do formulario "Conectar empresa", com os dados ja salvos. So roda no clique. */
  async function reconectar() {
    setAba('lojas');
    if (!sessao?.cnpj) return;
    setReconectando(true);
    try {
      await erpApi.conectarCnpj({ cnpj: sessao.cnpj, nome: sessao.nomeLoja, transporte: sessao.transporte === 'PULL' ? 'PULL' : 'PUSH' });
      notificar('ok', 'Empresa conectada de novo. Confira as lojas vinculadas.');
    } catch (err) {
      notificar('erro', mensagemDe(err, 'Não foi possível conectar.'));
    } finally {
      await carregarSessao().catch(() => undefined);
      setReconectando(false);
    }
  }

  const irPara = (destino: Aba) => (destino !== aba && rascunhoLoja.current ? setAbaPedida(destino) : setAba(destino));
  const mudarRascunho = useCallback((tem: boolean) => {
    rascunhoLoja.current = tem;
  }, []);

  async function sair(limparDados: boolean) {
    setSaindo(false);
    await erpApi.sair(limparDados);
    if (limparDados) setPedidos([]);
    setStatusLoja(null);
    await carregarSessao();
  }

  const avisosFlutuantes = toasts.length ? (
    <div className="toast-bar">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tipo}`}>
          <span style={{ fontSize: 13 }}>{t.msg}</span>
          <div className="linha">
            {t.tipo === 'erro' ? (
              <button type="button" className="btn btn-sm" onClick={() => setLogsAberto(true)}>
                Ver log
              </button>
            ) : null}
            <button type="button" className="btn-icon" title="Fechar aviso" onClick={() => setToasts((c) => c.filter((x) => x.id !== t.id))}>
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  ) : null;
  const logs = logsAberto ? <ModalLogs aoFechar={() => setLogsAberto(false)} aoMudarContagem={setTotalErrosLogs} /> : null;

  if (carregando) {
    return (
      <div className="login-page">
        <div className="card">Carregando sistema...</div>
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
        {logs}
        {avisosFlutuantes}
      </>
    );
  }

  const ativos = pedidos.filter((p) => p.statusKanban !== 'CONCLUIDO' && p.statusKanban !== 'CANCELADO').length;
  const status = { IFOOD: extrairStatusIfood(statusLoja), '99FOOD': extrairStatus99(statusLoja) };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div>
            <div className="brand-title">{sessao.nomeLoja || 'Gestor Delivery ERP'}</div>
            <div className="brand-sub">
              {sessao.cnpj ? `CNPJ ${sessao.cnpj}` : 'Nenhuma empresa conectada'} · {sessao.transporte}
            </div>
          </div>
          <nav className="nav-tabs" aria-label="Navegação principal">
            {ABAS.map(([chave, rotulo]) => (
              <button key={chave} type="button" className={`nav-tab${aba === chave ? ' active' : ''}`} onClick={() => irPara(chave)}>
                {rotulo}
                {chave === 'pedidos' ? <span className={`pill ${novos || urgentes ? 'pill-err' : ''}`}>{ativos}</span> : null}
                {chave === 'catalogo' ? <span className="pill">{produtos.length}</span> : null}
              </button>
            ))}
          </nav>
        </div>

        <div className="topbar-right">
          {sessao.lojas.map((l) => {
            const s = status[l.plataforma as 'IFOOD' | '99FOOD'];
            const aberta = s?.carregado ? s.aberta : l.estado === 'ATIVA';
            return (
              <span key={`${l.plataforma}-${l.loja}`} className={`pill ${aberta ? 'pill-ok' : 'pill-warn'}`} title={l.nome ?? ''}>
                <span className="dot" />
                {nomeCanal(l.plataforma)}: {s?.carregado ? (s.aberta ? 'Aberta' : 'Fechada') : l.estado}
              </span>
            );
          })}
          <button type="button" className={`btn btn-sm ${totalErrosLogs ? 'btn-danger' : ''}`} onClick={() => setLogsAberto(true)}>
            Logs{totalErrosLogs ? ` (${totalErrosLogs} erros)` : ''}
          </button>
          <button type="button" className="btn-icon" title={escuro ? 'Tema claro' : 'Tema escuro'} onClick={() => setEscuro((v) => !v)}>
            <IconeTema escuro={escuro} />
          </button>
          <MenuTresPontos
            titulo="Sessão"
            itens={[
              { rotulo: 'Sair e trocar token', aoClicar: () => void sair(false) },
              { rotulo: 'Sair, desconectar e limpar pedidos', perigo: true, separadorAntes: true, aoClicar: () => setSaindo(true) },
            ]}
          />
        </div>
      </header>

      <main className="main-content">
        {sessao.conexaoEncerrada ? (
          <div className="banner banner-err linha" role="alert" style={{ marginBottom: 16 }}>
            <span style={{ flex: 1, minWidth: 220 }}>
              <strong>Conexão encerrada.</strong> O Hub recusou o token desta conexão (excluída, revogada ou com token trocado). Pedidos e cardápio estão parados.
            </span>
            <button type="button" className="btn btn-sm btn-primary" disabled={reconectando} onClick={() => void reconectar()}>
              {reconectando ? 'Conectando...' : 'Conectar de novo'}
            </button>
          </div>
        ) : null}
        {aba === 'pedidos' ? (
          <KanbanPedidos
            pedidos={pedidos}
            aceiteAutomatico={aceiteAutomatico}
            fila={fila}
            somLigado={somLigado}
            aoAlternarSom={() => {
              liberarAudio();
              setSomLigado((v) => {
                gravarPreferencia('erp-som', v ? 'off' : 'on');
                if (!v) setTimeout(tocarAlerta, 150);
                return !v;
              });
            }}
            notificar={notificar}
            aoRecarregar={carregarPedidos}
            aoAbrirLogs={() => setLogsAberto(true)}
          />
        ) : null}
        {aba === 'catalogo' ? <GestorCatalogo lojas={sessao.lojas} produtos={produtos} notificar={notificar} aoRecarregar={carregarProdutos} aoAbrirLogs={() => setLogsAberto(true)} /> : null}
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
        {aba === 'dados' ? (
          // A chave descarta o que foi lido se a conexao ou as lojas mudarem
          <DadosLoja key={`${sessao.conexaoId}|${sessao.lojas.map((l) => `${l.plataforma}:${l.loja}`).sort().join()}`} sessao={sessao} notificar={notificar} aoAtualizarStatusLoja={carregarStatusLoja} aoMudarRascunho={mudarRascunho} />
        ) : null}
        {aba === 'tokens' ? <TokensRotas notificar={notificar} /> : null}
        {aba === 'docs' ? <PainelDocumentacao sessao={sessao} notificar={notificar} /> : null}
      </main>

      {abaPedida ? (
        <Confirmacao
          titulo="Sair sem enviar?"
          confirmar="Descartar e sair"
          cancelar="Continuar editando"
          aviso=""
          perigo
          aoConfirmar={() => {
            rascunhoLoja.current = false;
            setAba(abaPedida);
            setAbaPedida(null);
          }}
          aoCancelar={() => setAbaPedida(null)}
        >
          <span>As alterações digitadas em "Dados da loja" não foram enviadas.</span>
        </Confirmacao>
      ) : null}
      {saindo ? (
        <Confirmacao titulo="Sair, desconectar e limpar pedidos?" confirmar="Sair e limpar" aviso="Não é possível desfazer." perigo aoConfirmar={() => void sair(true)} aoCancelar={() => setSaindo(false)}>
          <span>Apaga deste ERP os pedidos, os eventos, o CNPJ conectado e os tokens salvos.</span>
        </Confirmacao>
      ) : null}
      {logs}
      {avisosFlutuantes}
    </div>
  );
}
