# Gestor Delivery ERP: integrador de referência (`erp-simulador`)

Aplicativo independente que mostra como um ERP consome o **Hub Target Delivery** para operar **pedidos** e
**cardápio** do iFood e da 99Food, com banco próprio (SQLite).

- **URL publicada:** `https://delivery.targetx.com.br/erp-simulador/`
- **Repositório:** `https://github.com/kauandlopes/app_teste_integracao`

## Documentação

**Leia primeiro: [AVISOS.md](AVISOS.md)**

| Documento | Conteúdo |
|---|---|
| [docs/hub/](docs/hub/) | Guia rápido e OpenAPI do Hub (cópia de 27/11/2026) |
| [docs/PEDIDOS.md](docs/PEDIDOS.md) | Chegada sem perda, todos os eventos, ações por plataforma, disputas, cancelamento e reembolso |
| [docs/CARDAPIO.md](docs/CARDAPIO.md) | Produto com adicionais e pizza, fila de publicação, diferenças entre plataformas |
| [docs/VARIAVEIS-E-SEGURANCA-ERP.md](docs/VARIAVEIS-E-SEGURANCA-ERP.md) | Variáveis por campo, fronteiras de segurança e conexão |

Na tela, **Tokens e rotas** mostra as credenciais em uso e o cURL de cada rota do Hub; **Logs** guarda requisições,
respostas, webhooks e as falhas de eventos e tarefas.

## Estrutura

```
src/shared/tipos.ts          contrato entre servidor e tela
src/server/
  app.ts, index.ts           montagem e inicialização
  workers.ts                 tarefas periódicas (PULL, fila, reconciliação, publicação)
  db.ts                      tabelas SQLite e migração de colunas
  hubClient.ts               chamadas ao Hub, logs e leitura de inteiros de 64 bits
  stream.ts                  atualização em tempo real (SSE)
  conexao/rotas.ts           token, CNPJ, lojas, pausas, credenciais e logs
  pedidos/                   eventos, regras de ação, detalhe, repositório, processador, rotas
  catalogo/                  validação, fila de publicação, espelho das plataformas, rotas
src/client/                  telas React
test/                        testes com Hub falso (não acessam o Hub real)
```

## Comandos

```bash
cd /var/www/app-balanço/erp-simulador

npm install
npm run typecheck
npm test                      # banco temporário e Hub falso
npm run build                 # gera dist/client
pm2 restart erp-simulador
curl http://127.0.0.1:3004/erp-simulador/api/saude
```

Variáveis do processo: `PORT` (padrão 3004) e `DB_PATH` (padrão `data/erp-hub.sqlite`).

## Cuidados

- Este app **não tem login** e mostra tokens: é uma ferramenta de homologação.
- Publicar produto envia para as **lojas vinculadas** à conexão, e na 99Food reenvia o cardápio inteiro. Confira em
  "Lojas e operação" qual loja está ligada antes de publicar.
- Pedidos de teste da tela são simulados pelo Hub e não chamam as plataformas.
