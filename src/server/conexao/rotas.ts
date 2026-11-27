import { Router, Request, Response } from 'express';
import { atualizarConfig, db, obterConfig } from '../db.js';
import { atualizarEstadoConexao, hubFetch, lerJson, mensagemDoHub, RespostaHub } from '../hubClient.js';
import { limparEspelho } from '../catalogo/espelho.js';
import { conexaoEncerrada, descartarConexaoAnterior, semLojaAtiva, tokenRecusado } from './estado.js';

export const WEBHOOK_PADRAO = 'https://delivery.targetx.com.br/erp-simulador/api/webhook';
const BASE_PADRAO = 'https://delivery.targetx.com.br/api/v1';

const SEM_CONEXAO = { cnpj: '', nomeLoja: '', conexaoId: '', tokenConexao: '', webhookSegredo: '', estadoConexao: '', lojasVinculadasJson: '[]' };

const falha = (res: Response, r: RespostaHub) => res.status(r.status || 502).json({ ...(r.json as object | null), erro: mensagemDoHub(r) });
const repassar = (res: Response, r: RespostaHub) => (r.ok ? res.status(r.status).json(r.json ?? { ok: true }) : falha(res, r));

/**
 * Token operacional de UMA conexao, pelo id. Nunca usa /integracao/recuperar-token: aquela rota troca o token
 * da conexao mais nova do integrador, que pode ser de outra loja.
 */
function gerarTokenDaConexao(conexaoId: string) {
  return hubFetch<{ conexaoId: string; token: string }>(`/hub/v1/conexoes/${encodeURIComponent(conexaoId)}/token`, { metodo: 'POST', tokenTipo: 'integrador' });
}

