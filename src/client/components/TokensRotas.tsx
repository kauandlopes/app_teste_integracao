import React, { useEffect, useState } from 'react';
import { Credenciais, erpApi, mensagemDe } from '../api';

/** Credenciais em uso e todas as rotas do Hub que o ERP consome, com cURL pronto para testar por fora. */
type Token = 'integrador' | 'conexao';
type Rota = [metodo: string, caminho: string, token: Token, descricao: string, corpo?: string];

const ROTAS: Array<{ grupo: string; rotas: Rota[] }> = [
  {
    grupo: 'Conexão e lojas',
    rotas: [
      ['GET', '/hub/v1/integracao', 'integrador', 'Valida o token e mostra a conexão mais recente do integrador'],
      ['POST', '/hub/v1/integracao/conectar', 'integrador', 'Conecta um CNPJ', '{"cnpj":"{cnpj}","transporte":"PUSH","webhook":{"url":"{webhook}"}}'],
      ['POST', '/hub/v1/conexoes/{conexaoId}/token', 'integrador', 'Gera novo token desta conexão (o anterior para de valer)'],
      ['GET', '/hub/v1/conexao', 'conexao', 'Estado, transporte e lojas vinculadas'],
      ['GET', '/hub/v1/conexao/lojas-disponiveis', 'conexao', 'Lojas livres para vincular'],
      ['POST', '/hub/v1/conexao/lojas', 'conexao', 'Vincula loja', '{"plataforma":"IFOOD","loja":"..."}'],
      ['POST', '/hub/v1/conexao/lojas/liberar', 'conexao', 'Desvincula loja', '{"plataforma":"IFOOD","loja":"..."}'],
      ['GET', '/hub/v1/conexao/loja/status', 'conexao', 'Loja aberta ou fechada'],
      ['POST', '/hub/v1/conexao/loja/interrupcoes', 'conexao', 'Pausa a loja no iFood', '{"description":"Pausa","start":"2026-01-01T12:00:00","end":"2026-01-01T12:30:00"}'],
      ['DELETE', '/hub/v1/conexao/loja/interrupcoes/{id}', 'conexao', 'Remove a pausa'],
    ],
  },
  {
    grupo: 'Recebimento de eventos',
    rotas: [
      ['PUT', '/hub/v1/conexao/webhook', 'conexao', 'Liga PUSH ou PULL', '{"transporte":"PUSH","url":"{webhook}"}'],
      ['POST', '/hub/v1/conexao/webhook/segredo/rotacionar', 'conexao', 'Novo segredo da assinatura'],
      ['POST', '/hub/v1/conexao/webhook/reativar', 'conexao', 'Retoma PUSH suspenso'],
      ['GET', '/hub/v1/conexao/entregas', 'conexao', 'Fila de entregas PUSH'],
      ['POST', '/hub/v1/conexao/entregas/reprocessar', 'conexao', 'Reenvia entregas', '{}'],
      ['GET', '/hub/v1/eventos?espera=25&limite=50', 'conexao', 'PULL de eventos'],
      ['POST', '/hub/v1/eventos/confirmar', 'conexao', 'Confirma o cursor do PULL', '{"ate":1}'],
      ['POST', '/hub/v1/conexao/eventos/teste', 'conexao', 'Evento de teste'],
      ['POST', '/hub/v1/conexao/avaliar-pedido', 'conexao', 'Pedido simulado pelo fluxo real', '{"plataforma":"IFOOD","comAdicionais":true}'],
    ],
  },
  {
    grupo: 'Pedidos',
    rotas: [
      ['GET', '/hub/v1/conexao/pedidos?limite=30', 'conexao', 'Pedidos recebidos e seus eventos'],
      ['GET', '/hub/v1/conexao/pedidos/{pedidoId}?plataforma=IFOOD&formato=unificado', 'conexao', 'Pedido completo'],
      ['GET', '/hub/v1/conexao/pedidos/{pedidoId}/subrecurso?tipo=motivos&plataforma=IFOOD', 'conexao', 'Motivos, rastreio ou sacola'],
      ['POST', '/hub/v1/conexao/pedidos/{pedidoId}/acao', 'conexao', 'Executa ação', '{"acao":"confirm","plataforma":"IFOOD"}'],
    ],
  },
  {
    grupo: 'Cardápio',
    rotas: [
      ['POST', '/hub/v1/conexao/catalogo/produtos', 'conexao', 'Cria ou substitui produto no iFood e na 99Food', '{"codigo":"X1","nome":"Item","categoria":"Lanches","preco":10,"disponivel":true}'],
      ['GET', '/hub/v1/conexao/catalogo/produtos/{codigo}', 'conexao', 'Situacao por canal'],
      ['PATCH', '/hub/v1/conexao/catalogo/produtos/{codigo}', 'conexao', 'Preço ou disponibilidade', '{"preco":12}'],
      ['PATCH', '/hub/v1/conexao/catalogo/produtos/{codigo}/opcoes/{opcao}', 'conexao', 'Preço ou disponibilidade de adicional', '{"disponivel":false}'],
      ['DELETE', '/hub/v1/conexao/catalogo/produtos/{codigo}', 'conexao', 'Exclui nos dois canais'],
      ['GET', '/hub/v1/conexao/catalogo/unificado', 'conexao', 'Cardápio publicado nas plataformas'],
      ['PATCH', '/hub/v1/conexao/catalogo/itens/preco?plataforma=IFOOD', 'conexao', 'Preço direto na plataforma', '{"itemId":"...","price":{"value":10}}'],
      ['PATCH', '/hub/v1/conexao/catalogo/itens/status?plataforma=IFOOD', 'conexao', 'Pausa direta na plataforma', '{"itemId":"...","status":"UNAVAILABLE"}'],
      ['GET', '/hub/v1/conexao/catalogo/categorias', 'conexao', 'Categorias das duas plataformas e onde cada uma existe (99Food: 1 leitura por minuto)'],
      ['POST', '/hub/v1/conexao/catalogo/categorias', 'conexao', 'Cria categoria nas duas plataformas (?plataforma= para uma só)', '{"name":"Bebidas"}'],
      ['GET', '/hub/v1/conexao/catalogo/nao-vendaveis?plataforma=IFOOD', 'conexao', 'Itens que não podem vender'],
    ],
  },
  {
    grupo: 'Loja & Horários',
    rotas: [
      ['GET', '/hub/v1/conexao/loja/dados', 'conexao', 'Dados atuais por plataforma e o que é editável'],
      ['PATCH', '/hub/v1/conexao/loja/dados', 'conexao', 'Altera preparo e telefones (99Food) e horários nos dois canais, sempre a semana inteira (altera a loja real)', '{"tempoPreparoMinutos":30}'],
      ['POST', '/hub/v1/conexao/loja/funcionamento', 'conexao', 'ABRIR, FECHAR, PAUSAR; OCUPADO e NORMAL só 99Food (altera a loja real)', '{"acao":"PAUSAR","duracaoMinutos":30}'],
      ['GET', '/hub/v1/conexao/loja/status', 'conexao', 'Status atual da loja (iFood e 99Food)'],
      ['POST', '/hub/v1/conexao/loja/status?plataforma=99FOOD', 'conexao', 'Abre ou fecha loja na 99Food (rota anterior)', '{"acao":"ABRIR"}'],
      ['POST', '/hub/v1/conexao/loja/interrupcoes', 'conexao', 'Cria pausa programada no iFood', '{"description":"Pausa","durationMinutes":30}'],
      ['DELETE', '/hub/v1/conexao/loja/interrupcoes/{id}', 'conexao', 'Remove pausa no iFood'],
      ['GET', '/hub/v1/conexao/loja/horarios', 'conexao', 'Consulta horários de funcionamento (iFood)'],
      ['PUT', '/hub/v1/conexao/loja/horarios', 'conexao', 'Atualiza horários de funcionamento (iFood)', '{"shifts":[{"dayOfWeek":"MONDAY","start":"08:00:00","duration":600}]}'],
    ],
  },
];

