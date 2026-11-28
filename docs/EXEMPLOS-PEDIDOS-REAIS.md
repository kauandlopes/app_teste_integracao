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

> Arquivo gerado por `npm run docs`. Edite a fonte, não este arquivo.

## Pedido 1: iFood, entrega própria com código

Pedido real de teste de 28/11/2026 (iFood, loja de teste). Dados pessoais, codigos e assinatura substituidos.

| # | Horário (UTC) | Depois de | Passo | HTTP | Tempo |
|---|---|---|---|---|---|
| 1 | 11:41:41 | 0 s | Webhook PLACED | 200 | 11 ms |
| 2 | 11:41:41 | 0 s | Consulta do pedido | 200 | 241 ms |
| 3 | 11:42:19 | 39 s | Ação confirm | 200 | 195 ms |
| 4 | 11:42:20 | 39 s | Webhook CONFIRMED | 200 | 1 ms |
| 5 | 11:42:20 | 40 s | Webhook DELIVERY_DROP_CODE_REQUESTED | 200 | 2 ms |
| 6 | 11:42:24 | 44 s | Ação readyToPickup | 200 | 193 ms |
| 7 | 11:42:25 | 44 s | Webhook READY_TO_PICKUP | 200 | 1 ms |
| 8 | 11:42:36 | 56 s | Ação dispatch | 200 | 190 ms |
| 9 | 11:42:36 | 56 s | Webhook DISPATCHED | 200 | 2 ms |
| 10 | 11:42:38 | 57 s | Ação conclude | 200 | 9 ms |
| 11 | 12:12:22 | 1841 s | Webhook CONCLUDED | 200 | 2 ms |

### 1. Webhook PLACED

`POST /erp-simulador/api/webhook`

```json
{
  "cabecalhos": {
    "x-target-plataforma": "IFOOD",
    "x-target-loja": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
    "x-target-evento": "65de8e61-50bd-4c7d-aa84-f491630fe9b2",
    "x-target-tipo": "PLACED",
    "x-target-pedido": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "x-target-seq": "25",
    "x-target-tentativa": "1",
    "x-target-timestamp": "1795866100",
    "x-target-notificacao": "e9aaceb9-41b4-4485-b1ff-782b9c34135c",
    "x-target-conexao": "<conexaoId>",
    "x-target-loja-externa": "<lojaExternaId>",
    "x-target-assinatura": "v1=<hmac-sha256 em hexadecimal>",
    "content-type": "application/json",
    "user-agent": "TargetHub/1"
  },
  "corpo": {
    "code": "PLC",
    "createdAt": "2026-11-28T11:41:39.702Z",
    "fullCode": "PLACED",
    "id": "65de8e61-50bd-4c7d-aa84-f491630fe9b2",
    "merchantId": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
    "orderId": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "salesChannel": "IFOOD"
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "recebido": true,
      "novo": true
    }
  }
}
```

### 2. Consulta do pedido

`GET /hub/v1/conexao/pedidos/{pedidoId}?formato=unificado`

```json
{
  "resposta": {
    "status": 200,
    "corpo": "ver detalheUnificado"
  }
}
```

### 3. Ação confirm

`POST /hub/v1/conexao/pedidos/{pedidoId}/acao`

```json
{
  "cabecalhos": {
    "Authorization": "Bearer <token_da_conexao>",
    "Idempotency-Key": "erp-<uuid da intencao>",
    "Content-Type": "application/json"
  },
  "corpo": {
    "acao": "confirm",
    "plataforma": "IFOOD"
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "ok": true,
      "status": 202
    }
  }
}
```

### 4. Webhook CONFIRMED

`POST /erp-simulador/api/webhook`

```json
{
  "cabecalhos": {
    "x-target-plataforma": "IFOOD",
    "x-target-loja": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
    "x-target-evento": "aab04448-84cb-4423-885b-e95604378c32",
    "x-target-tipo": "CONFIRMED",
    "x-target-pedido": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "x-target-seq": "26",
    "x-target-tentativa": "1",
    "x-target-timestamp": "1795866140",
    "x-target-notificacao": "eb01bae9-ef70-4043-85ab-a99fa07074e9",
    "x-target-conexao": "<conexaoId>",
    "x-target-loja-externa": "<lojaExternaId>",
    "x-target-assinatura": "v1=<hmac-sha256 em hexadecimal>",
    "content-type": "application/json",
    "user-agent": "TargetHub/1"
  },
  "corpo": {
    "code": "CFM",
    "createdAt": "2026-11-28T11:42:19.64Z",
    "fullCode": "CONFIRMED",
    "id": "aab04448-84cb-4423-885b-e95604378c32",
    "merchantId": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
    "metadata": {
      "CLIENT_ID": "integrador:exemplo",
      "ORIGIN": "ORDER_API",
      "appName": "exemplo",
      "ownerName": "exemplo"
    },
    "orderId": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "salesChannel": "IFOOD"
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "recebido": true,
      "novo": true
    }
  }
}
```

### 5. Webhook DELIVERY_DROP_CODE_REQUESTED

`POST /erp-simulador/api/webhook`

```json
{
  "cabecalhos": {
    "x-target-plataforma": "IFOOD",
    "x-target-loja": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
    "x-target-evento": "1a022fa8-3c35-4019-9bc9-c51c0d4301f0",
    "x-target-tipo": "DELIVERY_DROP_CODE_REQUESTED",
    "x-target-pedido": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "x-target-seq": "27",
    "x-target-tentativa": "1",
    "x-target-timestamp": "1795866140",
    "x-target-notificacao": "2b889858-cc6f-4fde-8943-15156aad2c80",
    "x-target-conexao": "<conexaoId>",
    "x-target-loja-externa": "<lojaExternaId>",
    "x-target-assinatura": "v1=<hmac-sha256 em hexadecimal>",
    "content-type": "application/json",
    "user-agent": "TargetHub/1"
  },
  "corpo": {
    "code": "DDCR",
    "createdAt": "2026-11-28T11:42:20.06Z",
    "fullCode": "DELIVERY_DROP_CODE_REQUESTED",
    "id": "1a022fa8-3c35-4019-9bc9-c51c0d4301f0",
    "merchantId": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
    "orderId": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "salesChannel": "IFOOD"
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "recebido": true,
      "novo": true
    }
  }
}
```

### 6. Ação readyToPickup

`POST /hub/v1/conexao/pedidos/{pedidoId}/acao`

```json
{
  "cabecalhos": {
    "Authorization": "Bearer <token_da_conexao>",
    "Idempotency-Key": "erp-<uuid da intencao>",
    "Content-Type": "application/json"
  },
  "corpo": {
    "acao": "readyToPickup",
    "plataforma": "IFOOD"
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "ok": true,
      "status": 202
    }
  }
}
```

### 7. Webhook READY_TO_PICKUP

`POST /erp-simulador/api/webhook`

```json
{
  "cabecalhos": {
    "x-target-plataforma": "IFOOD",
    "x-target-loja": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
    "x-target-evento": "411b304a-ebc7-432a-aad9-32b97dafa7c7",
    "x-target-tipo": "READY_TO_PICKUP",
    "x-target-pedido": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "x-target-seq": "28",
    "x-target-tentativa": "1",
    "x-target-timestamp": "1795866145",
    "x-target-notificacao": "caed54f5-ecd7-480e-8784-52c318a93be4",
    "x-target-conexao": "<conexaoId>",
    "x-target-loja-externa": "<lojaExternaId>",
    "x-target-assinatura": "v1=<hmac-sha256 em hexadecimal>",
    "content-type": "application/json",
    "user-agent": "TargetHub/1"
  },
  "corpo": {
    "code": "RTP",
    "createdAt": "2026-11-28T11:42:24.705Z",
    "fullCode": "READY_TO_PICKUP",
    "id": "411b304a-ebc7-432a-aad9-32b97dafa7c7",
    "merchantId": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
    "metadata": {
      "CLIENT_ID": "integrador:exemplo",
      "ORIGIN": "ORDER_API",
      "appName": "exemplo",
      "ownerName": "exemplo"
    },
    "orderId": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "salesChannel": "IFOOD"
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "recebido": true,
      "novo": true
    }
  }
}
```

