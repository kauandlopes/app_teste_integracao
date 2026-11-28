import React, { useEffect, useRef, useState } from 'react';
import { casasDemais, erpApi, formatarMoeda, lerPreco, ListaCategorias, mensagemDe, PLATAFORMAS_PRECO, PlataformaPreco, PrecosPlataforma, ProdutoErp } from '../api';
import { chaveCategoria, ondeExiste, soSecaoDePizza } from '../../shared/categorias';
import { useDescarte } from './Comuns';
import { IconeFechar } from './Icones';
import { Modal } from './Modal';

/**
 * Cadastro de produto (simples, pizza ou combo). Um unico formulario: ao salvar, o ERP grava e envia ao iFood e a 99Food.
 * Precos ficam como texto enquanto sao editados.
 */
/** Precos proprios de uma plataforma, como texto; campo vazio nao e enviado. */
type Precos = Partial<Record<PlataformaPreco, string>>;
const ROTULO_PLATAFORMA: Record<PlataformaPreco, string> = { IFOOD: 'iFood', '99FOOD': '99Food', AIQFOME: 'aiqfome', KEETA: 'Keeta' };

interface Opcao {
  precos: Precos;
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
  precos: Precos;
  disponivel: boolean;
  codigo: string;
  nome: string;
  preco: string;
  pedacos: string;
  maxSabores: string;
}
interface Sabor {
  precos: Precos;
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
  tipo: ProdutoErp['tipo'];
  preco: string;
  precos: Precos;
  /** Mostra os campos de preco por plataforma (escondidos por padrao). */
  porPlataforma: boolean;
  disponivel: boolean;
  foto: string;
  grupos: Grupo[];
  tamanhos: Tamanho[];
  sabores: Sabor[];
  massas: Opcao[];
  bordas: Opcao[];
  bordaObrigatoria: boolean;
  precoPorTamanho: boolean;
  pizzaNativa: boolean;
}

const aleatorio = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const dinheiro = (n: number) => String(n).replace('.', ',');
const opcaoVazia = (): Opcao => ({ nome: '', preco: '0', disponivel: true, precos: {} });
const tamanhoNovo = (): Tamanho => ({ codigo: `TAM-${aleatorio()}`, nome: '', preco: '', pedacos: '8', maxSabores: '2', disponivel: true, precos: {} });
const saborNovo = (): Sabor => ({ nome: '', acrescimo: '0', porTamanho: {}, disponivel: true, precos: {} });
const grupoNovo = (combo: boolean): Grupo => ({ nome: '', min: combo ? '1' : '0', max: '1', opcoes: [opcaoVazia()] });

const paraTexto = (p?: PrecosPlataforma): Precos => Object.fromEntries(Object.entries(p ?? {}).map(([k, v]) => [k, dinheiro(v)]));
/** Texto que nao e numero segue como foi digitado: o servidor recusa e diz em qual campo. */
const valorDigitado = (texto: string): number => {
  const n = lerPreco(texto);
  return Number.isFinite(n) ? n : (texto as unknown as number);
};
const precoValido = (texto: string) => {
  const n = lerPreco(texto || '0');
  return Number.isFinite(n) && !casasDemais(n);
};
/** So as plataformas preenchidas; nenhuma preenchida significa nao enviar o campo. */
function precosPreenchidos(ligado: boolean, precos: Precos): { precosPlataforma?: PrecosPlataforma } {
  if (!ligado) return {};
  const lista = PLATAFORMAS_PRECO.filter((k) => precos[k]?.trim()).map((k) => [k, valorDigitado(precos[k]!)]);
  return lista.length ? { precosPlataforma: Object.fromEntries(lista) as PrecosPlataforma } : {};
}

