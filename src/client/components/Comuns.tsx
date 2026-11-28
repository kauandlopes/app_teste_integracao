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

/** Deixa na propria tela por que a 99Food demora mais que o iFood. */
export function PublicacaoNas99({ aberto }: { aberto?: boolean }) {
  return (
    <details className="card" open={aberto} style={{ fontSize: 13, lineHeight: 1.6 }}>
      <summary style={{ cursor: 'pointer', minHeight: 24 }}>
        <strong>O iFood publica em segundos. A 99Food pode levar de poucos segundos a alguns minutos.</strong> Ver como funciona
      </summary>
      <p>A 99Food não recebe um produto sozinho: o Hub lê o cardápio da loja, junta o produto e envia o cardápio inteiro.</p>
      <p>Limites da 99Food por loja: ler o cardápio 2 vezes a cada 2 minutos, enviar 1 vez por minuto e receber 5 fotos a cada 10 segundos.</p>
      <p><strong>O limite de 1 envio por minuto não é 1 produto por minuto:</strong> tudo o que está na fila vai no mesmo envio.</p>
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
            <td>cerca de 10 segundos</td>
          </tr>
          <tr>
            <td>Houve envio ou leitura há pouco</td>
            <td>cerca de 1 a 2 minutos de espera</td>
          </tr>
          <tr>
            <td>120 produtos de uma vez (teste de 28/11)</td>
            <td>cerca de 1 min 30 s; com 120 fotos diferentes, no mínimo 4 min pelo limite de fotos</td>
          </tr>
          <tr>
            <td>Processamento dentro da 99Food</td>
            <td>em geral menos de 10 segundos; já levou perto de 3 minutos</td>
          </tr>
        </tbody>
      </table>
      <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
        <li>O sistema envia até 4 produtos ao mesmo tempo; a fila do Hub espera poucos segundos para juntar a rajada.</li>
        <li>A mesma foto não é enviada de novo à 99Food.</li>
        <li>Não repita "Reenviar" enquanto o produto estiver processando ou na fila.</li>
        <li>Atualizar "Nas plataformas" ou carregar as categorias no cadastro gasta a cota de leitura e pode atrasar a publicação.</li>
        <li>Pausar e reativar item publicado costuma valer na hora. Preço e cadastro dependem do envio do cardápio.</li>
        <li>Mudança feita no painel da 99Food em outros itens é mantida. No produto reenviado vale o cadastro do ERP.</li>
        <li>Item apagado no painel não avisa o ERP: use "Reenviar" para publicar de novo.</li>
        <li>A 99Food não aceita cardápio vazio: o último item fica pausado.</li>
        <li>Foto nova só aparece depois da análise da 99Food, que pode demorar ou recusar (montagem, colagem, bordas, imagem que não é do produto). Confira no portal dela.</li>
      </ul>
    </details>
  );
}
