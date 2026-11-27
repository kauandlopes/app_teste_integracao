import React, { useState } from 'react';
import { erpApi, lerPreco, mensagemDe, ProdutoErp } from '../api';
import { IconeFechar } from './Icones';

/**
 * Cadastro de produto (simples ou pizza). Um unico formulario: ao salvar, o ERP grava e envia ao iFood e a 99Food.
 * Precos ficam como texto enquanto sao editados.
 */
interface Opcao {
  codigo?: string;
  nome: string;
  preco: string;
  disponivel: boolean;
}
interface Grupo {
  codigo?: string;
  nome: string;
  min: string;
  max: string;
  opcoes: Opcao[];
}
interface Tamanho {
  codigo: string;
  nome: string;
  preco: string;
  pedacos: string;
  maxSabores: string;
}
interface Sabor {
  codigo?: string;
  nome: string;
  acrescimo: string;
  porTamanho: Record<string, string>;
  disponivel: boolean;
}
interface Form {
  codigo: string;
  nome: string;
  categoria: string;
  descricao: string;
  tipo: 'SIMPLES' | 'PIZZA';
  preco: string;
  disponivel: boolean;
  foto: string;
  grupos: Grupo[];
  tamanhos: Tamanho[];
  sabores: Sabor[];
  massas: Opcao[];
  bordas: Opcao[];
  bordaObrigatoria: boolean;
  precoPorTamanho: boolean;
}

const aleatorio = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const dinheiro = (n: number) => String(n).replace('.', ',');
const opcaoVazia = (): Opcao => ({ nome: '', preco: '0', disponivel: true });
const tamanhoNovo = (): Tamanho => ({ codigo: `TAM-${aleatorio()}`, nome: '', preco: '', pedacos: '8', maxSabores: '2' });
const saborNovo = (): Sabor => ({ nome: '', acrescimo: '0', porTamanho: {}, disponivel: true });

function paraForm(p: ProdutoErp | null, tipo: 'SIMPLES' | 'PIZZA'): Form {
  const complemento = (o: { codigo: string; nome: string; preco: number; disponivel: boolean }): Opcao => ({ ...o, preco: dinheiro(o.preco) });
  if (!p) {
    return {
      codigo: '',
      nome: '',
      categoria: tipo === 'PIZZA' ? 'Pizzas' : '',
      descricao: '',
      tipo,
      preco: '',
      disponivel: true,
      foto: '',
      grupos: [],
      tamanhos: [tamanhoNovo()],
      sabores: [saborNovo()],
      massas: [],
      bordas: [],
      bordaObrigatoria: false,
      precoPorTamanho: false,
    };
  }
  return {
    codigo: p.codigo,
    nome: p.nome,
    categoria: p.categoria,
    descricao: p.descricao,
    tipo: p.tipo,
    preco: dinheiro(p.preco),
    disponivel: p.disponivel,
    foto: p.foto,
    grupos: p.grupos.map((g) => ({ codigo: g.codigo, nome: g.nome, min: String(g.min), max: String(g.max), opcoes: g.opcoes.map(complemento) })),
    tamanhos: p.pizza?.tamanhos.map((t) => ({ codigo: t.codigo, nome: t.nome, preco: dinheiro(t.preco), pedacos: String(t.pedacos ?? ''), maxSabores: String(t.maxSabores) })) ?? [tamanhoNovo()],
    sabores:
      p.pizza?.sabores.map((s) => ({
        codigo: s.codigo,
        nome: s.nome,
        acrescimo: dinheiro(s.acrescimo),
        porTamanho: Object.fromEntries(Object.entries(s.acrescimoPorTamanho ?? {}).map(([k, v]) => [k, dinheiro(v)])),
        disponivel: s.disponivel,
      })) ?? [saborNovo()],
    massas: p.pizza?.massas.map(complemento) ?? [],
    bordas: p.pizza?.bordas.map(complemento) ?? [],
    bordaObrigatoria: p.pizza?.bordaObrigatoria ?? false,
    precoPorTamanho: !!p.pizza?.sabores.some((s) => s.acrescimoPorTamanho && Object.keys(s.acrescimoPorTamanho).length),
  };
}

