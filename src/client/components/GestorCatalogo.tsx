import React, { useEffect, useMemo, useState } from 'react';
import { AvisoCatalogo, erpApi, EstadoProduto, formatarMoeda, LojaVinculada, mensagemDe, nomeCanal, ProdutoCadastrado, ProdutoErp } from '../api';
import { Contagem, Mudanca, useConfirmar } from './Comuns';
import { EditorProduto } from './EditorProduto';
import { IconeAtualizar } from './Icones';
import { BotaoDisponivel, Plataformas, PrecoEditavel } from './Plataformas';

const ESTADOS: Record<EstadoProduto, [string, string]> = {
  NA_FILA: ['Na fila', 'pill-warn'],
  ENVIANDO: ['Enviando', 'pill-info'],
  PROCESSANDO: ['Processando', 'pill-info'],
  PUBLICADO: ['Publicado', 'pill-ok'],
  PARCIAL: ['Publicado em parte', 'pill-warn'],
  ERRO: ['Erro', 'pill-err'],
  SEM_LOJA: ['Sem loja vinculada', 'pill-warn'],
  REMOVENDO: ['Removendo', 'pill-warn'],
};
const CANAL: Record<string, [string, string]> = {
  PUBLICADO: ['publicado', 'pill-ok'],
  PROCESSANDO: ['processando', 'pill-info'],
  REMOVIDO: ['removido', ''],
  ERRO: ['erro', 'pill-err'],
  SEM_LOJA: ['sem loja', 'pill-warn'],
};

