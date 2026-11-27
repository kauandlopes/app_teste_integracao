# Guia Completo: Variáveis por Campo, Fronteiras de Segurança e Fluxo do ERP

Este documento define **exatamente**:
1. Quais campos são **fixos** no software ERP parceiro vs **variáveis por máquina/cliente** vs **gerados pelo Hub**;
2. O que **NUNCA** pode ficar exposto ou acessível no ERP final (responsabilidade exclusiva do servidor Target Delivery);
3. Como funciona toda a **operação ponta a ponta** após amarrar os sistemas (banco próprio do ERP, webhook PUSH instantâneo, pedidos, entregadores, cancelamentos, disputas e cardápio completo unificado iFood + 99Food).

---

## 1. Dicionário de Variáveis por Campo (Fixo vs Por Máquina vs Por Conexão)

### A. Variáveis de Infraestrutura e Autenticação do Software ERP (Configuradas no ERP)

| Campo / Variável | Escopo | Origem / Quem Define | Obrigatório? | Descrição e Regra |
|---|---|---|---|---|
| `baseUrl` (`https://delivery.targetx.com.br/api/v1`) | **Fixo** (por ambiente: produção/homologação) | Target Delivery | Sim | URL base da API do Hub Target. |
| `tokenIntegracao` (`hubp_...`) | **Fixo no software ERP** (mesmo token para todos os clientes/máquinas do ERP) | Target entrega 1 vez ao cadastrar o integrador | Sim | Identifica o sistema ERP parceiro (`X-Integrador` / Bearer em `/hub/v1/integracao/*` e `/hub/v1/conexoes/*`). **Nunca** deve ser digitado pelo lojista em produção — fica guardado no `.env`/cofre do backend do ERP. |
| `webhook.url` (Túnel HTTPS da máquina/servidor) | **Variável por máquina / servidor do cliente ERP** | Cada instalação do ERP | Sim (para PUSH) | Ex.: `https://loja-centro.meuerp.com.br/webhook` ou túnel próprio da loja. Cada cliente do ERP pode ter uma URL diferente. No modo simplificado 1:1 (`/hub/v1/integracao/conectar`), origens `https://` válidas têm túnel habilitado automaticamente; no modo estrito (`/hub/v1/conexoes`), a origem precisa estar cadastrada em `hub_tunel`. |
| `PORT` / `DB_PATH` | **Variável por máquina** | Ambiente do ERP | Sim | Porta local do processo e caminho/DSN do **banco de dados próprio do ERP** (no simulador usamos SQLite WAL `data/erp-hub.sqlite`; no ERP real é o PostgreSQL/SQLServer/Firebird/MySQL do próprio ERP). |

### B. Variáveis do Estabelecimento (Informadas uma vez ao conectar a loja)

| Campo | Escopo | Origem | Obrigatório? | Descrição e Regra |
|---|---|---|---|---|
| `cnpj` | **Variável por cliente (loja)** | Cadastro da loja no ERP | Sim | 14 dígitos numéricos sem máscara (`04503163000148`). Chave de isolamento multi-tenant da loja no Hub. |
| `nome` | **Variável por cliente (loja)** | Cadastro da loja no ERP | Sim | Razão social ou nome fantasia da loja. |
| `lojaExternaId` | **Variável por cliente (loja)** | ID da loja no ERP | No `/conexoes` (opcional no 1:1) | Código único da filial dentro do ERP (sem espaços). No fluxo 1:1, se omitido, usa o próprio `cnpj`. |
| `transporte` | **Por conexão** (`PUSH` recomendado) | ERP | Não (padrão `PUSH` quando há `webhook.url`) | `PUSH` = Webhook instantâneo (recomendado). `PULL` = Long-poll legado (`GET /hub/v1/eventos`). |
| `plataformas` | **Por conexão** | ERP | Sim (`['IFOOD', '99FOOD']`) | Canais desejados pela loja. |

### C. Credenciais e Estado Salvos no Banco Próprio do ERP (Retorno do Hub)

O ERP **deve persistir estas informações no seu próprio banco de dados** (tabela `config` no simulador):

