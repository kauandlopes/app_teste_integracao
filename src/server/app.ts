import crypto from 'crypto';
import express, { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { db, obterConfig, atualizarConfig } from './db.js';
import { hubFetch, mapearEtapaParaKanban, registrarLog, sincronizarComHub, upsertPedidoDoDetalhe } from './hubClient.js';

export function criarApp() {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(
    express.json({
      limit: '5mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

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
      transporte: c.transporte,
      estadoConexao: c.estadoConexao,
      lojas: JSON.parse(c.lojasVinculadasJson || '[]'),
      atualizadoEm: c.atualizadoEm,
    });
  });

  api.post('/entrar', async (req, res) => {
    const baseUrl = String(req.body?.baseUrl ?? '').trim().replace(/\/$/, '') || 'https://delivery.targetx.com.br/api/v1';
    const tokenIntegracao = String(req.body?.tokenIntegracao ?? '').trim();
    if (!tokenIntegracao) return res.status(400).json({ erro: 'Informe o token da integração.' });

    const r = await hubFetch<{ conectada: boolean; integrador: { codigo: string }; conexao: any }>('/hub/v1/integracao', {
      baseExplicita: baseUrl,
      tokenExplicito: tokenIntegracao,
    });
    if (!r.ok || !r.json) {
      return res.status(r.status || 502).json(r.json ?? { erro: r.text || 'Falha ao validar token no Hub.' });
    }

    const cur = obterConfig();
    const mesmaConexao = r.json.conexao?.conexaoId && r.json.conexao.conexaoId === cur.conexaoId;
    const patch: any = {
      baseUrl,
      tokenIntegracao,
      integradorCodigo: r.json.integrador.codigo,
      cnpj: r.json.conexao?.cnpj ?? '',
      nomeLoja: r.json.conexao?.nome ?? '',
      conexaoId: r.json.conexao?.conexaoId ?? '',
      estadoConexao: r.json.conexao?.estado ?? '',
      transporte: r.json.conexao?.transporte?.modo ?? 'PULL',
      lojasVinculadasJson: JSON.stringify(r.json.conexao?.lojas ?? []),
      tokenConexao: mesmaConexao ? cur.tokenConexao : '',
    };
    atualizarConfig(patch);

    // Se ja existe conexao 1:1 mas nao temos tokenConexao salvo neste SQLite, emitimos uma vez ao entrar
    if (r.json.conectada && !patch.tokenConexao) {
      const rec = await hubFetch<{ token: string }>('/hub/v1/integracao/recuperar-token', {
        metodo: 'POST',
        baseExplicita: baseUrl,
        tokenExplicito: tokenIntegracao,
      });
      if (rec.ok && rec.json?.token) {
        atualizarConfig({ tokenConexao: rec.json.token });
      }
    }

    res.json({ ok: true, integrador: r.json.integrador, conectado: r.json.conectada });
  });

  api.post('/sair', (req, res) => {
    atualizarConfig({
      tokenIntegracao: '',
      integradorCodigo: '',
      cnpj: '',
      nomeLoja: '',
      conexaoId: '',
      tokenConexao: '',
      estadoConexao: '',
      lojasVinculadasJson: '[]',
    });
    if (req.query.limparDados === 'true') {
      db.exec('DELETE FROM pedidos; DELETE FROM catalogo_itens; DELETE FROM catalogo_categorias;');
    }
    res.json({ ok: true });
  });

  api.post('/conectar-cnpj', async (req, res) => {
    const cnpj = String(req.body?.cnpj ?? '').replace(/\D/g, '');
    const nome = String(req.body?.nome ?? '').trim() || `Loja ${cnpj}`;
    const transporte = req.body?.transporte === 'PUSH' ? 'PUSH' : 'PULL';
    const webhookUrl = req.body?.webhookUrl ? String(req.body.webhookUrl).trim() : undefined;

    const r = await hubFetch<any>('/hub/v1/integracao/conectar', {
      metodo: 'POST',
      tokenTipo: 'integrador',
      body: {
        cnpj,
        nome,
        transporte,
        plataformas: ['IFOOD', '99FOOD'],
        ...(transporte === 'PUSH' && webhookUrl ? { webhook: { url: webhookUrl } } : {}),
      },
    });
    if (!r.ok || !r.json) return res.status(r.status || 400).json(r.json ?? { erro: r.text });

    const cur = obterConfig();
    let tokenConexao = r.json.credenciais?.token || (cur.conexaoId === r.json.conexaoId ? cur.tokenConexao : '');
    if (!tokenConexao) {
      const rec = await hubFetch<{ token: string }>('/hub/v1/integracao/recuperar-token', {
        metodo: 'POST',
        tokenTipo: 'integrador',
      });
      if (rec.ok && rec.json?.token) tokenConexao = rec.json.token;
    }

    atualizarConfig({
      cnpj: r.json.cnpj,
      nomeLoja: r.json.nome ?? nome,
      conexaoId: r.json.conexaoId,
      tokenConexao,
      webhookSegredo: r.json.credenciais?.webhookSegredo ?? cur.webhookSegredo,
      transporte: r.json.transporte?.modo ?? transporte,
      estadoConexao: r.json.estado ?? '',
      lojasVinculadasJson: JSON.stringify(r.json.lojas ?? []),
    });

    // Auto-vinculo: se so existir 1 loja livre disponivel, vincular sem intervencao
    const disponiveis: Array<{ plataforma: string; loja: string; nome: string }> = [
      ...(Array.isArray(r.json.lojasDisponiveis?.ifood) ? r.json.lojasDisponiveis.ifood : []),
      ...(Array.isArray(r.json.lojasDisponiveis?.ninenine) ? r.json.lojasDisponiveis.ninenine : []),
    ];
    // Nao re-vincular lojas que ja estao ativas na conexao
    const jaAtivas = new Set((r.json.lojas ?? []).filter((l: any) => l.estado === 'ATIVA').map((l: any) => l.loja));
    const paraVincular = disponiveis.filter((l) => !jaAtivas.has(l.loja));
    for (const loja of paraVincular) {
      const rv = await hubFetch<any>('/hub/v1/conexao/lojas', {
        metodo: 'POST',
        tokenTipo: 'conexao',
        body: { plataforma: loja.plataforma, loja: loja.loja },
      });
      if (rv.ok && rv.json) {
        atualizarConfig({ estadoConexao: rv.json.estado ?? '', lojasVinculadasJson: JSON.stringify(rv.json.lojas ?? []) });
      }
    }

    // Resposta final com estado atualizado
    const respostaFinal = obterConfig();
    res.status(r.status).json({ ...r.json, lojas: JSON.parse(respostaFinal.lojasVinculadasJson ?? '[]') });
  });

  api.post('/recuperar-token', async (_req, res) => {
    const r = await hubFetch<{ conexaoId: string; token: string; cnpj: string }>('/hub/v1/integracao/recuperar-token', {
      metodo: 'POST',
      tokenTipo: 'integrador',
    });
    if (!r.ok || !r.json) return res.status(r.status || 400).json(r.json ?? { erro: r.text });
    atualizarConfig({ tokenConexao: r.json.token, conexaoId: r.json.conexaoId });
    res.json(r.json);
  });

  api.get('/lojas-livres', async (_req, res) => {
    const r = await hubFetch('/hub/v1/conexao/lojas-disponiveis', { tokenTipo: 'conexao' });
    res.status(r.status || 502).json(r.json ?? { erro: r.text });
  });

  api.post('/lojas/vincular', async (req, res) => {
    const r = await hubFetch<any>('/hub/v1/conexao/lojas', {
      metodo: 'POST',
      tokenTipo: 'conexao',
      body: { plataforma: req.body?.plataforma, loja: req.body?.loja },
    });
    if (r.ok && r.json) {
      atualizarConfig({ estadoConexao: r.json.estado ?? '', lojasVinculadasJson: JSON.stringify(r.json.lojas ?? []) });
    }
    res.status(r.status || 400).json(r.json ?? { erro: r.text });
  });

  api.post('/lojas/liberar', async (req, res) => {
    const r = await hubFetch<any>('/hub/v1/conexao/lojas/liberar', {
      metodo: 'POST',
      tokenTipo: 'conexao',
      body: { plataforma: req.body?.plataforma, loja: req.body?.loja },
    });
    if (r.ok && r.json) {
      atualizarConfig({ estadoConexao: r.json.estado ?? '', lojasVinculadasJson: JSON.stringify(r.json.lojas ?? []) });
    }
    res.status(r.status || 400).json(r.json ?? { erro: r.text });
  });

  // ── Loja Status & Pausas ───────────────────────────────────────────────────

  api.get('/loja/status', async (_req, res) => {
    const r = await hubFetch('/hub/v1/conexao/loja/status', { tokenTipo: 'conexao' });
    res.status(r.status || 502).json(r.json ?? { erro: r.text });
  });

  api.post('/loja/interrupcoes', async (req, res) => {
    const agora = Date.now();
    const minutos = Number(req.body?.durationMinutes ?? 30);
    const paraBrasilia = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 19);
    const corpo = {
      description: String(req.body?.description ?? 'Pausa operacional'),
      start: req.body?.start || paraBrasilia(agora),
      end: req.body?.end || paraBrasilia(agora + Math.max(1, minutos) * 60_000),
    };
    const r = await hubFetch('/hub/v1/conexao/loja/interrupcoes', {
      metodo: 'POST',
      tokenTipo: 'conexao',
      body: corpo,
    });
    res.status(r.status || 400).json(r.json ?? { erro: r.text });
  });

  api.delete('/loja/interrupcoes/:id', async (req, res) => {
    const r = await hubFetch(`/hub/v1/conexao/loja/interrupcoes/${encodeURIComponent(req.params.id)}`, {
      metodo: 'DELETE',
      tokenTipo: 'conexao',
    });
    res.status(r.status || 400).json(r.json ?? { erro: r.text });
  });

  // ── Pedidos & Kanban (SQLite + Sync Hub) ───────────────────────────────────

  api.get('/pedidos', async (req, res) => {
    if (req.query.sync === 'true') {
      await sincronizarComHub().catch(() => undefined);
    }
    const linhas = db.prepare('SELECT * FROM pedidos ORDER BY atualizadoEm DESC LIMIT 200').all() as any[];
    res.json(
      linhas.map((p) => ({
        ...p,
        testeLocal: !!p.testeLocal,
        itens: JSON.parse(p.itensJson || '[]'),
        detalhe: JSON.parse(p.detalheJson || '{}'),
        eventos: JSON.parse(p.eventosJson || '[]'),
      })),
    );
  });

  api.post('/pedidos/sincronizar', async (_req, res) => {
    const s = await sincronizarComHub();
    // Tambem garante importacao de historico recente via /conexao/pedidos
    const lista = await hubFetch<Array<{ plataforma: string; pedidoId: string; ultimoTipo: string; eventos: unknown[] }>>(
      '/hub/v1/conexao/pedidos?limite=30',
      { tokenTipo: 'conexao' },
    );
    if (lista.ok && Array.isArray(lista.json)) {
      for (const p of lista.json) {
        if (!p.pedidoId) continue;
        const ja = db.prepare('SELECT id FROM pedidos WHERE id = ?').get(p.pedidoId);
        if (!ja) {
          const det = await hubFetch(`/hub/v1/conexao/pedidos/${p.pedidoId}?plataforma=${p.plataforma}`, { tokenTipo: 'conexao' });
          upsertPedidoDoDetalhe(p.pedidoId, p.plataforma, p.ultimoTipo || 'PLACED', det.json ?? {});
        }
      }
    }
    res.json({ ok: true, ...s });
  });

  api.post('/pedidos/teste', async (req, res) => {
    // 1. Dispara evento de teste real no Hub
    const ev = await hubFetch<{ seq: number; eventoId: string }>('/hub/v1/conexao/eventos/teste', {
      metodo: 'POST',
      tokenTipo: 'conexao',
    });
    // 2. Opcionalmente cria um card de simulacao local no Kanban SQLite para testar movimentacao completa
    if (req.body?.criarCardKanban !== false) {
      const id = `sim-${crypto.randomUUID().slice(0, 8)}`;
      const codigo = `SIM-${Math.floor(1000 + Math.random() * 9000)}`;
      const agora = new Date().toISOString();
      const detalhe = {
        id,
        displayId: codigo,
        orderType: 'DELIVERY',
        customer: { name: 'Cliente Simulação Local', phone: { number: '11999990000' } },
        delivery: { deliveryAddress: { streetName: 'Rua de Homologação', streetNumber: '100', neighborhood: 'Centro', city: 'São Paulo' } },
        items: [
          { name: 'X-Burger Clássico (Simulação)', quantity: 1, totalPrice: 28.9, options: [{ name: 'Bacon extra', price: 4.0 }] },
          { name: 'Refrigerante Lata', quantity: 1, totalPrice: 6.5 },
        ],
        payments: { methods: [{ method: 'CREDIT', type: 'ONLINE', value: 39.4 }] },
        total: { subTotal: 39.4, deliveryFee: 0, orderAmount: 39.4 },
      };
      db.prepare(`
        INSERT INTO pedidos (id, plataforma, codigoCurto, clienteNome, clienteTelefone, endereco, totalReal, statusKanban, etapaPlataforma, testeLocal, itensJson, detalheJson, eventosJson, criadoEm, atualizadoEm)
        VALUES (?, 'IFOOD', ?, ?, '11999990000', 'Rua de Homologação, 100, Centro', 39.4, 'NOVO', 'PLACED', 1, ?, ?, ?, ?, ?)
      `).run(
        id,
        codigo,
        'Cliente Simulação Local',
        JSON.stringify(detalhe.items),
        JSON.stringify(detalhe),
        JSON.stringify([{ tipo: 'SIMULACAO_LOCAL', recebidoEm: agora, hubSeq: ev.json?.seq ?? null }]),
        agora,
        agora,
      );
      return res.status(201).json({ ok: true, hubEvento: ev.json, pedidoId: id, codigo });
    }
    res.status(ev.status || 202).json(ev.json ?? { ok: ev.ok });
  });

  api.delete('/pedidos/simulacoes', (_req, res) => {
    const r = db.prepare('DELETE FROM pedidos WHERE testeLocal = 1').run();
    res.json({ removidos: r.changes });
  });

  api.get('/pedidos/:id/subrecurso', async (req, res) => {
    const tipo = String(req.query.tipo ?? 'motivos');
    const ped = db.prepare('SELECT testeLocal FROM pedidos WHERE id = ?').get(req.params.id) as { testeLocal: number } | undefined;
    if (ped?.testeLocal) {
      return res.json([
        { cancelCodeId: '501', description: 'Problemas de sistema / teste', cancelSchedule: false },
        { cancelCodeId: '503', description: 'Item em falta no estoque', cancelSchedule: false },
      ]);
    }
    const r = await hubFetch(`/hub/v1/conexao/pedidos/${encodeURIComponent(req.params.id)}/subrecurso?tipo=${encodeURIComponent(tipo)}`, {
      tokenTipo: 'conexao',
    });
    res.status(r.status || 400).json(r.json ?? { erro: r.text });
  });

  api.post('/pedidos/:id/acao', async (req, res) => {
    const pedidoId = req.params.id;
    const acao = String(req.body?.acao ?? '');
    const dados = req.body?.dados as Record<string, unknown> | undefined;
    const ped = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId) as any;

    if (ped?.testeLocal) {
      const mapa: Record<string, { kanban: string; etapa: string }> = {
        confirm: { kanban: 'PREPARO', etapa: 'CONFIRMED' },
        startPreparation: { kanban: 'PREPARO', etapa: 'PREPARATION_STARTED' },
        readyToPickup: { kanban: 'PRONTO', etapa: 'READY_TO_PICKUP' },
        dispatch: { kanban: 'ENTREGA', etapa: 'DISPATCHED' },
        conclude: { kanban: 'CONCLUIDO', etapa: 'CONCLUDED' },
        delivered: { kanban: 'CONCLUIDO', etapa: 'CONCLUDED' },
        acceptCancellation: { kanban: 'CANCELADO', etapa: 'CANCELLED' },
        denyCancellation: { kanban: ped.statusKanban || 'PREPARO', etapa: ped.etapaPlataforma || 'CONFIRMED' },
        requestCancellation: { kanban: 'CANCELADO', etapa: 'CANCELLED' },
      };
      const prox = mapa[acao];
      if (!prox) return res.status(400).json({ erro: `Ação inválida: ${acao}` });
      const evs = JSON.parse(ped.eventosJson || '[]');
      evs.unshift({ tipo: prox.etapa, recebidoEm: new Date().toISOString(), origem: 'KANBAN_SIMULACAO', dados: dados ?? null });
      db.prepare('UPDATE pedidos SET statusKanban = ?, etapaPlataforma = ?, eventosJson = ?, atualizadoEm = ? WHERE id = ?').run(
        prox.kanban,
        prox.etapa,
        JSON.stringify(evs),
        new Date().toISOString(),
        pedidoId,
      );
      return res.json({ ok: true, statusKanban: prox.kanban, etapa: prox.etapa });
    }

    // iFood nao possui endpoint POST /conclude (conclusao ocorre automaticamente pos-despacho); concluimos no painel local se solicitado
    if (ped?.plataforma === 'IFOOD' && (acao === 'conclude' || acao === 'delivered')) {
      const evs = JSON.parse(ped.eventosJson || '[]');
      evs.unshift({ tipo: 'CONCLUDED', recebidoEm: new Date().toISOString(), origem: 'PAINEL_ERP' });
      db.prepare('UPDATE pedidos SET statusKanban = ?, etapaPlataforma = ?, eventosJson = ?, atualizadoEm = ? WHERE id = ?').run(
        'CONCLUIDO',
        'CONCLUDED',
        JSON.stringify(evs),
        new Date().toISOString(),
        pedidoId,
      );
      return res.json({ ok: true, statusKanban: 'CONCLUIDO', localOnly: true });
    }

    const acaoHub = ped?.plataforma === '99FOOD' && acao === 'conclude' ? 'delivered' : acao;
    const r = await hubFetch(`/hub/v1/conexao/pedidos/${encodeURIComponent(pedidoId)}/acao`, {
      metodo: 'POST',
      tokenTipo: 'conexao',
      headers: { 'Idempotency-Key': `erp-sim-${acaoHub}-${pedidoId}-${Date.now()}` },
      body: { acao: acaoHub, ...(ped?.plataforma ? { plataforma: ped.plataforma } : {}), ...(dados ? { dados } : {}) },
    });
    if (!r.ok) return res.status(r.status || 400).json(r.json ?? { erro: r.text });

    const etapaNova = mapearAcaoParaEtapa(acaoHub);
    const novoKanban = mapearEtapaParaKanban(etapaNova, ped?.statusKanban);
    if (ped) {
      db.prepare('UPDATE pedidos SET statusKanban = ?, etapaPlataforma = ?, atualizadoEm = ? WHERE id = ?').run(
        novoKanban,
        etapaNova,
        new Date().toISOString(),
        pedidoId,
      );
    }
    res.json({ ok: true, resposta: r.json, statusKanban: novoKanban });
  });

  api.patch('/pedidos/:id/manual', (req, res) => {
    const ped = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id) as any;
    if (!ped) return res.status(404).json({ erro: 'Pedido não encontrado' });

    const detalhe = JSON.parse(ped.detalheJson || '{}');
    const clienteNome = typeof req.body?.clienteNome === 'string' && req.body.clienteNome.trim() ? req.body.clienteNome.trim() : ped.clienteNome;
    const clienteTelefone = typeof req.body?.clienteTelefone === 'string' ? req.body.clienteTelefone.trim() : ped.clienteTelefone;
    const endereco = typeof req.body?.endereco === 'string' ? req.body.endereco.trim() : ped.endereco;
    const statusKanban = typeof req.body?.statusKanban === 'string' && req.body.statusKanban ? req.body.statusKanban : ped.statusKanban;
    const observacao = typeof req.body?.observacao === 'string' ? req.body.observacao.trim() : undefined;

    if (observacao !== undefined) detalhe.observacaoErp = observacao;
    detalhe.customer = { ...(detalhe.customer ?? {}), name: clienteNome, phone: { ...(detalhe.customer?.phone ?? {}), number: clienteTelefone } };
    const evs = JSON.parse(ped.eventosJson || '[]');
    evs.unshift({ tipo: 'EDICAO_MANUAL', recebidoEm: new Date().toISOString(), statusKanban, clienteNome });

    db.prepare(
      'UPDATE pedidos SET clienteNome = ?, clienteTelefone = ?, endereco = ?, statusKanban = ?, detalheJson = ?, eventosJson = ?, atualizadoEm = ? WHERE id = ?',
    ).run(clienteNome, clienteTelefone, endereco, statusKanban, JSON.stringify(detalhe), JSON.stringify(evs.slice(0, 30)), new Date().toISOString(), ped.id);

    res.json({ ok: true });
  });

  // Receptor PUSH opcional
  api.post('/webhook', (req: any, res) => {
    const cfg = obterConfig();
    registrarLog({
      metodo: 'WEBHOOK_PUSH',
      url: '/erp-simulador/api/webhook',
      status: 200,
      ms: 1,
      reqHeaders: JSON.stringify(req.headers),
      reqBody: req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {}),
      resBody: '{"recebido":true}',
    } as any);
    if (cfg.webhookSegredo && req.headers['x-target-assinatura'] && req.rawBody) {
      const ts = String(req.headers['x-target-timestamp'] ?? '');
      const nid = String(req.headers['x-target-notificacao'] ?? '');
      const base = `${ts}.${nid}.${req.rawBody.toString('utf8')}`;
      const esperado = `v1=${crypto.createHmac('sha256', cfg.webhookSegredo).update(base).digest('hex')}`;
      const confere = String(req.headers['x-target-assinatura']).split(',').some((s) => s.trim() === esperado);
      if (!confere) return res.status(401).json({ erro: 'Assinatura HMAC invalida' });
    }
    res.json({ recebido: true });
  });

  // ── Catálogo Completo (SQLite + Sync Hub) ──────────────────────────────────

  async function sincronizarCatalogoNoSqlite() {
    const r = await hubFetch<any>('/hub/v1/conexao/catalogo', { tokenTipo: 'conexao' });
    if (!r.ok || !r.json) return r;

    const agora = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM catalogo_itens').run();
      db.prepare('DELETE FROM catalogo_categorias').run();

      const catsIfood = r.json.ifood?.categorias ?? [];
      catsIfood.forEach((cat: any, idx: number) => {
        db.prepare(`
          INSERT INTO catalogo_categorias (id, plataforma, nome, status, ordem, payloadJson, atualizadoEm)
          VALUES (?, 'IFOOD', ?, ?, ?, ?, ?)
        `).run(cat.id, cat.name ?? 'Sem nome', cat.status ?? 'AVAILABLE', cat.sequence ?? idx, JSON.stringify(cat), agora);

        (cat.items ?? []).forEach((it: any, itIdx: number) => {
          db.prepare(`
            INSERT INTO catalogo_itens (id, categoriaId, plataforma, nome, descricao, sku, preco, status, ordem, gruposJson, payloadJson, atualizadoEm)
            VALUES (?, ?, 'IFOOD', ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            it.id,
            cat.id,
            it.name ?? 'Item',
            it.description ?? '',
            it.externalCode ?? '',
            Number(it.price?.value ?? 0),
            it.status ?? 'AVAILABLE',
            it.sequence ?? itIdx,
            JSON.stringify(it.optionGroups ?? []),
            JSON.stringify(it),
            agora,
          );
        });
      });

      const lista99 = Array.isArray(r.json.ninenine?.cardapio)
        ? r.json.ninenine.cardapio
        : Array.isArray(r.json.ninenine?.cardapio?.items)
          ? r.json.ninenine.cardapio.items
          : Array.isArray(r.json.ninenine?.cardapio?.data)
            ? r.json.ninenine.cardapio.data
            : [];
      if (lista99.length > 0) {
        const grupos99 = new Map<string, any[]>();
        for (const it of lista99) {
          const catNome = String(it.category_name ?? it.categoryName ?? 'Cardápio 99Food');
          if (!grupos99.has(catNome)) grupos99.set(catNome, []);
          grupos99.get(catNome)!.push(it);
        }
        let catSeq = 1000;
        for (const [catNome, itens99] of grupos99.entries()) {
          const catId = `99cat-${Buffer.from(catNome).toString('hex').slice(0, 12)}`;
          db.prepare(`
            INSERT OR REPLACE INTO catalogo_categorias (id, plataforma, nome, status, ordem, payloadJson, atualizadoEm)
            VALUES (?, '99FOOD', ?, 'AVAILABLE', ?, ?, ?)
          `).run(catId, catNome, catSeq++, JSON.stringify({ nome: catNome, origem: '99FOOD' }), agora);

          itens99.forEach((it: any, iIdx: number) => {
            const id99 = String(it.app_item_id ?? it.item_id ?? it.id ?? `99-${catSeq}-${iIdx}`);
            const precoCent = Number(it.price ?? 0);
            const precoReais = precoCent > 200 ? precoCent / 100 : precoCent;
            const ativo = it.status === 1 || it.status === 'AVAILABLE' || it.available === true;
            db.prepare(`
              INSERT OR REPLACE INTO catalogo_itens (id, categoriaId, plataforma, nome, descricao, sku, preco, status, ordem, gruposJson, payloadJson, atualizadoEm)
              VALUES (?, ?, '99FOOD', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              id99,
              catId,
              String(it.item_name ?? it.name ?? 'Item 99Food'),
              String(it.description ?? ''),
              String(it.app_item_id ?? it.external_code ?? ''),
              precoReais,
              ativo ? 'AVAILABLE' : 'UNAVAILABLE',
              iIdx,
              JSON.stringify(it.modifier_groups ?? it.optionGroups ?? []),
              JSON.stringify(it),
              agora,
            );
          });
        }
      }
    });
    tx();
    return r;
  }

  api.get('/catalogo', async (req, res) => {
    const count = (db.prepare('SELECT COUNT(*) as n FROM catalogo_categorias').get() as { n: number }).n;
    if (req.query.sincronizar === 'true' || count === 0) {
      const r = await sincronizarCatalogoNoSqlite();
      if (!r.ok && count === 0) return res.status(r.status || 400).json(r.json ?? { erro: r.text });
    }
    const categorias = db.prepare('SELECT * FROM catalogo_categorias ORDER BY ordem ASC, nome ASC').all() as any[];
    const itens = db.prepare('SELECT * FROM catalogo_itens ORDER BY ordem ASC, nome ASC').all() as any[];
    res.json({
      categorias: categorias.map((c) => ({
        ...c,
        payload: JSON.parse(c.payloadJson || '{}'),
        itens: itens
          .filter((i) => i.categoriaId === c.id)
          .map((i) => ({
            ...i,
            grupos: JSON.parse(i.gruposJson || '[]'),
            payload: JSON.parse(i.payloadJson || '{}'),
          })),
      })),
    });
  });

  api.post('/catalogo/categorias', async (req, res) => {
    const r = await hubFetch<any>('/hub/v1/conexao/catalogo/categorias', {
      metodo: 'POST',
      tokenTipo: 'conexao',
      body: { name: req.body?.nome ?? req.body?.name, status: req.body?.status ?? 'AVAILABLE', template: 'DEFAULT' },
    });
    if (!r.ok) return res.status(r.status || 400).json(r.json ?? { erro: r.text });
    await sincronizarCatalogoNoSqlite();
    res.json(r.json);
  });

  api.patch('/catalogo/categorias/:id', async (req, res) => {
    const body: Record<string, unknown> = {};
    if (req.body?.status) body.status = req.body.status;
    if (req.body?.nome || req.body?.name) body.name = req.body.nome ?? req.body.name;
    if (req.body?.sequence !== undefined) body.sequence = req.body.sequence;

    const r = await hubFetch(`/hub/v1/conexao/catalogo/categorias/${encodeURIComponent(req.params.id)}`, {
      metodo: 'PATCH',
      tokenTipo: 'conexao',
      body,
    });
    if (!r.ok) return res.status(r.status || 400).json(r.json ?? { erro: r.text });
    await sincronizarCatalogoNoSqlite();
    res.json(r.json);
  });

  api.post('/catalogo/categorias/:id/mover', async (req, res) => {
    const direcao = req.body?.direcao === 'subir' ? -1 : 1;
    const cats = db.prepare('SELECT id, ordem FROM catalogo_categorias ORDER BY ordem ASC, nome ASC').all() as Array<{ id: string; ordem: number }>;
    const idx = cats.findIndex((c) => c.id === req.params.id);
    const alvoIdx = idx + direcao;
    if (idx < 0 || alvoIdx < 0 || alvoIdx >= cats.length) {
      return res.json({ ok: true, semAlteracao: true });
    }
    const atual = cats[idx];
    const vizinha = cats[alvoIdx];

    // Envia nova ordem real para o iFood
    const r1 = await hubFetch(`/hub/v1/conexao/catalogo/categorias/${encodeURIComponent(atual.id)}`, {
      metodo: 'PATCH',
      tokenTipo: 'conexao',
      body: { sequence: alvoIdx },
    });
    const r2 = await hubFetch(`/hub/v1/conexao/catalogo/categorias/${encodeURIComponent(vizinha.id)}`, {
      metodo: 'PATCH',
      tokenTipo: 'conexao',
      body: { sequence: idx },
    });
    if (!r1.ok) return res.status(r1.status || 400).json(r1.json ?? { erro: r1.text });
    if (!r2.ok) return res.status(r2.status || 400).json(r2.json ?? { erro: r2.text });

    db.prepare('UPDATE catalogo_categorias SET ordem = ? WHERE id = ?').run(alvoIdx, atual.id);
    db.prepare('UPDATE catalogo_categorias SET ordem = ? WHERE id = ?').run(idx, vizinha.id);
    res.json({ ok: true });
  });

  api.put('/catalogo/itens', async (req, res) => {
    const plat = String(req.query.plataforma ?? req.body?.plataforma ?? 'IFOOD').toUpperCase();
    let payload = req.body;
    if (plat === 'IFOOD' && !payload?.item) {
      const itemId = String(payload?.id ?? crypto.randomUUID());
      const productId = String(payload?.productId ?? crypto.randomUUID());
      const preco = Number(payload?.preco ?? payload?.price?.value ?? 0);
      const grupos = Array.isArray(payload?.optionGroups) ? payload.optionGroups : [];
      payload = {
        item: {
          id: itemId,
          type: payload?.type ?? 'DEFAULT',
          categoryId: payload?.categoryId ?? payload?.categoriaId,
          status: payload?.status ?? 'AVAILABLE',
          price: { value: preco },
          ...(payload?.externalCode || payload?.sku ? { externalCode: String(payload.externalCode ?? payload.sku) } : {}),
          index: Number(payload?.index ?? 0),
          productId,
        },
        products: [
          {
            id: productId,
            name: String(payload?.name ?? payload?.nome ?? 'Item'),
            description: String(payload?.description ?? payload?.descricao ?? ''),
            ...(payload?.externalCode || payload?.sku ? { externalCode: String(payload.externalCode ?? payload.sku) } : {}),
            serving: payload?.serving ?? 'SERVES_1',
            ...(grupos.length ? { optionGroups: grupos } : {}),
          },
        ],
      };
    }
    const r = await hubFetch(`/hub/v1/conexao/catalogo/itens?plataforma=${encodeURIComponent(plat)}`, {
      metodo: 'PUT',
      tokenTipo: 'conexao',
      body: payload,
    });
    if (!r.ok) return res.status(r.status || 400).json(r.json ?? { erro: r.text });
    await sincronizarCatalogoNoSqlite();
    res.json(r.json);
  });

  api.patch('/catalogo/itens/status', async (req, res) => {
    const { itemId, status, plataforma } = req.body ?? {};
    const plat = String(plataforma ?? req.query.plataforma ?? 'IFOOD').toUpperCase();
    const corpo = plat === '99FOOD' ? { app_item_id: itemId, status: status === 'AVAILABLE' ? 1 : 2 } : { itemId, status };
    const r = await hubFetch(`/hub/v1/conexao/catalogo/itens/status?plataforma=${encodeURIComponent(plat)}`, {
      metodo: 'PATCH',
      tokenTipo: 'conexao',
      body: corpo,
    });
    if (!r.ok) return res.status(r.status || 400).json(r.json ?? { erro: r.text });
    db.prepare('UPDATE catalogo_itens SET status = ?, atualizadoEm = ? WHERE id = ?').run(status, new Date().toISOString(), itemId);
    res.json(r.json);
  });

  api.patch('/catalogo/itens/preco', async (req, res) => {
    const { itemId, price, plataforma } = req.body ?? {};
    const plat = String(plataforma ?? req.query.plataforma ?? 'IFOOD').toUpperCase();
    const valor = Number(price?.value ?? 0);
    const corpo = plat === '99FOOD' ? { app_item_id: itemId, price: Math.round(valor * 100) } : { itemId, price: { value: valor } };
    const r = await hubFetch(`/hub/v1/conexao/catalogo/itens/preco?plataforma=${encodeURIComponent(plat)}`, {
      metodo: 'PATCH',
      tokenTipo: 'conexao',
      body: corpo,
    });
    if (!r.ok) return res.status(r.status || 400).json(r.json ?? { erro: r.text });
    db.prepare('UPDATE catalogo_itens SET preco = ?, atualizadoEm = ? WHERE id = ?').run(valor, new Date().toISOString(), itemId);
    res.json(r.json);
  });

  api.post('/catalogo/itens/:id/mover', (req, res) => {
    const direcao = req.body?.direcao === 'subir' ? -1 : 1;
    const item = db.prepare('SELECT id, categoriaId FROM catalogo_itens WHERE id = ?').get(req.params.id) as { id: string; categoriaId: string } | undefined;
    if (!item) return res.status(404).json({ erro: 'Item não encontrado' });
    const lista = db
      .prepare('SELECT id, ordem FROM catalogo_itens WHERE categoriaId = ? ORDER BY ordem ASC, nome ASC')
      .all(item.categoriaId) as Array<{ id: string; ordem: number }>;
    const idx = lista.findIndex((x) => x.id === item.id);
    const alvo = idx + direcao;
    if (idx < 0 || alvo < 0 || alvo >= lista.length) return res.json({ ok: true });
    lista.forEach((it, pos) => db.prepare('UPDATE catalogo_itens SET ordem = ? WHERE id = ?').run(pos, it.id));
    db.prepare('UPDATE catalogo_itens SET ordem = ? WHERE id = ?').run(alvo, lista[idx].id);
    db.prepare('UPDATE catalogo_itens SET ordem = ? WHERE id = ?').run(idx, lista[alvo].id);
    res.json({ ok: true });
  });

  api.get('/catalogo/itens/:itemId', async (req, res) => {
    const r = await hubFetch<any>(`/hub/v1/conexao/catalogo/itens/${encodeURIComponent(req.params.itemId)}`, {
      tokenTipo: 'conexao',
    });
    if (r.ok && r.json?.optionGroups) {
      db.prepare('UPDATE catalogo_itens SET gruposJson = ?, atualizadoEm = ? WHERE id = ?').run(
        JSON.stringify(r.json.optionGroups),
        new Date().toISOString(),
        req.params.itemId,
      );
    }
    res.status(r.status || 400).json(r.json ?? { erro: r.text });
  });

  api.patch('/catalogo/opcoes/status', async (req, res) => {
    const plat = String(req.body?.plataforma ?? req.query.plataforma ?? 'IFOOD').toUpperCase();
    const { optionId, status } = req.body ?? {};
    const r = await hubFetch(`/hub/v1/conexao/catalogo/opcoes/status?plataforma=${encodeURIComponent(plat)}`, {
      metodo: 'PATCH',
      tokenTipo: 'conexao',
      body: { optionId, status },
    });
    res.status(r.status || 400).json(r.json ?? { erro: r.text });
  });

  api.patch('/catalogo/opcoes/preco', async (req, res) => {
    const plat = String(req.body?.plataforma ?? req.query.plataforma ?? 'IFOOD').toUpperCase();
    const { optionId, price } = req.body ?? {};
    const r = await hubFetch(`/hub/v1/conexao/catalogo/opcoes/preco?plataforma=${encodeURIComponent(plat)}`, {
      metodo: 'PATCH',
      tokenTipo: 'conexao',
      body: { optionId, price },
    });
    res.status(r.status || 400).json(r.json ?? { erro: r.text });
  });

  api.get('/catalogo/nao-vendaveis', async (_req, res) => {
    const r = await hubFetch('/hub/v1/conexao/catalogo/nao-vendaveis', { tokenTipo: 'conexao' });
    res.status(r.status || 400).json(r.json ?? { erro: r.text });
  });

  // ── Logs Persistentes SQLite (dentro do menu 3 pontos) ─────────────────────

  api.get('/logs', (req, res) => {
    const filtro = String(req.query.filtro ?? 'todos');
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const limite = Math.min(Math.max(Number(req.query.limite ?? 300), 1), 1000);

    const where: string[] = [];
    const params: unknown[] = [];
    if (filtro === 'erros') where.push('(status = 0 OR status >= 400)');
    else if (filtro === 'sucesso') where.push('(status >= 200 AND status < 300)');
    if (q) {
      where.push('(LOWER(metodo) LIKE ? OR LOWER(url) LIKE ? OR CAST(status AS TEXT) LIKE ? OR LOWER(erroResumo) LIKE ? OR LOWER(reqBody) LIKE ? OR LOWER(resBody) LIKE ?)');
      const pat = `%${q}%`;
      params.push(pat, pat, pat, pat, pat, pat);
    }

    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM logs_http ${sqlWhere} ORDER BY id DESC LIMIT ?`).all(...params, limite) as any[];

    const totalErros = (db.prepare('SELECT COUNT(*) as n FROM logs_http WHERE status = 0 OR status >= 400').get() as { n: number }).n;
    const total = (db.prepare('SELECT COUNT(*) as n FROM logs_http').get() as { n: number }).n;
    res.json({ total, totalErros, logs: rows });
  });

  api.get('/logs/exportar', (_req, res) => {
    const rows = db.prepare('SELECT * FROM logs_http ORDER BY id DESC').all();
    res.setHeader('Content-Disposition', 'attachment; filename="erp-simulador-logs.json"');
    res.json(rows);
  });

  api.delete('/logs', (_req, res) => {
    db.prepare('DELETE FROM logs_http').run();
    res.json({ ok: true });
  });

  app.use('/erp-simulador/api', api);
  app.use('/api', api);

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

function mapearAcaoParaEtapa(acao: string): string {
  const m: Record<string, string> = {
    confirm: 'CONFIRMED',
    startPreparation: 'PREPARATION_STARTED',
    readyToPickup: 'READY_TO_PICKUP',
    dispatch: 'DISPATCHED',
    conclude: 'CONCLUDED',
    delivered: 'CONCLUDED',
    requestCancellation: 'CANCELLED',
    acceptCancellation: 'CANCELLED',
  };
  return m[acao] ?? acao.toUpperCase();
}