### 8. Ação dispatch

`POST /hub/v1/conexao/pedidos/{pedidoId}/acao`

```json
{
  "cabecalhos": {
    "Authorization": "Bearer <token_da_conexao>",
    "Idempotency-Key": "erp-<uuid da intencao>",
    "Content-Type": "application/json"
  },
  "corpo": {
    "acao": "dispatch",
    "plataforma": "IFOOD",
    "dados": {
      "courierName": "Entregador Exemplo",
      "courierPhone": "11900000001"
    }
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "ok": true,
      "status": 202
    }
  }
}
```

### 9. Webhook DISPATCHED

`POST /erp-simulador/api/webhook`

```json
{
  "cabecalhos": {
    "x-target-plataforma": "IFOOD",
    "x-target-loja": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
    "x-target-evento": "0d628cee-ca98-493a-8f84-4e510f588cd4",
    "x-target-tipo": "DISPATCHED",
    "x-target-pedido": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "x-target-seq": "29",
    "x-target-tentativa": "1",
    "x-target-timestamp": "1795866156",
    "x-target-notificacao": "e965ad85-ca1f-4f64-820f-ed09cce1e260",
    "x-target-conexao": "<conexaoId>",
    "x-target-loja-externa": "<lojaExternaId>",
    "x-target-assinatura": "v1=<hmac-sha256 em hexadecimal>",
    "content-type": "application/json",
    "user-agent": "TargetHub/1"
  },
  "corpo": {
    "code": "DSP",
    "createdAt": "2026-11-28T11:42:36.585Z",
    "fullCode": "DISPATCHED",
    "id": "0d628cee-ca98-493a-8f84-4e510f588cd4",
    "merchantId": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
    "metadata": {
      "CLIENT_ID": "integrador:exemplo",
      "ORIGIN": "ORDER_API",
      "appName": "exemplo",
      "ownerName": "exemplo"
    },
    "orderId": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "salesChannel": "IFOOD"
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "recebido": true,
      "novo": true
    }
  }
}
```

### 10. Ação conclude

`POST /hub/v1/conexao/pedidos/{pedidoId}/acao`

```json
{
  "cabecalhos": {
    "Authorization": "Bearer <token_da_conexao>",
    "Idempotency-Key": "erp-<uuid da intencao>",
    "Content-Type": "application/json"
  },
  "corpo": {
    "acao": "conclude",
    "plataforma": "IFOOD"
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "ok": true,
      "status": "CONCLUDED",
      "localOnly": true
    }
  }
}
```

### 11. Webhook CONCLUDED

`POST /erp-simulador/api/webhook`

```json
{
  "cabecalhos": {
    "x-target-plataforma": "IFOOD",
    "x-target-loja": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
    "x-target-evento": "330bab9b-1688-4fed-bfb4-8be3b4dcd954",
    "x-target-tipo": "CONCLUDED",
    "x-target-pedido": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "x-target-seq": "32",
    "x-target-tentativa": "1",
    "x-target-timestamp": "1795867942",
    "x-target-notificacao": "d41133d1-2b11-416a-9fc0-c6e91cffd8dc",
    "x-target-conexao": "<conexaoId>",
    "x-target-loja-externa": "<lojaExternaId>",
    "x-target-assinatura": "v1=<hmac-sha256 em hexadecimal>",
    "content-type": "application/json",
    "user-agent": "TargetHub/1"
  },
  "corpo": {
    "code": "CON",
    "createdAt": "2026-11-28T12:12:21.149Z",
    "fullCode": "CONCLUDED",
    "id": "330bab9b-1688-4fed-bfb4-8be3b4dcd954",
    "merchantId": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
    "metadata": {
      "triggerEvent": {
        "id": "bfdb21ba-03b0-4178-af15-34518c6842d3",
        "previousStatus": "DISPATCHED",
        "value": "CONCLUDED"
      }
    },
    "orderId": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "salesChannel": "IFOOD"
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "recebido": true,
      "novo": true
    }
  }
}
```

### Detalhe unificado devolvido na consulta