function paraProduto(f: Form) {
  const opcao = (o: Opcao) => ({ codigo: o.codigo, nome: o.nome, preco: lerPreco(o.preco || '0'), disponivel: o.disponivel });
  return {
    codigo: f.codigo.trim(),
    nome: f.nome,
    categoria: f.categoria,
    descricao: f.descricao,
    tipo: f.tipo,
    preco: lerPreco(f.preco || '0'),
    disponivel: f.disponivel,
    foto: f.foto,
    grupos: f.grupos.map((g) => ({ codigo: g.codigo, nome: g.nome, min: Number(g.min), max: Number(g.max), opcoes: g.opcoes.map(opcao) })),
    pizza:
      f.tipo === 'PIZZA'
        ? {
            tamanhos: f.tamanhos.map((t) => ({ codigo: t.codigo, nome: t.nome, preco: lerPreco(t.preco || '0'), pedacos: Number(t.pedacos) || undefined, maxSabores: Number(t.maxSabores) || 1 })),
            sabores: f.sabores.map((s) => ({
              codigo: s.codigo,
              nome: s.nome,
              acrescimo: lerPreco(s.acrescimo || '0'),
              disponivel: s.disponivel,
              ...(f.precoPorTamanho
                ? { acrescimoPorTamanho: Object.fromEntries(f.tamanhos.map((t) => [t.codigo, lerPreco(s.porTamanho[t.codigo] ?? s.acrescimo ?? '0')])) }
                : {}),
            })),
            massas: f.massas.map(opcao),
            bordas: f.bordas.map(opcao),
            bordaObrigatoria: f.bordaObrigatoria,
          }
        : null,
  };
}

