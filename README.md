# Gestor Delivery ERP — Aplicativo Standalone (`erp-simulador`)

Aplicativo independente do monorepo `/var/www/delivery`, com banco **SQLite** próprio (`better-sqlite3`), backend **Express** na porta `3004` e frontend **React + Vite**, publicado em:

- **URL pública:** `https://delivery.targetx.com.br/erp-simulador/`
- **Proxy Nginx:** [/etc/nginx/sites-available/delivery.targetx.com.br](file:///etc/nginx/sites-available/delivery.targetx.com.br) (`location /erp-simulador` -> `http://127.0.0.1:3004`)
- **Processo PM2:** `erp-simulador`

---

## 1. Estrutura de Arquivos

- `src/server/db.ts` — Inicializa o SQLite em `data/erp-hub.sqlite` (modo WAL) com as tabelas:
  - `config`: URL base da API, token do integrador (`hubp_`), CNPJ, `conexaoId`, `tokenConexao` (`hubi_`), transporte (`PULL`/`PUSH`) e lojas vinculadas.
  - `pedidos`: pedidos sincronizados do Hub e cards de simulação local do Kanban.
  - `catalogo_categorias` e `catalogo_itens`: espelho local do cardápio (iFood e 99Food).
  - `logs_http`: histórico persistente (até 1000 registros) de todas as chamadas HTTP, webhooks e erros (`400`, `401`, `409`, `500`), com headers, body, resposta e `cURL`.
- `src/server/hubClient.ts` — Cliente HTTP do Hub V1 (`hubFetch`), gravação automática em `logs_http` e worker `sincronizarComHub()` (a cada 5s em modo `PULL`, busca eventos e confirma cursor).
- `src/server/app.ts` — API local `/erp-simulador/api/*` e entrega dos estáticos de `dist/client`.
- `src/client/` — Interface React:
  - `TelaEntrada.tsx`: login por token do integrador (`hubp_...`) como senha; menu `⋮` para URL da API, logs e tema.
  - `PainelConexao.tsx`: conexão 1:1 (CNPJ), listagem/vínculo de lojas livres (iFood e 99Food) e pausas programadas.
  - `KanbanPedidos.tsx`: quadro Kanban em 5 colunas (*Novos*, *Em Preparo*, *Prontos*, *Saiu para Entrega*, *Finalizados / Cancelados*), `+ Novo Pedido Teste`, avanço de etapas, edição manual e cancelamento com motivos reais.
  - `GestorCatalogo.tsx`: categorias (`↑`/`↓`, ativar/pausar, renomear, criar), edição inline de preço, alternância **Visível / Pausado** (sumir/voltar item), criação/edição de item, complementos/opções e diagnóstico de não vendáveis no `⋮`.
  - `ModalLogs.tsx`: visualizador dos logs SQLite (`Todos`, `Erros`, `Sucesso`, busca, exportação JSON e `Copiar cURL`).

---

## 2. Comandos Operacionais

```bash
cd /var/www/app-balanço/erp-simulador

# Instalar dependências
npm install

# Validar TypeScript e gerar build do frontend (dist/client)
npm run typecheck && npm run build

# Reiniciar no PM2
pm2 restart erp-simulador

# Saúde da API local
curl http://127.0.0.1:3004/erp-simulador/api/saude
```

---

## 3. Fluxo Padrão dos Clientes ERP (1:1)

1. **Login no App:** informar o token do integrador (`hubp_...`).
2. **Conectar CNPJ (`POST /hub/v1/integracao/conectar`):** vincula 1 CNPJ à integração e obtém o token da conexão (`hubi_...`).
3. **Vincular Loja (`GET /hub/v1/conexao/lojas-disponiveis` + `POST /hub/v1/conexao/lojas`):** associa a loja iFood e/ou 99Food disponível.
4. **Pedidos (`PULL` ou `PUSH`):**
   - `GET /hub/v1/eventos` + `POST /hub/v1/eventos/confirmar`
   - `GET /hub/v1/conexao/pedidos/:pedidoId`
   - `POST /hub/v1/conexao/pedidos/:pedidoId/acao` (`confirm`, `startPreparation`, `readyToPickup`, `dispatch`, `requestCancellation`, etc.)
5. **Catálogo:**
   - `GET /hub/v1/conexao/catalogo`
   - `POST /hub/v1/conexao/catalogo/categorias` / `PATCH /hub/v1/conexao/catalogo/categorias/:id`
   - `PUT /hub/v1/conexao/catalogo/itens`
   - `PATCH /hub/v1/conexao/catalogo/itens/status` e `/itens/preco`
   - `PATCH /hub/v1/conexao/catalogo/opcoes/status` e `/opcoes/preco`
6. **Loja (Status e Pausas):**
   - `GET /hub/v1/conexao/loja/status`
   - `POST /hub/v1/conexao/loja/interrupcoes` e `DELETE /hub/v1/conexao/loja/interrupcoes/:id`