export function TokensRotas({ notificar }: { notificar: (tipo: 'ok' | 'erro', msg: string) => void }) {
  const [c, setC] = useState<Credenciais | null>(null);

  const carregar = () =>
    erpApi
      .credenciais()
      .then(setC)
      .catch((err) => notificar('erro', mensagemDe(err, 'Não foi possivel ler as credenciais.')));
  useEffect(() => {
    void carregar();
  }, []);

  if (!c) return <div className="card">Carregando...</div>;

  const copiar = (texto: string, o: string) =>
    navigator.clipboard
      .writeText(texto)
      .then(() => notificar('ok', `${o} copiado.`))
      .catch(() => notificar('erro', 'O navegador não permitiu copiar.'));

  const curl = ([metodo, caminho, token, , corpo]: Rota) => {
    const preencher = (t: string) => t.replace('{conexaoId}', c.conexaoId).replace('{cnpj}', c.cnpj).replace('{webhook}', c.webhookUrl);
    const partes = [`curl -X ${metodo} '${c.baseUrl}${preencher(caminho)}'`, `  -H 'Authorization: Bearer ${token === 'integrador' ? c.tokenIntegracao : c.tokenConexao}'`];
    if (corpo) partes.push("  -H 'Content-Type: application/json'", `  -d '${preencher(corpo)}'`);
    return partes.join(' \\\n');
  };

  const campos: Array<[string, string]> = [
    ['URL base da API', c.baseUrl],
    ['Token do integrador (hubp_)', c.tokenIntegracao],
    ['Token da conexão (hubi_)', c.tokenConexao],
    ['Segredo do webhook', c.webhookSegredo],
    ['ID da conexão', c.conexaoId],
    ['CNPJ', c.cnpj],
    ['Webhook do ERP', c.webhookUrl],
  ];

  return (
    <div className="pilha">
      <div className="card pilha">
        <div className="linha">
          <h2 style={{ margin: 0, fontSize: 16, flex: 1 }}>Tokens em uso</h2>
          <button type="button" className="btn btn-sm" onClick={() => void carregar()}>
            Atualizar
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              void erpApi
                .rotacionarSegredo()
                .then(carregar)
                .then(() => notificar('ok', 'Segredo do webhook trocado.'))
                .catch((err) => notificar('erro', mensagemDe(err, 'Falha ao trocar o segredo.')))
            }
          >
            Novo segredo do webhook
          </button>
        </div>
        {campos.map(([rotulo, valor]) => (
          <div className="linha linha-credencial" key={rotulo}>
            <span className="field-label" style={{ width: 200 }}>
              {rotulo}
            </span>
            <code style={{ flex: 1, minWidth: 220, wordBreak: 'break-all' }}>{valor || 'não definido'}</code>
            <button type="button" className="btn btn-sm" disabled={!valor} onClick={() => void copiar(valor, rotulo)}>
              Copiar
            </button>
          </div>
        ))}
      </div>

      {ROTAS.map((g) => (
        <div className="card" key={g.grupo} style={{ padding: 0, overflow: 'hidden' }}>
          <div className="cabecalho-categoria">
            <strong>{g.grupo}</strong>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="item-table">
              <tbody>
                {g.rotas.map((r) => (
                  <tr key={`${r[0]}${r[1]}`}>
                    <td style={{ width: 70 }}>
                      <strong>{r[0]}</strong>
                    </td>
                    <td>
                      <code style={{ wordBreak: 'break-all' }}>{r[1]}</code>
                      <div className="suave">{r[3]}</div>
                    </td>
                    <td style={{ width: 110 }}>
                      <span className="pill">{r[2] === 'integrador' ? 'hubp_' : 'hubi_'}</span>
                    </td>
                    <td style={{ width: 120, textAlign: 'right' }}>
                      <button type="button" className="btn btn-sm" onClick={() => void copiar(curl(r), 'cURL')}>
                        Copiar cURL
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
