import React, { useState } from 'react';
import codigo from '../../shared/exemplos/integracao-minima.ts?raw';
import noventaENove from '../../shared/exemplos/pedido-99food.json';
import ifood from '../../shared/exemplos/pedido-ifood.json';

/**
 * Dois pedidos reais das lojas de teste (28/11/2026), do webhook ao fim, e o codigo minimo para consumi-los.
 * Os JSONs sao as mensagens trocadas com o Hub; so dados pessoais, codigos e assinatura foram substituidos.
 */
interface Passo {
  em: string;
  tipo: string;
  rota: string;
  cabecalhos?: unknown;
  corpo?: any;
  resposta: unknown;
  ms: number;
}

const EXEMPLOS = [
  {
    chave: 'ifood',
    titulo: 'iFood, entrega própria com código',
    dados: ifood,
    observacoes: [
      'O PLACED traz só os identificadores: o pedido vem da consulta com formato=unificado.',
      'Cada ação responde 202 (recebido). A etapa muda quando o evento correspondente chega.',
      'DELIVERY_DROP_CODE_REQUESTED: peça o código ao cliente e envie verifyDeliveryCode.',
      'Neste registro o conclude respondeu localOnly e o iFood concluiu 30 minutos depois. Hoje o Hub não conclui sem o código: responde 422.',
      'Dois cartões em pagamentos; a taxa de serviço (1,00) vem em ajustes, fora do subtotal.',
    ],
  },
  {
    chave: '99food',
    titulo: '99Food, entrega própria com pizza, combo e adicionais',
    dados: noventaENove,
    observacoes: [
      'O orderNew já traz o pedido inteiro, em centavos. A consulta unificada devolve em reais.',
      'order_id tem 19 dígitos: trate sempre como texto.',
      'O preço do item inclui os adicionais (Thor Burger 56,90 = 42,90 + 2 x 5,00 + 4,00).',
      'Aceite em até 5 minutos. Aqui o confirm saiu pouco mais de 3 minutos depois da chegada.',
      'Neste pedido chegaram só orderNew e orderConfirm: o ERP aplicou pronto, saída e conclusão pela resposta errno 0. Em outro teste, concluindo sem despachar, o orderFinish chegou cerca de 2 minutos depois.',
      'Entrega própria: dispatch exige nome e telefone do entregador.',
    ],
  },
] as const;

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR');
const json = (v: unknown) => JSON.stringify(v, null, 2);

function Bloco({ titulo, texto, copiar }: { titulo: string; texto: string; copiar: (t: string) => void }) {
  return (
    <details>
      <summary style={{ cursor: 'pointer', minHeight: 32 }}>{titulo}</summary>
      <button type="button" className="btn btn-sm" onClick={() => copiar(texto)}>
        Copiar
      </button>
      <pre className="code-block" style={{ maxHeight: 420, overflow: 'auto' }}>
        {texto}
      </pre>
    </details>
  );
}

export function PedidosReais({ copiar }: { copiar: (texto: string, rotulo: string) => void }) {
  const [chave, setChave] = useState<(typeof EXEMPLOS)[number]['chave']>('ifood');
  const exemplo = EXEMPLOS.find((e) => e.chave === chave)!;
  const passos = exemplo.dados.passos as Passo[];
  const inicio = new Date(passos[0].em).getTime();
  const copiarBloco = (t: string) => copiar(t, 'Exemplo');

  return (
    <div className="pilha">
      <div className="card pilha">
        <div className="linha">
          {EXEMPLOS.map((e) => (
            <button key={e.chave} type="button" className={`btn btn-sm ${chave === e.chave ? 'btn-primary' : ''}`} style={{ whiteSpace: 'normal', textAlign: 'left' }} onClick={() => setChave(e.chave)}>
              {e.titulo}
            </button>
          ))}
        </div>
        <span className="suave">{exemplo.dados.origem}</span>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.6 }}>
          {exemplo.observacoes.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
        <Bloco titulo="Pedido no formato unificado (resposta da consulta)" texto={json(exemplo.dados.detalheUnificado)} copiar={copiarBloco} />
        {passos.map((p, i) => (
          <Bloco
            key={`${chave}-${i}`}
            titulo={`${i + 1}. ${hora(p.em)} (+${Math.round((new Date(p.em).getTime() - inicio) / 1000)} s) ${p.tipo === 'webhook' ? `Webhook ${p.corpo?.fullCode ?? p.corpo?.type}` : p.tipo === 'acao' ? `Ação ${p.corpo?.acao}` : 'Consulta do pedido'} · ${p.ms} ms`}
            texto={json({ rota: p.rota, cabecalhos: p.cabecalhos, corpo: p.corpo, resposta: p.resposta })}
            copiar={copiarBloco}
          />
        ))}
      </div>
      <div className="card pilha">
        <strong>Código mínimo para consumir (Node, sem framework)</strong>
        <Bloco titulo="src/shared/exemplos/integracao-minima.ts" texto={codigo} copiar={copiarBloco} />
      </div>
    </div>
  );
}
