# Guia Rápido — Integração ERP em 3 Passos

> **Aplicativo ERP Externo (standalone com SQLite, Kanban de Pedidos e Gestor de Cardápio):** acesse **`/erp-simulador`** (`https://delivery.targetx.com.br/erp-simulador`), digite o Token da Integração (`hubp_...`) como senha de acesso e teste todo o fluxo real (Conexão, Lojas, Pedidos e Catálogo iFood/99Food). Detalhes técnicos, `cURL` e histórico persistente de erros HTTP ficam nos menus **`⋮`**.
>
> **Contrato formal:** [openapi-conexoes-v1.json](./openapi-conexoes-v1.json) (parâmetros, corpos e códigos de erro de cada rota).

---

## Pré-requisito (Feito uma única vez no Super Admin)
1. Criar a Integração informando **Código** (ex: `target-x-homologacao`) e **Nome** (ex: `Homologação TX`).
2. Copiar o **Token da Integração (`hubp_...`)** exibido na tela e a **URL Base** (`https://delivery.targetx.com.br/api/v1`).

---

## Passo 1 — Conectar o CNPJ à Integração
O sistema externo autentica com `Authorization: Bearer <hubp_...>` e envia o CNPJ **sem precisar de código de provisionamento nem liberação prévia**:

```bash
curl -X POST 'https://delivery.targetx.com.br/api/v1/hub/v1/integracao/conectar' \
  -H 'Authorization: Bearer <token_da_integracao_hubp>' \
  -H 'Content-Type: application/json' \
  -d '{
    "cnpj": "11222333000181",
    "nome": "Loja de Homologacao"
  }'
```

**Observações:**
- **Uma conexão por CNPJ:** a mesma integração pode conectar vários CNPJs; cada um tem a sua conexão e o seu token `hubi_`. `GET /hub/v1/integracao` (com `hubp_`) lista as conexões ativas em `conexoes[]`.
- A resposta é `201` (conexão nova) ou `200` (repetição do mesmo CNPJ). Na repetição sem `Idempotency-Key`, `credenciais` volta por 24 h enquanto o token valer; depois vem `null` (recupere o token).
- CNPJ que já tem conexão no Hub (de outra integração, ou desta com outro `lojaExternaId`), ou de loja que opera no Target Delivery, responde `409 CNPJ_JA_CONECTADO`.
- Repetir a chamada não troca o destino de uma conexão existente: use `PUT /hub/v1/conexao/webhook`.
- Transporte padrão: **`PULL`** (sem precisar de IP público). Para **PUSH**, envie `"webhook": { "url": "https://seu-erp.exemplo.com.br/webhook" }` (com `webhook`, o padrão passa a ser `PUSH`). A URL aceita `http` ou `https`, sem usuário/senha e sem `#`; a origem é registrada automaticamente. Origem suspensa pela Target responde `403 DESTINO_NAO_AUTORIZADO`.
- A resposta traz `conexaoId`, `credenciais.token` (`hubi_...`), `credenciais.webhookSegredo` (somente em PUSH) e `lojasDisponiveis` (`ifood` e `ninenine`). Guarde as credenciais.
- Novo `hubi_`: `POST /hub/v1/integracao/recuperar-token` com `Bearer <hubp_...>` e corpo `{"cnpj":"..."}` ou `{"conexaoId":"..."}`. O token anterior deixa de valer na hora. Com mais de uma conexão ativa e sem informar qual, a resposta é `409 CONEXAO_AMBIGUA`, com a lista em `detalhes.conexoes`.

---

## Passo 2 — Consultar e Vincular Lojas (`iFood` e `99Food`)
A partir daqui use o token operacional da conexão: `Authorization: Bearer <hubi_...>`.

### 2.1 Listar lojas livres disponíveis (e ver situação atual)
```bash
curl 'https://delivery.targetx.com.br/api/v1/hub/v1/conexao/lojas-disponiveis' \
  -H 'Authorization: Bearer <token_da_conexao_hubi>'
```
Sem `plataforma`, a resposta é `{ "ifood": [], "ninenine": [], "avisos": [] }`; com `?plataforma=IFOOD` ou `99FOOD`, é uma lista. Limite de 20 consultas por minuto. Aparecem somente lojas autorizadas no aplicativo da Target e ainda sem dono.

