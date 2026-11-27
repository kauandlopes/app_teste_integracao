import { acompanharProcessamento, processarCatalogo } from './catalogo/publicador.js';
import { atualizarEstadoConexao, registrarLog } from './hubClient.js';
import { iniciarAgendados, limparEventosAntigos, processarFila, puxarEventos, reconciliar } from './pedidos/processador.js';

/** Tarefas periodicas. Cada uma se protege contra execucao simultanea. */
export function iniciarWorkers() {
  const repetir = (nome: string, segundos: number, tarefa: () => unknown) => {
    let ocupada = false;
    setInterval(() => {
      if (ocupada) return;
      ocupada = true;
      void Promise.resolve()
        .then(tarefa)
        .catch((err) => registrarLog({ metodo: 'TAREFA', url: nome, status: 0, ms: 0, erroResumo: err?.message ?? String(err), resBody: String(err?.stack ?? '') }))
        .finally(() => (ocupada = false));
    }, segundos * 1000);
  };

  repetir('pull', 3, puxarEventos);
  repetir('fila de eventos', 2, () => void processarFila());
  repetir('reconciliacao', 90, reconciliar);
  repetir('pedidos agendados', 30, iniciarAgendados);
  repetir('publicação do cardápio', 3, processarCatalogo);
  repetir('resultado da publicação', 15, acompanharProcessamento);
  repetir('estado da conexão', 60, atualizarEstadoConexao);
  repetir('limpeza', 3600, limparEventosAntigos);
}
