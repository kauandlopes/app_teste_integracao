import express, { NextFunction, Request, Response, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { rotasCatalogo } from './catalogo/rotas.js';
import { rotasConexao } from './conexao/rotas.js';
import { registrarLog } from './hubClient.js';
import { rotasPedidos } from './pedidos/rotas.js';
import { conectarStream } from './stream.js';

/** Montagem do servidor. As regras ficam em conexao/, pedidos/ e catalogo/. */
export function criarApp() {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(
    express.json({
      limit: '5mb',
      // O corpo original e necessario para conferir a assinatura do webhook
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  const api = Router();
  api.get('/stream', conectarStream);
  api.use(rotasConexao());
  api.use(rotasPedidos());
  api.use('/catalogo', rotasCatalogo());
  api.use((_req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada.' });
  });

  app.use('/erp-simulador/api', api);
  app.use('/api', api);

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const mensagem = err?.message ?? String(err);
    registrarLog({ metodo: req.method, url: req.originalUrl, status: err?.status ?? 500, ms: 0, erroResumo: mensagem, resBody: String(err?.stack ?? '') });
    res.status(err?.status ?? 500).json({ erro: err?.type === 'entity.too.large' ? 'Arquivo muito grande.' : `Falha no ERP: ${mensagem}` });
  });

  const clientDist = path.join(process.cwd(), 'dist', 'client');
  if (fs.existsSync(clientDist)) {
    app.use('/erp-simulador', express.static(clientDist));
    app.use('/', express.static(clientDist));
    app.get(/^\/erp-simulador(\/.*)?$/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
    app.get(/^\/(?!api\/).*$/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}