### 2.2 Vincular loja iFood ou 99Food em 1 clique
```bash
curl -X POST 'https://delivery.targetx.com.br/api/v1/hub/v1/conexao/lojas' \
  -H 'Authorization: Bearer <token_da_conexao_hubi>' \
  -H 'Content-Type: application/json' \
  -d '{"plataforma":"IFOOD","loja":"<merchantId>"}'
```
É uma loja ativa por plataforma (`409 PLATAFORMA_JA_VINCULADA`). Se o vínculo demorar, consulte `GET /hub/v1/conexao` até a loja ficar `ATIVA`. Em estabelecimentos exclusivos do Hub, `POST /hub/v1/conexao/lojas/liberar` (mesmo corpo) desfaz o vínculo.

---

## Passo 3 — Pedidos e Catálogo Ponta a Ponta

### 3.1 Receber Eventos de Pedidos por `PULL`
```bash
# Buscar novos eventos (long-poll de até 25 s)
curl 'https://delivery.targetx.com.br/api/v1/hub/v1/eventos?espera=25&limite=100' \
  -H 'Authorization: Bearer <token_da_conexao_hubi>'

# Depois de gravar, confirmar usando o campo "proximo" da resposta
curl -X POST 'https://delivery.targetx.com.br/api/v1/hub/v1/eventos/confirmar' \
  -H 'Authorization: Bearer <token_da_conexao_hubi>' \
  -H 'Content-Type: application/json' \
  -d '{"ate": <proximo>}'
```
- A resposta traz `eventos[]` (`seq`, `id`, `tipo`, `plataforma`, `loja`, `pedido`, `teste`, `corpo` original da plataforma), `proximo`, `agora` e, quando houver eventos apagados pela retenção, `lacuna` (reconcilie os pedidos).
- Deduplique por `plataforma` + `id`. `corpo` fica `null` (`corpoExpirado: true`) depois de 4 dias.
- **Evento de teste:** `POST /hub/v1/conexao/eventos/teste` com `Bearer <hubi_...>` (chega com `teste: true`).
- **Pedido simulado:** `POST /hub/v1/conexao/avaliar-pedido` com `{"plataforma":"IFOOD","comAdicionais":true,"cenario":"normal"}` (`cenario`: `normal`, `solicitacao_cancelamento` ou `cancelado`). Só para estabelecimentos exclusivos do Hub ou de homologação. Chega com `teste: false` e `avaliacaoSimulada: true`: o ERP não deve produzir nem faturar.

### 3.2 Receber Eventos por `PUSH`
Ativar ou trocar o destino (a resposta traz `webhookSegredo` quando ele é criado):
```bash
curl -X PUT 'https://delivery.targetx.com.br/api/v1/hub/v1/conexao/webhook' \
  -H 'Authorization: Bearer <token_da_conexao_hubi>' \
  -H 'Content-Type: application/json' \
  -d '{"transporte":"PUSH","url":"https://seu-erp.exemplo.com.br/webhook"}'
```
- O Hub envia o corpo original da plataforma com os cabeçalhos `X-Target-Plataforma`, `X-Target-Evento`, `X-Target-Notificacao`, `X-Target-Timestamp`, `X-Target-Assinatura`, entre outros (lista completa no OpenAPI).
- Assinatura: `v1=` + HMAC-SHA256 em hexadecimal, com o segredo, sobre `timestamp.notificacaoId.` seguido dos bytes crus do corpo. Durante a troca do segredo chegam duas assinaturas separadas por vírgula; aceite qualquer uma. Rejeite timestamp fora de 300 s.
- Responda `2xx` somente depois de gravar.
- **Deduplique por `X-Target-Plataforma` + `X-Target-Evento`.** `X-Target-Notificacao` muda quando o transporte é trocado.
- `401`/`403` suspendem o envio (retome em `POST /hub/v1/conexao/webhook/reativar`). `429` respeita `Retry-After`. Outras falhas, inclusive redirecionamento, são repetidas com espera crescente, até 200 falhas por padrão (cerca de 3 dias); depois a entrega fica `DEAD`.
- Acompanhar e reenviar: `GET /hub/v1/conexao/entregas?estado=DEAD` e `POST /hub/v1/conexao/entregas/reprocessar`.
- Trocar o segredo: `POST /hub/v1/conexao/webhook/segredo/rotacionar` (o anterior vale por mais 24 h). Voltar para PULL: `PUT /hub/v1/conexao/webhook` com `{"transporte":"PULL"}`. Com PUSH ativo, o PULL responde `409 TRANSPORTE_PUSH_ATIVO`.

