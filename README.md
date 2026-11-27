# Gestor Delivery ERP — App de Referência e Homologação (`erp-simulador`)

Aplicativo independente de referência para integradores ERP consumirem o **Hub Target Delivery** com **banco próprio** (SQLite WAL simulando o banco local do ERP), **Webhook PUSH instantâneo** por máquina, **SSE em tempo real**, **pedidos unificados** (iFood, 99Food e Target Delivery) e **cardápio completo unificado**.

- **URL publicada:** `https://delivery.targetx.com.br/erp-simulador/`
- **Repositório:** `https://github.com/kauandlopes/app_teste_integracao`
- **Documentação de Variáveis, Segurança e Fluxo Completo:** [docs/VARIAVEIS-E-SEGURANCA-ERP.md](docs/VARIAVEIS-E-SEGURANCA-ERP.md)

---

## Resumo Rápido: O que é do ERP vs O que é do Delivery

- **Token Integrador (`hubp_...`):** **Sempre o mesmo** para o software ERP parceiro (em todas as máquinas dos clientes). Fica guardado no backend do ERP, nunca exposto ao lojista.
- **Túnel / URL do Webhook (`https://.../webhook`):** **Variável por máquina/cliente** (cada instalação informa sua URL pública HTTPS ao conectar).
- **Banco de Dados (`data/erp-hub.sqlite` neste app):** **Próprio do ERP**. O ERP mantém suas tabelas locais (`config`, `pedidos`, `catalogo_categorias`, `catalogo_itens`) e nunca acessa o PostgreSQL do Target Delivery.
- **Serviços exclusivos do Target Delivery (NÃO replicar no ERP final):** logs de infraestrutura do servidor Delivery, fila interna de monitoramento global, rotas `/hub/v1/admin/*`, `HUB_MASTER_TOKEN` e credenciais OAuth dos aplicativos iFood/99Food.

---

## Estrutura de Arquivos

- [docs/VARIAVEIS-E-SEGURANCA-ERP.md](docs/VARIAVEIS-E-SEGURANCA-ERP.md) — Tabela completa de variáveis por campo, fronteiras de segurança e fluxos pós-vínculo.
- `src/server/db.ts` — Banco SQLite WAL local do ERP (`config`, `pedidos`, `catalogo_categorias`, `catalogo_itens`, `logs_http`).
- `src/server/hubClient.ts` — Cliente HTTP com mascaramento de tokens nos logs, normalização de pedidos (`upsertPedidoDoDetalhe`, incluindo entregadores e cancelamentos/disputas) e fallback PULL.
- `src/server/app.ts` — Servidor Express (porta `3004`), receptor `POST /api/webhook` com validação HMAC SHA-256 + SSE `GET /api/stream`, rotas de pedidos (`avaliar`, `importar-sistema`, `acao` com entregador e cancelamentos) e cardápio unificado.
- `src/client/`:
  - `TelaEntrada.tsx`: entrada com o token fixo do integrador (`hubp_...`).
  - `PainelConexao.tsx`: conexão 1:1 (CNPJ + URL PUSH da máquina), auto-vínculo/liberação de lojas, pausas e ferramentas de homologação recolhidas por padrão.
  - `KanbanPedidos.tsx`: Kanban 5 colunas com atualização instantânea via SSE, despacho com entregador (`Nome` e `Telefone`), troca de entregador, aceite/recusa de solicitação de cancelamento do cliente e cancelamento com motivos reais.
  - `GestorCatalogo.tsx`: cardápio completo unificado iFood + 99Food com categorias, itens, preços em reais, disponibilidade e grupos de complementos/adicionais.
  - `ModalLogs.tsx`: log local apenas para homologação/depuração do integrador.

---

## Comandos Operacionais

```bash
cd /var/www/app-balanço/erp-simulador

# Instalar dependências
npm install

# Validar TypeScript e gerar build do frontend (dist/client)
npm run typecheck && npm run build

# Reiniciar processo no PM2
pm2 restart erp-simulador

# Verificar saúde local
curl http://127.0.0.1:3004/erp-simulador/api/saude
```
