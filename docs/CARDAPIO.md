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

Regras da fila:

- Uma operação por vez, um produto por requisição, com tempo limite de 65 s.
- Limite de frequência (errno 10005/12021, 429), erro 5xx ou rede: nova tentativa em 5, 15, 65, 120 e 300 s (8 vezes).
- Recusa definitiva: o produto fica em "Erro" ou "Publicado em parte", com a mensagem da plataforma e "Reenviar".
- `PATCH` de produto que o Hub ainda não conhece vira publicação completa.
- A publicação do Hub não leva a disponibilidade de sabor, massa e borda: depois que os dois canais terminam, o ERP
  envia as pausas e reativa o que voltou a ficar disponível (`PATCH .../opcoes/{opcao}`).
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
- A categoria é casada pelo nome e criada se não existir. No iFood cada pizza ganha uma seção própria com o nome do
  produto (a categoria informada vale na 99Food).
- O iFood demora alguns segundos para refletir uma leitura depois de uma escrita.

## 3. Diferenças entre plataformas

| Assunto | iFood | 99Food |
|---|---|---|
| Publicação | Imediata | Assíncrona (`PROCESSANDO`), reenvia o **cardápio inteiro** da loja |
| Pizza | Tipo nativo com tamanhos, massas, bordas e frações | Não é nativa: um item com grupo de tamanho. Acréscimo de sabor diferente por tamanho gera um item por tamanho |
| Frequência | Limite geral do Hub | Leitura e envio do cardápio: 1 por minuto |
| Pausar categoria | Sim | Não (pause os itens) |

> Atenção: como a 99Food recebe o cardápio inteiro, publicar um único produto altera a loja toda no sentido técnico
> (o Hub lê o cardápio atual, mescla e envia). Faça testes de publicação somente em loja de teste.

## 4. "Nas plataformas"

Lê `GET /conexao/catalogo/unificado` e guarda uma cópia local por (plataforma, id). Se o Hub devolver avisos
(leitura parcial), nada é apagado. Para itens que não nasceram no ERP:

- preço e disponibilidade de item e de adicional;
- criar e renomear categoria; ordenar e pausar só no iFood (na 99Food cada troca reenvia o cardápio inteiro);
- consulta de itens não vendáveis do iFood.

Itens cadastrados no ERP aparecem com "Editar nos produtos do ERP": ajustes diretos seriam sobrescritos na próxima
publicação.

## 5. Limites atuais do Hub

Não há, pela rota de produto único: preço diferente por canal, escolher um canal só, ordenar itens, excluir
categoria, promoção, horários de venda, combo, foto ou descrição por adicional ou sabor, sabor restrito a um tamanho,
nem importação automática de itens que já existiam na plataforma.