### 3.3 Controle Completo com 1 Token (`hubi_...`) — Sem OAuth Extra
Todas as rotas abaixo usam `Authorization: Bearer <token_da_conexao_hubi>` e identificam sozinhas a loja vinculada à conexão.

#### Loja: dados, horários e funcionamento nos dois canais (recomendado)

| Rota | Para quê |
|---|---|
| `GET /hub/v1/conexao/loja/dados` | Valores atuais por plataforma e a lista do que é editável |
| `PATCH /hub/v1/conexao/loja/dados` | Alterar horários e dados da loja |
| `POST /hub/v1/conexao/loja/funcionamento` | `ABRIR`, `FECHAR`, `PAUSAR`, `OCUPADO`, `NORMAL` |
| `GET /hub/v1/conexao/loja/categorias` | Categorias aceitas pela 99Food |
| `GET`, `POST`, `PUT`, `DELETE /hub/v1/conexao/loja/areas-entrega` | Áreas de entrega da 99Food |

`?plataforma=IFOOD` ou `99FOOD` limita as três primeiras rotas; sem ele valem para todas as lojas ativas da conexão. A loja é sempre a da conexão: ids de loja no corpo são recusados.

O que cada plataforma permite:

| Dado ou operação | iFood | 99Food |
|---|---|---|
| Horários de funcionamento (`horarios`) | Sim | Sim |
| Abrir, fechar, pausar | Sim, por pausas (máximo de 7 dias) | Sim |
| Modo ocupado | Não | Sim |
| Telefones, tempo de preparo, feriados, fotos, categorias da loja | Não | Sim |
| Forma de aceite dos pedidos, receber pedidos de cancelamento e reembolso | Não | Sim |
| Área, tempo e taxa de entrega | Não | Sim, só com entrega própria |
| Nome, endereço, localização, modalidade de entrega | Não (Portal do Parceiro) | Não (portal da 99Food) |

Alterar dados (envie só o que muda):

```json
{
  "horarios": [
    { "dia": 1, "faixas": [ { "inicio": "11:00", "fim": "15:00" }, { "inicio": "18:00", "fim": "02:00" } ] },
    { "dia": 6, "faixas": [ { "inicio": "00:00", "fim": "24:00" } ] }
  ],
  "tempoPreparoMinutos": 30,
  "telefones": [ { "ddi": "55", "numero": "18999990000", "tipo": "CELULAR" } ],
  "feriados": [ { "data": "2026-12-25", "fechado": true },
                { "data": "2026-12-24", "fechado": false, "faixas": [ { "inicio": "10:00", "fim": "18:00" } ] } ],
  "imagens": { "logo": "https://.../logo.png", "capa": "https://.../capa.png" },
  "categorias": { "principal": "<id de loja/categorias>" },
  "aceitePedidos": "API",
  "solicitacoesCliente": { "cancelamento": true, "reembolso": true }
}
```

- `dia`: 1 = segunda ... 7 = domingo. `horarios` substitui a semana inteira (dia ausente fica fechado). `fim` menor que `inicio` passa da meia-noite; `24:00` é o fim do dia (a 99Food recebe `23:59` e divide a faixa que passa da meia-noite).
- `feriados`: não há remoção; para reabrir uma data, reenvie com `fechado: false` e as faixas. A 99Food não devolve feriados na consulta.
- `imagens`: voltam como `EM_ANALISE`; confira depois em `dados.imagens`.
- `aceitePedidos`: `API` = só o seu sistema confirma; `APP_E_API` = o app da loja também confirma (e pode confirmar antes do seu sistema).

Resposta (por plataforma e por campo):

```json
{ "ok": false, "parcial": true,
  "plataformas": {
    "IFOOD":  { "loja": { "id": "<merchantId>" }, "estado": "APLICADO",
                "campos": { "horarios": { "estado": "APLICADO" }, "tempoPreparoMinutos": { "estado": "NAO_SUPORTADO", "motivo": "..." } } },
    "99FOOD": { "loja": { "id": "<shop_id>", "appShopId": "..." }, "estado": "FALHOU",
                "campos": { "horarios": { "estado": "FALHOU", "erro": { "status": 429, "codigo": "PLATAFORMA_ERRNO_10005", "erro": "...", "retryAfterSegundos": 42 } } } } } }
```

