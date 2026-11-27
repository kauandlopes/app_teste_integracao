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
| Prazo na 99Food | Cerca de 1 minuto. Ela aceita 1 leitura e 1 envio de cardápio por minuto por loja |
| Resposta "aguarde X segundos" ou `CARDAPIO_99_OCUPADO` | Esperar o tempo de `Retry-After` e repetir |
| Publicar e alterar produto | Usar `catalogo/produtos`, que enfileira sozinho |
| Retorno do produto | Olhar `canais.<plataforma>.estado`, `erroCodigo`, `avisos` e `envioEmSegundos` |
| Excluir o último produto na 99Food | Se ela não aceitar cardápio vazio, o item fica pausado e o aviso informa |
| Item apagado no portal da plataforma | O ERP não é avisado. Use Reenviar para publicar de novo |
| Foto | JPEG ou PNG, no mínimo 150 x 150 pixels, até 5 MB. A 99Food analisa a imagem antes de exibir |
| Número de loja da 99Food | Sempre como texto, nunca como número |
| Primeiro vínculo de loja 99Food | Pode levar cerca de 30 segundos |
| Conexão encerrada (`401 TOKEN_INVALIDO`) | Conectar de novo e passar a usar o token novo |

## Novidades

- Alterar dados da loja: `GET` e `PATCH conexao/loja/dados`, `POST conexao/loja/funcionamento`.
- Categorias por plataforma: `GET conexao/catalogo/categorias`.
- Lojas 99Food de produção e de teste aparecem juntas, com `ambiente`, `appId` e `appNome`.

## Documentação

- [Guia rápido](docs/hub/GUIA-RAPIDO-ERP-1-1.md)
- [OpenAPI do integrador](docs/hub/openapi-integrador-v1.json)
- [Cardápio](docs/CARDAPIO.md) e [Pedidos](docs/PEDIDOS.md)
