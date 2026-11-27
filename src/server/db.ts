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

  -- Caixa de entrada duravel: o evento e gravado aqui ANTES de responder 200 ao Hub ou confirmar o cursor PULL
  CREATE TABLE IF NOT EXISTS eventos (
    id TEXT PRIMARY KEY,
    conexaoId TEXT NOT NULL DEFAULT '',
    seq INTEGER,
    origem TEXT NOT NULL,
    plataforma TEXT NOT NULL,
    pedidoId TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL,
    corpo TEXT NOT NULL DEFAULT '',
    ocorridoEm TEXT NOT NULL,
    recebidoEm TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'PENDENTE',
    tentativas INTEGER NOT NULL DEFAULT 0,
    proximaEm INTEGER NOT NULL DEFAULT 0,
    erro TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_eventos_fila ON eventos(estado, proximaEm);
  CREATE INDEX IF NOT EXISTS idx_eventos_seq ON eventos(conexaoId, seq);

  CREATE TABLE IF NOT EXISTS ajustes (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);

  -- Cardapio do ERP (fonte da verdade) e fila de publicacao nos canais
  CREATE TABLE IF NOT EXISTS produtos (
    codigo TEXT PRIMARY KEY,
    definicaoJson TEXT NOT NULL,
    canaisJson TEXT NOT NULL DEFAULT '{}',
    estado TEXT NOT NULL DEFAULT 'NA_FILA',
    erro TEXT NOT NULL DEFAULT '',
    atualizadoEm TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fila_catalogo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT NOT NULL,
    operacao TEXT NOT NULL,
    opcao TEXT NOT NULL DEFAULT '',
    dadosJson TEXT NOT NULL DEFAULT '{}',
    estado TEXT NOT NULL DEFAULT 'PENDENTE',
    tentativas INTEGER NOT NULL DEFAULT 0,
    proximaEm INTEGER NOT NULL DEFAULT 0,
    erro TEXT NOT NULL DEFAULT ''
  );

  -- Copia local do que esta nas plataformas. Chave composta: ids se repetem entre iFood e 99Food
  CREATE TABLE IF NOT EXISTS espelho_categorias (
    plataforma TEXT NOT NULL,
    id TEXT NOT NULL,
    ordem INTEGER NOT NULL DEFAULT 0,
    json TEXT NOT NULL,
    atualizadoEm TEXT NOT NULL,
    PRIMARY KEY (plataforma, id)
  );
  -- Cache antigo do cardapio (chave sem plataforma), substituido pelo espelho acima
  DROP TABLE IF EXISTS catalogo_itens;
  DROP TABLE IF EXISTS catalogo_categorias;

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

/** Colunas acrescentadas depois da primeira versao: bancos antigos ganham sem perder dados. */
function garantirColuna(tabela: string, coluna: string, definicao: string) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>;
  if (!colunas.some((c) => c.name === coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}
garantirColuna('pedidos', 'modalidade', "TEXT NOT NULL DEFAULT 'ENTREGA_PROPRIA'");
garantirColuna('pedidos', 'detalhePendente', 'INTEGER NOT NULL DEFAULT 1');
garantirColuna('pedidos', 'estadoJson', "TEXT NOT NULL DEFAULT '{}'");

// Intencao de excluir e pausas de pizza ja enviadas as plataformas
garantirColuna('produtos', 'removendo', 'INTEGER NOT NULL DEFAULT 0');
garantirColuna('produtos', 'pausadasJson', "TEXT NOT NULL DEFAULT '[]'");
garantirColuna('produtos', 'reaplicarPausas', 'INTEGER NOT NULL DEFAULT 0');
// Envio interrompido por reinicio volta para a fila
db.prepare("UPDATE fila_catalogo SET estado = 'PENDENTE' WHERE estado = 'ENVIANDO'").run();

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

export function lerAjuste(chave: string, padrao: string): string {
  const l = db.prepare('SELECT valor FROM ajustes WHERE chave = ?').get(chave) as { valor: string } | undefined;
  return l?.valor ?? padrao;
}

export function gravarAjuste(chave: string, valor: string) {
  db.prepare('INSERT INTO ajustes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, valor);
}
