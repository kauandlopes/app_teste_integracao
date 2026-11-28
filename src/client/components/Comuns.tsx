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

/** Deixa na propria tela por que a 99Food demora mais que o iFood. */
export function PublicacaoNas99({ aberto }: { aberto?: boolean }) {
  return (
    <details className="card" open={aberto} style={{ fontSize: 13, lineHeight: 1.6 }}>
      <summary style={{ cursor: 'pointer', minHeight: 24 }}>
        <strong>O iFood publica em segundos. A 99Food pode levar de poucos segundos a alguns minutos.</strong> Ver como funciona
      </summary>
      <p>A 99Food não recebe um produto sozinho: o Hub lê o cardápio da loja, junta o produto e envia o cardápio inteiro.</p>
      <p>Limites da 99Food por loja: ler o cardápio 2 vezes a cada 2 minutos e enviar 1 vez por minuto.</p>
      <table className="item-table">
        <thead>
          <tr>
            <th>Situação</th>
            <th>Tempo observado</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Limites livres</td>
            <td>poucos segundos</td>
          </tr>
          <tr>
            <td>Houve envio ou leitura há pouco</td>
            <td>cerca de 1 a 2 minutos de espera</td>
          </tr>
          <tr>
            <td>Processamento dentro da 99Food</td>
            <td>em geral menos de 10 segundos; já levou perto de 3 minutos</td>
          </tr>
        </tbody>
      </table>
      <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
        <li>Produtos enviados em sequência saem juntos em um dos próximos envios.</li>
        <li>Não repita "Reenviar" enquanto o produto estiver processando ou na fila.</li>
        <li>Atualizar "Nas plataformas" ou carregar as categorias no cadastro gasta a cota de leitura e pode atrasar a publicação.</li>
        <li>Pausar e reativar item publicado costuma valer na hora. Preço e cadastro dependem do envio do cardápio.</li>
        <li>Mudança feita no painel da 99Food em outros itens é mantida. No produto reenviado vale o cadastro do ERP.</li>
        <li>Item apagado no painel não avisa o ERP: use "Reenviar" para publicar de novo.</li>
        <li>A 99Food não aceita cardápio vazio: o último item fica pausado.</li>
        <li>A foto aparece depois da análise da 99Food, que recusa montagem, colagem e bordas. Use foto real do produto.</li>
      </ul>
    </details>
  );
}
