import React from 'react';

/** Aba Documentacao: por que a 99Food demora mais que o iFood. */
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