```json
{
  "id": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
  "codigoExibicao": "5550",
  "canal": "IFOOD",
  "statusKanban": "NOVO",
  "etapaOriginal": "RECEBIDO",
  "tipoEntrega": "DELIVERY",
  "modalidadePlataforma": "DELIVERY",
  "categoriaPlataforma": "FOOD",
  "entreguePor": "MERCHANT",
  "cliente": {
    "nome": "Cliente Exemplo",
    "telefone": "0800 000 0000",
    "documento": "00000000000",
    "telefoneVirtual": "0800 000 0000",
    "localizador": "00000000"
  },
  "enderecoEntrega": {
    "formatado": "Rua Exemplo, 100",
    "logradouro": "Rua Exemplo",
    "numero": "100",
    "complemento": "",
    "bairro": "Centro",
    "cidade": "Cidade",
    "uf": "UF",
    "cep": "00000000",
    "referencia": "Referencia"
  },
  "valores": {
    "moeda": "BRL",
    "subtotal": 21,
    "taxaEntrega": 5,
    "total": 27,
    "trocoPara": null
  },
  "pagamento": {
    "forma": "CREDIT",
    "pagoOnline": true
  },
  "itens": [
    {
      "id": "5cad4023-59b7-43c1-9f54-ee7d341b931d",
      "nome": "PRODUTO 1 - NÃO ENTREGAR - Primeiro Nível",
      "quantidade": 1,
      "precoUnitario": 5,
      "precoTotal": 5,
      "observacao": "",
      "codigoExterno": "9874",
      "modificadores": []
    },
    {
      "id": "ac155690-3458-49c2-880c-9045bcb4143b",
      "nome": "PRODUTO 2 (COMBO) - NÃO ENTREGAR - Primeiro Nível",
      "quantidade": 1,
      "precoUnitario": 16,
      "precoTotal": 16,
      "observacao": "",
      "codigoExterno": "8641",
      "modificadores": [
        {
          "nome": "Complemento 1 - Segundo Nível",
          "quantidade": 1,
          "precoUnitario": 2,
          "codigoExterno": "8230",
          "idExterno": "459826e9-afe8-4d5f-9e40-2ce77f3ec20e"
        },
        {
          "nome": "Complemento 2 - Segundo Nível",
          "quantidade": 1,
          "precoUnitario": 2,
          "codigoExterno": "7612",
          "idExterno": "c0aff13b-823b-4e71-a444-ebed87263a91"
        },
        {
          "nome": "Complemento 3 - Segundo Nível",
          "quantidade": 1,
          "precoUnitario": 2,
          "codigoExterno": "2984",
          "idExterno": "8f919585-f599-4eb4-8f92-5375b73131ae"
        },
        {
          "nome": "Complemento 4 - Segundo Nível",
          "quantidade": 1,
          "precoUnitario": 2,
          "codigoExterno": "9110",
          "idExterno": "87f56b3f-ecaa-4ded-b1d8-bce525c10e1e"
        },
        {
          "nome": "Complemento 4 - Segundo Nível > Customização 1 do Complemento 4 - Terceiro Nível",
          "quantidade": 1,
          "precoUnitario": 1,
          "codigoExterno": "1043",
          "idExterno": "4b740390-7b7f-49a7-96cb-83994a475832"
        },
        {
          "nome": "Complemento 4 - Segundo Nível > Customização 2 do Complemento 4 - Terceiro Nível",
          "quantidade": 1,
          "precoUnitario": 1,
          "codigoExterno": "3722",
          "idExterno": "ea54e7fb-77e1-46a2-8a59-00dff519c51a"
        },
        {
          "nome": "Complemento 4 - Segundo Nível > Customização 3 do Complemento 4 - Terceiro Nível",
          "quantidade": 1,
          "precoUnitario": 1,
          "codigoExterno": "4538",
          "idExterno": "6c636e30-da94-4d11-9591-4e8419423908"
        }
      ]
    }
  ],
  "observacoes": "Este pedido foi gerado automaticamente pelo Developer Portal.",
  "acoesPermitidas": [
    "confirm",
    "requestCancellation"
  ],
  "agendamento": {
    "agendado": false,
    "previsaoEntrega": "2026-11-28T12:26:39.193Z",
    "inicioPreparo": "2026-11-28T11:41:39.193Z"
  },
  "codigos": {
    "retirada": null,
    "coleta": "0000",
    "entrega": null
  },
  "pagamentos": [
    {
      "forma": "CREDIT",
      "bandeira": "Visa",
      "valor": 17,
      "pagoOnline": true
    },
    {
      "forma": "CREDIT",
      "bandeira": "Master",
      "valor": 10,
      "pagoOnline": true
    }
  ],
  "ajustes": {
    "descontoPlataforma": 0,
    "descontoLoja": 0,
    "taxaServico": 1,
    "gorjeta": 0,
    "dinheiroAReceber": null,
    "repasseLoja": null
  },
  "pedidoTeste": true,
  "criadoEm": "2026-11-28T11:41:39.193Z",
  "bruto": {
    "id": "3ad5038e-4f31-4399-b2df-2fd5850127ac",
    "displayId": "5550",
    "createdAt": "2026-11-28T11:41:39.193Z",
    "category": "FOOD",
    "orderTiming": "IMMEDIATE",
    "orderType": "DELIVERY",
    "delivery": {
      "mode": "DEFAULT",
      "description": "Padrão",
      "deliveredBy": "MERCHANT",
      "deliveryDateTime": "2026-11-28T12:26:39.193Z",
      "observations": "Este pedido foi gerado automaticamente pelo Developer Portal.",
      "deliveryAddress": {
        "streetName": "Rua Exemplo",
        "streetNumber": "100",
        "formattedAddress": "Rua Exemplo, 100",
        "neighborhood": "Centro",
        "complement": "",
        "postalCode": "00000000",
        "city": "Cidade",
        "state": "UF",
        "country": "XX",
        "reference": "Referencia",
        "coordinates": {
          "latitude": 0,
          "longitude": 0
        }
      },
      "pickupCode": "0000"
    },
    "preparationStartDateTime": "2026-11-28T11:41:39.193Z",
    "isTest": true,
    "salesChannel": "IFOOD",
    "merchant": {
      "id": "535493c1-17ea-40ed-aec5-f6b3d3d5aede",
      "name": "Teste - Target Client",
      "business": {
        "name": "IFOOD_MARKETPLACE"
      }
    },
    "customer": {
      "id": "00000000-0000-0000-0000-000000000000",
      "name": "Cliente Exemplo",
      "documentNumber": "00000000000",
      "documentType": "idEstrangeiro",
      "phone": {
        "number": "0800 000 0000",
        "localizer": "00000000",
        "localizerExpiration": "2026-11-28T15:41:39.193Z"
      },
      "ordersCountOnMerchant": 0,
      "segmentation": "Cliente"
    },
    "items": [
      {
        "index": 1,
        "id": "5cad4023-59b7-43c1-9f54-ee7d341b931d",
        "uniqueId": "9d020cb1-a7d7-461f-a6a9-0872fb859752",
        "name": "PRODUTO 1 - NÃO ENTREGAR - Primeiro Nível",
        "externalCode": "9874",
        "ean": "",
        "quantity": 1,
        "unit": "UN",
        "unitPrice": 5,
        "optionsPrice": 0,
        "customizationPrice": 0,
        "totalPrice": 5,
        "price": 5,
        "observations": "",
        "options": [],
        "imageUrl": "https://static-images.ifood.com.br/image/upload/t_high/pratos/e078d2e1-0af0-49c3-ba0d-ea4effffbd54/202305121137_XIHJ_i.jpg"
      },
      {
        "index": 2,
        "id": "ac155690-3458-49c2-880c-9045bcb4143b",
        "uniqueId": "d5dc2940-f192-40c2-82e9-2dbc507911a1",
        "name": "PRODUTO 2 (COMBO) - NÃO ENTREGAR - Primeiro Nível",
        "type": "COMBO_V2",
        "externalCode": "8641",
        "ean": "",
        "quantity": 1,
        "unit": "UN",
        "unitPrice": 5,
        "optionsPrice": 8,
        "customizationPrice": 3,
        "totalPrice": 16,
        "price": 5,
        "observations": "",
        "options": [
          {
            "index": 3,
            "id": "459826e9-afe8-4d5f-9e40-2ce77f3ec20e",
            "name": "Complemento 1 - Segundo Nível",
            "type": "SPECIFICATION",
            "groupName": "Adicione mais ingredientes",
            "externalCode": "8230",
            "ean": "",
            "quantity": 1,
            "unit": "UN",
            "unitPrice": 2,
            "addition": 0,
            "price": 2
          },
          {
            "index": 4,
            "id": "c0aff13b-823b-4e71-a444-ebed87263a91",
            "name": "Complemento 2 - Segundo Nível",
            "type": "OFFER_UNIT",
            "groupName": "Deseja adicionar molhos?",
            "externalCode": "7612",
            "ean": "",
            "quantity": 1,
            "unit": "UN",
            "unitPrice": 2,
            "addition": 0,
            "price": 2
          },
          {
            "index": 5,
            "id": "8f919585-f599-4eb4-8f92-5375b73131ae",
            "name": "Complemento 3 - Segundo Nível",
            "type": "OFFER_UNIT",
            "groupName": "Escolha seu acompanhamento",
            "externalCode": "2984",
            "ean": "",
            "quantity": 1,
            "unit": "UN",
            "unitPrice": 2,
            "addition": 0,
            "price": 2
          },
          {
            "index": 6,
            "id": "87f56b3f-ecaa-4ded-b1d8-bce525c10e1e",
            "name": "Complemento 4 - Segundo Nível",
            "type": "MAIN",
            "groupName": "Meu sanduíche favorito",
            "customizations": [
              {
                "id": "4b740390-7b7f-49a7-96cb-83994a475832",
                "externalCode": "1043",
                "name": "Customização 1 do Complemento 4 - Terceiro Nível",
                "groupName": "Grupo de Complemento Obrigatório",
                "type": "SPECIFICATION",
                "quantity": 1,
                "unitPrice": 1,
                "addition": 0,
                "price": 1
              },
              {
                "id": "ea54e7fb-77e1-46a2-8a59-00dff519c51a",
                "externalCode": "3722",
                "name": "Customização 2 do Complemento 4 - Terceiro Nível",
                "groupName": "Grupo de Complemento Opcional",
                "type": "SPECIFICATION",
                "quantity": 1,
                "unitPrice": 1,
                "addition": 0,
                "price": 1
              },
              {
                "id": "6c636e30-da94-4d11-9591-4e8419423908",
                "externalCode": "4538",
                "name": "Customização 3 do Complemento 4 - Terceiro Nível",
                "groupName": "Escolha seu acompanhamento",
                "type": "SPECIFICATION",
                "quantity": 1,
                "unitPrice": 1,
                "addition": 0,
                "price": 1
              }
            ],
            "externalCode": "9110",
            "ean": "",
            "quantity": 1,
            "unit": "UN",
            "unitPrice": 2,
            "addition": 0,
            "price": 2
          }
        ],
        "imageUrl": "https://static-images.ifood.com.br/image/upload/t_high/pratos/e078d2e1-0af0-49c3-ba0d-ea4effffbd54/202305121137_XIHJ_i.jpg"
      }
    ],
    "total": {
      "additionalFees": 1,
      "subTotal": 21,
      "deliveryFee": 5,
      "benefits": 0,
      "orderAmount": 27
    },
    "payments": {
      "prepaid": 27,
      "pending": 0,
      "methods": [
        {
          "value": 17,
          "currency": "BRL",
          "method": "CREDIT",
          "prepaid": true,
          "type": "ONLINE",
          "transaction": {
            "authorizationCode": "0000000",
            "acquirerDocument": "00000000000000"
          },
          "card": {
            "brand": "Visa"
          }
        },
        {
          "value": 10,
          "currency": "BRL",
          "method": "CREDIT",
          "prepaid": true,
          "type": "ONLINE",
          "transaction": {
            "authorizationCode": "0000000",
            "acquirerDocument": "00000000000000"
          },
          "card": {
            "brand": "Master"
          }
        }
      ]
    },
    "additionalFees": [
      {
        "type": "SMALL_ORDER_FEE_35_PROMOTIONS",
        "description": "Taxa de Serviço",
        "fullDescription": "Cobramos uma taxa que nos ajuda a cobrir custos operacionais, inclusive de segurança, e a manter os investimentos contínuos na plataforma.",
        "value": 1,
        "liabilities": [
          {
            "name": "IFOOD",
            "percentage": 100
          }
        ]
      }
    ],
    "picking": {
      "picker": "DEFAULT"
    },
    "additionalInfo": {
      "metadata": {
        "developerId": "00000000-0000-0000-0000-000000000000",
        "customerEmail": "cliente@exemplo.com",
        "developerEmail": "dev@exemplo.com"
      }
    }
  }
}
```