| Campo | Escopo | Quando volta do Hub | Regra de Uso e Segurança |
|---|---|---|---|
| `conexaoId` (`UUID`) | Por loja/máquina | `POST /hub/v1/integracao/conectar` | Identificador da instalação dessa loja no Hub (`X-Target-Conexao`). |
| `tokenConexao` (`hubi_...`) | Por loja/máquina | Somente na criação (`201`) ou via `POST /recuperar-token` | **Bearer Token exclusivo da loja** para todas as rotas operacionais (`/hub/v1/conexao/*`). Só dá acesso às lojas deste CNPJ. |
| `webhookSegredo` | Por loja/máquina | Na ativação do `PUSH` ou via `POST /webhook/segredo/rotacionar` | Segredo usado para validar a assinatura HMAC SHA-256 (`X-Target-Assinatura`) nos webhooks recebidos em `POST /webhook`. **Nunca** deve aparecer na UI final do lojista. |
| `estadoConexao` | Por loja/máquina | `GET /hub/v1/conexao` | `ATIVA`, `PARCIAL`, `PENDENTE`, `EM_MIGRACAO` ou `REVOGADA`. |
| `lojasVinculadas` | Por loja/máquina | `GET /hub/v1/conexao` e `POST /hub/v1/conexao/lojas` | Lista `[{ plataforma, estado, loja, lojaExterna, nome }]` contendo o `merchantId` (iFood) ou `app_shop_id` (99Food) vinculados. |

### D. Campos de Pedidos Unificados (Banco Próprio do ERP)

Independentemente de o pedido vir do **iFood**, da **99Food** ou do **Target Delivery**, o Hub entrega ao ERP (`GET /hub/v1/conexao/pedidos/:id?formato=unificado` e `avaliar-pedido`) os mesmos campos normalizados:

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | `string` | UUID do iFood/TD ou ID 64-bit da 99Food (`order_id`). Chave primária no banco do ERP. |
| `codigoExibicao` | `string` | Número curto exibido na cozinha/balcão (ex.: `4821`). |
| `canal` | `'IFOOD' \| '99FOOD' \| 'TD'` | Canal de origem do pedido. |
| `statusKanban` | `NOVO \| PREPARO \| PRONTO \| ENTREGA \| CONCLUIDO \| CANCELADO` | Etapa padronizada no fluxo operacional do ERP. |
| `etapaOriginal` | `string` | Código bruto do evento (`PLACED`, `CONFIRMED`, `READY_TO_PICKUP`, `DISPATCHED`, `CONCLUDED`, `CANCELLED`, `CANCELLATION_REQUESTED`, etc.). |
| `tipoEntrega` | `'DELIVERY' \| 'RETIRADA'` | Modalidade normalizada. |
| `entreguePor` | `'MERCHANT' \| 'IFOOD' \| 'PLATFORM' \| 'CUSTOMER' \| null` | Quem faz a entrega. Define se o ERP envia entregador próprio (`MERCHANT`). |
| `cliente` | `{ nome, telefone, documento, telefoneVirtual, localizador }` | **Regra de ouro:** em pedidos de iFood/99Food, use o telefone virtual + localizador da plataforma; nunca sobrescreva clientes do PDV pelo telefone 0800 compartilhado. |
| `enderecoEntrega` | `{ formatado, logradouro, numero, complemento, bairro, cidade, uf, cep, referencia } \| null` | Endereço completo quando `DELIVERY`. |
| `valores` | `{ moeda: 'BRL', subtotal, taxaEntrega, total, trocoPara }` | Valores **sempre em reais (`float`)** — inclusive na 99Food (conversão automática de centavos). |
| `pagamento` | `{ forma, pagoOnline }` | Forma normalizada e indicador se já foi pago online no app. |
| `itens` | `Array<{ id, nome, quantidade, precoUnitario, precoTotal, observacao, codigoExterno, modificadores[] }>` | Itens com SKU/código externo (`codigoExterno`) e todos os adicionais/sabores/bordas achatados em `modificadores`. |
| `entregador` (opcional) | `{ nome, telefone }` | Preenchido pelo ERP quando despacha entrega própria. |
| `solicitacaoCancelamento` | `{ pendente, etapa, disputeId?, motivo }` | Presente quando o cliente pediu cancelamento na plataforma e aguarda resposta do ERP. |

### E. Campos de Cardápio Unificado (iFood + 99Food)

Retornados por `GET /hub/v1/conexao/catalogo/unificado`:

- **Categoria:** `{ id, plataforma, nome, status ('AVAILABLE' | 'UNAVAILABLE'), template ('DEFAULT' | 'PIZZA'), ordem, itens[] }`
- **Item:** `{ id, productId?, categoriaId, plataforma, nome, descricao, sku, imagemUrl, preco (sempre em reais), status, ordem, grupos[] }`
- **Grupo de Adicionais:** `{ id, nome, min, max, status, opcoes[] }`
- **Opção / Adicional:** `{ id, nome, sku, preco (sempre em reais), status }`

---

## 2. O Que NÃO Pode Ter Fácil Acesso / Exposto ao ERP

Esta fronteira garante segurança multi-tenant, LGPD e isolamento entre os 60 clientes do ERP e a plataforma Target Delivery:

