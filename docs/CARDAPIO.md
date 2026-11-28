# Cardápio: um cadastro, dois canais

O ERP é a fonte da verdade: o produto é gravado no banco do ERP e publicado no iFood e na 99Food pela rota
`catalogo/produtos` do Hub. Código: `src/server/catalogo/`.

## 1. Fluxo de uma alteração

```
Tela ─> valida e grava (tabela produtos) ─> fila_catalogo ─> Hub ─> iFood / 99Food
                                                              └─> estado por canal volta para a tela
```

| Ação na tela | Chamada ao Hub |
|---|---|
| Criar ou editar produto | `POST /conexao/catalogo/produtos` (definição completa) |
| Preço ou pausa do produto simples | `PATCH /conexao/catalogo/produtos/{codigo}` |
| Preço ou pausa de adicional | `PATCH /conexao/catalogo/produtos/{codigo}/opcoes/{opcao}` |
| Preço de sabor, massa ou borda de pizza | Republica o produto (o Hub não aceita ajuste direto de preço em pizza) |
| Excluir | `DELETE /conexao/catalogo/produtos/{codigo}` |
| Consultar resultado da 99Food | `GET /conexao/catalogo/produtos/{codigo}` a cada 15 s enquanto `PROCESSANDO` |
| Lista de categorias no cadastro | `GET /conexao/catalogo/categorias` ao abrir o cadastro (o ERP reaproveita a resposta por 60 s) |
| Criar categoria avulsa ("Nas plataformas") | `POST /conexao/catalogo/categorias` sem `plataforma`: cria nas duas |

Regras da fila:

- Uma operação por vez, um produto por requisição, com tempo limite de 65 s.
- Limite de frequência (errno 10005/12021, 429), erro 5xx ou rede: nova tentativa em 5, 15, 65, 120 e 300 s (8 vezes),
  nunca antes do `Retry-After` informado pelo Hub.
- Cada canal traz `erroCodigo` (mostrado junto da mensagem), `avisos[]` e `envioEmSegundos`. O ERP guarda o horário
  previsto do envio e mostra "enviando em Xs" enquanto o canal processa.
- Aviso que chega com a exclusão (a 99Food recusou apagar e o item ficou pausado) permanece no topo do cardápio até
  ser dispensado, mesmo com o produto já fora do ERP.
- "Reenviar" fica sempre disponível: é o caminho quando o item foi apagado direto no painel da plataforma.
- Recusa definitiva: o produto fica em "Erro" ou "Publicado em parte", com a mensagem da plataforma e "Reenviar".
- `PATCH` de produto que o Hub ainda não conhece vira publicação completa.
- A disponibilidade de tamanho, sabor, massa e borda vai na própria publicação. Na 99Food, pizza com preço de sabor
  variando por tamanho ignora a pausa de um tamanho.
- Ajustes esperam enquanto a 99Food processa a publicação. Alteração feita durante um envio entra na fila em seguida.

## 2. Formato do produto

Simples com adicionais:

```json
{
  "codigo": "XSAL", "nome": "X-Salada", "categoria": "Lanches", "preco": 22, "disponivel": true,
  "grupos": [
    { "codigo": "PONTO", "nome": "Ponto da carne", "min": 1, "max": 1,
      "opcoes": [ { "codigo": "AOPONTO", "nome": "Ao ponto", "preco": 0, "disponivel": true } ] },
    { "codigo": "ADIC", "nome": "Adicionais", "min": 0, "max": 2,
      "opcoes": [ { "codigo": "BACON", "nome": "Bacon", "preco": 4, "disponivel": true } ] }
  ]
}
```

Pizza (tamanho = preço final; sabor, massa e borda somam):

```json
{
  "codigo": "PIZZA", "nome": "Pizza", "categoria": "Pizzas", "tipo": "PIZZA", "disponivel": true,
  "pizza": {
    "tamanhos": [ { "codigo": "G", "nome": "Grande", "preco": 60, "pedacos": 8, "maxSabores": 2 } ],
    "sabores":  [ { "codigo": "CAL", "nome": "Calabresa", "acrescimo": 0 },
                  { "codigo": "CAM", "nome": "Camarão", "acrescimo": 10 } ],
    "massas":   [ { "codigo": "TRAD", "nome": "Tradicional", "preco": 0 } ],
    "bordas":   [ { "codigo": "CAT", "nome": "Catupiry", "preco": 8 } ],
    "bordaObrigatoria": false
  },
  "grupos": []
}
```

Preços em reais. `maxSabores: 2` habilita meio a meio.

Cuidados (aplicados pelo ERP):

- Todos os códigos são gerados e gravados no ERP; renomear não troca ids na plataforma.
- `disponivel` vai sempre: omitido, o Hub reativa o produto.
- `grupos` vai sempre completo: omitido, o Hub remove os grupos.
- Foto: JPG ou PNG, mínimo de 150 px; a tela reduz para menos de 700 KB (corpo do Hub até 1 MB). Sem foto, a atual
  é mantida na plataforma.