## Pedido 2: 99Food, entrega própria com pizza, combo e adicionais

Pedido real de teste de 28/11/2026 (99Food, loja de teste). Dados pessoais, codigos e assinatura substituidos.

| # | Horário (UTC) | Depois de | Passo | HTTP | Tempo |
|---|---|---|---|---|---|
| 1 | 12:53:43 | 0 s | Webhook orderNew | 200 | 4 ms |
| 2 | 12:53:45 | 2 s | Consulta do pedido | 200 | 1606 ms |
| 3 | 12:57:00 | 197 s | Ação confirm | 200 | 859 ms |
| 4 | 12:57:01 | 198 s | Webhook orderConfirm | 200 | 12 ms |
| 5 | 12:57:03 | 200 s | Ação readyToPickup | 200 | 599 ms |
| 6 | 12:57:22 | 219 s | Ação dispatch | 200 | 1185 ms |
| 7 | 12:57:26 | 223 s | Ação conclude | 200 | 1074 ms |

### 1. Webhook orderNew

`POST /erp-simulador/api/webhook`

```json
{
  "cabecalhos": {
    "x-target-plataforma": "99FOOD",
    "x-target-loja": "5764618411079896616",
    "x-target-evento": "99f-ee214dc6aa227a074fb1c6818dac2332771f751a",
    "x-target-tipo": "orderNew",
    "x-target-pedido": "5764703623590248759",
    "x-target-seq": "41",
    "x-target-tentativa": "1",
    "x-target-timestamp": "1795870423",
    "x-target-notificacao": "fd4237a8-9d53-4088-9b09-dd372e188b66",
    "x-target-conexao": "<conexaoId>",
    "x-target-loja-externa": "<lojaExternaId>",
    "x-target-assinatura": "v1=<hmac-sha256 em hexadecimal>",
    "content-type": "application/json",
    "user-agent": "TargetHub/1"
  },
  "corpo": {
    "app_id": 1000000000000000000,
    "app_shop_id": "5764618411079896616",
    "type": "orderNew",
    "timestamp": 1795870422,
    "data": {
      "order_id": "5764703623590248759",
      "order_info": {
        "order_id": "5764703623590248759",
        "status": 100,
        "order_index": 1,
        "order_channel": "DiDi Food",
        "remark": "",
        "country": "BR",
        "city_id": 55000243,
        "timezone": "America/Sao_Paulo",
        "pay_type": 1,
        "pay_method": 1,
        "pay_channel": 150,
        "delivery_type": 2,
        "delivery_eta": 0,
        "expected_cook_eta": 0,
        "expected_arrived_eta": 1795872219,
        "create_time": 1795870420,
        "order_timing": false,
        "pay_time": 1795870422,
        "complete_time": 0,
        "cancel_time": 0,
        "shop_confirm_time": 0,
        "c_cancel_preference": 7,
        "need_cutlery": true,
        "price": {
          "order_price": 13890,
          "items_discount": 0,
          "real_price": 15089,
          "real_pay_price": 15089,
          "delivery_price": 500,
          "delivery_discount": 0,
          "others_fees": {
            "small_order_price": 0,
            "total_tip_money": 0,
            "service_price": 699,
            "coupon_discount": 0
          },
          "refund_price": 0,
          "customer_need_paying_money": 15089,
          "store_charged_delivery_price": 500,
          "commission_price": 0
        },
        "shop": {
          "shop_id": "5764619645299983865",
          "app_shop_id": "5764618411079896616",
          "shop_addr": "Endereco da loja",
          "shop_name": "Target Teste Teste",
          "shop_phone": [
            {
              "calling_code": 55,
              "phone": "11900000000",
              "type": "0"
            }
          ]
        },
        "receive_address": {
          "uid": 100000000000000,
          "name": "Cliente Exemplo",
          "first_name": "Cliente",
          "last_name": "Exemplo",
          "calling_code": "+55",
          "phone": "11900000000",
          "city": "Cidade",
          "country_code": "BR",
          "poi_address": "Rua Exemplo, 100 - Centro, Cidade - UF",
          "house_number": "1",
          "poi_lat": 0,
          "poi_lng": 0,
          "coordinate_type": "wgs84",
          "poi_display_name": "Rua Exemplo, 100",
          "state": "UF",
          "district": "Centro",
          "street_name": "Rua Exemplo",
          "street_number": "100",
          "postal_code": "00000-000",
          "complement": "",
          "reference": "Referencia",
          "virtual_phone_number": "08000000000",
          "handover_page_url": "https://food-b-h5.99app.com/pt-BR/v2/confirmation-entrega",
          "locator": "00000000"
        },
        "order_items": [
          {
            "mdu_id": "15C2D5C36045D659D9218D0DD9878B89",
            "app_item_id": "pizza_atum_v3",
            "app_external_id": "",
            "name": "Pizza Atum",
            "total_price": 4500,
            "sku_price": 4200,
            "amount": 1,
            "remark": "",
            "sub_item_list": [
              {
                "app_item_id": "opcao_tamanho_media_v3",
                "app_external_id": "",
                "name": "Média",
                "total_price": 0,
                "sku_price": 0,
                "amount": 1,
                "app_content_id": "mg_tamanho_pizza_geral_v3",
                "content_name": "Escolha o Tamanho",
                "content_app_external_id": "",
                "sub_item_list": [],
                "sales_type": "unit",
                "promo_type": 0,
                "real_price": 0,
                "shop_subside_price": 0
              },
              {
                "app_item_id": "opcao_borda_tradicional_v3",
                "app_external_id": "",
                "name": "Borda Tradicional",
                "total_price": 0,
                "sku_price": 0,
                "amount": 1,
                "app_content_id": "mg_tipo_borda_v3",
                "content_name": "Opções de Borda",
                "content_app_external_id": "",
                "sub_item_list": [],
                "sales_type": "unit",
                "promo_type": 0,
                "real_price": 0,
                "shop_subside_price": 0
              },
              {
                "app_item_id": "opcao_adicional_milho_v3",
                "app_external_id": "",
                "name": "Milho",
                "total_price": 300,
                "sku_price": 300,
                "amount": 1,
                "app_content_id": "mg_adicionais_classicos_v3",
                "content_name": "Turbine sua Pizza",
                "content_app_external_id": "",
                "sub_item_list": [],
                "sales_type": "unit",
                "promo_type": 0,
                "real_price": 300,
                "shop_subside_price": 0
              }
            ],
            "promo_type": 0,
            "real_price": 4500,
            "promotion_detail": {
              "promo_type": 0,
              "promo_discount": 0,
              "shop_subside_price": 0
            },
            "sales_type": "unit"
          },
          {
            "mdu_id": "016E3C9CBA3CC2164A43B9BA4358C9EB",
            "app_item_id": "TGT-COMBO-1",
            "app_external_id": "TGT-COMBO-1",
            "name": "Combo Batata e Bebida",
            "total_price": 3700,
            "sku_price": 3400,
            "amount": 1,
            "remark": "",
            "sub_item_list": [
              {
                "app_item_id": "TGT-CB-RUSTICA",
                "app_external_id": "TGT-CB-RUSTICA",
                "name": "Batata rústica",
                "total_price": 300,
                "sku_price": 300,
                "amount": 1,
                "app_content_id": "TGT-COMBO-1.g.x.TGT-CB-PORCAO",
                "content_name": "Porção",
                "content_app_external_id": "",
                "sub_item_list": [],
                "sales_type": "unit",
                "promo_type": 0,
                "real_price": 300,
                "shop_subside_price": 0
              },
              {
                "app_item_id": "TGT-CB-COLA",
                "app_external_id": "TGT-CB-COLA",
                "name": "Refrigerante lata",
                "total_price": 0,
                "sku_price": 0,
                "amount": 1,
                "app_content_id": "TGT-COMBO-1.g.x.TGT-CB-BEBIDA",
                "content_name": "Bebida",
                "content_app_external_id": "",
                "sub_item_list": [],
                "sales_type": "unit",
                "promo_type": 0,
                "real_price": 0,
                "shop_subside_price": 0
              }
            ],
            "promo_type": 0,
            "real_price": 3700,
            "promotion_detail": {
              "promo_type": 0,
              "promo_discount": 0,
              "shop_subside_price": 0
            },
            "sales_type": "unit"
          },
          {
            "mdu_id": "9D633DCDBF978D220FC8155E8C9B36FE",
            "app_item_id": "TGT-LANCHE-1",
            "app_external_id": "TGT-LANCHE-1",
            "name": "Thor Burger",
            "total_price": 5690,
            "sku_price": 4290,
            "amount": 1,
            "remark": "oiiiii",
            "sub_item_list": [
              {
                "app_item_id": "TGT-BACON",
                "app_external_id": "TGT-BACON",
                "name": "Bacon extra",
                "total_price": 1000,
                "sku_price": 500,
                "amount": 2,
                "app_content_id": "TGT-LANCHE-1.g.x.TGT-ADIC",
                "content_name": "Adicionais",
                "content_app_external_id": "",
                "sub_item_list": [],
                "sales_type": "unit",
                "promo_type": 0,
                "real_price": 1000,
                "shop_subside_price": 0
              },
              {
                "app_item_id": "TGT-QUEIJO",
                "app_external_id": "TGT-QUEIJO",
                "name": "Queijo extra",
                "total_price": 400,
                "sku_price": 400,
                "amount": 1,
                "app_content_id": "TGT-LANCHE-1.g.x.TGT-ADIC",
                "content_name": "Adicionais",
                "content_app_external_id": "",
                "sub_item_list": [],
                "sales_type": "unit",
                "promo_type": 0,
                "real_price": 400,
                "shop_subside_price": 0
              },
              {
                "app_item_id": "TGT-AOPONTO",
                "app_external_id": "TGT-AOPONTO",
                "name": "Ao ponto",
                "total_price": 0,
                "sku_price": 0,
                "amount": 1,
                "app_content_id": "TGT-LANCHE-1.g.x.TGT-PONTO",
                "content_name": "Ponto da carne",
                "content_app_external_id": "",
                "sub_item_list": [],
                "sales_type": "unit",
                "promo_type": 0,
                "real_price": 0,
                "shop_subside_price": 0
              }
            ],
            "promo_type": 0,
            "real_price": 5690,
            "promotion_detail": {
              "promo_type": 0,
              "promo_discount": 0,
              "shop_subside_price": 0
            },
            "sales_type": "unit"
          }
        ],
        "fulfillment_mode": 0,
        "bizline": 0,
        "is_test": 1,
        "handover_code": "0000"
      }
    }
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "recebido": true,
      "novo": true
    }
  }
}
```