export function rotasConexao(): Router {
  const api = Router();

  api.get('/saude', (_req, res) => {
    res.json({ ok: true, db: 'sqlite', agora: new Date().toISOString() });
  });

  api.get('/sessao', (_req, res) => {
    const c = obterConfig();
    res.json({
      baseUrl: c.baseUrl,
      autenticado: !!c.tokenIntegracao,
      integradorCodigo: c.integradorCodigo,
      cnpj: c.cnpj,
      nomeLoja: c.nomeLoja,
      conexaoId: c.conexaoId,
      temTokenConexao: !!c.tokenConexao,
      conexaoEncerrada: conexaoEncerrada(),
      transporte: c.transporte,
      webhookUrl: WEBHOOK_PADRAO,
      temWebhookSegredo: !!c.webhookSegredo,
      estadoConexao: c.estadoConexao,
      lojas: JSON.parse(c.lojasVinculadasJson || '[]'),
      atualizadoEm: c.atualizadoEm,
    });
  });

  /** Valida o token do integrador. A conexao ja salva e mantida; nenhum token e trocado aqui. */
  api.post('/entrar', async (req, res) => {
    const baseUrl = String(req.body?.baseUrl ?? '').trim().replace(/\/$/, '') || BASE_PADRAO;
    const tokenIntegracao = String(req.body?.tokenIntegracao ?? '').trim();
    if (!tokenIntegracao) return res.status(400).json({ erro: 'Informe o token da integração.' });

    const r = await hubFetch<{ conectada: boolean; integrador: { codigo: string } }>('/hub/v1/integracao', { baseExplicita: baseUrl, tokenExplicito: tokenIntegracao });
    if (!r.ok || !r.json?.integrador) return falha(res, r);

    const cur = obterConfig();
    const outroIntegrador = !!cur.integradorCodigo && cur.integradorCodigo !== r.json.integrador.codigo;
    atualizarConfig({ baseUrl, tokenIntegracao, integradorCodigo: r.json.integrador.codigo, ...(outroIntegrador ? SEM_CONEXAO : {}) });
    if (outroIntegrador) descartarConexaoAnterior('');
    res.json({ ok: true, integrador: r.json.integrador, conectado: !!obterConfig().tokenConexao });
  });

  api.post('/sair', (req, res) => {
    if (req.query.limparDados === 'true') {
      atualizarConfig({ tokenIntegracao: '', integradorCodigo: '', ...SEM_CONEXAO });
      db.exec('DELETE FROM pedidos; DELETE FROM eventos;');
      descartarConexaoAnterior('');
    } else {
      // Mantem a conexao: pedidos continuam chegando e entrar de novo nao troca nenhum token
      atualizarConfig({ tokenIntegracao: '' });
    }
    res.json({ ok: true });
  });

  api.post('/conectar-cnpj', async (req, res) => {
    const cnpj = String(req.body?.cnpj ?? '').replace(/\D/g, '');
    const nome = String(req.body?.nome ?? '').trim() || `Loja ${cnpj}`;
    const transporte = req.body?.transporte === 'PULL' ? 'PULL' : 'PUSH';
    const webhookUrl = String(req.body?.webhookUrl || WEBHOOK_PADRAO).trim();

    const r = await hubFetch<any>('/hub/v1/integracao/conectar', {
      metodo: 'POST',
      tokenTipo: 'integrador',
      timeoutMs: 65_000,
      body: { cnpj, nome, transporte, plataformas: ['IFOOD', '99FOOD'], ...(transporte === 'PUSH' ? { webhook: { url: webhookUrl } } : {}) },
    });
    if (!r.ok || !r.json) return falha(res, r);

    const mesma = obterConfig().conexaoId === r.json.conexaoId;
    // Antes de reaproveitar o token salvo, confere se ele ainda vale: se nao, este mesmo clique gera outro
    if (mesma && !r.json.credenciais?.token) await atualizarEstadoConexao();
    const cur = obterConfig();
    const valeOSalvo = mesma && !!cur.tokenConexao && !conexaoEncerrada();
    let tokenConexao: string = [r.json.credenciais?.token, valeOSalvo ? cur.tokenConexao : ''].find((t) => t && !tokenRecusado(t)) ?? '';
    if (!tokenConexao) {
      const rec = await gerarTokenDaConexao(r.json.conexaoId);
      if (!rec.ok || !rec.json?.token) return falha(res, rec);
      tokenConexao = rec.json.token;
    }
    // Na mesma conexao vale o segredo salvo: o Hub pode devolver o da criacao, ja trocado depois
    const manterSegredo = valeOSalvo && !!cur.webhookSegredo;
    // Fora isso, so o segredo de uma conexao recem-criada (201) e certamente o atual
    let segredoAtual = manterSegredo || (r.status === 201 && !!r.json.credenciais?.webhookSegredo);
    if (cur.conexaoId && !mesma) descartarConexaoAnterior(r.json.conexaoId);
    atualizarConfig({
      cnpj: r.json.cnpj,
      nomeLoja: r.json.nome ?? nome,
      conexaoId: r.json.conexaoId,
      tokenConexao,
      webhookSegredo: manterSegredo ? cur.webhookSegredo : r.json.credenciais?.webhookSegredo || (mesma ? cur.webhookSegredo : ''),
      transporte: r.json.transporte?.modo ?? transporte,
      estadoConexao: r.json.estado ?? '',
      lojasVinculadasJson: JSON.stringify(r.json.lojas ?? []),
    });

    // Conexao existente: ajusta o transporte e garante o segredo para conferir a assinatura
    const urlAtual = r.json.transporte?.url ?? webhookUrl;
    if (obterConfig().transporte !== transporte || (transporte === 'PUSH' && urlAtual !== webhookUrl)) {
      const rw = await hubFetch<any>('/hub/v1/conexao/webhook', { metodo: 'PUT', body: transporte === 'PUSH' ? { transporte, url: webhookUrl } : { transporte } });
      if (!rw.ok) return falha(res, rw);
      if (rw.json?.webhookSegredo) segredoAtual = true;
      atualizarConfig({ transporte: rw.json?.transporte?.modo ?? transporte, ...(rw.json?.webhookSegredo ? { webhookSegredo: rw.json.webhookSegredo } : {}) });
    }
    if (transporte === 'PUSH' && (!segredoAtual || !obterConfig().webhookSegredo)) {
      const rot = await hubFetch<{ webhookSegredo: string }>('/hub/v1/conexao/webhook/segredo/rotacionar', { metodo: 'POST' });
      if (!rot.ok || !rot.json?.webhookSegredo) return falha(res, rot);
      atualizarConfig({ webhookSegredo: rot.json.webhookSegredo });
    }

    const final = obterConfig();
    res.status(r.status).json({ ...r.json, transporte: { ...(r.json.transporte ?? {}), modo: final.transporte, url: webhookUrl }, lojas: JSON.parse(final.lojasVinculadasJson) });
  });

  /** Botao manual: gera um token novo da conexao salva (o anterior para de valer na hora). */
  api.post('/recuperar-token', async (_req, res) => {
    const { conexaoId } = obterConfig();
    if (!conexaoId) return res.status(409).json({ erro: 'Conecte o CNPJ primeiro.' });
    const r = await gerarTokenDaConexao(conexaoId);
    if (!r.ok || !r.json?.token) return falha(res, r);
    atualizarConfig({ tokenConexao: r.json.token });
    await atualizarEstadoConexao();
    res.json(r.json);
  });

  api.post('/webhook/segredo/rotacionar', async (_req, res) => {
    const r = await hubFetch<{ webhookSegredo: string }>('/hub/v1/conexao/webhook/segredo/rotacionar', { metodo: 'POST' });
    if (r.ok && r.json?.webhookSegredo) atualizarConfig({ webhookSegredo: r.json.webhookSegredo });
    repassar(res, r);
  });

  /** Tela "Tokens e rotas": credenciais em uso para testar por fora (cURL, Postman). */
  api.get('/credenciais', (_req, res) => {
    const c = obterConfig();
    res.json({
      baseUrl: c.baseUrl,
      tokenIntegracao: c.tokenIntegracao,
      tokenConexao: c.tokenConexao,
      webhookSegredo: c.webhookSegredo,
      conexaoId: c.conexaoId,
      cnpj: c.cnpj,
      webhookUrl: WEBHOOK_PADRAO,
    });
  });

  // ── Lojas ──────────────────────────────────────────────────────────────────

  api.get('/lojas-livres', async (req, res) => {
    const plat = typeof req.query.plataforma === 'string' && req.query.plataforma ? `?plataforma=${encodeURIComponent(req.query.plataforma)}` : '';
    repassar(res, await hubFetch(`/hub/v1/conexao/lojas-disponiveis${plat}`, { timeoutMs: 65_000 }));
  });

  const mudarLoja = (caminho: string) => async (req: Request & { rawBody?: Buffer }, res: Response) => {
    // Corpo original: id de loja com 19 digitos enviado como numero seria arredondado pelo JSON.parse do Express
    const corpo = lerJson<{ plataforma?: unknown; loja?: unknown }>(req.rawBody?.toString('utf8') ?? '');
    const plataforma = String(corpo?.plataforma ?? '');
    const loja = String(corpo?.loja ?? '').trim();
    if (!plataforma || !loja) return res.status(400).json({ erro: 'Escolha a plataforma e a loja.' });
    const r = await hubFetch<any>(caminho, { metodo: 'POST', body: { plataforma, loja }, timeoutMs: 65_000 });
    if (r.ok && r.json) {
      atualizarConfig({ estadoConexao: r.json.estado ?? '', lojasVinculadasJson: JSON.stringify(r.json.lojas ?? []) });
      // O cardapio copiado era da loja anterior daquela plataforma. Os produtos cadastrados no ERP ficam
      limparEspelho(plataforma);
    } else if ((r.json as any)?.codigo === 'LOJA_NAO_ENCONTRADA') await atualizarEstadoConexao();
    repassar(res, r);
  };
  api.post('/lojas/vincular', mudarLoja('/hub/v1/conexao/lojas'));
  api.post('/lojas/liberar', mudarLoja('/hub/v1/conexao/lojas/liberar'));
  api.post('/lojas/atualizar', async (_req, res) => {
    await atualizarEstadoConexao();
    res.json({ ok: true });
  });

  api.get('/loja/status', async (_req, res) => {
    if (semLojaAtiva()) return res.json({});
    repassar(res, await hubFetch('/hub/v1/conexao/loja/status', { silenciarSucesso: () => true }));
  });

  api.post('/loja/interrupcoes', async (req, res) => {
    const minutos = Math.max(1, Number(req.body?.durationMinutes ?? 30));
    const paraBrasilia = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 19);
    const body = {
      description: String(req.body?.description || 'Pausa operacional'),
      start: req.body?.start || paraBrasilia(Date.now()),
      end: req.body?.end || paraBrasilia(Date.now() + minutos * 60_000),
    };
    repassar(res, await hubFetch('/hub/v1/conexao/loja/interrupcoes', { metodo: 'POST', body }));
  });

  api.delete('/loja/interrupcoes/:id', async (req, res) => {
    repassar(res, await hubFetch(`/hub/v1/conexao/loja/interrupcoes/${encodeURIComponent(req.params.id)}`, { metodo: 'DELETE' }));
  });

  // ── Dados e funcionamento da loja nos dois canais ──────────────────────────

  /** Plataforma invalida e recusada: ignorar aplicaria a mudanca nas duas lojas. */
  const lojaNoHub = (rota: 'dados' | 'funcionamento', metodo: 'GET' | 'PATCH' | 'POST') => async (req: Request, res: Response) => {
    const plat = req.query.plataforma;
    if (plat !== undefined && plat !== 'IFOOD' && plat !== '99FOOD') return res.status(400).json({ erro: 'Plataforma inválida.' });
    const r = await hubFetch<any>(`/hub/v1/conexao/loja/${rota}${plat ? `?plataforma=${plat}` : ''}`, { metodo, ...(metodo === 'GET' ? {} : { body: req.body ?? {} }), timeoutMs: 65_000 });
    if (r.json?.codigo === 'LOJA_NAO_ENCONTRADA') await atualizarEstadoConexao();
    // Sem resposta do Hub a alteracao pode ter chegado a plataforma
    if (!r.ok && metodo !== 'GET' && !r.json?.codigo && (r.status === 0 || r.status >= 500)) {
      return res.status(502).json({ erro: `${mensagemDoHub(r)} A alteração pode ter sido aplicada: consulte a loja antes de repetir.` });
    }
    if (r.ok && !r.json?.plataformas) return res.status(502).json({ erro: 'O Hub respondeu sem o resultado por plataforma. Consulte a loja antes de repetir.' });
    repassar(res, r);
  };
  api.get('/loja/dados', lojaNoHub('dados', 'GET'));
  api.patch('/loja/dados', lojaNoHub('dados', 'PATCH'));
  api.post('/loja/funcionamento', lojaNoHub('funcionamento', 'POST'));

  // ── Fila PUSH do Hub (homologacao) ─────────────────────────────────────────

  api.get('/entregas', async (req, res) => {
    const estado = typeof req.query.estado === 'string' && req.query.estado ? `&estado=${encodeURIComponent(req.query.estado)}` : '';
    repassar(res, await hubFetch(`/hub/v1/conexao/entregas?limite=50${estado}`));
  });
  api.post('/entregas/reprocessar', async (_req, res) => repassar(res, await hubFetch('/hub/v1/conexao/entregas/reprocessar', { metodo: 'POST', body: {} })));
  api.post('/webhook/reativar', async (_req, res) => repassar(res, await hubFetch('/hub/v1/conexao/webhook/reativar', { metodo: 'POST' })));

  // ── Logs ───────────────────────────────────────────────────────────────────

  api.get('/logs', (req, res) => {
    const filtro = String(req.query.filtro ?? 'todos');
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const limite = Math.min(Math.max(Number(req.query.limite ?? 300), 1), 1500);
    const where: string[] = [];
    const params: unknown[] = [];
    if (filtro === 'erros') where.push('(status = 0 OR status >= 400)');
    else if (filtro === 'sucesso') where.push('(status >= 200 AND status < 300)');
    if (q) {
      where.push('(LOWER(metodo) LIKE ? OR LOWER(url) LIKE ? OR CAST(status AS TEXT) LIKE ? OR LOWER(erroResumo) LIKE ? OR LOWER(reqBody) LIKE ? OR LOWER(resBody) LIKE ?)');
      params.push(...Array(6).fill(`%${q}%`));
    }
    const filtroSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const logs = db.prepare(`SELECT * FROM logs_http ${filtroSql} ORDER BY id DESC LIMIT ?`).all(...params, limite);
    const contar = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    res.json({ total: contar('SELECT COUNT(*) AS n FROM logs_http'), totalErros: contar('SELECT COUNT(*) AS n FROM logs_http WHERE status = 0 OR status >= 400'), logs });
  });

  api.get('/logs/exportar', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="erp-simulador-logs.json"');
    res.json(db.prepare('SELECT * FROM logs_http ORDER BY id DESC').all());
  });

  api.delete('/logs', (_req, res) => {
    db.prepare('DELETE FROM logs_http').run();
    res.json({ ok: true });
  });

  return api;
}
