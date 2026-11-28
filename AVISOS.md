# Avisos para quem integra o ERP ao Hub

Atualizado em 27/11/2026. App de testes. by: Kauan

## Fazer agora

1. Reenviar uma vez os produtos que têm foto. Até esta data, um novo envio de cardápio apagava as fotos dos outros produtos na 99Food.
2. Reenviar o produto `000002`, perdido em uma atualização do servidor.

## Regras que valem sempre

| Assunto | Regra |
|---|---|
| Categoria | Todo produto precisa de categoria. Se faltar em uma plataforma, é criada ao publicar |
| Criar categoria sem `?plataforma` | Cria no iFood e na 99Food (antes era só no iFood) |
| Prazo na 99Food | De poucos segundos a alguns minutos. Ver "Por que a 99Food demora", abaixo |
| Resposta "aguarde X segundos" ou `CARDAPIO_99_OCUPADO` | Esperar o tempo de `Retry-After` e repetir |
| Publicar e alterar produto | Usar `catalogo/produtos`, que enfileira sozinho |
| Retorno do produto | Olhar `canais.<plataforma>.estado`, `erroCodigo`, `avisos` e `envioEmSegundos` |
| Excluir o último produto na 99Food | Se ela não aceitar cardápio vazio, o item fica pausado e o aviso informa |
| Item apagado no portal da plataforma | O ERP não é avisado. Use Reenviar para publicar de novo |
| Foto | JPEG ou PNG, no mínimo 150 x 150 pixels, até 5 MB. Foto nova só aparece depois da análise da 99Food |
| Muitos produtos | Um por requisição, até 4 ao mesmo tempo. Todos saem juntos no envio da 99Food |
| Consultar muitos produtos | `GET conexao/catalogo/produtos` (uma chamada), não um por um |
| Número de loja da 99Food | Sempre como texto, nunca como número |
| Primeiro vínculo de loja 99Food | Pode levar cerca de 30 segundos |
| Conexão encerrada (`401 TOKEN_INVALIDO`) | Conectar de novo e passar a usar o token novo |

## Por que a 99Food demora

O iFood publica em segundos. A 99Food não recebe um produto sozinho: o Hub lê o cardápio da loja, junta o produto e envia o cardápio inteiro. Por loja, ela permite ler 2 vezes a cada 2 minutos, enviar 1 vez por minuto e receber 5 fotos a cada 10 segundos. Um envio por minuto não é um produto por minuto: tudo o que está na fila vai junto.

| Situação | Tempo observado |
|---|---|
| Limites livres | Cerca de 10 segundos |
| 120 produtos de uma vez (28/11) | Cerca de 1 min 30 s; com 120 fotos diferentes, no mínimo 4 min |
| Houve envio ou leitura há pouco | Cerca de 1 a 2 minutos de espera |
| Processamento dentro da 99Food | Em geral menos de 10 segundos; já levou perto de 3 minutos |

- Produtos enviados em sequência saem juntos em um dos próximos envios.
- Não reenviar enquanto o produto estiver processando ou na fila.
- Consultar o cardápio ou as categorias gasta a cota de leitura e pode atrasar a publicação. Não consultar em laço.
- Pausar e reativar item publicado costuma valer na hora. Preço e cadastro dependem do envio do cardápio.
- Mudança feita no painel da 99Food em outros itens é mantida. No produto reenviado vale o cadastro do ERP.
- Foto nova só aparece depois da análise da 99Food, que pode demorar ou recusar. Usar foto real do produto e conferir no portal dela.
- Evitar lote grande numa só requisição: o servidor corta em 60 segundos.

## Novidades

- Alterar dados da loja: `GET` e `PATCH conexao/loja/dados`, `POST conexao/loja/funcionamento`.
- Categorias por plataforma: `GET conexao/catalogo/categorias`.
- Lojas 99Food de produção e de teste aparecem juntas, com `ambiente`, `appId` e `appNome`.

## Documentação

- [Guia rápido](docs/hub/GUIA-RAPIDO-ERP-1-1.md)
- [OpenAPI do integrador](docs/hub/openapi-integrador-v1.json)
- [Cardápio](docs/CARDAPIO.md) e [Pedidos](docs/PEDIDOS.md)
