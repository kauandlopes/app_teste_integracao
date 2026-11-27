import { criarApp } from './app.js';
import { sincronizarComHub } from './hubClient.js';

const PORT = Number(process.env.PORT || 3004);
const app = criarApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[erp-simulador] Rodando em http://127.0.0.1:${PORT}/erp-simulador`);
});

// Worker continuo leve: puxa novos pedidos/eventos a cada 5s quando em modo PULL
setInterval(() => {
  void sincronizarComHub().catch(() => undefined);
}, 5000);
