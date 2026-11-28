/** Gera docs/TELAS.md e docs/EXEMPLOS-PEDIDOS-REAIS.md a partir do mesmo conteudo mostrado no app. */
import fs from 'fs';
import { ERROS, TELAS } from '../src/shared/telas.js';

const ler = (a: string) => fs.readFileSync(new URL(a, import.meta.url), 'utf8');
const gravar = (a: string, t: string) => fs.writeFileSync(new URL(a, import.meta.url), t);
const lista = (itens: string[]) => itens.map((i) => `- ${i}`).join('\n');
const bloco = (v: unknown, tipo = 'json') => `\`\`\`${tipo}\n${typeof v === 'string' ? v.trimEnd() : JSON.stringify(v, null, 2)}\n\`\`\``;
const AVISO = '> Arquivo gerado por `npm run docs`. Edite a fonte, não este arquivo.';

export function docTelas(): string {
  const telas = TELAS.map((t) =>
    [`## ${t.tela}`, lista(t.funciona), t.avisos ? `**Avisos que ficam na tela**\n\n${lista(t.avisos)}` : '', `**Código e rotas:** ${t.codigo.map((c) => `\`${c}\``).join(', ')}`].filter(Boolean).join('\n\n'),
  );
  const erros = ['## Erros que o ERP precisa tratar', '| Resposta | O que fazer |\n|---|---|', ...ERROS.map(([c, f]) => `| \`${c}\` | ${f} |`)];
  return [
    '# Como funciona cada tela',
    AVISO,
    'Sistema de exemplo para desenvolvimento e testes. As telas mostram o necessário para operar; a explicação está aqui e o detalhe técnico, em Logs.',
    ...telas,
    erros.slice(0, 1).join('') + '\n\n' + erros.slice(1).join('\n'),
  ].join('\n\n') + '\n';
}

export function docExemplos(): string {
  const texto = ler('../docs/exemplos-intro.md').trim();
  const partes = [texto, AVISO];
  for (const [titulo, arquivo] of [
    ['Pedido 1: iFood, entrega própria com código', 'pedido-ifood'],
    ['Pedido 2: 99Food, entrega própria com pizza, combo e adicionais', 'pedido-99food'],
  ]) {
    const e = JSON.parse(ler(`../src/shared/exemplos/${arquivo}.json`));
    const inicio = new Date(e.passos[0].em).getTime();
    const nome = (p: any) => (p.tipo === 'webhook' ? `Webhook ${p.corpo?.fullCode ?? p.corpo?.type}` : p.tipo === 'acao' ? `Ação ${p.corpo?.acao}` : 'Consulta do pedido');
    partes.push(
      `## ${titulo}`,
      e.origem,
      ['| # | Horário (UTC) | Depois de | Passo | HTTP | Tempo |', '|---|---|---|---|---|---|', ...e.passos.map((p: any, i: number) => `| ${i + 1} | ${p.em.slice(11, 19)} | ${Math.round((new Date(p.em).getTime() - inicio) / 1000)} s | ${nome(p)} | ${p.resposta.status} | ${p.ms} ms |`)].join('\n'),
      ...e.passos.map((p: any, i: number) => `### ${i + 1}. ${nome(p)}\n\n\`${p.rota}\`\n\n${bloco({ cabecalhos: p.cabecalhos, corpo: p.corpo, resposta: p.resposta })}`),
      `### Detalhe unificado devolvido na consulta\n\n${bloco(e.detalheUnificado)}`,
    );
  }
  partes.push('## Código mínimo para consumir', '`src/shared/exemplos/integracao-minima.ts`', bloco(ler('../src/shared/exemplos/integracao-minima.ts'), 'ts'));
  return partes.join('\n\n') + '\n';
}

if (process.argv[1]?.endsWith('gerar-docs.ts')) {
  gravar('../docs/TELAS.md', docTelas());
  gravar('../docs/EXEMPLOS-PEDIDOS-REAIS.md', docExemplos());
  console.log('docs/TELAS.md e docs/EXEMPLOS-PEDIDOS-REAIS.md gerados');
}
