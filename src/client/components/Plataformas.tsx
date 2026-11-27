import React, { useEffect, useState } from 'react';
import { CategoriaEspelho, erpApi, formatarMoeda, GrupoEspelho, ItemEspelho, lerPreco, mensagemDe, nomeCanal } from '../api';
import { IconeAtualizar, IconeSeta } from './Icones';

/** O que esta publicado em cada plataforma, com ajustes rapidos para itens que nao sao cadastrados no ERP. */
export function PrecoEditavel({ valor, desabilitado, aoSalvar }: { valor: number; desabilitado?: boolean; aoSalvar: (novo: number) => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  if (texto === null) {
    return (
      <button type="button" className="btn btn-sm" disabled={desabilitado} title="Alterar preço" onClick={() => setTexto(String(valor).replace('.', ','))}>
        {formatarMoeda(valor)}
      </button>
    );
  }
  const salvar = () => {
    const novo = lerPreco(texto);
    if (Number.isFinite(novo) && novo >= 0) {
      aoSalvar(novo);
      setTexto(null);
    }
  };
  return (
    <span className="linha">
      <input
        className="input input-sm preco"
        autoFocus
        inputMode="decimal"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') salvar();
          if (e.key === 'Escape') setTexto(null);
        }}
      />
      <button type="button" className="btn btn-sm btn-primary" onClick={salvar}>
        Salvar
      </button>
    </span>
  );
}

export const BotaoDisponivel = ({ disponivel, desabilitado, aoClicar }: { disponivel: boolean; desabilitado?: boolean; aoClicar: () => void }) => (
  <button type="button" className={`pill ${disponivel ? 'pill-ok' : 'pill-err'}`} disabled={desabilitado} onClick={aoClicar} title={disponivel ? 'Pausar' : 'Reativar'}>
    <span className="dot" />
    {disponivel ? 'Disponível' : 'Pausado'}
  </button>
);

