import React, { useState } from 'react';
import { ApiErro, erpApi, pedeConfirmacaoDeTroca } from '../api';
import { useConfirmar } from './Comuns';
import { IconeOlho } from './Icones';
import { MenuTresPontos } from './MenuTresPontos';

export function TelaEntrada({
  baseUrlInicial,
  totalErros,
  escuro,
  aoAlternarTema,
  aoAbrirLogs,
  aoEntrar,
}: {
  baseUrlInicial: string;
  totalErros: number;
  escuro: boolean;
  aoAlternarTema: () => void;
  aoAbrirLogs: () => void;
  aoEntrar: () => void;
}) {
  // Token fixo apenas para agilizar testes locais/homologacao (trocar/revogar este token depois por seguranca)
  const [token, setToken] = useState('hubp_1fb7c38c-a62e-4c3e-831c-85390f64639b_6Y8VetE84mkkx2cKw-BnhlH03PeAvKVmUoIID8wPEEc');
  const [baseUrl, setBaseUrl] = useState(baseUrlInicial || 'https://delivery.targetx.com.br/api/v1');
  const [mostrarToken, setMostrarToken] = useState(false);
  const [mostrarServidor, setMostrarServidor] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { pedir, dialogo } = useConfirmar();

  async function enviar(e?: React.FormEvent, confirmarTroca = false): Promise<void> {
    e?.preventDefault();
    if (!token.trim()) {
      setErro('Informe o token da integração para acessar.');
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      await erpApi.entrar(baseUrl.trim(), token.trim(), confirmarTroca);
      aoEntrar();
    } catch (err) {
      if (pedeConfirmacaoDeTroca(err)) {
        return pedir({
          titulo: 'Entrar com outro integrador?',
          confirmar: 'Trocar e arquivar pedidos',
          aviso: err.message,
          perigo: true,
          conteudo: <span>O token informado é de outro integrador. A conexão salva neste ERP será desfeita.</span>,
          acao: () => enviar(undefined, true),
        });
      }
      setErro(err instanceof ApiErro ? err.message : 'Falha ao conectar no servidor.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="login-page">
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <MenuTresPontos
          titulo="Opções técnicas e logs"
          temAlerta={totalErros > 0}
          itens={[
            {
              rotulo: mostrarServidor ? 'Ocultar endereço do servidor' : 'Configurar endereço da API',
              aoClicar: () => setMostrarServidor((v) => !v),
            },
            {
              rotulo: 'Logs HTTP e Erros SQLite',
              badge: totalErros > 0 ? totalErros : undefined,
              aoClicar: aoAbrirLogs,
            },
            {
              rotulo: escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro',
              separadorAntes: true,
              aoClicar: aoAlternarTema,
            },
          ]}
        />
      </div>

      <form className="login-card" onSubmit={enviar}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Gestor Delivery ERP</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Acesse com o token do integrador para gerenciar pedidos e cardápio da loja.
          </p>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="token-integracao">
            Token de acesso (Integrador)
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              id="token-integracao"
              type={mostrarToken ? 'text' : 'password'}
              className="input"
              placeholder="Cole seu token aqui"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
              autoComplete="off"
            />
            <button
              type="button"
              className="btn-icon"
              style={{ minWidth: 40, minHeight: 40 }}
              title={mostrarToken ? 'Ocultar token' : 'Mostrar token'}
              onClick={() => setMostrarToken((v) => !v)}
            >
              <IconeOlho aberto={mostrarToken} />
            </button>
          </div>
        </div>

        {mostrarServidor ? (
          <div className="field">
            <label className="field-label" htmlFor="base-url">
              URL Base da API
            </label>
            <input
              id="base-url"
              type="url"
              className="input input-sm"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
        ) : null}

        {erro ? (
          <div className="pill pill-err" style={{ borderRadius: 6, padding: '8px 10px', whiteSpace: 'normal' }}>
            {erro}
          </div>
        ) : null}

        <button type="submit" className="btn btn-primary" disabled={carregando}>
          {carregando ? 'Validando acesso...' : 'Entrar no sistema'}
        </button>
      </form>
      {dialogo}
    </div>
  );
}
