/**
 * Apoio dos testes: banco SQLite temporario e um Hub falso em loopback que segue o contrato do Hub V1.
 * Nada aqui fala com o Hub real nem com as plataformas.
 */
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

export interface Chamada {
  metodo: string;
  caminho: string;
  query: URLSearchParams;
  corpo: any;
  corpoBruto: string;
  headers: http.IncomingHttpHeaders;
}

type Resposta = { status?: number; json?: unknown; bruto?: string };
type Tratador = (c: Chamada, partes: RegExpMatchArray) => Resposta | undefined;

export async function prepararAmbiente() {
  process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'erp-teste-')), 'erp.sqlite');
  const chamadas: Chamada[] = [];
  let tratadores: Array<{ metodo: string; rota: RegExp; fn: Tratador }> = [];

  const hub = http.createServer((req, res) => {
    let corpoBruto = '';
    req.on('data', (p) => (corpoBruto += p));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://hub');
      let corpo: any = null;
      try {
        corpo = corpoBruto ? JSON.parse(corpoBruto) : null;
      } catch {
        corpo = null;
      }
      const chamada: Chamada = { metodo: req.method ?? 'GET', caminho: url.pathname, query: url.searchParams, corpo, corpoBruto, headers: req.headers };
      chamadas.push(chamada);
      let r: Resposta | undefined;
      for (const t of tratadores) {
        const m = t.metodo === chamada.metodo ? chamada.caminho.match(t.rota) : null;
        if (m) r = t.fn(chamada, m);
        if (r) break;
      }
      r ??= { json: {} };
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(r.bruto ?? JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise<void>((ok) => hub.listen(0, '127.0.0.1', ok));
  const baseHub = `http://127.0.0.1:${(hub.address() as any).port}`;

  const banco = await import('../src/server/db.js');
  const { criarApp } = await import('../src/server/app.js');
  const app = criarApp().listen(0, '127.0.0.1');
  await new Promise((ok) => app.once('listening', ok));
  const baseApp = `http://127.0.0.1:${(app.address() as any).port}/api`;

  banco.atualizarConfig({ baseUrl: baseHub, tokenIntegracao: 'hubp_teste', integradorCodigo: 'teste', cnpj: '11111111000191', conexaoId: 'conexao-1', tokenConexao: 'hubi_teste', transporte: 'PUSH', webhookSegredo: 'segredo-teste' });

  const erp = async (metodo: string, caminho: string, corpo?: unknown) => {
    const r = await fetch(baseApp + caminho, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  let seq = 0;
  /** Envia um webhook assinado como o Hub envia. */
  const webhook = async (dados: { plataforma: string; tipo: string; pedido: string; corpo: unknown; evento?: string; seq?: number; segredo?: string }) => {
    const texto = typeof dados.corpo === 'string' ? dados.corpo : JSON.stringify(dados.corpo);
    const numero = dados.seq ?? ++seq;
    const notificacao = crypto.randomUUID();
    const ts = String(Math.floor(Date.now() / 1000));
    const assinatura = crypto.createHmac('sha256', dados.segredo ?? 'segredo-teste').update(`${ts}.${notificacao}.${texto}`).digest('hex');
    const r = await fetch(`${baseApp}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-target-plataforma': dados.plataforma,
        'x-target-tipo': dados.tipo,
        'x-target-pedido': dados.pedido,
        'x-target-evento': dados.evento ?? `ev-${numero}`,
        'x-target-notificacao': notificacao,
        'x-target-seq': String(numero),
        'x-target-timestamp': ts,
        'x-target-assinatura': `v1=${assinatura}`,
      },
      body: texto,
    });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  return {
    erp,
    webhook,
    banco,
    chamadas,
    quando(metodo: string, rota: RegExp, fn: Tratador) {
      tratadores.unshift({ metodo, rota, fn });
    },
    limpar() {
      tratadores = [];
      chamadas.length = 0;
      banco.db.exec('DELETE FROM pedidos; DELETE FROM eventos; DELETE FROM produtos; DELETE FROM fila_catalogo; DELETE FROM espelho_categorias; DELETE FROM ajustes;');
    },
    chamadasDe: (metodo: string, rota: RegExp) => chamadas.filter((c) => c.metodo === metodo && rota.test(c.caminho)),
    fechar() {
      hub.close();
      app.close();
    },
  };
}

export function pedidoUnificado(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    codigoExibicao: '#4821',
    canal: 'IFOOD',
    statusKanban: 'NOVO',
    etapaOriginal: 'RECEBIDO',
    tipoEntrega: 'DELIVERY',
    modalidadePlataforma: 'DELIVERY',
    entreguePor: 'MERCHANT',
    cliente: { nome: 'Maria', telefone: '08007000000', documento: null, telefoneVirtual: '08007000000', localizador: '12345678' },
    enderecoEntrega: { formatado: 'Rua A, 10 - Centro' },
    valores: { moeda: 'BRL', subtotal: 80, taxaEntrega: 9.9, total: 89.9, trocoPara: null },
    pagamento: { forma: 'CREDIT', pagoOnline: true },
    itens: [{ id: 'i1', nome: 'Pizza Grande', quantidade: 1, precoUnitario: 80, precoTotal: 80, observacao: 'sem cebola', codigoExterno: 'PZ', modificadores: [{ nome: 'Calabresa', quantidade: 1, precoUnitario: 0, codigoExterno: 'CAL' }] }],
    observacoes: null,
    acoesPermitidas: [],
    criadoEm: new Date().toISOString(),
    ...extra,
  };
}