| Recurso / Informação Restrita | Por que o ERP NÃO pode acessar ou expor | Onde fica |
|---|---|---|
| **Logs do servidor Delivery e fila interna (`hub_entrega`, erro de infra)** | Serviço exclusivo de observabilidade e operação da Target Delivery. O cliente/ERP não deve enxergar logs internos do Delivery nem métricas de outros tenants. *(No simulador existe uma inspeção recolhida apenas para homologação.)* | Servidor API Target Delivery |
| **Credenciais OAuth dos apps iFood e 99Food da Target (`clientId`, `clientSecret`, `app_secret`, `refreshToken`, `auth_token`)** | A chave do aplicativo oficial da Target no Portal do Parceiro é compartilhada; vazar compromete toda a rede de lojas. | Vault/Banco criptografado no Target Delivery |
| **Rotas administrativas (`HUB_MASTER_TOKEN` / `/hub/v1/admin/*` e `/hub/v2/admin/*`)** | Permitem gerenciar integradores, aprovar empresas do Delivery, revogar conexões e ver monitor global. | Restrito à Target (IP/Master Token) |
| **Dados de outros CNPJs / outras lojas** | Cada `hubi_` enxerga exclusivamente a sua conexão; tentativas para outro pedido/loja retornam `403/404`. | Isolado por `instalacaoId` e `empresaId` no Hub |
| **Banco de dados PostgreSQL do Delivery** | O ERP nunca lê/escreve diretamente no banco do Delivery; o ERP tem seu **próprio banco** e sincroniza via API/Webhook. | Rede interna Target |
| **`webhookSegredo` e `tokenIntegracao` (`hubp_`) na UI do lojista** | São segredos de sistema (backend-to-backend). Nunca devem ir para HTML/LocalStorage público de tela de caixa ou prints não mascarados. | Backend do ERP (`.env` / cofre criptografado) |

---

## 3. Fluxo Operacional Completo Depois de Amarrado

Depois que a conexão (`hubp_` + CNPJ + `webhook.url` da máquina + vínculo da loja) está amarrada:

1. **Chegada de Pedido (Webhook PUSH Instantâneo):**
   - Cliente faz pedido no iFood ou 99Food -> Hub dispara `POST <webhook.url>` assinado com `X-Target-Assinatura: v1=<HMAC-SHA256>` (latência típica < 100 ms).
   - O receptor do ERP valida a assinatura HMAC usando `webhookSegredo`, deduplica por `X-Target-Notificacao`, busca `GET /hub/v1/conexao/pedidos/:pedidoId?plataforma=...&formato=unificado` (se o payload não vier completo) e **grava no banco próprio do ERP** + atualiza a tela em tempo real.
   - Se o endpoint do ERP estiver fora do ar (5xx/timeout), o Hub faz retry com backoff exponencial mantendo a ordem por pedido.

2. **Ciclo Normal do Pedido no ERP:**
   - **Aceitar:** `POST /hub/v1/conexao/pedidos/:id/acao` `{ "acao": "confirm" }`
   - **Iniciar preparo:** `{ "acao": "startPreparation" }` *(no iFood envia à plataforma; na 99Food é aceito de forma idempotente)*
   - **Pronto para retirada / coleta:** `{ "acao": "readyToPickup" }`
   - **Despachar (com ou sem entregador):** `{ "acao": "dispatch", "dados": { "courierName": "João Silva", "courierPhone": "11999998888" } }`
     - Na entrega própria da **99Food**, o Hub monta automaticamente `courier_info` + `limit_time` e chama `/v1/order/selfdelivery/dispatch`.
   - **Alterar entregador em rota:** `{ "acao": "updateCourier", "dados": { "courierName": "Maria Souza", "courierPhone": "11988887777" } }` -> na 99Food chama `/v1/order/selfdelivery/updateCourierInfo`; no iFood atualiza localmente.
   - **Validar código de entrega/coleta (quando exigido):** `{ "acao": "validatePickupCode", "dados": { "code": "1234" } }`
   - **Concluir entrega:** `{ "acao": "conclude" }` *(na 99Food envia `/v1/order/order/delivered`; no iFood conclui no fluxo local após despacho)*.

