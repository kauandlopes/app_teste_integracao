import React, { useEffect, useRef, useState } from 'react';
import { IconeTresPontos } from './Icones';

export interface ItemMenu {
  rotulo: string;
  badge?: string | number;
  perigo?: boolean;
  separadorAntes?: boolean;
  aoClicar: () => void;
}

export function MenuTresPontos({
  itens,
  titulo = 'Mais opções',
  temAlerta = false,
  compacto = false,
}: {
  itens: ItemMenu[];
  titulo?: string;
  temAlerta?: boolean;
  compacto?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, [aberto]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="btn-icon"
        title={titulo}
        aria-label={titulo}
        aria-expanded={aberto}
        style={{
          minWidth: compacto ? 30 : 36,
          minHeight: compacto ? 30 : 36,
          position: 'relative',
        }}
        onClick={(e) => {
          e.stopPropagation();
          setAberto((v) => !v);
        }}
      >
        <IconeTresPontos size={compacto ? 15 : 18} />
        {temAlerta ? (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--err)',
            }}
          />
        ) : null}
      </button>

      {aberto ? (
        <div className="menu-popover" role="menu">
          {itens.map((it, idx) => (
            <React.Fragment key={`${it.rotulo}-${idx}`}>
              {it.separadorAntes ? <div className="menu-sep" /> : null}
              <button
                type="button"
                role="menuitem"
                className={`menu-item${it.perigo ? ' danger' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setAberto(false);
                  it.aoClicar();
                }}
              >
                <span>{it.rotulo}</span>
                {it.badge !== undefined ? <span className="pill">{it.badge}</span> : null}
              </button>
            </React.Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