### 2. Consulta do pedido

`GET /hub/v1/conexao/pedidos/{pedidoId}?formato=unificado`

```json
{
  "resposta": {
    "status": 200,
    "corpo": "ver detalheUnificado"
  }
}
```

### 3. Ação confirm

`POST /hub/v1/conexao/pedidos/{pedidoId}/acao`

```json
{
  "cabecalhos": {
    "Authorization": "Bearer <token_da_conexao>",
    "Idempotency-Key": "erp-<uuid da intencao>",
    "Content-Type": "application/json"
  },
  "corpo": {
    "acao": "confirm",
    "plataforma": "99FOOD"
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "errno": 0,
      "errmsg": "ok",
      "requestId": "0ac738086b0acf9c5cbdbd951b976702",
      "time": 1795870620,
      "data": true
    }
  }
}
```

### 4. Webhook orderConfirm

`POST /erp-simulador/api/webhook`

```json
{
  "cabecalhos": {
    "x-target-plataforma": "99FOOD",
    "x-target-loja": "5764618411079896616",
    "x-target-evento": "99f-c7c1ea0cd3f4845b800615837004035c1ed7cf44",
    "x-target-tipo": "orderConfirm",
    "x-target-pedido": "5764703623590248759",
    "x-target-seq": "42",
    "x-target-tentativa": "1",
    "x-target-timestamp": "1795870621",
    "x-target-notificacao": "4774473d-5459-44ab-bf4f-0309e7411875",
    "x-target-conexao": "<conexaoId>",
    "x-target-loja-externa": "<lojaExternaId>",
    "x-target-assinatura": "v1=<hmac-sha256 em hexadecimal>",
    "content-type": "application/json",
    "user-agent": "TargetHub/1"
  },
  "corpo": {
    "app_id": 1000000000000000000,
    "app_shop_id": "5764618411079896616",
    "type": "orderConfirm",
    "timestamp": 1795870621,
    "data": {
      "order_id": "5764703623590248759",
      "order_info": {
        "receive_address": null
      }
    }
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "recebido": true,
      "novo": true
    }
  }
}
```

