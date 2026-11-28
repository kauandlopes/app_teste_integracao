# Como funciona cada tela

> Arquivo gerado por `npm run docs`. Edite a fonte, não este arquivo.

Sistema de exemplo para desenvolvimento e testes. As telas mostram o necessário para operar; a explicação está aqui e o detalhe técnico, em Logs.

## Pedidos

- Quadro por etapa: Novos, Em preparo, Prontos, Saiu para entrega e Finalizados. A etapa nunca volta; cancelado vence qualquer etapa.
- O cartão aparece e toca assim que o evento chega, antes mesmo de o detalhe ser lido. Falha de leitura é repetida em 2, 5, 15, 30, 60, 120 e 300 s.
- O alerta sonoro repete enquanto houver pedido sem aceite ou solicitação com prazo. O navegador exige um clique na página antes de tocar.
- Aceite automático (desligado por padrão): aceita o pedido recém-chegado e, no iFood, inicia o preparo. Falha passageira é repetida em 5, 10, 20, 30 e 60 s até o prazo de aceite.
- Pedido agendado do iFood: o preparo começa no horário informado pela plataforma.
- Pedido de teste usa a rota avaliar-pedido: percorre fila, PUSH ou PULL e webhook sem chamar as plataformas. Não produza nem fature pedido simulado ou de teste.
- Sincronizar relê eventos pendentes e compara a lista do Hub (até 100 pedidos, 48 h) com o que o ERP recebeu.

**Avisos que ficam na tela**

- Prazo de aceite: iFood 8 minutos, 99Food 5 minutos.
- Falha do aceite automático fica no cartão até o pedido avançar.

**Código e rotas:** `src/server/pedidos/processador.ts`, `src/server/pedidos/eventos.ts`, `src/client/components/KanbanPedidos.tsx`, `GET /hub/v1/conexao/pedidos`

## Pedido (detalhe)

- Os botões vêm de uma regra única por plataforma, modalidade e etapa; o servidor recusa ação fora dela.
- Cada clique gera uma intenção enviada como Idempotency-Key. Repetir após falha de rede usa a mesma chave; depois de recusa definitiva a próxima usa chave nova.
- No iFood a resposta 202 significa recebido: a etapa se confirma pelo evento. Não há comando de concluir; o pedido sai da etapa com o evento CONCLUDED.
- Com DELIVERY_DROP_CODE_REQUESTED, validar o código de entrega vira a ação principal. Código recusado não muda nada.
- Na 99Food a entrega própria exige nome e telefone do entregador; antes de despachar, concluir ou validar código o Hub confirma e marca pronto.
- No iFood, trocar entregador altera só o ERP.
- Código de entrega do iFood: verifyDeliveryCode (ou conclude com dados.code). Em entrega própria o código de coleta não se aplica. Até 28/11 foi testada ao vivo a recusa de código errado; o aceite de um código certo ainda não.
- Ações de logística do iFood (informar entregador, a caminho, chegada) exigem o módulo de logística no aplicativo. O aplicativo atual não tem: o Hub responde 422 SEM_PERMISSAO_LOGISTICA.
- Cancelar exige um motivo da lista nas duas plataformas. Pedido já cancelado não aceita novos comandos (409 PEDIDO_ENCERRADO).
- Na 99Food, observado em 28/11: concluindo sem despachar, o orderFinish chegou cerca de 2 minutos depois; com despacho, não chegou em 40 minutos (um caso). Um cancelamento após a entrega ainda foi aceito pela plataforma.
- Disputas, pedidos de cancelamento e de reembolso aparecem com prazo, evidências e o que acontece sem resposta.
- Imprimir comanda usa bobina de 72 mm. A aba Técnico mostra o JSON recebido.
- Os preços dos itens já incluem os complementos: o valor do complemento só explica o item.

**Avisos que ficam na tela**

- Toda resposta a disputa, cancelamento ou reembolso pede confirmação: não há como desfazer.
- Pedido de cancelamento da 99Food sem resposta em 5 minutos é recusado; reembolso sem resposta em 24 horas é aceito.
- "Somente no ERP": observação e mudança manual de etapa não vão para a plataforma.

**Código e rotas:** `src/server/pedidos/regras.ts`, `src/server/pedidos/processador.ts (executarAcao)`, `src/client/components/ModalPedido.tsx`, `POST /hub/v1/conexao/pedidos/{id}/acao`

## Cardápio

- O ERP é a fonte da verdade: grava o produto e coloca na fila. Até 4 produtos saem ao mesmo tempo.
- Cada canal mostra o próprio estado: publicado, processando, na fila, erro, removido ou sem loja. Avisos de rotina ficam no título do selo e em Logs.
- O iFood publica em segundos. A 99Food não recebe um item avulso: o Hub reenvia o cardápio inteiro; por loja são 2 leituras a cada 2 minutos, 1 envio por minuto e 5 fotos a cada 10 segundos.
- Categoria é obrigatória; a que não existir em uma plataforma é criada ao publicar.
- Preço por plataforma: só o campo preenchido é enviado; vazio usa o preço padrão.
- Pizza: o preço do tamanho é o final; sabores, massas e bordas somam. Pizza nativa do iFood fica em seção própria; sem ela vira item com grupos. Sem massa, o iFood recebe "Tradicional". Preço de pizza só muda reenviando o produto.
- Acréscimo de sabor diferente por tamanho publica um item para cada tamanho.
- Combo: preço no produto, um grupo por etapa e a primeira etapa é a principal.
- Foto: JPEG ou PNG, mínimo 150 x 150, até 5 MB. A 99Food analisa antes de exibir e pode recusar montagem, colagem ou borda.
- Reenviar é o caminho quando o item foi apagado direto no painel da plataforma. Com exclusão em andamento, reenviar repete a exclusão. A 99Food não aceita cardápio vazio: o último item fica pausado.
- Preço zero só é aceito quando um grupo obrigatório tem preço em todas as opções, inclusive em combo.

