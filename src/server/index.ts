import { criarApp } from './app.js';
import { iniciarWorkers } from './workers.js';

const PORT = Number(process.env.PORT || 3004);
const app = criarApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[erp-simulador] Rodando em http://127.0.0.1:${PORT}/erp-simulador`);
  iniciarWorkers();
});