/** Reduz a foto no navegador: o Hub aceita corpo de ate 1 MB e a menor dimensao precisa de 150 px. */
async function prepararFoto(arquivo: File): Promise<string> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falha(new Error('Arquivo de imagem inválido.'));
      i.src = url;
    });
    if (Math.min(img.width, img.height) < 150) throw new Error('A imagem precisa ter pelo menos 150 px no menor lado.');
    for (const [lado, qualidade] of [[1200, 0.85], [1000, 0.8], [800, 0.72], [600, 0.65]] as const) {
      const escala = Math.min(1, lado / Math.max(img.width, img.height));
      const tela = document.createElement('canvas');
      tela.width = Math.round(img.width * escala);
      tela.height = Math.round(img.height * escala);
      const ctx = tela.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tela.width, tela.height);
      ctx.drawImage(img, 0, 0, tela.width, tela.height);
      const dados = tela.toDataURL('image/jpeg', qualidade);
      if (dados.length < 700_000) return dados;
    }
    throw new Error('Não foi possivel reduzir a imagem. Escolha outra.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Lista simples de opcoes (nome, preco, pausa), usada em grupos, massas e bordas. */
function ListaOpcoes({ opcoes, mudar, rotulo }: { opcoes: Opcao[]; mudar: (o: Opcao[]) => void; rotulo: string }) {
  const alterar = (i: number, parte: Partial<Opcao>) => mudar(opcoes.map((o, j) => (j === i ? { ...o, ...parte } : o)));
  return (
    <div className="pilha">
      {opcoes.map((o, i) => (
        <div className="linha-opcao" key={i}>
          <input className="input input-sm" placeholder={`Nome (${rotulo.toLowerCase()})`} value={o.nome} onChange={(e) => alterar(i, { nome: e.target.value })} required />
          <input className="input input-sm preco" inputMode="decimal" placeholder="R$" title="Preço adicional" value={o.preco} onChange={(e) => alterar(i, { preco: e.target.value })} />
          <label className="chave">
            <input type="checkbox" checked={o.disponivel} onChange={(e) => alterar(i, { disponivel: e.target.checked })} />
            Disponível
          </label>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => mudar(opcoes.filter((_, j) => j !== i))}>
            Remover
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => mudar([...opcoes, opcaoVazia()])}>
        Adicionar {rotulo.toLowerCase()}
      </button>
    </div>
  );
}

export function EditorProduto({
  produto,
  tipo,
  categorias,
  aoFechar,
  aoSalvar,
  notificar,
}: {
  produto: ProdutoErp | null;
  tipo: 'SIMPLES' | 'PIZZA';
  categorias: string[];
  aoFechar: () => void;
  aoSalvar: () => Promise<void>;
  notificar: (tipo: 'ok' | 'erro', msg: string) => void;
}) {
  const [f, setF] = useState<Form>(() => paraForm(produto, tipo));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const mudar = (parte: Partial<Form>) => setF((atual) => ({ ...atual, ...parte }));
  const item = <T,>(lista: T[], i: number, parte: Partial<T>) => lista.map((x, j) => (j === i ? { ...x, ...parte } : x));
  const ehPizza = f.tipo === 'PIZZA';

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      await erpApi.salvarProduto({ ...(paraProduto(f) as any), novo: !produto });
      notificar('ok', `${f.nome} salvo. Enviando para iFood e 99Food.`);
      await aoSalvar();
      aoFechar();
    } catch (err) {
      setErro(mensagemDe(err, 'Não foi possivel salvar.'));
    } finally {
      setSalvando(false);
    }
  }

  async function escolherFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    try {
      mudar({ foto: await prepararFoto(arquivo) });
      setErro('');
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao ler a imagem.');
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal-panel wide" onSubmit={salvar}>
        <div className="modal-head">
          <h2 style={{ margin: 0, fontSize: 16 }}>{produto ? `Editar ${produto.nome}` : ehPizza ? 'Nova pizza' : 'Novo produto'}</h2>
          <button type="button" className="btn-icon" onClick={aoFechar} title="Fechar">
            <IconeFechar />
          </button>
        </div>

        <div className="modal-body">
          <div className="grid-2">
            <label className="field">
              <span className="field-label">Nome</span>
              <input className="input" value={f.nome} maxLength={150} onChange={(e) => mudar({ nome: e.target.value })} required autoFocus />
            </label>
            <label className="field">
              <span className="field-label">Categoria (criada na plataforma se não existir)</span>
              <input className="input" list="categorias-erp" value={f.categoria} maxLength={100} onChange={(e) => mudar({ categoria: e.target.value })} required />
              <datalist id="categorias-erp">
                {categorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            {!ehPizza ? (
              <label className="field">
                <span className="field-label">Preço (R$)</span>
                <input className="input" inputMode="decimal" value={f.preco} onChange={(e) => mudar({ preco: e.target.value })} required />
              </label>
            ) : null}
            <label className="field">
              <span className="field-label">Código / SKU (vazio gera automaticamente)</span>
              <input className="input" value={f.codigo} maxLength={40} pattern="[A-Za-z0-9_\-]*" disabled={!!produto} onChange={(e) => mudar({ codigo: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Descrição</span>
            <textarea className="textarea" rows={2} maxLength={1000} value={f.descricao} onChange={(e) => mudar({ descricao: e.target.value })} />
          </label>
          <div className="linha">
            {f.foto ? <img src={f.foto} alt="" className="miniatura" /> : null}
            <label className="btn btn-sm">
              {f.foto ? 'Trocar foto' : 'Escolher foto'}
              <input type="file" accept="image/jpeg,image/png" hidden onChange={(e) => void escolherFoto(e)} />
            </label>
            {f.foto ? (
              <button type="button" className="btn btn-sm" onClick={() => mudar({ foto: '' })}>
                Não enviar foto
              </button>
            ) : null}
            <label className="chave">
              <input type="checkbox" checked={f.disponivel} onChange={(e) => mudar({ disponivel: e.target.checked })} />
              Disponível para venda
            </label>
          </div>

          {ehPizza ? (
            <>
              <section className="secao">
                <h3>Tamanhos</h3>
                <p className="suave">O preço do tamanho é o preço final da pizza. Sabores, massas e bordas somam a ele.</p>
                {f.tamanhos.map((t, i) => (
                  <div className="linha-tamanho" key={t.codigo}>
                    <label className="field">
                      <span className="field-label">Nome</span>
                      <input className="input input-sm" placeholder="Grande" value={t.nome} onChange={(e) => mudar({ tamanhos: item(f.tamanhos, i, { nome: e.target.value }) })} required />
                    </label>
                    <label className="field">
                      <span className="field-label">Preço (R$)</span>
                      <input className="input input-sm" inputMode="decimal" value={t.preco} onChange={(e) => mudar({ tamanhos: item(f.tamanhos, i, { preco: e.target.value }) })} required />
                    </label>
                    <label className="field">
                      <span className="field-label">Fatias</span>
                      <input className="input input-sm" type="number" min={1} max={64} value={t.pedacos} onChange={(e) => mudar({ tamanhos: item(f.tamanhos, i, { pedacos: e.target.value }) })} />
                    </label>
                    <label className="field">
                      <span className="field-label">Até quantos sabores</span>
                      <select className="select input-sm" value={t.maxSabores} onChange={(e) => mudar({ tamanhos: item(f.tamanhos, i, { maxSabores: e.target.value }) })}>
                        {[1, 2, 3, 4].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="btn btn-sm btn-danger" disabled={f.tamanhos.length === 1} onClick={() => mudar({ tamanhos: f.tamanhos.filter((_, j) => j !== i) })}>
                      Remover
                    </button>
                  </div>
                ))}
                <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => mudar({ tamanhos: [...f.tamanhos, tamanhoNovo()] })}>
                  Adicionar tamanho
                </button>
              </section>

              <section className="secao">
                <div className="linha">
                  <h3>Sabores</h3>
                  <label className="chave">
                    <input type="checkbox" checked={f.precoPorTamanho} onChange={(e) => mudar({ precoPorTamanho: e.target.checked })} />
                    Acréscimo diferente por tamanho
                  </label>
                </div>
                {f.precoPorTamanho ? (
                  <div className="banner banner-warn">Na 99Food, acréscimos diferentes por tamanho publicam um item separado para cada tamanho. Com o mesmo acréscimo em todos, sai um item só.</div>
                ) : null}
                {f.sabores.map((s, i) => (
                  <div className="linha-opcao" key={i}>
                    <input className="input input-sm" placeholder="Nome do sabor" value={s.nome} onChange={(e) => mudar({ sabores: item(f.sabores, i, { nome: e.target.value }) })} required />
                    {f.precoPorTamanho ? (
                      f.tamanhos.map((t) => (
                        <input
                          key={t.codigo}
                          className="input input-sm preco"
                          inputMode="decimal"
                          title={`Acréscimo no tamanho ${t.nome}`}
                          placeholder={t.nome || 'R$'}
                          value={s.porTamanho[t.codigo] ?? s.acrescimo}
                          onChange={(e) => mudar({ sabores: item(f.sabores, i, { porTamanho: { ...s.porTamanho, [t.codigo]: e.target.value } }) })}
                        />
                      ))
                    ) : (
                      <input className="input input-sm preco" inputMode="decimal" title="Acréscimo" value={s.acrescimo} onChange={(e) => mudar({ sabores: item(f.sabores, i, { acrescimo: e.target.value }) })} />
                    )}
                    <label className="chave">
                      <input type="checkbox" checked={s.disponivel} onChange={(e) => mudar({ sabores: item(f.sabores, i, { disponivel: e.target.checked }) })} />
                      Disponível
                    </label>
                    <button type="button" className="btn btn-sm btn-danger" disabled={f.sabores.length === 1} onClick={() => mudar({ sabores: f.sabores.filter((_, j) => j !== i) })}>
                      Remover
                    </button>
                  </div>
                ))}
                <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => mudar({ sabores: [...f.sabores, saborNovo()] })}>
                  Adicionar sabor
                </button>
              </section>

              <section className="secao">
                <h3>Massas</h3>
                <p className="suave">Sem massa cadastrada, o iFood recebe a massa Tradicional.</p>
                <ListaOpcoes rotulo="Massa" opcoes={f.massas} mudar={(massas) => mudar({ massas })} />
              </section>
              <section className="secao">
                <div className="linha">
                  <h3>Bordas</h3>
                  <label className="chave">
                    <input type="checkbox" checked={f.bordaObrigatoria} onChange={(e) => mudar({ bordaObrigatoria: e.target.checked })} />
                    Escolha obrigatória
                  </label>
                </div>
                <ListaOpcoes rotulo="Borda" opcoes={f.bordas} mudar={(bordas) => mudar({ bordas })} />
              </section>
            </>
          ) : null}

          <section className="secao">
            <h3>{ehPizza ? 'Grupos extras' : 'Complementos e adicionais'}</h3>
            <p className="suave">Mínimo maior que zero torna o grupo obrigatório.</p>
            {f.grupos.map((g, i) => (
              <div className="card pilha" key={i}>
                <div className="linha-grupo">
                  <label className="field">
                    <span className="field-label">Nome do grupo</span>
                    <input className="input input-sm" placeholder="Adicionais" value={g.nome} onChange={(e) => mudar({ grupos: item(f.grupos, i, { nome: e.target.value }) })} required />
                  </label>
                  <label className="field">
                    <span className="field-label">Mínimo</span>
                    <input className="input input-sm" type="number" min={0} max={99} value={g.min} onChange={(e) => mudar({ grupos: item(f.grupos, i, { min: e.target.value }) })} />
                  </label>
                  <label className="field">
                    <span className="field-label">Máximo</span>
                    <input className="input input-sm" type="number" min={1} max={99} value={g.max} onChange={(e) => mudar({ grupos: item(f.grupos, i, { max: e.target.value }) })} />
                  </label>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => mudar({ grupos: f.grupos.filter((_, j) => j !== i) })}>
                    Remover grupo
                  </button>
                </div>
                <ListaOpcoes rotulo="Opção" opcoes={g.opcoes} mudar={(opcoes) => mudar({ grupos: item(f.grupos, i, { opcoes }) })} />
              </div>
            ))}
            <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => mudar({ grupos: [...f.grupos, { nome: '', min: '0', max: '1', opcoes: [opcaoVazia()] }] })}>
              Adicionar grupo
            </button>
          </section>
        </div>

        <div className="modal-foot">
          {erro ? <span className="observacao" style={{ marginRight: 'auto' }}>{erro}</span> : null}
          <button type="button" className="btn" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar e enviar para iFood e 99Food'}
          </button>
        </div>
      </form>
    </div>
  );
}