**Avisos que ficam na tela**

- Preço, pausa e exclusão mostram o valor atual, o novo e em quais lojas valem antes de enviar.

**Código e rotas:** `src/server/catalogo/publicador.ts`, `src/server/catalogo/produto.ts`, `src/client/components/GestorCatalogo.tsx`, `POST /hub/v1/conexao/catalogo/produtos`

## Lojas e operação

- Conectar o CNPJ gera a conexão e o token dela. Um integrador pode ter várias conexões; este exemplo opera uma por vez.
- PUSH: o Hub chama o webhook do ERP com assinatura HMAC. PULL: o ERP consulta os eventos e confirma o cursor.
- Uma loja ativa por plataforma. A lista mostra as lojas autorizadas no aplicativo da Target e ainda sem dono. O primeiro vínculo da 99Food pode levar cerca de 30 segundos.
- Gerar novo token invalida o anterior na hora.
- Conexão encerrada (401): o ERP para pedidos e cardápio até conectar de novo.
- Desvínculo no portal da 99Food chega pelo evento shopBindStatus e gera um alerta. O estado da loja no Hub pode continuar ATIVA: confira antes de publicar.
- Entregas do Hub mostra a fila PUSH; reativar e reprocessar reenvia o que o Hub desistiu de entregar.

**Avisos que ficam na tela**

- Trocar de empresa com pedido em aberto pede confirmação; os pedidos ficam arquivados, sem cancelamento na plataforma.

**Código e rotas:** `src/server/conexao/rotas.ts`, `src/client/components/PainelConexao.tsx`, `POST /hub/v1/integracao/conectar`, `POST /hub/v1/conexao/lojas`

## Dados da loja

- Uma consulta ao abrir e depois só no botão: a 99Food aceita 1 consulta por minuto e leva até 2 minutos para refletir a mudança.
- O iFood altera horários e funcionamento. A 99Food também altera tempo de preparo, telefones e modo ocupado. Nome e endereço são do portal de cada plataforma.
- Horários substituem a semana inteira; fim menor que o início passa da meia-noite; 24:00 é o fim do dia.
- Pausar no iFood cria uma interrupção; fechar no iFood é uma pausa de 7 dias, que precisa ser renovada. Abrir remove as pausas em vigor.
- Na 99Food, pausa de até 30 minutos ou até o fim do dia; fechar vale até um novo abrir. A situação final chega no evento shopStatus.
- 99Food: 1 alteração de dados e horários por minuto; envie tudo junto.

**Avisos que ficam na tela**

- Toda alteração vale na loja real e passa por revisão do valor atual e do novo.

**Código e rotas:** `src/client/components/DadosLoja.tsx`, `GET e PATCH /hub/v1/conexao/loja/dados`, `POST /hub/v1/conexao/loja/funcionamento`

## Tokens e rotas

- Ferramenta de desenvolvimento: mostra as credenciais em uso e o cURL de cada rota. Um ERP de produção não expõe essa tela.

**Avisos que ficam na tela**

- Este exemplo não tem login: use somente para desenvolvimento e testes, com lojas de teste.

**Código e rotas:** `src/client/components/TokensRotas.tsx`

## Logs

- Guarda requisição, resposta, tempo e cURL de cada chamada ao Hub, webhooks recebidos e falhas de eventos e tarefas.
- A tela mostra a mensagem em português; o código técnico (por exemplo PLATAFORMA_HTTP_502) e o requestId ficam no log.
- Ficam os 1500 registros mais recentes. Consultas de rotina sem novidade só são gravadas quando falham.

**Avisos que ficam na tela**

- O log guarda os tokens usados nas chamadas: não compartilhe a exportação.

**Código e rotas:** `src/server/hubClient.ts`, `src/client/components/ModalLogs.tsx`

## Erros que o ERP precisa tratar

| Resposta | O que fazer |
|---|---|
| `401 TOKEN_INVALIDO` | Conexão excluída, revogada ou token trocado: parar e conectar de novo. |
| `400 PLATAFORMA_HTTP_4xx / PLATAFORMA_ERRNO_n` | A plataforma recusou: mostrar o motivo; corrigir antes de repetir. |
| `502 PLATAFORMA_HTTP_5xx` | Falha da plataforma: pode repetir com a mesma Idempotency-Key. |
| `422 CODIGO_INVALIDO` | Código de coleta ou entrega recusado: nada foi validado. |
| `422 CODIGO_ENTREGA_OBRIGATORIO / CONCLUSAO_PELO_IFOOD` | O iFood não conclui sem o código, ou conclui sozinho pelo evento CONCLUDED. |
| `400 CODIGO_OBRIGATORIO` | Faltou dados.code. |
| `422 CODIGO_NAO_SE_APLICA` | Código de coleta enviado em pedido de entrega própria: use o código de entrega. |
| `422 SEM_PERMISSAO_LOGISTICA` | O aplicativo do iFood não tem o módulo de logística. |
| `400 MOTIVO_INVALIDO` | Cancelamento sem motivo da lista; a lista vem na resposta. |
| `409 PEDIDO_ENCERRADO` | Pedido já cancelado: não envie o comando. |
| `409 PEDIDO_OU_LOJA_NAO_E_SEU` | Pedido ou loja de fora desta conexão. |
| `429` | Limite de chamadas: esperar o Retry-After. |
| `504 COMANDO_RESULTADO_INCERTO` | Pode ter sido executado: consultar o pedido antes de repetir. |