function paraForm(p: ProdutoErp | null, tipo: ProdutoErp['tipo']): Form {
  const complemento = (o: { codigo: string; nome: string; preco: number; disponivel: boolean; precosPlataforma?: PrecosPlataforma }): Opcao => ({ ...o, preco: dinheiro(o.preco), precos: paraTexto(o.precosPlataforma) });
  if (!p) {
    return {
      codigo: '',
      nome: '',
      categoria: tipo === 'PIZZA' ? 'Pizzas' : tipo === 'COMBO' ? 'Combos' : '',
      descricao: '',
      tipo,
      preco: '',
      precos: {},
      porPlataforma: false,
      disponivel: true,
      foto: '',
      grupos: tipo === 'COMBO' ? [grupoNovo(true)] : [],
      tamanhos: [tamanhoNovo()],
      sabores: [saborNovo()],
      massas: [],
      bordas: [],
      bordaObrigatoria: false,
      precoPorTamanho: false,
      pizzaNativa: false,
    };
  }
  return {
    codigo: p.codigo,
    nome: p.nome,
    categoria: p.categoria,
    descricao: p.descricao,
    tipo: p.tipo,
    preco: dinheiro(p.preco),
    precos: paraTexto(p.precosPlataforma),
    porPlataforma: JSON.stringify(p).includes('"precosPlataforma"'),
    disponivel: p.disponivel,
    foto: p.foto,
    grupos: p.grupos.map((g) => ({ codigo: g.codigo, nome: g.nome, min: String(g.min), max: String(g.max), opcoes: g.opcoes.map(complemento) })),
    tamanhos: p.pizza?.tamanhos.map((t) => ({ codigo: t.codigo, nome: t.nome, preco: dinheiro(t.preco), pedacos: String(t.pedacos ?? ''), maxSabores: String(t.maxSabores), disponivel: t.disponivel !== false, precos: paraTexto(t.precosPlataforma) })) ?? [tamanhoNovo()],
    sabores:
      p.pizza?.sabores.map((s) => ({
        codigo: s.codigo,
        nome: s.nome,
        acrescimo: dinheiro(s.acrescimo),
        porTamanho: Object.fromEntries(Object.entries(s.acrescimoPorTamanho ?? {}).map(([k, v]) => [k, dinheiro(v)])),
        disponivel: s.disponivel,
        precos: paraTexto(s.precosPlataforma),
      })) ?? [saborNovo()],
    massas: p.pizza?.massas.map(complemento) ?? [],
    bordas: p.pizza?.bordas.map(complemento) ?? [],
    bordaObrigatoria: p.pizza?.bordaObrigatoria ?? false,
    precoPorTamanho: !!p.pizza?.sabores.some((s) => s.acrescimoPorTamanho && Object.keys(s.acrescimoPorTamanho).length),
    pizzaNativa: p.formatoIfood === 'PIZZA',
  };
}

