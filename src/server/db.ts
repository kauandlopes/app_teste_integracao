import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'erp-hub.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    baseUrl TEXT NOT NULL DEFAULT 'https://delivery.targetx.com.br/api/v1',
    tokenIntegracao TEXT NOT NULL DEFAULT '',
    integradorCodigo TEXT NOT NULL DEFAULT '',
    cnpj TEXT NOT NULL DEFAULT '',
    nomeLoja TEXT NOT NULL DEFAULT '',
    conexaoId TEXT NOT NULL DEFAULT '',
    tokenConexao TEXT NOT NULL DEFAULT '',
    webhookSegredo TEXT NOT NULL DEFAULT '',
    transporte TEXT NOT NULL DEFAULT 'PULL',
    estadoConexao TEXT NOT NULL DEFAULT '',
    lojasVinculadasJson TEXT NOT NULL DEFAULT '[]',
    atualizadoEm TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO config (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS pedidos (
    id TEXT PRIMARY KEY,
    plataforma TEXT NOT NULL,
    codigoCurto TEXT NOT NULL DEFAULT '',
    clienteNome TEXT NOT NULL DEFAULT 'Cliente',
    clienteTelefone TEXT NOT NULL DEFAULT '',
    endereco TEXT NOT NULL DEFAULT '',
    totalReal REAL NOT NULL DEFAULT 0,
    statusKanban TEXT NOT NULL DEFAULT 'NOVO',
    etapaPlataforma TEXT NOT NULL DEFAULT 'PLACED',
    testeLocal INTEGER NOT NULL DEFAULT 0,
    itensJson TEXT NOT NULL DEFAULT '[]',
    detalheJson TEXT NOT NULL DEFAULT '{}',
    eventosJson TEXT NOT NULL DEFAULT '[]',
    criadoEm TEXT NOT NULL DEFAULT (datetime('now')),
    atualizadoEm TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS catalogo_categorias (
    id TEXT PRIMARY KEY,
    plataforma TEXT NOT NULL,
    nome TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',
    ordem INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL DEFAULT '{}',
    atualizadoEm TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS catalogo_itens (
    id TEXT PRIMARY KEY,
    categoriaId TEXT NOT NULL,
    plataforma TEXT NOT NULL,
    nome TEXT NOT NULL,
    descricao TEXT NOT NULL DEFAULT '',
    sku TEXT NOT NULL DEFAULT '',
    preco REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',
    ordem INTEGER NOT NULL DEFAULT 0,
    gruposJson TEXT NOT NULL DEFAULT '[]',
    payloadJson TEXT NOT NULL DEFAULT '{}',
    atualizadoEm TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS logs_http (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quando TEXT NOT NULL,
    metodo TEXT NOT NULL,
    url TEXT NOT NULL,
    status INTEGER NOT NULL,
    ms INTEGER NOT NULL,
    erroResumo TEXT NOT NULL DEFAULT '',
    reqHeaders TEXT NOT NULL DEFAULT '{}',
    reqBody TEXT NOT NULL DEFAULT '',
    resBody TEXT NOT NULL DEFAULT '',
    curl TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_logs_http_status ON logs_http(status);
  CREATE INDEX IF NOT EXISTS idx_pedidos_kanban ON pedidos(statusKanban, atualizadoEm DESC);
`);

export interface ConfigRow {
  id: number;
  baseUrl: string;
  tokenIntegracao: string;
  integradorCodigo: string;
  cnpj: string;
  nomeLoja: string;
  conexaoId: string;
  tokenConexao: string;
  webhookSegredo: string;
  transporte: string;
  estadoConexao: string;
  lojasVinculadasJson: string;
  atualizadoEm: string;
}

export function obterConfig(): ConfigRow {
  return db.prepare('SELECT * FROM config WHERE id = 1').get() as ConfigRow;
}

export function atualizarConfig(patch: Partial<Omit<ConfigRow, 'id' | 'atualizadoEm'>>): ConfigRow {
  const atual = obterConfig();
  const prox = { ...atual, ...patch, atualizadoEm: new Date().toISOString() };
  db.prepare(`
    UPDATE config SET
      baseUrl = @baseUrl,
      tokenIntegracao = @tokenIntegracao,
      integradorCodigo = @integradorCodigo,
      cnpj = @cnpj,
      nomeLoja = @nomeLoja,
      conexaoId = @conexaoId,
      tokenConexao = @tokenConexao,
      webhookSegredo = @webhookSegredo,
      transporte = @transporte,
      estadoConexao = @estadoConexao,
      lojasVinculadasJson = @lojasVinculadasJson,
      atualizadoEm = @atualizadoEm
    WHERE id = 1
  `).run(prox);
  return obterConfig();
}