### 5. Ação readyToPickup

`POST /hub/v1/conexao/pedidos/{pedidoId}/acao`

```json
{
  "cabecalhos": {
    "Authorization": "Bearer <token_da_conexao>",
    "Idempotency-Key": "erp-<uuid da intencao>",
    "Content-Type": "application/json"
  },
  "corpo": {
    "acao": "readyToPickup",
    "plataforma": "99FOOD"
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "errno": 0,
      "errmsg": "ok",
      "requestId": "0ac738086b0acf9f5cbdbd951b977e02",
      "time": 1795870623,
      "data": {}
    }
  }
}
```

### 6. Ação dispatch

`POST /hub/v1/conexao/pedidos/{pedidoId}/acao`

```json
{
  "cabecalhos": {
    "Authorization": "Bearer <token_da_conexao>",
    "Idempotency-Key": "erp-<uuid da intencao>",
    "Content-Type": "application/json"
  },
  "corpo": {
    "acao": "dispatch",
    "plataforma": "99FOOD",
    "dados": {
      "courierName": "Entregador Exemplo",
      "courierPhone": "11900000001"
    }
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "errno": 0,
      "errmsg": "ok",
      "requestId": "0aa120bc6b0acfb1a03ba81f1ba3d502",
      "time": 1795870642,
      "data": {}
    }
  }
}
```

### 7. Ação conclude

`POST /hub/v1/conexao/pedidos/{pedidoId}/acao`

```json
{
  "cabecalhos": {
    "Authorization": "Bearer <token_da_conexao>",
    "Idempotency-Key": "erp-<uuid da intencao>",
    "Content-Type": "application/json"
  },
  "corpo": {
    "acao": "conclude",
    "plataforma": "99FOOD"
  },
  "resposta": {
    "status": 200,
    "corpo": {
      "errno": 0,
      "errmsg": "ok",
      "requestId": "0aa120bc6b0acfb6a03ba81f1ba40c02",
      "time": 1795870646,
      "data": {}
    }
  }
}
```

### Detalhe unificado devolvido na consulta