export function GestorCatalogo({
  lojas,
  produtos,
  notificar,
  aoRecarregar,
  aoAbrirLogs,
}: {
  lojas: LojaVinculada[];
  produtos: ProdutoCadastrado[];
  notificar: (tipo: 'ok' | 'erro', msg: string) => void;
  aoRecarregar: () => Promise<void>;
  aoAbrirLogs: () => void;
}) {
  const [aba, setAba] = useState<'erp' | 'plataformas'>('erp');
  const [busca, setBusca] = useState('');
  const [editor, setEditor] = useState<{ produto: ProdutoErp | null; tipo: ProdutoErp['tipo'] } | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [categoriasPlataforma, setCategoriasPlataforma] = useState<string[]>([]);
  const [avisos, setAvisos] = useState<AvisoCatalogo[]>([]);
  const { pedir, dialogo } = useConfirmar();
  const destinos = lojas.filter((l) => l.estado === 'ATIVA').map((l) => `${nomeCanal(l.plataforma)}: ${l.nome || l.loja}`);
  const ondeVale = destinos.length ? (
    <div className="semana">
      <span className="field-label">Vale em</span>
      {destinos.map((d) => (
        <strong key={d}>{d}</strong>
      ))}
    </div>
  ) : (
    <span className="observacao">Nenhuma loja vinculada: a mudança fica no ERP.</span>
  );

  useEffect(() => {
    void erpApi
      .avisosCatalogo()
      .then(setAvisos)
      .catch(() => {});
  }, [produtos]);

  useEffect(() => {
    void erpApi
      .plataformas(false)
      .then((r) => setCategoriasPlataforma(r.categorias.map((c) => c.nome).filter(Boolean)))
      .catch(() => {});
  }, [produtos.length]);

  const categorias = useMemo(() => [...new Set(produtos.map((p) => p.produto.categoria))].filter(Boolean).sort(), [produtos]);
  const skus = useMemo(() => new Set(produtos.map((p) => p.produto.codigo)), [produtos]);
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos
      .filter((p) => !q || `${p.produto.nome} ${p.produto.codigo} ${p.produto.categoria}`.toLowerCase().includes(q))
      .sort((a, b) => `${a.produto.categoria}${a.produto.nome}`.localeCompare(`${b.produto.categoria}${b.produto.nome}`));
  }, [produtos, busca]);

  async function executar(chave: string, tarefa: () => Promise<unknown>, sucesso: string) {
    setOcupado(chave);
    try {
      await tarefa();
      await aoRecarregar();
      notificar('ok', sucesso);
    } catch (err) {
      notificar('erro', mensagemDe(err, 'Falha na operação.'));
    } finally {
      setOcupado(null);
    }
  }

  const abrirNoErp = (sku: string) => {
    const alvo = produtos.find((p) => p.produto.codigo === sku);
    if (alvo) setEditor({ produto: alvo.produto, tipo: alvo.produto.tipo });
  };

  /** Preco e disponibilidade vao direto para a loja real: mostra o valor atual e o novo antes. */
  const confirmarMudanca = (chave: string, nome: string, rotulo: string, de: string, para: string, tarefa: () => Promise<unknown>, sucesso: string) =>
    pedir({
      titulo: `Alterar ${rotulo.toLowerCase()} de ${nome}?`,
      confirmar: 'Confirmar e enviar',
      // Na 99Food o efeito depende do envio do cardapio (ate alguns minutos); pausa costuma valer na hora
      aviso: 'A mudança vale na loja real.',
      conteudo: (
        <>
          <Mudanca rotulo={rotulo} de={de} para={para} />
          {ondeVale}
        </>
      ),
      acao: () => executar(chave, tarefa, sucesso),
    });
  const mudarPreco = (chave: string, nome: string, atual: number, novo: number, tarefa: () => Promise<unknown>) =>
    confirmarMudanca(chave, nome, 'Preço', formatarMoeda(atual), formatarMoeda(novo), tarefa, 'Preço salvo. Enviando.');
  const mudarDisponivel = (chave: string, nome: string, atual: boolean, tarefa: () => Promise<unknown>) =>
    confirmarMudanca(chave, nome, 'Disponibilidade', atual ? 'Disponível' : 'Pausado', atual ? 'Pausado' : 'Disponível', tarefa, 'Disponibilidade salva. Enviando.');

  const excluir = (p: ProdutoErp) =>
    pedir({
      titulo: `Excluir ${p.nome}?`,
      confirmar: 'Excluir do ERP e das plataformas',
      aviso: 'Não é possível desfazer.',
      perigo: true,
      conteudo: (
        <>
          {/* "Excluir" apaga nos canais (a 99Food pode apenas pausar o ultimo item); "so do ERP" nao chama o Hub. */}
          <span>"Remover só do ERP" mantém o produto publicado nas plataformas.</span>
          {ondeVale}
        </>
      ),
      acao: () => executar(p.codigo, () => erpApi.excluirProduto(p.codigo), 'Exclusão enviada ao iFood e à 99Food.'),
      outra: { rotulo: 'Remover só do ERP', acao: () => executar(p.codigo, () => erpApi.excluirProduto(p.codigo, true), 'Removido somente do ERP.') },
    });

  const opcoesDe = (p: ProdutoErp) => [
    ...(p.pizza
      ? [
          { titulo: 'Tamanhos', opcoes: p.pizza.tamanhos.map((o) => ({ ...o, valor: o.preco })) },
          { titulo: 'Sabores', opcoes: p.pizza.sabores.map((o) => ({ ...o, valor: o.acrescimo, porTamanho: !!o.acrescimoPorTamanho })) },
          { titulo: 'Massas', opcoes: p.pizza.massas.map((o) => ({ ...o, valor: o.preco })) },
          { titulo: 'Bordas', opcoes: p.pizza.bordas.map((o) => ({ ...o, valor: o.preco })) },
        ]
      : []),
    ...p.grupos.map((g) => ({ titulo: `${g.nome} · mínimo ${g.min}, máximo ${g.max}`, opcoes: g.opcoes.map((o) => ({ ...o, valor: o.preco })) })),
  ];

  return (
    <div className="pilha">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <div className="toolbar-group">
          <button type="button" className={`btn btn-sm ${aba === 'erp' ? 'btn-primary' : ''}`} onClick={() => setAba('erp')}>
            Produtos do ERP ({produtos.length})
          </button>
          <button type="button" className={`btn btn-sm ${aba === 'plataformas' ? 'btn-primary' : ''}`} onClick={() => setAba('plataformas')}>
            Nas plataformas
          </button>
        </div>
        {aba === 'erp' ? (
          <div className="toolbar-group">
            <input type="search" className="input input-sm" style={{ width: 230 }} placeholder="Buscar produto, código ou categoria" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <button type="button" className="btn btn-sm" onClick={() => void executar('fila', erpApi.processarFilaCatalogo, 'Fila de envio executada.')} disabled={ocupado === 'fila'}>
              <IconeAtualizar size={14} /> Enviar pendentes agora
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditor({ produto: null, tipo: 'SIMPLES' })}>
              Novo produto
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditor({ produto: null, tipo: 'PIZZA' })}>
              Nova pizza
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditor({ produto: null, tipo: 'COMBO' })}>
              Novo combo
            </button>
          </div>
        ) : null}
      </div>

      {aba === 'plataformas' ? (
        <Plataformas lojas={lojas} skusDoErp={skus} notificar={notificar} aoAbrirNoErp={abrirNoErp} />
      ) : (
        <>
          {/*
            Como a publicacao funciona (detalhado na aba Documentacao e em docs/CARDAPIO.md):
            - salvar, mudar preco ou pausar coloca o produto na fila; o servidor envia ate 4 produtos ao mesmo tempo;
            - o iFood responde em segundos; a 99Food nao recebe item avulso, o Hub reenvia o cardapio inteiro
              (por loja: 2 leituras a cada 2 minutos, 1 envio por minuto, 5 fotos a cada 10 segundos);
            - categoria que nao existe na plataforma e criada na publicacao.
            A tela mostra apenas o estado por canal; avisos completos do Hub ficam em Logs.
          */}
          {avisos.map((a) => (
            <div className="banner banner-warn linha" key={a.id}>
              <span style={{ flex: 1, minWidth: 220 }}>{a.texto}</span>
              <button type="button" className="btn btn-sm" onClick={() => void erpApi.dispensarAviso(a.id).then(() => setAvisos((lista) => lista.filter((x) => x.id !== a.id)))}>
                Dispensar
              </button>
            </div>
          ))}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {!filtrados.length ? (
              <div className="vazio">Nenhum produto cadastrado.</div>
            ) : null}
            {filtrados.map((item) => {
              const p = item.produto;
              const [rotulo, cor] = ESTADOS[item.estado];
              const listas = opcoesDe(p);
              return (
                <div key={p.codigo} className="item-espelho">
                  <div className="linha linha-espelho">
                    {p.foto ? <img src={p.foto} alt="" className="miniatura" /> : null}
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <strong>{p.nome}</strong>
                      {p.tipo !== 'SIMPLES' ? <span className="pill" style={{ marginLeft: 6 }}>{p.tipo === 'PIZZA' ? 'Pizza' : 'Combo'}</span> : null}
                      {JSON.stringify(p).includes('"precosPlataforma"') ? <span className="pill pill-info" style={{ marginLeft: 6 }}>Preço por plataforma</span> : null}
                      <div className="suave">
                        {p.categoria} · {p.codigo}
                      </div>
                    </div>
                    <div className="linha">
                      <span className={`pill ${cor}`}>{rotulo}</span>
                      {(['IFOOD', '99FOOD'] as const).map((c) => {
                        const canal = item.canais[c];
                        return canal ? (
                          <span key={c} className={`pill ${CANAL[canal.estado]?.[1] ?? ''}`} title={canal.erro ?? canal.avisos?.join(' ') ?? ''}>
                            {nomeCanal(c)}: {CANAL[canal.estado]?.[0] ?? canal.estado}
                            {canal.envioEmSegundos !== undefined ? <Contagem segundos={canal.envioEmSegundos} antes=" · enviando em" /> : null}
                          </span>
                        ) : null;
                      })}
                    </div>
                    {p.tipo !== 'PIZZA' ? (
                      <PrecoEditavel valor={p.preco} desabilitado={!!ocupado} aoSalvar={(preco) => mudarPreco(p.codigo, p.nome, p.preco, preco, () => erpApi.ajustarProduto(p.codigo, { preco }))} />
                    ) : (
                      <span className="suave">a partir de {formatarMoeda(p.preco)}</span>
                    )}
                    <BotaoDisponivel
                      disponivel={p.disponivel}
                      desabilitado={!!ocupado}
                      aoClicar={() => mudarDisponivel(p.codigo, p.nome, p.disponivel, () => erpApi.ajustarProduto(p.codigo, { disponivel: !p.disponivel }))}
                    />
                    {listas.length ? (
                      <button type="button" className="btn btn-sm" onClick={() => setAberto(aberto === p.codigo ? null : p.codigo)}>
                        {aberto === p.codigo ? 'Ocultar opções' : 'Opções'}
                      </button>
                    ) : null}
                    <button type="button" className="btn btn-sm" onClick={() => setEditor({ produto: p, tipo: p.tipo })}>
                      Editar
                    </button>
                    <button type="button" className="btn btn-sm" disabled={!!ocupado} onClick={() => void executar(p.codigo, () => erpApi.reenviarProduto(p.codigo), 'Produto colocado na fila.')}>
                      Reenviar
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" disabled={!!ocupado} onClick={() => excluir(p)}>
                      Excluir
                    </button>
                  </div>

                  {item.erro ? (
                    <div className="banner banner-warn linha">
                      <span style={{ flex: 1 }}>{item.erro}</span>
                      <button type="button" className="btn btn-sm" onClick={aoAbrirLogs}>
                        Ver logs
                      </button>
                    </div>
                  ) : null}
                  {/*
                    Avisos de rotina do Hub (fila, analise de foto) ficam no titulo do selo do canal e em Logs.
                    Aqui aparece so o que muda a expectativa do operador: item que saiu do ERP mas ficou
                    pausado na plataforma (a 99Food nao aceita cardapio vazio).
                  */}
                  {Object.entries(item.canais).flatMap(([c, s]) =>
                    s?.estado === 'REMOVIDO'
                      ? (s.avisos ?? []).map((a) => (
                          <div className="observacao" key={`${c}${a}`}>
                            {nomeCanal(c)}: {a}
                          </div>
                        ))
                      : [],
                  )}

                  {aberto === p.codigo
                    ? listas.map((l) => (
                        <div className="grupo-espelho" key={l.titulo}>
                          <div className="field-label">{l.titulo}</div>
                          {l.opcoes.map((o) => (
                            <div className="linha linha-espelho" key={o.codigo}>
                              <span style={{ flex: 1, minWidth: 140 }}>
                                {o.nome} <span className="suave">· {o.codigo}</span>
                              </span>
                              {'porTamanho' in o && o.porTamanho ? (
                                <span className="suave">preço por tamanho (editar o produto)</span>
                              ) : (
                                <PrecoEditavel valor={o.valor} desabilitado={!!ocupado} aoSalvar={(preco) => mudarPreco(o.codigo, o.nome, o.valor, preco, () => erpApi.ajustarOpcao(p.codigo, o.codigo, { preco }))} />
                              )}
                              <BotaoDisponivel
                                disponivel={o.disponivel}
                                desabilitado={!!ocupado}
                                aoClicar={() => mudarDisponivel(o.codigo, o.nome, o.disponivel, () => erpApi.ajustarOpcao(p.codigo, o.codigo, { disponivel: !o.disponivel }))}
                              />
                            </div>
                          ))}
                        </div>
                      ))
                    : null}
                </div>
              );
            })}
          </div>
        </>
      )}

      {editor ? (
        <EditorProduto destinos={destinos} produto={editor.produto} tipo={editor.tipo} categorias={categorias} categoriasEspelho={categoriasPlataforma} notificar={notificar} aoFechar={() => setEditor(null)} aoSalvar={aoRecarregar} />
      ) : null}
      {dialogo}
    </div>
  );
}
