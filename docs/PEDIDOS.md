# Pedidos: do evento à tela (iFood e 99Food)

Exemplos completos com dois pedidos reais: [EXEMPLOS-PEDIDOS-REAIS.md](EXEMPLOS-PEDIDOS-REAIS.md).

Como o ERP de referência recebe, grava e opera pedidos usando o Hub V1. Referência de comportamento: Target Delivery.
Código: `src/server/pedidos/`.

## 1. Chegada sem perda

```
Hub ── PUSH (webhook) ──┐
Hub ── PULL (eventos) ──┼─> tabela eventos (grava) ─> fila ─> pedidos ─> tela (SSE, som)
Hub ── reconciliação ───┘
```

| Regra | Onde |
|---|---|
| O evento é gravado **antes** do `200` ao webhook e antes de confirmar o cursor do PULL | `rotas.ts`, `processador.ts` (`receberEvento`, `puxarEventos`) |
| Repetição é ignorada pelo id do evento (`X-Target-Evento`) e pelo `seq` da conexão | `receberEvento` |
| O card aparece e o alerta toca antes de o detalhe chegar | `processarEvento` |
| Falha ao ler o detalhe: nova tentativa em 2, 5, 15, 30, 60, 120 e 300 s (até 60 vezes). Nada é sobrescrito com resposta incompleta | `processarPedido`, `mesclarDetalhe` |
| Um pedido por vez dentro dele mesmo; pedidos diferentes em paralelo | `processarFila` |
| A etapa nunca volta (evento atrasado); `CANCELADO` vence qualquer etapa | `regras.ts` (`avancarStatus`) |
| A cada 90 s o ERP compara `GET /conexao/pedidos?limite=100` com o que recebeu e importa o que faltou (até 48 h) | `reconciliar` |
| A lista do Hub não traz o corpo. Disputa ou solicitação importada assim marca o pedido com "Responder no portal" (24 h) e, no PUSH, pede ao Hub o reenvio das entregas desistidas. O webhook que chegar depois completa a solicitação | `aplicarEfeito`, `reconciliar` |
| Inteiros de 64 bits da 99Food (`order_id`, `apply_id`) são lidos como texto | `hubClient.ts` (`lerJson`) |

Eventos com falha aparecem em um aviso na tela de pedidos, com "Tentar agora". Cada falha também vai para os Logs (`EVENTO`).

## 2. Eventos tratados

### iFood (nome completo ou código curto)

| Evento | Efeito no ERP |
|---|---|
| `PLACED` (PLC) | Cria o pedido em Novos e busca o detalhe |
| `CONFIRMED` (CFM) | Em preparo |
| `PREPARATION_STARTED` (PRS) | Em preparo, preparo iniciado |
| `READY_TO_PICKUP` (RTP) | Pronto |
| `DISPATCHED` (DSP), `COLLECTED` (CLT) | Saiu para entrega |
| `CONCLUDED` (CON) | Concluído |
| `CANCELLED` (CAN) | Cancelado, com o motivo |
| `CANCELLATION_REQUESTED` (CAR) | Com `disputeId`: solicitação para responder. Sem: cancelamento em análise |
| `CANCELLATION_REQUEST_FAILED` (CARF) | A plataforma recusou o cancelamento: o pedido continua |
| `HANDSHAKE_DISPUTE` (HSD) | Disputa com prazo, resposta na tela |
| `HANDSHAKE_SETTLEMENT` (HSS) | Encerra a disputa; ela não reabre |
| `ASSIGN_DRIVER`, `GOING_TO_ORIGIN`, `ARRIVED_AT_ORIGIN`, `ARRIVED_AT_DESTINATION` | Entregador e etapa da entrega |
| `DELIVERY_RETURNING_TO_ORIGIN`, `DELIVERY_RETURNED_TO_ORIGIN` | Alerta |
| `ORDER_PATCHED`, `DELIVERY_ADDRESS_CHANGE`, `DELIVERY_PHONE_CHANGE`, `PICKUP_AREA_ASSIGNED` | Relê o pedido e avisa |
| `DELIVERY_PICKUP_CODE_REQUESTED` | Alerta |
| `DELIVERY_DROP_CODE_REQUESTED` (DDCR) | Alerta; em "Saiu para entrega" a ação principal passa a ser validar o código |
| Qualquer outro | Entra no histórico e o pedido é relido |

### 99Food

| Evento | Efeito no ERP |
|---|---|
| `orderNew` | Novo |
| `orderConfirm` | Em preparo |
| `orderReady` | Pronto |
| `orderFinish` | Concluído |
| `orderCancel` | Cancelado |
| `orderPartialCancel` | Relê itens e valores e avisa |
| `orderCancelApply` | Cliente pediu cancelamento: 5 minutos para responder |
| `orderRefundApply` | Cliente pediu reembolso: 24 horas para responder |
| `deliveryStatus` 120/130/150/180 | Entregador e etapa |
| `deliveryStatus` 140 / 160 | Saiu para entrega / Concluído |
| `deliveryStatus` 170 / 190 | Alerta de ação da loja |
| `deliveryStatus` em texto (99Entrega) | Etapa da entrega |

## 3. Ações por plataforma e modalidade

Fonte única: `regras.ts` (`acoesDisponiveis`). A tela mostra e o servidor aceita somente o que a regra devolve.

| Modalidade | iFood | 99Food |
|---|---|---|
| Entrega própria | `confirm`, `startPreparation`, `readyToPickup`, `dispatch`, `verifyDeliveryCode`, `updateCourier` (só no ERP) | `confirm`, `readyToPickup`, `dispatch` (exige entregador), `conclude`, `updateCourier` |
| Entrega da plataforma | `confirm`, `startPreparation`, `readyToPickup`, `validatePickupCode` | `confirm`, `readyToPickup`, `payConfirm` (dinheiro) |
| Retirada / mesa | `confirm`, `startPreparation`, `readyToPickup`, `validatePickupCode` | `confirm`, `readyToPickup`, `pickedUp` |