- `200` quando ao menos uma plataforma teve sucesso: confira `ok` e `parcial`. `ok` é `true` quando tudo que foi pedido entrou em ao menos uma plataforma e nada falhou; `NAO_SUPORTADO` não é falha.
- Sem nenhum sucesso, o HTTP é o do erro (`429` com `Retry-After` somente se todas as falhas forem limite) e o mesmo detalhe vem em `detalhes.plataformas`. Repita só as plataformas que falharam, com `?plataforma=`.
- Pedido inválido não envia nada: `400 CAMPO_NAO_EDITAVEL` (nome, endereço etc.), `400 CAMPO_DESCONHECIDO`, `400 REQUISICAO_INVALIDA`; `422 NAO_SUPORTADO_NA_PLATAFORMA` quando nenhuma plataforma da requisição permite o que foi pedido.
- `GET loja/dados` responde no mesmo formato: `plataformas.<P>` com `ok`, `loja`, `dados`, `editaveis`, `naoEditaveis`, `recursos`, `funcionamento`, `observacoes` e `falhas` (seções do iFood que não vieram). Campo `null` = a plataforma não informa.

Funcionamento:

```json
{ "acao": "PAUSAR", "duracaoMinutos": 30 }
```

| Ação | iFood | 99Food |
|---|---|---|
| `ABRIR` | Remove as pausas em vigor (as agendadas ficam). Fora do horário a loja continua fechada | Abre, ou revoga o fechamento; opcional `aberturaAutomatica` (padrão `true`) |
| `FECHAR` | Pausa de 7 dias; para manter, `ABRIR` e `FECHAR` antes do vencimento | Fecha até um novo `ABRIR` |
| `PAUSAR` | `duracaoMinutos` de 1 a 10080, ou `ateFimDoDia: true`; opcional `descricao` | `duracaoMinutos` até 30 (degraus de 10) ou `ateFimDoDia: true`; opcional `codigoMotivo` 1001 a 1006. Só com a loja aberta |
| `OCUPADO` / `NORMAL` | Não existe | `duracaoMinutos` 1 a 180 (padrão 60), `acrescimoPreparoMinutos` 1 a 30 (padrão 15) |

- `estado`: `APLICADO` (iFood), `ENVIADO` (99Food aceitou; a situação final chega no evento `shopStatus`), `FALHOU` ou `NAO_SUPORTADO`.
- Pausa já existente no período: `409 IFOOD_PAUSA_JA_EXISTE` (envie `ABRIR` antes). Pausa criada há segundos ainda não pode ser removida: `429 IFOOD_PAUSA_RECEM_CRIADA`.
- Limites da 99Food: 1 consulta da loja por minuto (a leitura pode levar até 2 minutos para refletir a mudança); 1 chamada por minuto para dados e horários (vão juntos), outra para `aceitePedidos`, outra para `solicitacoesCliente` e outra para a situação; áreas: 10 criações e 10 alterações por minuto, 3 listagens e 3 remoções.
- `504 COMANDO_RESULTADO_INCERTO`: pode ter sido aplicado; consulte antes de repetir.

Áreas de entrega (99Food, loja com entrega própria): `POST` cria, `PUT` leva `ids` da listagem e a configuração completa, `DELETE ?ids=a,b` remove.

```json
{ "tipo": "CIRCULO", "raioKm": 5, "tempoEntregaMinutos": 40, "horarios": [ { "inicio": "11:00", "fim": "23:00" } ], "taxaEntrega": 7.9 }
```

`POLIGONO` leva `pontos: [{ "latitude": 0, "longitude": 0 }]` (3 ou mais) no lugar de `raioKm`. `taxaEntrega` em reais.

#### Loja: rotas anteriores (continuam válidas)
- `GET /hub/v1/conexao/loja/horarios` e `PUT` — Só iFood, no formato original (`shifts`)
- `GET /hub/v1/conexao/loja/status` — Status (iFood e 99Food) e interrupções (iFood)
- `POST /hub/v1/conexao/loja/status` — Só 99Food: `{ "acao": "ABRIR" | "FECHAR" | "PAUSAR" | "REABRIR" }`; `PAUSAR` exige `pauseTime` (1 a 4) e `pauseReasonCode` (1001 a 1006). Limite de 1 comando por minuto
- `POST /hub/v1/conexao/loja/interrupcoes` — Pausa programada no iFood: `{ "description": "...", "durationMinutes": 10 }` (opcionais `start` e `end`, horário de Brasília)
- `DELETE /hub/v1/conexao/loja/interrupcoes/{interrupcaoId}` — Remover pausa no iFood

