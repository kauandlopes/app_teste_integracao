import React, { useEffect, useState } from 'react';

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

/** Confirmacao antes de qualquer mudanca que vale na loja real. */
export function Confirmacao({
  titulo,
  confirmar,
  perigo,
  ocupado,
  aoConfirmar,
  aoCancelar,
  children,
}: {
  titulo: string;
  confirmar: string;
  perigo?: boolean;
  ocupado?: boolean;
  aoConfirmar: () => void;
  aoCancelar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label={titulo} style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h2 style={{ margin: 0, fontSize: 16 }}>{titulo}</h2>
        </div>
        <div className="modal-body">
          {children}
          <div className="banner banner-warn">A mudança vale na loja real e tem efeito imediato.</div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" autoFocus disabled={ocupado} onClick={aoCancelar}>
            Cancelar
          </button>
          <button type="button" className={`btn ${perigo ? 'btn-danger' : 'btn-primary'}`} disabled={ocupado} onClick={aoConfirmar}>
            {ocupado ? 'Enviando...' : confirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