- Categoria é obrigatória. É casada pelo nome (sem diferenciar maiúsculas, acentos e espaços) e criada na plataforma
  em que não existir. Só a pizza nativa do iFood ignora a categoria e ganha uma seção com o nome do produto.
- Acréscimo de sabor diferente por tamanho publica um item por tamanho na 99Food e no iFood em itens. Com mais de um
  sabor, os acréscimos são somados.
- Reenviar uma pizza publicada como nativa exclui a antiga e publica no formato atual; uma seção que sobrar vazia só
  sai pelo portal do iFood.
- O iFood demora alguns segundos para refletir uma leitura depois de uma escrita.

Combo (cada grupo é uma etapa de escolha; o primeiro é o principal; preço no produto):

```json
{
  "codigo": "COMBO1", "nome": "Combo lanche", "categoria": "Combos", "tipo": "COMBO", "preco": 30,
  "grupos": [
    { "codigo": "LANCHE", "nome": "Lanche", "min": 1, "max": 1, "opcoes": [ { "codigo": "XS", "nome": "X-Salada", "preco": 0 } ] },
    { "codigo": "BEBIDA", "nome": "Bebida", "min": 1, "max": 1, "opcoes": [ { "codigo": "COCA", "nome": "Coca-Cola", "preco": 0 } ] }
  ]
}
```

### Preço por plataforma (opcional)

`preco` é o **preço padrão**. Quando uma plataforma cobra taxa diferente, o item ganha `precosPlataforma`, somente com
as chaves preenchidas:

```json
{ "codigo": "G", "nome": "Grande", "preco": 50, "precosPlataforma": { "IFOOD": 55.9, "99FOOD": 52 } }
```

| Regra | Detalhe |
|---|---|
| Chaves | `IFOOD`, `99FOOD`, `AIQFOME`, `KEETA` (as duas últimas para integrações futuras) |
| Onde vale | produto simples ou combo, adicionais, tamanhos, sabores, massas e bordas de pizza |
| Sabor de pizza | o valor substitui o acréscimo naquela plataforma |
| Vazio | a plataforma usa o preço padrão; sem nenhum preenchido o campo não é enviado |
| Ajuste rápido de preço | altera o padrão; o preço próprio da plataforma continua |
| Na tela | escondido até marcar "Preço diferente por plataforma" |

> Conferido ao vivo em 27/11 no iFood e na 99Food: preço próprio em tamanho de pizza e em adicional, e volta ao padrão
> quando o produto é reenviado sem o campo.

## 3. Diferenças entre plataformas

| Assunto | iFood | 99Food |
|---|---|---|
| Publicação | Imediata | Assíncrona (`PROCESSANDO`), reenvia o **cardápio inteiro** da loja |
| Pizza | Padrão: item na categoria com grupos (tamanho, massa, borda, sabores). Opcional `formatoIfood: "PIZZA"`: pizza nativa em seção própria | Não é nativa: um item com grupo de tamanho |
| Frequência | Limite geral do Hub | Leitura e envio do cardápio: 1 por minuto |
| Pausar categoria | Sim | Não (pause os itens) |

> Prazos de publicação e limites da 99Food: ver "Por que a 99Food demora" em [AVISOS.md](../AVISOS.md).

> Atenção: como a 99Food recebe o cardápio inteiro, publicar um único produto altera a loja toda no sentido técnico
> (o Hub lê o cardápio atual, mescla e envia). Faça testes de publicação somente em loja de teste.

## 4. "Nas plataformas"

Lê `GET /conexao/catalogo/unificado` e guarda uma cópia local por (plataforma, id). Se o Hub devolver avisos
(leitura parcial), nada é apagado. Para itens que não nasceram no ERP:

- preço e disponibilidade de item e de adicional;
- criar categoria (nas duas plataformas, com o resultado de cada uma) e renomear; ordenar e pausar só no iFood (na 99Food cada troca reenvia o cardápio inteiro);
- consulta de itens não vendáveis do iFood.

Itens cadastrados no ERP aparecem com "Editar nos produtos do ERP": ajustes diretos seriam sobrescritos na próxima
publicação.

## 5. Limites atuais do Hub

Não há, pela rota de produto único: escolher um canal só, ordenar itens, excluir
categoria, promoção, horários de venda, foto ou descrição por adicional ou sabor, sabor restrito a um tamanho,
nem importação automática de itens que já existiam na plataforma.

## 6. Dados da loja

Tela "Dados da loja" (`src/client/components/DadosLoja.tsx`): `GET`/`PATCH /conexao/loja/dados` e
`POST /conexao/loja/funcionamento`. Toda alteração pede confirmação. Consulta uma vez ao abrir e depois só no clique.
Altera horários (iFood e 99Food), tempo de preparo e telefones (99Food), abrir, fechar, pausar e modo ocupado
(99Food). Fora da tela: fotos, áreas de entrega, feriados, categorias da loja, forma de aceite e pedidos de
cancelamento e reembolso.