```json
{
  "id": "5764703623590248759",
  "codigoExibicao": "1",
  "canal": "99FOOD",
  "statusKanban": "NOVO",
  "etapaOriginal": "RECEBIDO",
  "tipoEntrega": "DELIVERY",
  "modalidadePlataforma": "DELIVERY",
  "categoriaPlataforma": null,
  "entreguePor": "MERCHANT",
  "cliente": {
    "nome": "Cliente Exemplo",
    "telefone": "0800 000 0000",
    "documento": null,
    "telefoneVirtual": "0800 000 0000",
    "localizador": "00000000"
  },
  "enderecoEntrega": {
    "formatado": "Rua Exemplo, 100",
    "logradouro": "Rua Exemplo",
    "numero": "100",
    "complemento": "",
    "bairro": "Centro",
    "cidade": "Cidade",
    "uf": "UF",
    "cep": "00000000",
    "referencia": "Referencia"
  },
  "valores": {
    "moeda": "BRL",
    "subtotal": 138.9,
    "taxaEntrega": 5,
    "total": 150.89,
    "trocoPara": null
  },
  "pagamento": {
    "forma": "Cartao de credito/debito (online)",
    "pagoOnline": true
  },
  "itens": [
    {
      "id": "pizza_atum_v3",
      "nome": "Pizza Atum",
      "quantidade": 1,
      "precoUnitario": 45,
      "precoTotal": 45,
      "observacao": null,
      "codigoExterno": null,
      "modificadores": [
        {
          "nome": "Média",
          "quantidade": 1,
          "precoUnitario": 0,
          "codigoExterno": "opcao_tamanho_media_v3",
          "idExterno": "opcao_tamanho_media_v3"
        },
        {
          "nome": "Borda Tradicional",
          "quantidade": 1,
          "precoUnitario": 0,
          "codigoExterno": "opcao_borda_tradicional_v3",
          "idExterno": "opcao_borda_tradicional_v3"
        },
        {
          "nome": "Milho",
          "quantidade": 1,
          "precoUnitario": 3,
          "codigoExterno": "opcao_adicional_milho_v3",
          "idExterno": "opcao_adicional_milho_v3"
        }
      ]
    },
    {
      "id": "TGT-COMBO-1",
      "nome": "Combo Batata e Bebida",
      "quantidade": 1,
      "precoUnitario": 37,
      "precoTotal": 37,
      "observacao": null,
      "codigoExterno": "TGT-COMBO-1",
      "modificadores": [
        {
          "nome": "Batata rústica",
          "quantidade": 1,
          "precoUnitario": 3,
          "codigoExterno": "TGT-CB-RUSTICA",
          "idExterno": "TGT-CB-RUSTICA"
        },
        {
          "nome": "Refrigerante lata",
          "quantidade": 1,
          "precoUnitario": 0,
          "codigoExterno": "TGT-CB-COLA",
          "idExterno": "TGT-CB-COLA"
        }
      ]
    },
    {
      "id": "TGT-LANCHE-1",
      "nome": "Thor Burger",
      "quantidade": 1,
      "precoUnitario": 56.9,
      "precoTotal": 56.9,
      "observacao": "oiiiii",
      "codigoExterno": "TGT-LANCHE-1",
      "modificadores": [
        {
          "nome": "Bacon extra",
          "quantidade": 2,
          "precoUnitario": 5,
          "codigoExterno": "TGT-BACON",
          "idExterno": "TGT-BACON"
        },
        {
          "nome": "Queijo extra",
          "quantidade": 1,
          "precoUnitario": 4,
          "codigoExterno": "TGT-QUEIJO",
          "idExterno": "TGT-QUEIJO"
        },
        {
          "nome": "Ao ponto",
          "quantidade": 1,
          "precoUnitario": 0,
          "codigoExterno": "TGT-AOPONTO",
          "idExterno": "TGT-AOPONTO"
        }
      ]
    }
  ],
  "observacoes": "Talheres: Sim (enviar talheres) | Código localizador (locator): 00000000",
  "acoesPermitidas": [
    "confirm",
    "requestCancellation"
  ],
  "agendamento": {
    "agendado": false,
    "previsaoEntrega": "2026-11-28T13:23:39.000Z",
    "inicioPreparo": null,
    "previsaoPronto": null
  },
  "codigos": {
    "retirada": null,
    "coleta": null,
    "entrega": null
  },
  "pagamentos": [
    {
      "forma": "Cartao de credito/debito (online)",
      "bandeira": null,
      "valor": 150.89,
      "pagoOnline": true
    }
  ],
  "ajustes": {
    "descontoPlataforma": 0,
    "descontoLoja": 0,
    "taxaServico": 6.99,
    "gorjeta": 0,
    "dinheiroAReceber": 0,
    "repasseLoja": 150.89
  },
  "pedidoTeste": true,
  "criadoEm": "2026-11-28T12:53:40.000Z",
  "bruto": {
    "errno": 0,
    "errmsg": "ok",
    "requestId": "0aa136f46b0aced8943f53ac1bbdb402",
    "time": 1795870425,
    "data": {
      "order_id": "5764703623590248759",
      "status": 100,
      "order_index": 1,
      "order_channel": "DiDi Food",
      "remark": "",
      "city_id": 55000243,
      "country": "BR",
      "timezone": "America/Sao_Paulo",
      "pay_type": 1,
      "delivery_type": 2,
      "expected_cook_eta": 0,
      "expected_arrived_eta": 1795872219,
      "create_time": 1795870420,
      "order_timing": false,
      "pay_time": 1795870422,
      "complete_time": 0,
      "cancel_time": 0,
      "shop_confirm_time": 0,
      "price": {
        "order_price": 13890,
        "others_fees": {
          "small_order_price": 0,
          "total_tip_money": 0,
          "service_price": 699,
          "coupon_discount": 0,
          "meal_top_up_price": 0
        },
        "real_price": 15089,
        "real_pay_price": 15089,
        "delivery_price": 500,
        "refund_price": 0,
        "store_charged_delivery_price": 500,
        "in_sale_refund_to_c_fee": 0,
        "commission_price": 0,
        "items_discount": 0,
        "delivery_discount": 0,
        "customer_need_paying_money": 15089
      },
      "shop": {
        "shop_id": "5764619645299983865",
        "app_shop_id": "5764618411079896616",
        "shop_addr": "Endereco da loja",
        "shop_name": "Target Teste Teste",
        "shop_phone": [
          {
            "calling_code": 55,
            "phone": "11900000000",
            "type": "0"
          }
        ]
      },
      "receive_address": {
        "uid": 100000000000000,
        "name": "Cliente Exemplo",
        "first_name": "Cliente",
        "last_name": "Exemplo",
        "calling_code": "+55",
        "phone": "11900000000",
        "city": "Cidade",
        "country_code": "BR",
        "poi_address": "Rua Exemplo, 100 - Centro, Cidade - UF",
        "house_number": "1",
        "poi_lat": 0,
        "poi_lng": 0,
        "coordinate_type": "wgs84",
        "poi_display_name": "Rua Exemplo, 100",
        "state": "UF",
        "district": "Centro",
        "street_name": "Rua Exemplo",
        "street_number": "100",
        "postal_code": "00000-000",
        "complement": "",
        "reference": "Referencia",
        "virtual_phone_number": "08000000000",
        "handover_page_url": "https://food-b-h5.99app.com/pt-BR/v2/confirmation-entrega",
        "locator": "00000000"
      },
      "order_items": [
        {
          "app_item_id": "pizza_atum_v3",
          "app_external_id": "",
          "name": "Pizza Atum",
          "total_price": 4500,
          "sku_price": 4200,
          "amount": 1,
          "submit_refund_amount": 0,
          "remark": "",
          "sub_item_list": [
            {
              "app_item_id": "opcao_tamanho_media_v3",
              "app_external_id": "",
              "name": "Média",
              "total_price": 0,
              "sku_price": 0,
              "amount": 1,
              "submit_refund_amount": 0,
              "app_content_id": "mg_tamanho_pizza_geral_v3",
              "content_app_external_id": "",
              "sub_item_list": [],
              "content_name": "Escolha o Tamanho",
              "sales_type": "unit",
              "shop_subside_price": 0,
              "real_price": 0,
              "promo_type": 0
            },
            {
              "app_item_id": "opcao_borda_tradicional_v3",
              "app_external_id": "",
              "name": "Borda Tradicional",
              "total_price": 0,
              "sku_price": 0,
              "amount": 1,
              "submit_refund_amount": 0,
              "app_content_id": "mg_tipo_borda_v3",
              "content_app_external_id": "",
              "sub_item_list": [],
              "content_name": "Opções de Borda",
              "sales_type": "unit",
              "shop_subside_price": 0,
              "real_price": 0,
              "promo_type": 0
            },
            {
              "app_item_id": "opcao_adicional_milho_v3",
              "app_external_id": "",
              "name": "Milho",
              "total_price": 300,
              "sku_price": 300,
              "amount": 1,
              "submit_refund_amount": 0,
              "app_content_id": "mg_adicionais_classicos_v3",
              "content_app_external_id": "",
              "sub_item_list": [],
              "content_name": "Turbine sua Pizza",
              "sales_type": "unit",
              "shop_subside_price": 0,
              "real_price": 300,
              "promo_type": 0
            }
          ],
          "sales_type": "unit",
          "mdu_id": "15C2D5C36045D659D9218D0DD9878B89",
          "real_price": 4500
        },
        {
          "app_item_id": "TGT-COMBO-1",
          "app_external_id": "TGT-COMBO-1",
          "name": "Combo Batata e Bebida",
          "total_price": 3700,
          "sku_price": 3400,
          "amount": 1,
          "submit_refund_amount": 0,
          "remark": "",
          "sub_item_list": [
            {
              "app_item_id": "TGT-CB-RUSTICA",
              "app_external_id": "TGT-CB-RUSTICA",
              "name": "Batata rústica",
              "total_price": 300,
              "sku_price": 300,
              "amount": 1,
              "submit_refund_amount": 0,
              "app_content_id": "TGT-COMBO-1.g.x.TGT-CB-PORCAO",
              "content_app_external_id": "",
              "sub_item_list": [],
              "content_name": "Porção",
              "sales_type": "unit",
              "shop_subside_price": 0,
              "real_price": 300,
              "promo_type": 0
            },
            {
              "app_item_id": "TGT-CB-COLA",
              "app_external_id": "TGT-CB-COLA",
              "name": "Refrigerante lata",
              "total_price": 0,
              "sku_price": 0,
              "amount": 1,
              "submit_refund_amount": 0,
              "app_content_id": "TGT-COMBO-1.g.x.TGT-CB-BEBIDA",
              "content_app_external_id": "",
              "sub_item_list": [],
              "content_name": "Bebida",
              "sales_type": "unit",
              "shop_subside_price": 0,
              "real_price": 0,
              "promo_type": 0
            }
          ],
          "sales_type": "unit",
          "mdu_id": "016E3C9CBA3CC2164A43B9BA4358C9EB",
          "real_price": 3700
        },
        {
          "app_item_id": "TGT-LANCHE-1",
          "app_external_id": "TGT-LANCHE-1",
          "name": "Thor Burger",
          "total_price": 5690,
          "sku_price": 4290,
          "amount": 1,
          "submit_refund_amount": 0,
          "remark": "oiiiii",
          "sub_item_list": [
            {
              "app_item_id": "TGT-BACON",
              "app_external_id": "TGT-BACON",
              "name": "Bacon extra",
              "total_price": 1000,
              "sku_price": 500,
              "amount": 2,
              "submit_refund_amount": 0,
              "app_content_id": "TGT-LANCHE-1.g.x.TGT-ADIC",
              "content_app_external_id": "",
              "sub_item_list": [],
              "content_name": "Adicionais",
              "sales_type": "unit",
              "shop_subside_price": 0,
              "real_price": 1000,
              "promo_type": 0
            },
            {
              "app_item_id": "TGT-QUEIJO",
              "app_external_id": "TGT-QUEIJO",
              "name": "Queijo extra",
              "total_price": 400,
              "sku_price": 400,
              "amount": 1,
              "submit_refund_amount": 0,
              "app_content_id": "TGT-LANCHE-1.g.x.TGT-ADIC",
              "content_app_external_id": "",
              "sub_item_list": [],
              "content_name": "Adicionais",
              "sales_type": "unit",
              "shop_subside_price": 0,
              "real_price": 400,
              "promo_type": 0
            },
            {
              "app_item_id": "TGT-AOPONTO",
              "app_external_id": "TGT-AOPONTO",
              "name": "Ao ponto",
              "total_price": 0,
              "sku_price": 0,
              "amount": 1,
              "submit_refund_amount": 0,
              "app_content_id": "TGT-LANCHE-1.g.x.TGT-PONTO",
              "content_app_external_id": "",
              "sub_item_list": [],
              "content_name": "Ponto da carne",
              "sales_type": "unit",
              "shop_subside_price": 0,
              "real_price": 0,
              "promo_type": 0
            }
          ],
          "sales_type": "unit",
          "mdu_id": "9D633DCDBF978D220FC8155E8C9B36FE",
          "real_price": 5690
        }
      ],
      "pickup_code": "0000",
      "need_cutlery": true,
      "fulfillment_mode": 0,
      "bizline": 0,
      "is_test": 1,
      "c_cancel_preference": 7,
      "promotions": [],
      "shopper_info": {
        "name": "",
        "phone": ""
      },
      "pay_method": 1,
      "pay_channel": 150,
      "handover_code": "0000"
    }
  }
}
```