#### Pedidos
- `GET /hub/v1/conexao/pedidos?limite=30` — Pedidos recebidos pela conexão (`limite` de 1 a 100). Com `incluirSistema=true`, devolve no formato unificado os pedidos registrados no Target Delivery para o estabelecimento
- `GET /hub/v1/conexao/pedidos/{pedidoId}` — Detalhe original da plataforma; com `?formato=unificado`, o mesmo formato para iFood e 99Food (`statusKanban`, `acoesPermitidas`, itens, valores)
- `GET /hub/v1/conexao/pedidos/{pedidoId}/subrecurso?tipo=motivos|rastreio|sacola` — Motivos de cancelamento, rastreio ou sacola
- `POST /hub/v1/conexao/pedidos/{pedidoId}/acao` — Corpo `{ "acao": "...", "plataforma": "IFOOD", "dados": {} }`; cabeçalho `Idempotency-Key` opcional

No detalhe unificado consultado na plataforma vêm também:

| Campo | Conteúdo |
|---|---|
| `ajustes` | `descontoPlataforma`, `descontoLoja`, `taxaServico`, `gorjeta`, `dinheiroAReceber`, `repasseLoja` (reais; os dois últimos podem ser `null`) |
| `pedidoTeste` | `true` quando a plataforma marca o pedido como teste: não produzir nem faturar |
| `pagamentos` | `forma`, `bandeira`, `valor`, `pagoOnline` |
| `agendamento` | `agendado`, `previsaoEntrega`, `inicioPreparo` |
| `codigos` | `retirada`, `coleta`, `entrega` |

Ações:

| Plataforma | Ações |
|---|---|
| iFood | `confirm`, `startPreparation`, `readyToPickup`, `dispatch`, `requestCancellation`, `acceptCancellation`, `denyCancellation`, `counterOffer`, `validatePickupCode`, `assignDriver`, `goingToOrigin`, `arrivedAtOrigin`, `arrivedAtDestination`, `verifyDeliveryCode`, `tracking`, `virtualBag`, `cancellationReasons` |
| 99Food | `confirm`, `readyToPickup`, `dispatch`, `updateCourier`, `delivered` (ou `conclude`), `pickedUp`, `validatePickupCode`, `payConfirm`, `partialCancel`, `adjustItem`, `requestCancellation`, `acceptCancellation`, `denyCancellation`, `acceptRefund`, `denyRefund` |

- No iFood, `conclude`, `delivered`, `updateCourier` e `payConfirm` não chamam a plataforma (`localOnly: true`).
- **Cancelar no iFood:** `dados.cancellationCode` (de `subrecurso?tipo=motivos`; sem ele vai `501`).
- **Cancelar na 99Food:** o motivo é obrigatório e precisa estar na lista de motivos (`dados.cancelCodeId`, por exemplo `"1010"`). Sem motivo válido: `400 MOTIVO_INVALIDO`, com `detalhes.motivos`. Com motivo válido, o Hub confirma o pedido antes de cancelar.
- **Entrega própria na 99Food:** `dispatch` exige `dados.courierName` e `dados.courierPhone` (`400 ENTREGADOR_OBRIGATORIO`).
- **Disputa no iFood:** `acceptCancellation` ou `denyCancellation` com `dados.disputeId`. A contraproposta (`counterOffer` ou `CONTRAPROPOSTA`) exige `disputeId`, `alternativeId` (ambos do evento da disputa) e `type` (`REFUND` ou `ADDITIONAL_TIME`); sem algum deles, `400 CONTRAPROPOSTA_INCOMPLETA`:

```json
{ "acao": "CONTRAPROPOSTA", "plataforma": "IFOOD",
  "dados": { "disputeId": "<disputeId>", "alternativeId": "<alternativeId>", "type": "ADDITIONAL_TIME", "metadata": {} } }
```

- Na 99Food, `dados.applyId` (cancelamento e reembolso) vai sempre como texto; número acima de 2^53 é recusado com `400 APPLY_ID_COMO_TEXTO`.
- **Cancelamento parcial na 99Food:** `partialCancel` com `dados.items` = `[{ "app_item_id", "mdu_id", "cancel_amount" }]` (o `mdu_id` vem no detalhe do pedido).
- `504 COMANDO_RESULTADO_INCERTO`: o comando pode ter sido executado; consulte o pedido antes de repetir.

