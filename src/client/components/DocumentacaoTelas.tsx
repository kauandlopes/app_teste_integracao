import React from 'react';
import { ERROS, TELAS } from '../../shared/telas';

const Lista = ({ itens }: { itens: string[] }) => (
  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.6 }}>
    {itens.map((i) => (
      <li key={i}>{i}</li>
    ))}
  </ul>
);

export function Telas() {
  return (
    <div className="pilha">
      <div className="card">
        <strong>Sistema de exemplo para desenvolvimento e testes.</strong>
        <span className="suave"> As telas mostram o necessário para operar; a explicação está aqui e o detalhe técnico, em Logs.</span>
      </div>
      {TELAS.map((t) => (
        <details className="card" key={t.tela}>
          <summary style={{ cursor: 'pointer', minHeight: 32 }}>
            <strong>{t.tela}</strong>
          </summary>
          <div className="pilha">
            <Lista itens={t.funciona} />
            {t.avisos ? (
              <>
                <span className="field-label">Avisos que ficam na tela</span>
                <Lista itens={t.avisos} />
              </>
            ) : null}
            <span className="suave">Código e rotas: {t.codigo.join(' · ')}</span>
          </div>
        </details>
      ))}
      <div className="card" style={{ overflowX: 'auto' }}>
        <strong>Erros que o ERP precisa tratar</strong>
        <table className="item-table">
          <tbody>
            {ERROS.map(([codigo, fazer]) => (
              <tr key={codigo}>
                <td>
                  <code>{codigo}</code>
                </td>
                <td>{fazer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
