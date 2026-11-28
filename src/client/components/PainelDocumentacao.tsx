import React, { useState } from 'react';
import { Sessao } from '../api';
import { PublicacaoNas99 } from './Comuns';

export function PainelDocumentacao({
  sessao,
  notificar,
}: {
  sessao: Sessao;
  notificar: (tipo: 'ok' | 'erro', msg: string) => void;
}) {
  const [subAba, setSubAba] = useState<'webhook' | 'pedidos' | 'cardapio' | 'generica' | 'variaveis'>('webhook');

  const baseUrl = sessao.baseUrl || 'https://delivery.targetx.com.br/api/v1';
  const rotaWebhookAppTeste = 'https://delivery.targetx.com.br/erp-simulador/api/webhook';
  const rotaWebhookAtual = sessao.webhookUrl || rotaWebhookAppTeste;

  function copiar(texto: string, rotulo: string) {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(texto).then(
        () => notificar('ok', `${rotulo} copiado para a área de transferência.`),
        () => notificar('erro', 'Não foi possível copiar automaticamente.'),
      );
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Documentação Oficial de Integração do ERP</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Rota de webhook, algoritmo exato de coleta/recebimento de pedidos, contrato genérico multi-canal e isolamento de credenciais.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm${subAba === 'webhook' ? ' btn-primary' : ''}`}
              onClick={() => setSubAba('webhook')}
            >
              1. Rota Webhook PUSH & Túnel
            </button>
            <button
              type="button"
              className={`btn btn-sm${subAba === 'pedidos' ? ' btn-primary' : ''}`}
              onClick={() => setSubAba('pedidos')}
            >
              2. Como Puxar Pedidos
            </button>
            <button
              type="button"
              className={`btn btn-sm${subAba === 'cardapio' ? ' btn-primary' : ''}`}
              onClick={() => setSubAba('cardapio')}
            >
              3. Cardápio
            </button>
            <button
              type="button"
              className={`btn btn-sm${subAba === 'generica' ? ' btn-primary' : ''}`}
              onClick={() => setSubAba('generica')}
            >
              4. API Genérica (Futuras)
            </button>
            <button
              type="button"
              className={`btn btn-sm${subAba === 'variaveis' ? ' btn-primary' : ''}`}
              onClick={() => setSubAba('variaveis')}
            >
              5. Variáveis e Segurança
            </button>
          </div>
        </div>
      </div>

      {subAba === 'webhook' ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Rota de Webhook que o ERP precisa expor e informar no Hub</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Rota configurada nesta sessão (Túnel / HTTPS)</div>
              <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>{rotaWebhookAtual}</div>
              <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => copiar(rotaWebhookAtual, 'URL de webhook')}>
                Copiar URL
              </button>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Como funciona em produção (ERP em múltiplas máquinas)</div>
              <div style={{ marginTop: 4, fontSize: 13 }}>
                No seu ERP real, cada máquina/cliente informa sua própria URL HTTPS em <code>webhook.url</code> ao chamar{' '}
                <code>POST {baseUrl}/hub/v1/integracao/conectar</code> (ex.: <code>https://tunel-loja-01.seuerp.com.br/webhook</code>). O Target Delivery
                passa a entregar os eventos nessa rota em tempo real com assinatura HMAC SHA-256.
              </div>
            </div>
          </div>

          <div style={{ fontSize: 13 }}>
            <strong>Cabeçalhos enviados pelo Hub em todo POST no seu Webhook:</strong>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="item-table">
              <thead>
                <tr>
                  <th>Header</th>
                  <th>Exemplo</th>
                  <th>Função no receptor do ERP</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>X-Target-Assinatura</code></td>
                  <td><code>v1=9f8e7d...</code></td>
                  <td>HMAC SHA-256 calculado sobre <code>{"${timestamp}.${notificacaoId}.${rawBody}"}</code> usando <code>webhookSegredo</code>.</td>
                </tr>
                <tr>
                  <td><code>X-Target-Timestamp</code></td>
                  <td><code>1764245000</code></td>
                  <td>Timestamp Unix enviado na assinatura para proteção contra replay.</td>
                </tr>
                <tr>
                  <td><code>X-Target-Notificacao</code></td>
                  <td><code>c079afaf-2c4a-...</code></td>
                  <td>UUID único da entrega PUSH. Salve para deduplicar caso o Hub reenvie em falha de rede.</td>
                </tr>
                <tr>
                  <td><code>X-Target-Plataforma</code></td>
                  <td><code>IFOOD</code> / <code>99FOOD</code> / futuro</td>
                  <td>Canal de origem da notificação.</td>
                </tr>
                <tr>
                  <td><code>X-Target-Tipo</code></td>
                  <td><code>PLACED</code>, <code>CANCELLED</code>, etc.</td>
                  <td>Evento recebido da plataforma.</td>
                </tr>
                <tr>
                  <td><code>X-Target-Pedido</code></td>
                  <td><code>simhub-...</code> ou ID real</td>
                  <td>Identificador único do pedido para consulta de detalhe se necessário.</td>
                </tr>
                <tr>
                  <td><code>X-Target-Seq</code></td>
                  <td><code>12</code></td>
                  <td>Sequência monotônica do evento dentro da conexão.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <pre style={{ margin: 0, padding: 12, borderRadius: 6, border: '1px solid var(--border)', overflowX: 'auto', fontSize: 12 }}>
{`// Validação obrigatória no POST /webhook do ERP (Node.js / TypeScript)
const rawBody = req.rawBody.toString('utf8'); // corpo bruto exato antes de JSON.parse
const ts = String(req.headers['x-target-timestamp'] ?? '');
const nid = String(req.headers['x-target-notificacao'] ?? '');
const assinatura = String(req.headers['x-target-assinatura'] ?? '');

const esperado = 'v1=' + crypto
  .createHmac('sha256', webhookSegredo)
  .update(\`\${ts}.\${nid}.\${rawBody}\`)
  .digest('hex');

// Comparar sempre em tempo constante (crypto.timingSafeEqual); se falhar -> HTTP 401`}
          </pre>
        </div>
      ) : null}

      {subAba === 'pedidos' ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Fluxo exato: como o ERP puxa e grava pedidos</h3>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
            <li>
              <strong>Amarra a loja 1x:</strong> backend do ERP envia <code>POST {baseUrl}/hub/v1/integracao/conectar</code> com <code>Authorization: Bearer hubp_...</code>,{' '}
              <code>cnpj</code>, <code>transporte: "PUSH"</code>, <code>webhook: {"{ url }"}</code> e <code>plataformas: ["IFOOD", "99FOOD"]</code>. Persiste no banco do ERP{' '}
              <code>conexaoId</code>, <code>tokenConexao (hubi_...)</code> e <code>webhookSegredo</code>. Se vier loja disponível, vincula em{' '}
              <code>POST /hub/v1/conexao/lojas</code>.
            </li>
            <li>
              <strong>Recebe no seu Webhook:</strong> valida <code>X-Target-Assinatura</code> com <code>webhookSegredo</code>, <strong>grava o evento</strong> (deduplicando por{' '}
              <code>X-Target-Evento</code>) e só então responde HTTP 200.
            </li>
            <li>
              <strong>Obtém o pedido completo normalizado:</strong> se <code>body.pedido</code> já vier no formato unificado (ex.: eventos enriquecidos/avaliação), usa direto; caso contrário
              consulta usando o <code>hubi_</code> da loja:
              <pre style={{ margin: '6px 0', padding: 10, borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, overflowX: 'auto' }}>
{`GET ${baseUrl}/hub/v1/conexao/pedidos/{pedidoId}?plataforma={IFOOD|99FOOD}&formato=unificado
Authorization: Bearer {tokenConexao_hubi}`}
              </pre>
            </li>
            <li>
              <strong>Processa a fila:</strong> aplica a etapa sem nunca voltar (evento atrasado não rebaixa o pedido; cancelado vence), avisa a tela na hora e, se a leitura do pedido
              falhar, tenta de novo sem apagar o que já tem.
            </li>
            <li>
              <strong>Contingência e reconciliação:</strong> ao iniciar ou após queda de internet, o ERP pode puxar pedidos históricos/perdidos com:
              <pre style={{ margin: '6px 0', padding: 10, borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, overflowX: 'auto' }}>
{`GET ${baseUrl}/hub/v1/conexao/pedidos?limite=30    # pedidos recebidos via Hub e seus eventos`}
              </pre>
            </li>
          </ol>

          <div style={{ fontSize: 13 }}>
            <strong>Campos garantidos no JSON unificado (mesmo esquema para iFood, 99Food e futuras integrações):</strong>
          </div>
          <pre style={{ margin: 0, padding: 12, borderRadius: 6, border: '1px solid var(--border)', overflowX: 'auto', fontSize: 12 }}>
{`{
  "id": "uuid-ou-order_id",
  "codigoExibicao": "4821",
  "canal": "IFOOD" | "99FOOD" | "TD" | "<FUTURO_CANAL>",
  "statusKanban": "NOVO" | "PREPARO" | "PRONTO" | "ENTREGA" | "CONCLUIDO" | "CANCELADO",
  "etapaOriginal": "PLACED | CONFIRMED | READY_TO_PICKUP | DISPATCHED | CONCLUDED | CANCELLED | CANCELLATION_REQUESTED",
  "tipoEntrega": "DELIVERY" | "RETIRADA",
  "entreguePor": "MERCHANT" | "IFOOD" | "PLATFORM" | "CUSTOMER" | null,
  "cliente": { "nome", "telefone", "documento", "telefoneVirtual", "localizador" },
  "enderecoEntrega": { "formatado", "logradouro", "numero", "complemento", "bairro", "cidade", "uf", "cep", "referencia" },
  "valores": { "moeda": "BRL", "subtotal": 76.8, "taxaEntrega": 7.0, "total": 83.8, "trocoPara": null },
  "pagamento": { "forma": "CREDIT", "pagoOnline": true },
  "itens": [{ "id", "nome", "quantidade", "precoUnitario", "precoTotal", "observacao", "codigoExterno", "modificadores": [] }],
  "solicitacaoCancelamento": { "pendente": true, "disputeId": "...", "motivo": "..." }
}`}
          </pre>
        </div>
      ) : null}

      {subAba === 'pedidos' ? (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="item-table">
            <thead>
              <tr>
                <th>Modalidade</th>
                <th>Ações iFood</th>
                <th>Ações 99Food</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Entrega própria</td>
                <td><code>confirm, startPreparation, readyToPickup, dispatch, conclude, updateCourier</code></td>
                <td><code>confirm, readyToPickup, dispatch (com entregador), conclude, updateCourier</code></td>
              </tr>
              <tr>
                <td>Entrega da plataforma</td>
                <td><code>confirm, startPreparation, validatePickupCode</code></td>
                <td><code>confirm, readyToPickup, payConfirm</code></td>
              </tr>
              <tr>
                <td>Retirada ou mesa</td>
                <td><code>confirm, startPreparation, readyToPickup, conclude</code></td>
                <td><code>confirm, readyToPickup, pickedUp</code></td>
              </tr>
              <tr>
                <td>Solicitações</td>
                <td>Disputa: <code>acceptCancellation / denyCancellation</code> com <code>disputeId</code></td>
                <td>Cancelamento: <code>applyId</code>. Reembolso: <code>acceptRefund / denyRefund</code></td>
              </tr>
              <tr>
                <td>Cancelar pela loja</td>
                <td><code>requestCancellation</code> com <code>cancellationCode</code>; aguarda a confirmação da plataforma</td>
                <td><code>requestCancellation</code> com <code>reason_id</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {subAba === 'cardapio' ? (
        <>
        <PublicacaoNas99 aberto />
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Um cadastro no ERP, publicado no iFood e na 99Food</h3>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
            <li>Criar ou editar: <code>POST /hub/v1/conexao/catalogo/produtos</code> com a definição completa (adicionais e pizza), um produto por vez.</li>
            <li>Preço e pausa: <code>PATCH .../produtos/:codigo</code> e <code>.../opcoes/:opcao</code>. Preço de pizza republica o produto.</li>
            <li>Envie sempre <code>codigo</code> em tudo, <code>disponivel</code> e a lista completa de <code>grupos</code>.</li>
            <li>A 99Food responde <code>PROCESSANDO</code>: consulte <code>GET .../produtos/:codigo</code> até mudar.</li>
            <li>Falha temporária (limite de frequência, 5xx) volta para a fila; recusa definitiva aparece no produto com a mensagem da plataforma.</li>
          </ol>
          <pre style={{ margin: 0, padding: 12, borderRadius: 6, border: '1px solid var(--border)', overflowX: 'auto', fontSize: 12 }}>
{`{
  "codigo": "PIZZA", "nome": "Pizza", "categoria": "Pizzas", "tipo": "PIZZA", "disponivel": true,
  "pizza": {
    "tamanhos": [{ "codigo": "G", "nome": "Grande", "preco": 60, "pedacos": 8, "maxSabores": 2 }],
    "sabores":  [{ "codigo": "CAL", "nome": "Calabresa", "acrescimo": 0 }],
    "massas":   [{ "codigo": "TRAD", "nome": "Tradicional", "preco": 0 }],
    "bordas":   [{ "codigo": "CAT", "nome": "Catupiry", "preco": 8 }],
    "bordaObrigatoria": false
  },
  "grupos": [{ "codigo": "BEB", "nome": "Bebida", "min": 0, "max": 1,
    "opcoes": [{ "codigo": "COCA", "nome": "Coca-Cola", "preco": 8, "disponivel": true }] }]
}`}
          </pre>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>Preço por plataforma (opcional):</strong> <code>preco</code> é o padrão. Envie <code>precosPlataforma</code> somente com as chaves preenchidas (
            <code>IFOOD</code>, <code>99FOOD</code>, <code>AIQFOME</code>, <code>KEETA</code>) em produto, adicional, tamanho, sabor, massa ou borda.
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>Pizza no iFood:</strong> por padrão entra como item na categoria enviada; <code>formatoIfood: "PIZZA"</code> publica a pizza nativa em seção própria.
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>Combo:</strong> <code>tipo: "COMBO"</code>, preço no produto e um grupo por etapa (o primeiro é o principal).
          </p>
          <p className="suave" style={{ margin: 0 }}>
            <strong>Categoria é obrigatória:</strong> se não existir em uma plataforma, o Hub cria ao publicar. <code>GET /hub/v1/conexao/catalogo/categorias</code> mostra onde cada uma existe (na 99Food, a consulta gasta a cota de leitura);{' '}
            <code>POST</code> na mesma rota, sem <code>?plataforma</code>, cria nas duas e responde por plataforma.
          </p>
          <p className="suave" style={{ margin: 0 }}>
            <strong>Resultado por canal:</strong> a resposta é 200 mesmo com falha. Trate <code>canais.*.erroCodigo</code>, mostre <code>erro</code> e <code>avisos[]</code>; <code>envioEmSegundos</code> vem na resposta enquanto o envio à 99Food está na fila.
          </p>
          <p className="suave" style={{ margin: 0 }}>Na 99Food a publicação reenvia o cardápio inteiro da loja: teste publicação apenas em loja de teste.</p>
        </div>
        </>
      ) : null}

      {subAba === 'generica' ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>API Genérica para TODAS as Integrações Atuais e Futuras</h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            O ERP parceiro nunca chama URL nativa do iFood, 99Food, Keeta, Aiqfome ou Rappi diretamente. Toda tradução de protocolo, conversão de centavos e OAuth fica dentro
            do Hub Target. Se amanhã entrar uma nova plataforma no Target Delivery, o ERP continua usando exatamente estas rotas:
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="item-table">
              <thead>
                <tr>
                  <th>Domínio</th>
                  <th>Rota Genérica no Hub (Bearer <code>hubi_</code>)</th>
                  <th>Comportamento Agnóstico de Canal</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Conexão & Lojas</td>
                  <td><code>POST /hub/v1/integracao/conectar</code><br /><code>GET /hub/v1/conexao</code></td>
                  <td>1 chamada conecta CNPJ, ativa túnel/PUSH e lista lojas de qualquer canal vinculado.</td>
                </tr>
                <tr>
                  <td>Receber Pedidos</td>
                  <td><code>POST &lt;webhook.url&gt;</code><br /><code>GET /hub/v1/conexao/pedidos/:id?formato=unificado</code></td>
                  <td>Webhook instantâneo + JSON único com valores sempre em Reais (<code>float</code>) e adicionais em <code>modificadores[]</code>.</td>
                </tr>
                <tr>
                  <td>Operar Pedido</td>
                  <td><code>POST /hub/v1/conexao/pedidos/:id/acao</code></td>
                  <td>
                    Aceita <code>confirm</code>, <code>startPreparation</code>, <code>readyToPickup</code>, <code>dispatch</code> (c/ entregador), <code>updateCourier</code>,{' '}
                    <code>validatePickupCode</code>, <code>conclude</code>, <code>requestCancellation</code>, <code>acceptCancellation</code>, <code>denyCancellation</code>.
                  </td>
                </tr>
                <tr>
                  <td>Motivos / Rastreio</td>
                  <td><code>GET /hub/v1/conexao/pedidos/:id/subrecurso?tipo=motivos|rastreio|sacola</code></td>
                  <td>Retorna códigos/motivos reais de cancelamento do canal antes de chamar <code>requestCancellation</code>.</td>
                </tr>
                <tr>
                  <td>Cardápio Unificado</td>
                  <td><code>GET /hub/v1/conexao/catalogo/unificado</code></td>
                  <td>Categorias, itens, SKU externo, grupos e opções de TODOS os canais ativos da loja em um único JSON.</td>
                </tr>
                <tr>
                  <td>Preço & Pausa</td>
                  <td><code>PATCH /hub/v1/conexao/catalogo/itens/preco</code><br /><code>PATCH /hub/v1/conexao/catalogo/itens/status</code><br /><code>PATCH /hub/v1/conexao/catalogo/opcoes/...</code></td>
                  <td>Passando <code>?plataforma=...</code> e <code>itemId</code>/<code>optionId</code>, o Hub converte reais/centavos e preserva vínculos de adicionais (99Food).</td>
                </tr>
                <tr>
                  <td>Status da Loja</td>
                  <td><code>GET /hub/v1/conexao/loja/status</code></td>
                  <td>Retorna bloco por canal e bloco <code>unificado</code> (<code>{'{ aberta, titulo }'}</code>), evitando parser específico no ERP.</td>
                </tr>
                <tr>
                  <td>Dados e Funcionamento</td>
                  <td><code>GET/PATCH /hub/v1/conexao/loja/dados</code> e <code>POST .../loja/funcionamento</code></td>
                  <td>Resultado por plataforma: confira <code>ok</code>, <code>parcial</code>, <code>editaveis</code> e <code>retryAfterSegundos</code>. Altera a loja real: confirme com o operador antes.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, fontSize: 13 }}>
            <strong>Regra de Ouro no ERP para futuras integrações:</strong> trate <code>pedido.canal</code> e <code>item.plataforma</code> como string aberta para exibição/contabilidade,
            jamais escreva <code>if (canal === 'IFOOD') ... else ...</code> para regras de negócio e sempre armazene o <code>codigoExterno</code> (SKU do ERP) para casar produtos.
          </div>
        </div>
      ) : null}

      {subAba === 'variaveis' ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>O que é Fixo, o que Varia por Máquina e o que NÃO vai para o ERP</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="item-table">
              <thead>
                <tr>
                  <th>Informação / Variável</th>
                  <th>Escopo</th>
                  <th>Quem guarda / Regra de segurança</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>tokenIntegracao (hubp_...)</code></td>
                  <td><span className="pill pill-ok">Fixo no software ERP</span></td>
                  <td>Mesmo token para todas as cópias do seu ERP. Fica no <code>.env</code>/cofre do backend ERP, nunca digitado pelo lojista em produção.</td>
                </tr>
                <tr>
                  <td><code>webhook.url</code> (Túnel HTTPS)</td>
                  <td><span className="pill">Variável por máquina</span></td>
                  <td>Cada loja/servidor informa o seu túnel HTTPS próprio ao conectar o CNPJ.</td>
                </tr>
                <tr>
                  <td>Banco de dados do ERP (SQLite / Postgres / etc.)</td>
                  <td><span className="pill">Variável por máquina</span></td>
                  <td>Cada instalação mantém seu próprio banco local com pedidos, clientes, catálogo e <code>tokenConexao</code>/<code>webhookSegredo</code>.</td>
                </tr>
                <tr>
                  <td><code>tokenConexao (hubi_...)</code> e <code>webhookSegredo</code></td>
                  <td><span className="pill">Retornado por CNPJ</span></td>
                  <td>Salvos apenas no backend do ERP; dão acesso exclusivamente ao CNPJ vinculado. Não expor no HTML público.</td>
                </tr>
                <tr>
                  <td>Logs internos do Delivery / fila `hub_entrega` / OAuth apps / <code>/admin</code></td>
                  <td><span className="pill pill-warn">Proibido no ERP</span></td>
                  <td>Serviço interno exclusivo da Target Delivery. O ERP nunca acessa banco do Delivery nem segredos globais dos marketplaces.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