#### Cardápio: um produto para os dois canais (recomendado)
O ERP usa os próprios códigos; reenviar o mesmo `codigo` atualiza o produto.

- `POST /hub/v1/conexao/catalogo/produtos` — Um produto ou `{ "produtos": [ ... ] }` (até 100)
- `GET /hub/v1/conexao/catalogo/produtos` e `/produtos/{codigo}` — Situação por canal
- `PATCH /hub/v1/conexao/catalogo/produtos/{codigo}` — `{ "preco": 24.5 }` e/ou `{ "disponivel": false }`
- `PATCH /hub/v1/conexao/catalogo/produtos/{codigo}/opcoes/{opcao}` — Mesmo corpo, para adicional, sabor, massa ou borda
- `DELETE /hub/v1/conexao/catalogo/produtos/{codigo}` — Remove dos dois canais

A resposta é `200` mesmo quando um canal falha: confira `ok` e `canais.IFOOD.estado` / `canais.99FOOD.estado` (`PUBLICADO`, `PROCESSANDO`, `REMOVIDO`, `ERRO` ou `SEM_LOJA`). Com `ERRO`, trate `erroCodigo` e mostre `erro`, que traz o motivo da plataforma.

Na 99Food:
- Com a janela de 1 envio por minuto livre, o envio sai na própria requisição; ocupada, vem `PROCESSANDO` com `envioEmSegundos`. O resultado sai em até 15 minutos.
- A leitura que a 99Food devolve é a verdade: itens apagados no portal não exigem confirmação. Só leitura ilegível interrompe (`CARDAPIO_99_ILEGIVEL`).
- Uma operação recusada não leva as outras do lote para `ERRO`: o Hub divide o lote até isolar a que falha.
- `DELETE` vale para qualquer produto, inclusive o último. Se a 99Food recusar o envio que o apagaria, o canal fica `REMOVIDO`, o item é pausado (veja `avisos[]`) e sai no próximo envio aceito.

Tipos: `SIMPLES` (padrão), `PIZZA` e `COMBO`. No `COMBO`, `preco` é obrigatório, cada grupo é uma etapa de escolha e o **primeiro grupo é o principal**; no iFood vira combo e na 99Food vira item com grupos.

```json
{
  "codigo": "COMBO-01",
  "nome": "Combo",
  "categoria": "Combos",
  "tipo": "COMBO",
  "preco": 39.9,
  "grupos": [
    { "codigo": "ETAPA-LANCHE", "nome": "Escolha o lanche", "min": 1, "max": 1,
      "opcoes": [ { "codigo": "CB-XBURGER", "nome": "X Burger" } ] },
    { "codigo": "ETAPA-BEBIDA", "nome": "Escolha a bebida", "min": 1, "max": 1,
      "opcoes": [ { "codigo": "CB-SUCO", "nome": "Suco" }, { "codigo": "CB-REFRI", "nome": "Refrigerante", "preco": 2.0 } ] }
  ]
}
```

Pizza (exemplo completo no OpenAPI):
- `pizza.tamanhos[]` (com `preco` final e `maxSabores` de 1 a 4), `sabores[]`, `massas[]`, `bordas[]`; todos aceitam `disponivel`.
- Códigos de tamanhos, sabores, massas e bordas diferentes entre si; cada adicional (`grupos[].opcoes[]`) precisa de código próprio e distinto de todos eles.
- O preço da pizza não muda por `PATCH` (`400 PRECO_DE_PIZZA`): reenvie o produto.
- Na 99Food, quando o acréscimo de um sabor muda conforme o tamanho, cada tamanho vira um item; o `disponivel` do tamanho continua valendo, na publicação e na pausa pela rota de opções.

Regras gerais: `disponivel` do produto omitido vale `true` (o reenvio reativa um produto pausado); `foto` em data URI vale para os dois canais e URL `https` só para a 99Food; sem `foto`, a atual é mantida; corpo de até 1 MB.

#### Como a pizza aparece no iFood

| `formatoIfood` | Resultado |
|---|---|
| `ITENS` (padrão) | item comum dentro da `categoria` enviada, com grupos Tamanho, Massa, Borda, Sabores e adicionais. Quando o acréscimo de um sabor muda conforme o tamanho, cada tamanho vira um item |
| `PIZZA` | pizza nativa do iFood, em uma seção própria com o nome do produto e cobrança por fração |