## Código mínimo para consumir

`src/shared/exemplos/integracao-minima.ts`

```ts
/**
 * Integracao minima de um ERP com o Hub, sem framework. E o mesmo codigo mostrado na aba Documentacao
 * e em docs/EXEMPLOS-PEDIDOS-REAIS.md; os testes rodam estas funcoes sobre os dois pedidos reais.
 */
import crypto from 'crypto';

export interface Conexao {
  base: string; // https://<hub>/api/v1
  token: string; // hubi_ da conexao (um por CNPJ)
  webhookSegredo: string;
}

/**
 * 1. Webhook PUSH. A assinatura cobre "timestamp.notificacaoId." seguido dos bytes CRUS do corpo.
 * Na troca de segredo chegam duas assinaturas separadas por virgula: qualquer uma vale.
 * Timestamp fora de 300 s e recusado (repeticao de uma chamada antiga).
 */
export function assinaturaValida(segredo: string, cabecalhos: Record<string, string>, corpoCru: Buffer, agoraS = Math.floor(Date.now() / 1000)): boolean {
  const timestamp = cabecalhos['x-target-timestamp'] ?? '';
  if (!segredo || Math.abs(agoraS - Number(timestamp)) > 300) return false;
  const assinado = Buffer.concat([Buffer.from(`${timestamp}.${cabecalhos['x-target-notificacao'] ?? ''}.`), corpoCru]);
  const esperada = Buffer.from(`v1=${crypto.createHmac('sha256', segredo).update(assinado).digest('hex')}`);
  return (cabecalhos['x-target-assinatura'] ?? '').split(',').some((parte) => {
    const recebida = Buffer.from(parte.trim());
    return recebida.length === esperada.length && crypto.timingSafeEqual(recebida, esperada);
  });
}

/** Deduplique por plataforma + evento. x-target-notificacao muda quando o transporte e trocado. */
export const chaveDoEvento = (cabecalhos: Record<string, string>) => `${cabecalhos['x-target-plataforma']}:${cabecalhos['x-target-evento']}`;

/**
 * O order_id da 99Food tem 19 digitos: JSON.parse arredonda o numero. Converta para texto ANTES do parse
 * (ou use o cabecalho x-target-pedido, que ja vem como texto).
 */
export const lerJsonSemArredondar = <T = unknown>(texto: string): T => JSON.parse(texto.replace(/([:[,]\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"')) as T;

export interface ItemUnificado {
  nome: string;
  quantidade: number;
  /** Ja inclui os complementos. */
  precoUnitario: number;
  precoTotal: number;
  codigoExterno: string | null;
  modificadores: Array<{ nome: string; quantidade: number; precoUnitario: number; codigoExterno: string | null }>;
}

export interface PedidoUnificado {
  valores: { subtotal: number; taxaEntrega: number; total: number };
  ajustes?: { taxaServico: number; gorjeta: number; descontoLoja: number; descontoPlataforma: number };
  itens: ItemUnificado[];
}

/**
 * 2. Valores. O preco do item JA CONTEM os complementos: os precos dos modificadores explicam o item e
 * nunca sao somados de novo. Nos dois pedidos reais: soma dos itens = subtotal.
 */
export function conferirValores(p: PedidoUnificado) {
  const centavos = (v: number) => Math.round(v * 100);
  const itens = p.itens.reduce((s, i) => s + centavos(i.precoTotal), 0);
  const a = p.ajustes;
  const total = itens + centavos(p.valores.taxaEntrega) + centavos(a?.taxaServico ?? 0) + centavos(a?.gorjeta ?? 0) - centavos(a?.descontoLoja ?? 0) - centavos(a?.descontoPlataforma ?? 0);
  return { itensBatem: itens === centavos(p.valores.subtotal), totalBate: total === centavos(p.valores.total) };
}

export type Desfecho =
  | { tipo: 'feito'; resposta: unknown }
  | { tipo: 'repetir'; aposSegundos: number; motivo: string } // mesma Idempotency-Key
  | { tipo: 'conferir'; motivo: string } // pode ter sido executado: consulte o pedido antes de repetir
  | { tipo: 'recusado'; codigo: string; motivo: string }; // corrija e envie com chave NOVA

/** 3. Leitura da resposta de uma acao. */
export function desfecho(status: number, corpo: any, retryAfter = 0): Desfecho {
  const codigo = String(corpo?.codigo ?? '');
  const motivo = String(corpo?.erro ?? '');
  if (codigo === 'COMANDO_RESULTADO_INCERTO') return { tipo: 'conferir', motivo };
  if (status === 429 || codigo === 'COMANDO_EM_ANDAMENTO') return { tipo: 'repetir', aposSegundos: retryAfter || 30, motivo };
  if (status === 502 || status === 503) return { tipo: 'repetir', aposSegundos: retryAfter || 5, motivo };
  if (status >= 400) return { tipo: 'recusado', codigo, motivo };
  return { tipo: 'feito', resposta: corpo };
}

/**
 * 4. Envio de uma acao: confirm, readyToPickup, dispatch, verifyDeliveryCode, conclude, requestCancellation.
 * A intencao identifica o clique do operador: repetir a mesma intencao nunca duplica o comando.
 * No iFood o 200/202 significa "recebido": a etapa so muda de fato quando chega o evento.
 */
export async function enviarAcao(c: Conexao, plataforma: 'IFOOD' | '99FOOD', pedidoId: string, acao: string, dados: Record<string, unknown> | undefined, intencao: string): Promise<Desfecho> {
  try {
    const r = await fetch(`${c.base}/hub/v1/conexao/pedidos/${encodeURIComponent(pedidoId)}/acao`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': `erp-${intencao}`, 'User-Agent': 'MeuERP/1.0' },
      body: JSON.stringify({ acao, plataforma, ...(dados ? { dados } : {}) }),
      signal: AbortSignal.timeout(45_000),
    });
    return desfecho(r.status, await r.json().catch(() => null), Number(r.headers.get('retry-after')) || 0);
  } catch {
    return { tipo: 'conferir', motivo: 'Sem resposta do Hub.' };
  }
}

/** 5. Detalhe para gravar o pedido e imprimir a comanda. */
export async function buscarPedido(c: Conexao, plataforma: 'IFOOD' | '99FOOD', pedidoId: string) {
  const r = await fetch(`${c.base}/hub/v1/conexao/pedidos/${encodeURIComponent(pedidoId)}?plataforma=${plataforma}&formato=unificado`, {
    headers: { Authorization: `Bearer ${c.token}`, 'User-Agent': 'MeuERP/1.0' },
  });
  if (!r.ok) throw new Error(`Hub respondeu ${r.status}`);
  return lerJsonSemArredondar<PedidoUnificado & Record<string, unknown>>(await r.text());
}
```