Outras ações:

- `dispatch` no iFood a partir de "Em preparo" envia `readyToPickup` antes.
- Logística do iFood na entrega própria: `assignDriver`, `goingToOrigin`, `arrivedAtOrigin`, `arrivedAtDestination`. Exigem o
  módulo de logística no aplicativo; sem ele, `422 SEM_PERMISSAO_LOGISTICA`.
- `verifyDeliveryCode` vai pelo módulo de pedidos. `validatePickupCode` em entrega própria: `422 CODIGO_NAO_SE_APLICA`.
  A recusa de código errado foi testada ao vivo em 28/11; o aceite de um código certo ainda não.
- 99Food: `validatePickupCode` (código do cliente) e `adjustItem` (item em falta).
- Pedidos simulados (`simhub-`) aceitam apenas o subconjunto que o Hub trata.
- No iFood não há comando de conclusão. `conclude` com `dados.code` confere o código do cliente; sem código o Hub
  responde `422 CODIGO_ENTREGA_OBRIGATORIO` ou `422 CONCLUSAO_PELO_IFOOD` e nada é concluído. O pedido sai da etapa no
  evento `CONCLUDED`. Resposta `localOnly` ou `implicit` nunca marca o pedido como concluído.
- Código errado: o iFood responde `200` com `success: false` e o Hub pode responder `422 CODIGO_INVALIDO`. Nos dois casos
  a tela mostra "Código incorreto" e nada muda.

### Cancelamento pela loja

| Plataforma | Enviado | Depois |
|---|---|---|
| iFood | `{cancellationCode, reason}` com código de `subrecurso?tipo=motivos` | Fica "em análise" até `CANCELLED` ou `CANCELLATION_REQUEST_FAILED` |
| 99Food | `{reason_id, cancellationCode, reason}` (motivo 1080 exige texto; 1060, 1071 e 1072 só na entrega própria) | Cancelado quando o Hub aceita |

### Responder solicitações

| Situação | Ação | `dados` |
|---|---|---|
| Disputa iFood | `acceptCancellation` / `denyCancellation` | `{disputeId, detailReason?}` |
| Contraproposta iFood | `counterOffer` | `{disputeId, alternativeId, type, metadata}` (a alternativa vem em `alternatives` da disputa; o ERP respeita `maxAmount`, tempos e motivos oferecidos) |
| Cancelamento do cliente 99Food | idem | `{applyId, reason?}` (motivo da lista recebida) |
| Reembolso 99Food | `acceptRefund` / `denyRefund` | `{applyId}` / `{applyId, baseReasonId, baseReason, reason?}` |

A tela mostra evidências, itens reclamados e o que acontece no fim do prazo (`timeoutAction`). Toda resposta pede
confirmação. Solicitação vencida continua no quadro, mas o alerta sonoro para.

### Idempotência

Cada clique gera uma "intenção" enviada como `Idempotency-Key: erp-<intenção>`. Repetir após falha de rede usa a
mesma chave. Depois de uma recusa definitiva (4xx), a próxima tentativa usa chave nova, porque o Hub guarda a
resposta por 24 horas.

A lista `acoesPermitidas` do pedido unificado é uma foto do momento da consulta; o ERP calcula os botões a partir da
etapa atual gravada, seguindo a mesma matriz.

## 4. Recursos da operação

- **Aceite automático** (desligado por padrão): confirma o pedido que acabou de chegar (até 10 minutos) e, no iFood,
  inicia o preparo. Falha passageira (rede, 5xx, 429, comando em andamento) é repetida em 5, 10, 20, 30 e 60 s, com a
  última tentativa antes do prazo de aceite (iFood 8 min, 99Food 5 min). A falha fica no quadro, com o número do pedido,
  até ele avançar.
- **Agendados (iFood)**: o preparo começa no horário de `preparationStartDateTime`. Falha passageira é repetida; recusa
  definitiva fica no quadro para o operador.
- **Troca de empresa ou integrador**: com pedido em aberto pede confirmação; os pedidos ficam como "Arquivado".
- **Alerta sonoro**: toca na chegada e se repete enquanto houver pedido sem aceite ou solicitação urgente. O navegador
  exige um clique na página antes de tocar.
- **Comanda**: "Imprimir comanda" no pedido (largura de bobina 72 mm).
- **Dados na tela**: itens com adicionais e observações, pagamento, troco, descontos e quem paga, códigos de
  retirada/coleta/entrega, localizador, CPF, agendamento, entregador, eventos e o JSON bruto.
- **Ajuste interno**: observação e mudança manual de etapa valem só no ERP; nada vai para a plataforma.

## 5. Como testar sem tocar nas plataformas

- Tela: "Pedido de teste" e o menu ao lado (99Food, solicitação de cancelamento, cancelado) usam
  `POST /conexao/avaliar-pedido`, que percorre Hub, fila, PUSH ou PULL e webhook.
- `npm test`: Hub falso em loopback com banco temporário (`test/`). Cobre disputas, cancelamentos, reembolso, ids de
  64 bits, fora de ordem, repetição, falhas, PULL, reconciliação e aceite automático.

## 6. Limites atuais (do Hub ou das plataformas)

- O Hub arredonda inteiros de 64 bits no detalhe da 99Food; o ERP usa o id que veio no evento. Linhas com `mdu_id`
  arredondado não aparecem em "item em falta".
- No iFood a conclusão é feita pela plataforma. Para fechar só no ERP, use "Mover para".
- A contraproposta ainda não foi validada em homologação.