- No formato `ITENS`, quando o cliente escolhe mais de um sabor, o iFood soma os acréscimos.
- Reenviar uma pizza com outro formato exclui o que estava publicado e publica no novo.

#### Preço diferente por plataforma

`preco` é o preço padrão. Envie `precosPlataforma` somente onde o preço for diferente; a plataforma ausente usa o padrão.

```json
{ "codigo": "X1", "nome": "X-Salada", "categoria": "Lanches", "preco": 28.9,
  "precosPlataforma": { "IFOOD": 32.9 } }
```

- Vale no produto, em `grupos[].opcoes[]` e em `pizza.tamanhos[]`, `massas[]`, `bordas[]` e `sabores[]`.
- No sabor de pizza, o valor substitui o acréscimo naquela plataforma, inclusive o que varia por tamanho. No tamanho, precisa ser maior que zero.
- Chaves aceitas: `IFOOD`, `99FOOD`, `AIQFOME` e `KEETA` (as duas últimas ainda não publicam). Outra chave é recusada.
- `PATCH` de preço em produto ou opção altera só o padrão: a plataforma com preço próprio mantém o dela.
- Reenviar o produto sem o campo volta ao preço padrão.

#### Cardápio: leitura e operações por plataforma
Use `?plataforma=IFOOD` ou `99FOOD` (nas operações de escrita o padrão é iFood).

- `GET /hub/v1/conexao/catalogo` — Resposta das plataformas (`incluirItens`, `formato=unificado`). Na 99Food a leitura é guardada por 60 segundos por loja; com envio na fila ou cota ocupada volta a última leitura (até 10 minutos), com o horário em `lidoEm`
- `GET /hub/v1/conexao/catalogo/unificado` — Mesmo formato para as duas; no iFood, `precosPorTamanho` (`tamanhoId`, `preco`, `status`) traz o preço de cada sabor por tamanho. Confira `avisos[]`
- `GET /hub/v1/conexao/catalogo/itens/{itemId}` — Detalhe do item e complementos
- `GET /hub/v1/conexao/catalogo/nao-vendaveis` — Itens não vendáveis (iFood) ou pausados (99Food)
- `GET /hub/v1/conexao/catalogo/categorias` — Lista única das categorias, com onde cada uma existe (ver abaixo)
- `POST /hub/v1/conexao/catalogo/categorias` — Criar categoria `{ "name": "..." }` (até 100 caracteres). Sem `plataforma`, age nas duas lojas ativas (ver abaixo)
- `PATCH /hub/v1/conexao/catalogo/categorias/{categoriaId}` — Atualizar categoria. Na 99Food reenvia o cardápio inteiro (`409 CATEGORIA_JA_EXISTE` para nome repetido)
- `PUT /hub/v1/conexao/catalogo/itens` — Item completo em uma plataforma. Na 99Food, o envio cru de cardápio responde `400 USE_CATALOGO_PRODUTOS`
- `PATCH /hub/v1/conexao/catalogo/itens/preco` — `{ "itemId": "...", "price": { "value": 29.9 } }`
- `PATCH /hub/v1/conexao/catalogo/itens/status` — `{ "itemId": "...", "status": "AVAILABLE" }` ou `"UNAVAILABLE"`
- `PATCH /hub/v1/conexao/catalogo/opcoes/preco` e `/opcoes/status` — `{ "optionId": "...", ... }`
- `POST /hub/v1/conexao/catalogo/imagem` — `{ "image": "<base64 ou data URI>" }`

Escritas na 99Food por estas rotas:
- Com um envio em andamento ou na fila: `409 CARDAPIO_99_OCUPADO` (repita após `Retry-After`).
- A 99Food aceita 1 leitura e 1 envio de cardápio por minuto: `429 CARDAPIO_99_AGUARDE` ou `429 PLATAFORMA_ERRNO_10005`.
- Prefira `catalogo/produtos`, que entra na fila sozinho.

**Categorias.** Todo produto exige `categoria` (nome); se não existir na plataforma, é criada ao publicar. A comparação ignora maiúsculas, acentos e espaços. No iFood, a pizza nativa (`formatoIfood: "PIZZA"`) fica em seção própria.

```json
{ "plataformas": { "IFOOD": { "estado": "OK", "lidoEm": "..." }, "99FOOD": { "estado": "SEM_LOJA" } },
  "categorias": [ { "nome": "Lanches", "plataformas": ["IFOOD"], "ausenteEm": [],
    "canais": { "IFOOD": [ { "id": "...", "nome": "Lanches", "itens": 3, "status": "AVAILABLE", "template": "DEFAULT" } ] } } ],
  "avisos": ["Sem loja 99Food ativa nesta conexao."] }
```

