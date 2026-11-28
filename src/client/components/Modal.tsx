import React, { useEffect, useRef, useState } from 'react';

const abertos: HTMLElement[] = [];
const FOCAVEIS = 'button:not(:disabled), a[href], input:not(:disabled):not([hidden]), select:not(:disabled), textarea:not(:disabled), summary';

/**
 * Fundo comum dos modais. Escape e clique fora valem somente para o de cima; o Tab fica dentro do modal e o foco volta
 * para onde estava ao fechar.
 */
export function Modal({ aoFechar, fundoFecha = true, children }: { aoFechar: () => void; fundoFecha?: boolean; children: React.ReactNode }) {
  const fundo = useRef<HTMLDivElement>(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;
  // Lido antes de o autoFocus do conteudo mudar o foco
  const [anterior] = useState(() => document.activeElement as HTMLElement | null);
  // Selecionar texto e soltar fora do painel nao fecha o modal
  const apertouFora = useRef(false);

  useEffect(() => {
    const el = fundo.current!;
    abertos.push(el);
    document.body.style.overflow = 'hidden';
    if (!el.contains(document.activeElement)) el.focus();
    const tecla = (e: KeyboardEvent) => {
      if (abertos[abertos.length - 1] !== el) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        fechar.current();
      }
      if (e.key !== 'Tab') return;
      const lista = [...el.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((x) => x.offsetParent !== null);
      if (!lista.length) return e.preventDefault();
      const atual = lista.indexOf(document.activeElement as HTMLElement);
      if (atual === -1 || (e.shiftKey ? atual === 0 : atual === lista.length - 1)) {
        e.preventDefault();
        lista[e.shiftKey ? lista.length - 1 : 0].focus();
      }
    };
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      abertos.splice(abertos.indexOf(el), 1);
      if (!abertos.length) document.body.style.overflow = '';
      anterior?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      ref={fundo}
      tabIndex={-1}
      onMouseDown={(e) => (apertouFora.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (fundoFecha && apertouFora.current && e.target === e.currentTarget) fechar.current();
      }}
    >
      {children}
    </div>
  );
}
