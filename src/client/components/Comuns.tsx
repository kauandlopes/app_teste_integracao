import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

/** Segundos que faltam, atualizados a cada segundo. `segundos` vem do servidor a cada leitura. */
export function Contagem({ segundos, antes, depois = '' }: { segundos: number; antes: string; depois?: string }) {
  const [resta, setResta] = useState(segundos);
  useEffect(() => {
    const ate = Date.now() + segundos * 1000;
    setResta(segundos);
    const t = setInterval(() => setResta(Math.max(0, Math.ceil((ate - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [segundos]);
  return <>{resta > 0 ? `${antes} ${resta}s` : depois}</>;
}

/** Confirmacao antes de qualquer mudanca que vale na loja real. Escape cancela. */
export function Confirmacao({
  titulo,
  confirmar,
  cancelar = 'Cancelar',
  aviso = 'A mudança vale na loja real e tem efeito imediato.',
  perigo,
  ocupado,
  outra,
  aoConfirmar,
  aoCancelar,
  children,
}: {
  titulo: string;
  confirmar: string;
  cancelar?: string;
  /** Vazio quando a acao nao mexe na loja. */
  aviso?: string;
  perigo?: boolean;
  ocupado?: boolean;
  /** Segunda forma de concluir, quando ha duas. */
  outra?: { rotulo: string; aoClicar: () => void };
  aoConfirmar: () => void;
  aoCancelar: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal fundoFecha={false} aoFechar={() => !ocupado && aoCancelar()}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label={titulo} style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h2 style={{ margin: 0, fontSize: 16 }}>{titulo}</h2>
        </div>
        <div className="modal-body">
          {children}
          {aviso ? <div className="banner banner-warn">{aviso}</div> : null}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" autoFocus disabled={ocupado} onClick={aoCancelar}>
            {cancelar}
          </button>
          {outra ? (
            <button type="button" className="btn" disabled={ocupado} onClick={outra.aoClicar}>
              {outra.rotulo}
            </button>
          ) : null}
          <button type="button" className={`btn ${perigo ? 'btn-danger' : 'btn-primary'}`} disabled={ocupado} onClick={aoConfirmar}>
            {ocupado ? 'Enviando...' : confirmar}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export interface PedidoDeConfirmacao {
  titulo: string;
  confirmar: string;
  aviso?: string;
  perigo?: boolean;
  conteudo: React.ReactNode;
  /** Trata os proprios erros: o dialogo fecha quando termina. */
  acao: () => unknown;
  outra?: { rotulo: string; acao: () => unknown };
}

/** Uma confirmacao por vez, sem duplo envio. Renderize `dialogo` fora de qualquer formulario. */
export function useConfirmar() {
  const [pedido, setPedido] = useState<PedidoDeConfirmacao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const enviando = useRef(false);
  async function concluir(acao: () => unknown) {
    if (enviando.current) return;
    enviando.current = true;
    setOcupado(true);
    try {
      await acao();
    } finally {
      enviando.current = false;
      setOcupado(false);
      setPedido(null);
    }
  }
  const outra = pedido?.outra;
  const dialogo = pedido ? (
    <Confirmacao
      titulo={pedido.titulo}
      confirmar={pedido.confirmar}
      aviso={pedido.aviso}
      perigo={pedido.perigo}
      ocupado={ocupado}
      outra={outra ? { rotulo: outra.rotulo, aoClicar: () => void concluir(outra.acao) } : undefined}
      aoConfirmar={() => void concluir(pedido.acao)}
      aoCancelar={() => setPedido(null)}
    >
      {pedido.conteudo}
    </Confirmacao>
  ) : null;
  return { pedir: setPedido, dialogo };
}

/** O navegador pergunta antes de recarregar ou fechar a pagina com algo digitado. */
export function useAvisoDeSaida(alterado: boolean) {
  useEffect(() => {
    if (!alterado) return;
    const segurar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', segurar);
    return () => window.removeEventListener('beforeunload', segurar);
  }, [alterado]);
}

/** Protege o que foi digitado: fechar o formulario ou a pagina com alteracoes pede confirmacao. */
export function useDescarte(alterado: boolean, aoFechar: () => void) {
  const [perguntando, setPerguntando] = useState(false);
  useAvisoDeSaida(alterado);
  return {
    fechar: () => (alterado ? setPerguntando(true) : aoFechar()),
    pergunta: perguntando ? (
      <Confirmacao titulo="Descartar o que foi digitado?" confirmar="Descartar" cancelar="Continuar editando" aviso="" perigo aoConfirmar={aoFechar} aoCancelar={() => setPerguntando(false)}>
        <span>As alterações ainda não foram salvas.</span>
      </Confirmacao>
    ) : null,
  };
}

/** Valor atual e novo, lado a lado. */
export function Mudanca({ rotulo, de, para }: { rotulo: string; de: string; para: string }) {
  return (
    <div className="mudanca">
      <span className="field-label">{rotulo}</span>
      <span>
        <span className="suave">{de}</span> → <strong>{para}</strong>
      </span>
    </div>
  );
}