export function Plataformas({ skusDoErp, notificar, aoAbrirNoErp }: { skusDoErp: Set<string>; notificar: (tipo: 'ok' | 'erro', msg: string) => void; aoAbrirNoErp: (sku: string) => void }) {
  const [categorias, setCategorias] = useState<CategoriaEspelho[]>([]);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [canal, setCanal] = useState<'IFOOD' | '99FOOD'>('IFOOD');
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [edicaoCategoria, setEdicaoCategoria] = useState<{ id: string | null; nome: string } | null>(null);
  const [diagnostico, setDiagnostico] = useState('');

  async function carregar(atualizar = false) {
    const r = await erpApi.plataformas(atualizar);
    setCategorias(r.categorias);
    setAtualizadoEm(r.atualizadoEm);
    if (atualizar) setAvisos(r.avisos);
  }
  useEffect(() => {
    void carregar().catch(() => undefined);
  }, []);

  async function executar(tarefa: () => Promise<unknown>, sucesso: string) {
    setOcupado(true);
    try {
      await tarefa();
      await carregar();
      notificar('ok', sucesso);
    } catch (err) {
      notificar('erro', mensagemDe(err, 'Falha na operação.'));
    } finally {
      setOcupado(false);
    }
  }

  const doCanal = categorias.filter((c) => c.plataforma === canal);

  function grupos(lista: GrupoEspelho[], item: ItemEspelho, nivel = 0): React.ReactNode {
    const doErp = skusDoErp.has(item.sku);
    return lista.map((g) => (
      <div key={g.id} className="grupo-espelho" style={{ marginLeft: nivel * 16 }}>
        <div className="field-label">
          {g.nome} · mínimo {g.min}, máximo {g.max}
          {g.tipoGrupo && g.tipoGrupo !== 'DEFAULT' ? ` · ${g.tipoGrupo}` : ''}
        </div>
        {g.opcoes.map((o) => (
          <React.Fragment key={o.id}>
            <div className="linha linha-espelho">
              <span style={{ flex: 1, minWidth: 140 }}>
                {o.nome}
                {o.sku ? <span className="suave"> · {o.sku}</span> : null}
                {o.precosPorTamanho?.length ? <span className="suave"> · {o.precosPorTamanho.map((t) => formatarMoeda(t.preco)).join(' / ')}</span> : null}
              </span>
              <PrecoEditavel
                valor={o.preco}
                desabilitado={ocupado || doErp}
                aoSalvar={(preco) => void executar(() => erpApi.ajustarOpcaoPlataforma({ plataforma: canal, optionId: o.id, groupId: g.id, preco }), `Preço de ${o.nome} atualizado.`)}
              />
              <BotaoDisponivel
                disponivel={o.status !== 'UNAVAILABLE'}
                desabilitado={ocupado || doErp}
                aoClicar={() =>
                  void executar(
                    () => erpApi.ajustarOpcaoPlataforma({ plataforma: canal, optionId: o.id, status: o.status === 'UNAVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE' }),
                    `${o.nome}: disponibilidade alterada.`,
                  )
                }
              />
            </div>
            {o.subgrupos?.length ? grupos(o.subgrupos, item, nivel + 1) : null}
          </React.Fragment>
        ))}
      </div>
    ));
  }

  return (
    <div className="pilha">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <div className="toolbar-group">
          {(['IFOOD', '99FOOD'] as const).map((c) => (
            <button key={c} type="button" className={`btn btn-sm ${canal === c ? 'btn-primary' : ''}`} onClick={() => setCanal(c)}>
              {nomeCanal(c)}
            </button>
          ))}
          <span className="suave">{atualizadoEm ? `Lido em ${new Date(atualizadoEm).toLocaleString('pt-BR')}` : 'Ainda não lido das plataformas'}</span>
        </div>
        <div className="toolbar-group">
          <button type="button" className="btn btn-sm" onClick={() => setEdicaoCategoria({ id: null, nome: '' })}>
            Nova categoria
          </button>
          {canal === 'IFOOD' ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                void erpApi
                  .naoVendaveis('IFOOD')
                  .then((r) => setDiagnostico(JSON.stringify(r, null, 2)))
                  .catch((err) => notificar('erro', mensagemDe(err, 'Falha na consulta.')))
              }
            >
              Itens não vendáveis
            </button>
          ) : null}
          <button type="button" className="btn btn-sm btn-primary" disabled={ocupado} onClick={() => void executar(() => carregar(true), 'Cardápio lido das plataformas.')}>
            <IconeAtualizar size={14} /> {ocupado ? 'Aguarde...' : 'Puxar das plataformas'}
          </button>
        </div>
      </div>
      {canal === '99FOOD' ? <div className="suave">A 99Food permite uma leitura do cardápio por minuto. Criar ou renomear categoria reenvia o cardápio inteiro da loja.</div> : null}
      {avisos.map((a) => (
        <div className="banner banner-warn" key={a}>
          {a}
        </div>
      ))}
      {diagnostico ? (
        <div className="card">
          <div className="linha">
            <strong>Itens não vendáveis</strong>
            <button type="button" className="btn btn-sm" onClick={() => setDiagnostico('')}>
              Fechar
            </button>
          </div>
          <pre className="code-block">{diagnostico}</pre>
        </div>
      ) : null}
      {edicaoCategoria ? (
        <form
          className="card linha"
          onSubmit={(e) => {
            e.preventDefault();
            const { id, nome } = edicaoCategoria;
            void executar(
              async () => {
                if (id) await erpApi.alterarCategoria(id, { plataforma: canal, nome });
                else {
                  await erpApi.criarCategoria(canal, nome);
                  await erpApi.plataformas(true);
                }
                setEdicaoCategoria(null);
              },
              id ? 'Categoria renomeada.' : 'Categoria criada.',
            );
          }}
        >
          <strong>
            {edicaoCategoria.id ? 'Renomear categoria' : 'Nova categoria'} ({nomeCanal(canal)})
          </strong>
          <input className="input input-sm" style={{ flex: 1, minWidth: 200 }} autoFocus required value={edicaoCategoria.nome} onChange={(e) => setEdicaoCategoria({ ...edicaoCategoria, nome: e.target.value })} />
          <button type="submit" className="btn btn-sm btn-primary" disabled={ocupado}>
            Salvar
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setEdicaoCategoria(null)}>
            Cancelar
          </button>
        </form>
      ) : null}

      {!doCanal.length ? <div className="card vazio">Nenhuma categoria em {nomeCanal(canal)}. Use "Puxar das plataformas".</div> : null}
      {doCanal.map((c, indice) => (
        <div className="card" key={c.id} style={{ padding: 0, overflow: 'hidden' }}>
          <div className="cabecalho-categoria">
            <strong>{c.nome}</strong>
            <div className="linha">
              <button type="button" className="btn-icon" title="Subir categoria" disabled={ocupado || indice === 0} onClick={() => void executar(() => erpApi.alterarCategoria(c.id, { plataforma: canal, mover: 'subir' }), 'Ordem atualizada.')}>
                <IconeSeta direcao="cima" />
              </button>
              <button type="button" className="btn-icon" title="Descer categoria" disabled={ocupado || indice === doCanal.length - 1} onClick={() => void executar(() => erpApi.alterarCategoria(c.id, { plataforma: canal, mover: 'descer' }), 'Ordem atualizada.')}>
                <IconeSeta direcao="baixo" />
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setEdicaoCategoria({ id: c.id, nome: c.nome })}>
                Renomear
              </button>
              {canal === 'IFOOD' ? (
                <BotaoDisponivel
                  disponivel={c.status !== 'UNAVAILABLE'}
                  desabilitado={ocupado}
                  aoClicar={() =>
                    void executar(() => erpApi.alterarCategoria(c.id, { plataforma: canal, status: c.status === 'UNAVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE' }), 'Categoria atualizada.')
                  }
                />
              ) : null}
            </div>
          </div>
          {c.itens.map((it) => {
            const doErp = skusDoErp.has(it.sku);
            const chave = `${c.id}:${it.id}`;
            return (
              <div key={chave} className="item-espelho">
                <div className="linha linha-espelho">
                  {it.imagemUrl?.startsWith('http') ? <img src={it.imagemUrl} alt="" className="miniatura" /> : null}
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <strong>{it.nome}</strong>
                    {it.tipo === 'PIZZA' ? <span className="pill" style={{ marginLeft: 6 }}>Pizza</span> : null}
                    <div className="suave">
                      {it.sku ? `SKU ${it.sku}` : 'Sem SKU'}
                      {it.descricao ? ` · ${it.descricao}` : ''}
                    </div>
                  </div>
                  {doErp ? (
                    <button type="button" className="btn btn-sm" onClick={() => aoAbrirNoErp(it.sku)}>
                      Editar nos produtos do ERP
                    </button>
                  ) : null}
                  {it.grupos?.length ? (
                    <button type="button" className="btn btn-sm" onClick={() => setAberto(aberto === chave ? null : chave)}>
                      {aberto === chave ? 'Ocultar adicionais' : `Adicionais (${it.grupos.length})`}
                    </button>
                  ) : null}
                  <PrecoEditavel valor={it.preco} desabilitado={ocupado || doErp} aoSalvar={(preco) => void executar(() => erpApi.ajustarItemPlataforma({ plataforma: canal, itemId: it.id, preco }), `Preço de ${it.nome} atualizado.`)} />
                  <BotaoDisponivel
                    disponivel={it.status !== 'UNAVAILABLE'}
                    desabilitado={ocupado || doErp}
                    aoClicar={() =>
                      void executar(
                        () => erpApi.ajustarItemPlataforma({ plataforma: canal, itemId: it.id, status: it.status === 'UNAVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE' }),
                        `${it.nome}: disponibilidade alterada.`,
                      )
                    }
                  />
                </div>
                {aberto === chave ? grupos(it.grupos, it) : null}
              </div>
            );
          })}
          {!c.itens.length ? <div className="vazio">Categoria sem itens</div> : null}
        </div>
      ))}
    </div>
  );
}