3. **Cancelamentos (Todos os 3 cenários funcionam):**
   - **Cancelado pela plataforma/cliente direto (`CANCELLED` / `orderCancel`):** chega via Webhook PUSH instantâneo -> o ERP move o pedido para `CANCELADO` imediatamente e registra o motivo.
   - **Solicitação de cancelamento / disputa pelo cliente (`CANCELLATION_REQUESTED`, `HANDSHAKE_DISPUTE`, `orderCancelApply`):** chega via Webhook PUSH -> o ERP exibe alerta para o atendente decidir:
     - **Aceitar:** `{ "acao": "acceptCancellation", "dados": { "disputeId": "..." } }`
     - **Recusar:** `{ "acao": "denyCancellation", "dados": { "disputeId": "...", "reason": "Pedido já saiu para entrega" } }`
   - **Cancelado pelo ERP / Loja (`requestCancellation`):**
     - ERP consulta `GET /hub/v1/conexao/pedidos/:id/subrecurso?tipo=motivos&plataforma=...` (retorna motivos reais tanto do iFood quanto da 99Food).
     - ERP envia `POST /hub/v1/conexao/pedidos/:id/acao` `{ "acao": "requestCancellation", "dados": { "cancellationCode": "...", "reason": "..." } }` *(na 99Food, se o pedido ainda não havia sido confirmado, o Hub confirma antes automaticamente conforme exigência da plataforma)*.

4. **Cardápio Completo (iFood + 99Food):**
   - Sincronização inicial/manual: `GET /hub/v1/conexao/catalogo/unificado` traz todas as categorias, itens, grupos de modificadores, opções/adicionais e preços sempre em reais (`float`) tanto do iFood quanto da 99Food.
   - Alteração de preço na 99Food preserva automaticamente `app_modifier_group_ids` (não desvincula adicionais).
   - Alterações de status/preço de itens e opções funcionam nos dois canais pelo mesmo conjunto de rotas `/hub/v1/conexao/catalogo/*`.


---

## 4. Rota do Webhook, Como Puxar Pedidos e API Genérica para Futuras Integrações

### A. Qual rota de Webhook configurar
- **No app de homologação atual:** `POST https://delivery.targetx.com.br/erp-simulador/api/webhook`
- **No seu ERP de produção (1 rota por máquina/servidor ou túnel):** qualquer URL HTTPS própria informada no campo `webhook.url` ao chamar `POST /hub/v1/integracao/conectar` (ex.: `https://loja-01.seuerp.com.br/webhook`).
- **Headers recebidos em cada POST do Hub:** `X-Target-Assinatura` (`v1=<hmac>`), `X-Target-Timestamp`, `X-Target-Notificacao`, `X-Target-Plataforma`, `X-Target-Tipo`, `X-Target-Pedido`, `X-Target-Seq`.
- **Assinatura HMAC:** `HMAC_SHA256(webhookSegredo, "${timestamp}.${notificacaoId}.${rawBody}")`, validada obrigatoriamente em tempo constante (`crypto.timingSafeEqual`); ausente ou divergente deve retornar **HTTP 401**.

### B. Como o ERP puxa e processa pedidos (PUSH + Fallback Unificado)
1. **Via Webhook PUSH (principal, instantâneo):** valida HMAC -> deduplica por `X-Target-Notificacao` -> se `body.pedido` já vier completo usa direto; se não vier, consulta `GET /hub/v1/conexao/pedidos/{pedidoId}?plataforma={canal}&formato=unificado` com `Bearer <tokenConexao_hubi>` -> grava no banco do ERP com proteção monotônica de status (nunca regredir `CONCLUIDO`/`CANCELADO`) -> responde **HTTP 200**.
2. **Via Consulta / Reconciliação / Pedidos Target Delivery:**
   - `GET /hub/v1/conexao/pedidos?limite=30` (pedidos recebidos no Hub)
   - `GET /hub/v1/conexao/pedidos?incluirSistema=true&limite=30` (pedidos já salvos no Target Delivery no mesmo formato `PedidoUnificadoHub`)
   - Se `PULL` estiver ligado em máquina sem túnel: `GET /hub/v1/eventos?espera=25&limite=50` + `POST /hub/v1/eventos/confirmar` `{ "ate": maxSeq }`.

### C. Contrato Genérico para TODAS as Integrações (iFood, 99Food e futuras plataformas)
Toda integração atual (`IFOOD`, `99FOOD`, `TD`) e futura (ex.: `KEETA`, `AIQFOME`, `RAPPI`) trafega pelas **mesmas rotas agnósticas**:
- Conexão: `POST /hub/v1/integracao/conectar`, `GET /hub/v1/conexao`, `POST /hub/v1/conexao/lojas`
- Pedidos e ações: `GET /hub/v1/conexao/pedidos/:id?formato=unificado`, `POST /hub/v1/conexao/pedidos/:id/acao`, `GET /hub/v1/conexao/pedidos/:id/subrecurso?tipo=motivos|rastreio|sacola`
- Catálogo: `GET /hub/v1/conexao/catalogo/unificado`, `PATCH /hub/v1/conexao/catalogo/itens/preco`, `PATCH /hub/v1/conexao/catalogo/itens/status`, `PATCH /hub/v1/conexao/catalogo/opcoes/preco`, `PATCH /hub/v1/conexao/catalogo/opcoes/status`
- Status da loja: `GET /hub/v1/conexao/loja/status`
