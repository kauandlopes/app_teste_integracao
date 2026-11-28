# Dois pedidos reais, do webhook ao fim

Mensagens trocadas entre o ERP e o Hub em 28/11/2026, nas lojas de teste. Dados pessoais, códigos, tokens e
assinatura foram substituídos; estrutura, identificadores de pedido, valores e tempos são os originais.

## Regras que os dois pedidos mostram

| Assunto | iFood | 99Food |
|---|---|---|
| O que chega no webhook | Só identificadores (`orderId`, `fullCode`); buscar o pedido | `orderNew` com o pedido inteiro, em centavos |
| Identificador | UUID | Número de 19 dígitos: tratar como texto |
| Resposta de uma ação | `{"ok": true, "status": 202}`: recebido; confirmar pelo evento | `{"errno": 0}`: aplicado |
| Prazo de aceite | 8 minutos | 5 minutos |
| Entrega própria | Código do cliente quando chega `DELIVERY_DROP_CODE_REQUESTED` | Entregador obrigatório no `dispatch` |
| Conclusão | `verifyDeliveryCode` (ou `conclude` com `dados.code`); a etapa vem no evento `CONCLUDED` | `conclude` pelo ERP; o `orderFinish` nem sempre chega |
| Preço do item | Já inclui os complementos | Já inclui os complementos |

> Avisos
> - O pedido do iFood abaixo é de antes da correção de 28/11: o `conclude` respondeu `localOnly` e o código do cliente
>   não foi validado. Hoje o Hub responde `422 CODIGO_ENTREGA_OBRIGATORIO` e o fluxo correto é `verifyDeliveryCode`.
> - A recusa de código errado foi testada ao vivo; o aceite de um código certo do iFood ainda não.
> - As ações de logística do iFood respondem `422 SEM_PERMISSAO_LOGISTICA` neste aplicativo.
> - Nunca some o preço dos modificadores ao preço do item.
> - Pedido com `pedidoTeste: true` ou simulado não deve ser produzido nem faturado.
> - Para a nota fiscal o formato unificado não traz autorização do cartão, CNPJ da credenciadora nem tipo do documento;
>   no iFood esses campos estão no corpo original (`bruto`).
