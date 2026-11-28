/** Vida da conexao com o Hub: quando o token deixa de valer e o que fica para tras ao trocar de conexao. */
import { createHash } from 'crypto';
import { db, gravarAjuste, lerAjuste, atualizarConfig, obterConfig } from '../db.js';
import { limparEspelho } from '../catalogo/espelho.js';
import { obterPedido, salvarPedido } from '../pedidos/repositorio.js';
import { notificar } from '../stream.js';

const digital = (token: string) => createHash('sha256').update(token).digest('hex');

/** A recusa vale so para aquele token: qualquer token novo gravado volta a funcionar sozinho. */
export const tokenRecusado = (token: string) => !!token && lerAjuste('tokenRecusado', '') === digital(token);
export const conexaoEncerrada = () => tokenRecusado(obterConfig().tokenConexao);
export const conexaoPronta = () => !!obterConfig().tokenConexao && !conexaoEncerrada();

/** Para tudo que usa o token atual. CNPJ, nome e segredo ficam para reconectar. */
export function encerrarConexao() {
  if (conexaoEncerrada()) return;
  gravarAjuste('tokenRecusado', digital(obterConfig().tokenConexao));
  atualizarConfig({ estadoConexao: 'ENCERRADA', lojasVinculadasJson: '[]' });
  limparEspelho();
  notificar('conexao');
}

export const pedidosAbertos = () => (db.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE statusKanban NOT IN ('CONCLUIDO','CANCELADO')").get() as { n: number }).n;

/** O que pertencia a outra conexao nao pode ser operado pela nova: sai das filas e dos pedidos em aberto. */
export function descartarConexaoAnterior(novaConexaoId: string) {
  db.transaction(() => {
    limparEspelho();
    db.prepare("UPDATE eventos SET estado = 'PROCESSADO', erro = 'Conexão anterior encerrada' WHERE estado != 'PROCESSADO' AND conexaoId != ?").run(novaConexaoId);
    db.prepare('DELETE FROM fila_catalogo').run();
    db.prepare("UPDATE produtos SET canaisJson = '{}', removendo = 0, estado = 'SEM_LOJA', erro = 'Conexão trocada. Vincule a loja e use Reenviar.'").run();
    const abertos = db.prepare("SELECT id FROM pedidos WHERE statusKanban NOT IN ('CONCLUIDO','CANCELADO')").all() as Array<{ id: string }>;
    for (const { id } of abertos) {
      const p = obterPedido(id)!;
      // Sai do quadro como arquivado: a plataforma nao confirmou cancelamento nenhum
      p.statusKanban = 'CANCELADO';
      p.estado.arquivado = true;
      p.estado.falhaAutomatica = null;
      p.estado.motivoCancelamento = 'Arquivado pelo ERP: a conexão deste pedido foi encerrada. Confira no app da plataforma.';
      p.estado.pendencias = { disputa: null, cancelamentoCliente: null, reembolso: null, cancelamentoLoja: null };
      salvarPedido(p);
    }
  })();
  notificar('pedidos');
  notificar('catalogo');
}

/** Ha lojas conhecidas e nenhuma ativa: consultar loja ou cardapio no Hub so devolveria LOJA_NAO_ENCONTRADA. */
export function semLojaAtiva(): boolean {
  const lojas = JSON.parse(obterConfig().lojasVinculadasJson || '[]') as Array<{ estado?: string }>;
  return lojas.length > 0 && !lojas.some((l) => l.estado === 'ATIVA');
}