- `ausenteEm` considera só as plataformas lidas com sucesso; `publicandoEm` indica categoria que um produto na fila vai criar.
- `POST` sem `plataforma` responde `200` com `{ ok, nome, plataformas: { IFOOD, 99FOOD }, avisos }`; `estado` por plataforma: `CRIADA`, `JA_EXISTE`, `PROCESSANDO`, `PENDENTE` (99Food sem itens: nasce com o primeiro produto), `SEM_LOJA` ou `ERRO` (com `erro` e `erroCodigo`).
- `POST` com `plataforma` responde a categoria (`id`, `name`, `plataforma`, `jaExistia`, `estado`) ou o erro HTTP.

### 3.4 Autenticar no Proxy Nativo (Opcional — compatível com SDKs iFood/99Food)
```bash
# Proxy iFood (clientId = conexaoId, clientSecret = hubi_...)
curl -X POST 'https://delivery.targetx.com.br/api/v1/hub/v1/proxy/ifood/authentication/v1.0/oauth/token' \
  -H 'Content-Type: application/json' \
  -d '{"clientId":"<conexaoId>","clientSecret":"<token_da_conexao_hubi>"}'
```
Use o `accessToken` (`hubt_...`) retornado no `Authorization: Bearer <hubt_...>` para todas as rotas oficiais via Hub:
- **Detalhe do pedido:** `GET /hub/v1/proxy/ifood/order/v1.0/orders/{orderId}`
- **Confirmar / Preparar / Despachar / Cancelar:** `POST /hub/v1/proxy/ifood/order/v1.0/orders/{orderId}/{confirm|startPreparation|readyToPickup|dispatch|requestCancellation}`
- **Catálogo V2:** `GET /hub/v1/proxy/ifood/catalog/v2.0/merchants/{merchantId}/catalogs` e `/categories?includeItems=true` (além de `POST/PUT/PATCH/DELETE` para categorias, itens, preços e status).

Na 99Food o token do proxy vem de `POST /hub/v1/proxy/99food/v1/auth/token` (`app_id` = conexaoId, `app_secret` = token `hubi_`, `app_shop_id` = campo `loja` da 99Food). Não envie cardápio da 99Food pelo proxy (`v3/item/item/upload`): ele substitui o cardápio inteiro da loja; use `catalogo/produtos`.

---

## Erros
Formato: `{ "erro": "...", "codigo": "...", "detalhes": {}, "requestId": "..." }`. Trate o `codigo`; informe o `requestId` ao suporte.

| HTTP e código | Quando |
|---|---|
| `401 TOKEN_INVALIDO` | Token ausente, errado, revogado ou do tipo errado para a rota |
| `400 REQUISICAO_INVALIDA` | Campo inválido (`detalhes.campo`) |
| `400 PRODUTO_INVALIDO` | Produto inválido (`detalhes.indice` e `detalhes.campo`) |
| `400 PLATAFORMA_HTTP_<n>` / `PLATAFORMA_ERRNO_<n>` | Recusa do iFood ou da 99Food (resposta em `detalhes`) |
| `409 PEDIDO_OU_LOJA_NAO_E_SEU` | Pedido ou loja de fora da conexão |
| `413 CORPO_GRANDE_DEMAIS` | Corpo acima de 1 MB |
| `429 LIMITE_DA_INSTALACAO` / `MUITAS_TENTATIVAS` | Limite de chamadas; respeite `Retry-After` |
| `502 PLATAFORMA_INDISPONIVEL` | Falha ao falar com a plataforma |
| `503 HUB_DESLIGADO` / `HUB_INDISPONIVEL` | Hub indisponível |

Envie um `User-Agent` próprio. A proteção de borda (Cloudflare) pode responder `403` com `error code: 1010` a alguns User-Agents padrão de bibliotecas; essa resposta não segue o formato acima.

## Excluir categoria

`DELETE /hub/v1/conexao/catalogo/categorias?nome=Bebidas` exclui nas duas plataformas (ou use `&plataforma=IFOOD`). Só exclui categoria sem produtos: com produtos, o estado volta `COM_PRODUTOS`. A 99Food não aceita cardápio sem nenhuma categoria.