function paraProduto(f: Form) {
  const precos = (v: Precos) => precosPreenchidos(f.porPlataforma, v);
  const opcao = (o: Opcao) => ({ codigo: o.codigo, nome: o.nome, preco: valorDigitado(o.preco || '0'), disponivel: o.disponivel, ...precos(o.precos) });
  return {
    codigo: f.codigo.trim(),
    nome: f.nome,
    categoria: f.categoria,
    descricao: f.descricao,
    tipo: f.tipo,
    preco: valorDigitado(f.preco || '0'),
    ...(f.tipo === 'PIZZA' ? {} : precos(f.precos)),
    disponivel: f.disponivel,
    foto: f.foto,
    ...(f.tipo === 'PIZZA' && f.pizzaNativa ? { formatoIfood: 'PIZZA' as const } : {}),
    grupos: f.grupos.map((g) => ({ codigo: g.codigo, nome: g.nome, min: Number(g.min), max: Number(g.max), opcoes: g.opcoes.map(opcao) })),
    pizza:
      f.tipo === 'PIZZA'
        ? {
            tamanhos: f.tamanhos.map((t) => ({ codigo: t.codigo, nome: t.nome, preco: valorDigitado(t.preco || '0'), pedacos: Number(t.pedacos) || undefined, maxSabores: Number(t.maxSabores) || 1, disponivel: t.disponivel, ...precos(t.precos) })),
            sabores: f.sabores.map((s) => ({
              codigo: s.codigo,
              nome: s.nome,
              acrescimo: valorDigitado(s.acrescimo || '0'),
              disponivel: s.disponivel,
              ...precos(s.precos),
              ...(f.precoPorTamanho
                ? { acrescimoPorTamanho: Object.fromEntries(f.tamanhos.map((t) => [t.codigo, valorDigitado(s.porTamanho[t.codigo] ?? s.acrescimo ?? '0')])) }
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
    throw new Error('Não foi possível reduzir a imagem. Escolha outra.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Um campo por plataforma; vazio usa o preco padrao. */
function CamposPlataforma({ precos, padrao, mudar }: { precos: Precos; padrao: string; mudar: (p: Precos) => void }) {
  return (
    <div className="linha precos-plataforma">
      {PLATAFORMAS_PRECO.map((k) => (
        <label className="field" key={k}>
          <span className="field-label">{ROTULO_PLATAFORMA[k]}</span>
          <input className="input input-sm preco" inputMode="decimal" placeholder={padrao || 'padrão'} value={precos[k] ?? ''} onChange={(e) => mudar({ ...precos, [k]: e.target.value })} />
        </label>
      ))}
    </div>
  );
}

/** Categoria do produto: lista das plataformas com onde cada uma existe, ou um nome novo digitado. */
function CampoCategoria({
  valor,
  doErp,
  doEspelho,
  pizzaNativa,
  invalido,
  campo,
  mudar,
}: {
  valor: string;
  doErp: string[];
  doEspelho: string[];
  pizzaNativa: boolean;
  invalido: boolean;
  campo: React.Ref<HTMLInputElement>;
  mudar: (v: string) => void;
}) {
  const [lista, setLista] = useState<ListaCategorias | null>(null);
  const [falhou, setFalhou] = useState('');
  useEffect(() => {
    void erpApi
      .categorias()
      .then(setLista)
      .catch((err) => setFalhou(mensagemDe(err, 'Não foi possível consultar as categorias.')));
  }, []);

  const doHub = (lista?.categorias ?? []).filter((c) => !soSecaoDePizza(c));
  // Sem leitura completa das plataformas, a ultima copia do cardapio completa a lista
  const completa = !!lista && !Object.values(lista.plataformas).some((p) => p.estado === 'ERRO');
  const opcoes = new Map<string, { nome: string; onde: string }>();
  for (const c of doHub) opcoes.set(chaveCategoria(c.nome), { nome: c.nome, onde: ondeExiste(c, lista) });
  for (const nome of completa ? doErp : [...doErp, ...doEspelho]) {
    if (!opcoes.has(chaveCategoria(nome))) opcoes.set(chaveCategoria(nome), { nome, onde: completa ? ondeExiste(undefined, lista) : 'não conferida nas plataformas' });
  }
  const digitada = valor.trim() ? doHub.find((c) => chaveCategoria(c.nome) === chaveCategoria(valor)) : undefined;
  const situacao = valor.trim() ? ondeExiste(digitada, lista) : '';
  const recusa = lista?.plataformas['99FOOD']?.ultimaRecusa;

  return (
    <div className="pilha">
      <div className="grid-2">
        <label className="field">
          <span className="field-label">Categoria (obrigatória)</span>
          <input ref={campo} className="input" value={valor} maxLength={100} placeholder="Digite um nome ou escolha na lista" aria-invalid={invalido} onChange={(e) => mudar(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Categorias existentes</span>
          <select className="select" value="" onChange={(e) => e.target.value && mudar(e.target.value)}>
            <option value="">{!lista && !falhou ? 'Consultando as plataformas...' : 'Escolher...'}</option>
            {[...opcoes.values()]
              .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
              .map((o) => (
                <option key={o.nome} value={o.nome}>
                  {o.nome}
                  {o.onde ? ` (${o.onde})` : ''}
                </option>
              ))}
          </select>
        </label>
      </div>
      {situacao ? (
        <span className={/ser[aá]|sendo|não/.test(situacao) ? 'observacao' : 'suave'} role="status">
          <strong>{valor.trim()}</strong> · {situacao}.
        </span>
      ) : null}
      <span className="suave">
        Todo produto precisa de categoria. Se ela não existir em uma das plataformas, é criada lá ao publicar.
        {pizzaNativa ? ' A pizza nativa do iFood fica em seção própria: a categoria vale na 99Food.' : ''}
      </span>
      {falhou ? <span className="observacao">{falhou} Digite o nome da categoria.</span> : null}
      {lista?.avisos?.map((a) => (
        <span className="suave" key={a}>
          {a}
        </span>
      ))}
      {recusa ? <span className="observacao">Último envio de categoria recusado pela 99Food: {recusa.erro}</span> : null}
    </div>
  );
}

/** Lista simples de opcoes (nome, preco, pausa), usada em grupos, massas e bordas. */
function ListaOpcoes({ opcoes, mudar, rotulo, porPlataforma }: { opcoes: Opcao[]; mudar: (o: Opcao[]) => void; rotulo: string; porPlataforma: boolean }) {
  const alterar = (i: number, parte: Partial<Opcao>) => mudar(opcoes.map((o, j) => (j === i ? { ...o, ...parte } : o)));
  return (
    <div className="pilha">
      {opcoes.map((o, i) => (
        <div className="pilha" key={i}>
        <div className="linha-opcao">
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
        {porPlataforma ? <CamposPlataforma precos={o.precos} padrao={o.preco} mudar={(precos) => alterar(i, { precos })} /> : null}
        </div>
      ))}
      <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => mudar([...opcoes, opcaoVazia()])}>
        Adicionar {rotulo.toLowerCase()}
      </button>
    </div>
  );
}

export function EditorProduto({
  destinos,
  produto,
  tipo,
  categorias,
  categoriasEspelho,
  aoFechar,
  aoSalvar,
  notificar,
}: {
  /** Lojas vinculadas que recebem o produto. */
  destinos: string[];
  produto: ProdutoErp | null;
  tipo: ProdutoErp['tipo'];
  categorias: string[];
  categoriasEspelho: string[];
  aoFechar: () => void;
  aoSalvar: () => Promise<void>;
  notificar: (tipo: 'ok' | 'erro', msg: string) => void;
}) {
  const [f, setF] = useState<Form>(() => paraForm(produto, tipo));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const campoCategoria = useRef<HTMLInputElement>(null);
  const semCategoria = !!erro && !f.categoria.trim();
  const mudar = (parte: Partial<Form>) => setF((atual) => ({ ...atual, ...parte }));
  const item = <T,>(lista: T[], i: number, parte: Partial<T>) => lista.map((x, j) => (j === i ? { ...x, ...parte } : x));
  const ehPizza = f.tipo === 'PIZZA';
  const ehCombo = f.tipo === 'COMBO';
  const [inicial] = useState(() => JSON.stringify(f));
  const alterado = JSON.stringify(f) !== inicial;
  const descarte = useDescarte(alterado, aoFechar);
  const fechar = () => !salvando && descarte.fechar();
  /** O que muda nos campos principais em relacao ao produto salvo. */
  const mudancas =
    produto && alterado
      ? [
          f.nome !== produto.nome && `nome ${produto.nome} → ${f.nome}`,
          !ehPizza && lerPreco(f.preco || '0') !== produto.preco && `preço ${formatarMoeda(produto.preco)} → ${precoValido(f.preco) ? formatarMoeda(lerPreco(f.preco || '0')) : `"${f.preco}" (inválido)`}`,
          f.categoria !== produto.categoria && `categoria ${produto.categoria} → ${f.categoria}`,
          f.disponivel !== produto.disponivel && (f.disponivel ? 'pausado → disponível' : 'disponível → pausado'),
        ].filter(Boolean)
      : [];

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.categoria.trim()) {
      campoCategoria.current?.focus();
      return setErro('Informe a categoria do produto: escolha uma da lista ou digite um nome novo.');
    }
    setSalvando(true);
    setErro('');
    try {
      await erpApi.salvarProduto({ ...(paraProduto(f) as any), novo: !produto });
      notificar('ok', `${f.nome} salvo. Enviando para iFood e 99Food.`);
      await aoSalvar();
      aoFechar();
    } catch (err) {
      setErro(mensagemDe(err, 'Não foi possível salvar.'));
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
    <Modal fundoFecha={false} aoFechar={fechar}>
      <form
        className="modal-panel wide"
        role="dialog"
        aria-modal="true"
        onSubmit={salvar}
        // Enter em um campo publicaria o produto sem querer: salvar e somente pelo botao
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
        }}
      >
        <div className="modal-head">
          <h2 style={{ margin: 0, fontSize: 16 }}>{produto ? `Editar ${produto.nome}` : ehPizza ? 'Nova pizza' : ehCombo ? 'Novo combo' : 'Novo produto'}</h2>
          <button type="button" className="btn-icon" disabled={salvando} onClick={fechar} title="Fechar" aria-label="Fechar">
            <IconeFechar />
          </button>
        </div>

        <div className="modal-body">
          <span className={destinos.length ? 'suave' : 'observacao'}>
            {destinos.length ? `Salvar envia para ${destinos.join(' · ')}.` : 'Nenhuma loja vinculada: o produto fica no ERP até vincular uma loja.'}
          </span>
          <div className="grid-2">
            <label className="field">
              <span className="field-label">Nome</span>
              <input className="input" value={f.nome} maxLength={150} onChange={(e) => mudar({ nome: e.target.value })} required autoFocus />
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
          <CampoCategoria
            valor={f.categoria}
            doErp={categorias}
            doEspelho={categoriasEspelho}
            pizzaNativa={ehPizza && f.pizzaNativa}
            invalido={semCategoria}
            campo={campoCategoria}
            mudar={(categoria) => {
              mudar({ categoria });
              setErro('');
            }}
          />
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
            <label className="chave">
              <input type="checkbox" checked={f.porPlataforma} onChange={(e) => mudar({ porPlataforma: e.target.checked })} />
              Preço diferente por plataforma
            </label>
          </div>
          {f.porPlataforma ? (
            <div className="banner banner-warn">
              Opcional: preencha só onde o preço muda; campo vazio usa o preço padrão. Desmarcar apaga os preços por plataforma ao salvar. Vale também para cada adicional, tamanho, sabor, massa e borda.
            </div>
          ) : null}
          {f.porPlataforma && !ehPizza ? <CamposPlataforma precos={f.precos} padrao={f.preco} mudar={(precos) => mudar({ precos })} /> : null}

          {ehPizza ? (
            <>
              <label className="chave" style={{ alignSelf: 'flex-start' }}>
                <input type="checkbox" checked={f.pizzaNativa} onChange={(e) => mudar({ pizzaNativa: e.target.checked })} />
                No iFood, usar a pizza nativa (cria uma seção própria)
              </label>
              <p className="suave" style={{ margin: 0 }}>
                Desmarcado, a pizza entra na categoria informada como um item com grupos de tamanho, massa, borda e sabores.
              </p>
              <section className="secao">
                <h3>Tamanhos</h3>
                <p className="suave">O preço do tamanho é o preço final da pizza. Sabores, massas e bordas somam a ele.</p>
                {f.tamanhos.map((t, i) => (
                  <div className="pilha" key={t.codigo}>
                  <div className="linha-tamanho">
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
                    <label className="chave">
                      <input type="checkbox" checked={t.disponivel} onChange={(e) => mudar({ tamanhos: item(f.tamanhos, i, { disponivel: e.target.checked }) })} />
                      Disponível
                    </label>
                    <button type="button" className="btn btn-sm btn-danger" disabled={f.tamanhos.length === 1} onClick={() => mudar({ tamanhos: f.tamanhos.filter((_, j) => j !== i) })}>
                      Remover
                    </button>
                  </div>
                  {f.porPlataforma ? <CamposPlataforma precos={t.precos} padrao={t.preco} mudar={(precos) => mudar({ tamanhos: item(f.tamanhos, i, { precos }) })} /> : null}
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
                  <div className="banner banner-warn">Acréscimos diferentes por tamanho publicam um item para cada tamanho (99Food e iFood em itens). Com o mesmo acréscimo em todos, sai um item só. Com mais de um sabor, os acréscimos são somados.</div>
                ) : null}
                {f.sabores.map((s, i) => (
                  <div className="pilha" key={i}>
                  <div className="linha-opcao">
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
                  {f.porPlataforma ? <CamposPlataforma precos={s.precos} padrao={s.acrescimo} mudar={(precos) => mudar({ sabores: item(f.sabores, i, { precos }) })} /> : null}
                  </div>
                ))}
                <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => mudar({ sabores: [...f.sabores, saborNovo()] })}>
                  Adicionar sabor
                </button>
              </section>

              <section className="secao">
                <h3>Massas</h3>
                <p className="suave">Sem massa cadastrada, o iFood recebe a massa Tradicional.</p>
                <ListaOpcoes porPlataforma={f.porPlataforma} rotulo="Massa" opcoes={f.massas} mudar={(massas) => mudar({ massas })} />
              </section>
              <section className="secao">
                <div className="linha">
                  <h3>Bordas</h3>
                  <label className="chave">
                    <input type="checkbox" checked={f.bordaObrigatoria} onChange={(e) => mudar({ bordaObrigatoria: e.target.checked })} />
                    Escolha obrigatória
                  </label>
                </div>
                <ListaOpcoes porPlataforma={f.porPlataforma} rotulo="Borda" opcoes={f.bordas} mudar={(bordas) => mudar({ bordas })} />
              </section>
            </>
          ) : null}

          <section className="secao">
            <h3>{ehPizza ? 'Grupos extras' : ehCombo ? 'Etapas do combo' : 'Complementos e adicionais'}</h3>
            <p className="suave">{ehCombo ? 'Cada grupo é uma etapa de escolha; a primeira é a principal. O preço do combo é o do campo Preço.' : 'Mínimo maior que zero torna o grupo obrigatório.'}</p>
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
                <ListaOpcoes porPlataforma={f.porPlataforma} rotulo="Opção" opcoes={g.opcoes} mudar={(opcoes) => mudar({ grupos: item(f.grupos, i, { opcoes }) })} />
              </div>
            ))}
            <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => mudar({ grupos: [...f.grupos, grupoNovo(ehCombo)] })}>
              Adicionar grupo
            </button>
          </section>
        </div>

        <div className="modal-foot">
          {erro ? (
            <span className="observacao" role="alert" style={{ marginRight: 'auto' }}>
              {erro}
            </span>
          ) : mudancas.length ? (
            <span className="suave" style={{ marginRight: 'auto' }}>
              Muda: {mudancas.join('; ')}.
            </span>
          ) : null}
          <button type="button" className="btn" disabled={salvando} onClick={fechar}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar e enviar para iFood e 99Food'}
          </button>
        </div>
      </form>
      {descarte.pergunta}
    </Modal>
  );
}
