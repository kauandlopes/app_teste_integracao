import { Request, Response } from 'express';

/** SSE: a tela atualiza no instante em que o servidor muda um pedido ou o cardapio. */
const clientes = new Set<Response>();

export function conectarStream(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`event: conectado\ndata: {"ok":true}\n\n`);
  clientes.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    clientes.delete(res);
  });
}

export function notificar(evento: 'pedidos' | 'catalogo', dados: Record<string, unknown> = {}) {
  const texto = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const c of clientes) c.write(texto);
}
