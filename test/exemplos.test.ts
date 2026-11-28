import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import test from 'node:test';
import { docExemplos, docTelas } from '../scripts/gerar-docs.js';
import { assinaturaValida, conferirValores, desfecho, lerJsonSemArredondar } from '../src/shared/exemplos/integracao-minima.js';
import ifood from '../src/shared/exemplos/pedido-ifood.json' with { type: 'json' };
import noventaENove from '../src/shared/exemplos/pedido-99food.json' with { type: 'json' };

const ler = (a: string) => fs.readFileSync(new URL(a, import.meta.url), 'utf8');

test('os dois pedidos reais fecham: itens = subtotal e total com taxas', () => {
  for (const e of [ifood, noventaENove]) assert.deepEqual(conferirValores(e.detalheUnificado as any), { itensBatem: true, totalBate: true });
});

test('assinatura do webhook: aceita a correta, recusa corpo alterado e horario antigo', () => {
  const corpo = Buffer.from('{"orderId":"1"}');
  const assinatura = `v1=${crypto.createHmac('sha256', 's').update('100.n.').update(corpo).digest('hex')}`;
  const cab = { 'x-target-timestamp': '100', 'x-target-notificacao': 'n', 'x-target-assinatura': `v1=antiga,${assinatura}` };
  assert.equal(assinaturaValida('s', cab, corpo, 120), true);
  assert.equal(assinaturaValida('s', cab, Buffer.from('{}'), 120), false);
  assert.equal(assinaturaValida('s', cab, corpo, 1000), false);
});

test('id de 19 digitos nao e arredondado e as respostas sao classificadas', () => {
  assert.equal(lerJsonSemArredondar<{ order_id: string }>('{"order_id":5764703623590248759}').order_id, '5764703623590248759');
  assert.equal(desfecho(502, {}).tipo, 'repetir');
  assert.equal(desfecho(504, { codigo: 'COMANDO_RESULTADO_INCERTO' }).tipo, 'conferir');
  assert.equal(desfecho(422, { codigo: 'CODIGO_INVALIDO' }).tipo, 'recusado');
  assert.equal(desfecho(200, { ok: true }).tipo, 'feito');
});

test('documentos gerados estao em dia e sem segredo', () => {
  assert.equal(ler('../docs/TELAS.md'), docTelas(), 'rode npm run docs');
  assert.equal(ler('../docs/EXEMPLOS-PEDIDOS-REAIS.md'), docExemplos(), 'rode npm run docs');
  assert.doesNotMatch(docExemplos(), /hub[ipt]_[A-Za-z0-9]{8,}/);
});
