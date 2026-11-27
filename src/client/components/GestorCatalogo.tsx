import React, { useMemo, useState } from 'react';
import { ApiErro, CatalogoCategoria, CatalogoItem, erpApi, extrairStatusIfood, formatarMoeda } from '../api';
import { IconeAtualizar, IconeFechar, IconeSeta } from './Icones';
import { MenuTresPontos } from './MenuTresPontos';

export function GestorCatalogo({
  categorias,
  statusLoja,
  notificar,
  aoRecarregarCatalogo,
  aoRecarregarStatusLoja,
  aoAbrirLogs,
}: {
  categorias: CatalogoCategoria[];
  statusLoja: any;
  notificar: (tipo: 'ok' | 'erro', msg: string) => void;
  aoRecarregarCatalogo: (sincronizar?: boolean) => Promise<void>;
  aoRecarregarStatusLoja: () => Promise<void>;
  aoAbrirLogs: () => void;
}) {
  const [catSelId, setCatSelId] = useState<string>('TODAS');
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'TODOS' | 'AVAILABLE' | 'UNAVAILABLE'>('TODOS');
  const [filtroPlat, setFiltroPlat] = useState<'TODAS' | 'IFOOD' | '99FOOD'>('TODAS');
  const [sincronizando, setSincronizando] = useState(false);
  const [ocupadoKey, setOcupadoKey] = useState<string | null>(null);

  // Edição inline de preço
  const [precoEditId, setPrecoEditId] = useState<string | null>(null);
  const [precoEditVal, setPrecoEditVal] = useState('');

  // Modal Categoria (criar ou renomear)
  const [modalCat, setModalCat] = useState<{ modo: 'criar' | 'renomear'; id?: string; nome: string } | null>(null);

  // Modal Item & Complementos
  const [modalItem, setModalItem] = useState<{
    modo: 'criar' | 'editar';
    id?: string;
    productId?: string;
    categoriaId: string;
    plataforma: string;
    nome: string;
    descricao: string;
    sku: string;
    preco: string;
    status: 'AVAILABLE' | 'UNAVAILABLE';
    grupos: any[];
    payloadRaw?: any;
    mostrarJson?: boolean;
  } | null>(null);

  // Edição preço complemento dentro do Modal Item
  const [opPrecoEdit, setOpPrecoEdit] = useState<{ id: string; valor: string } | null>(null);

  // Modal Diagnóstico Técnico (via menu 3 pontos)
  const [modalTecnico, setModalTecnico] = useState<{ titulo: string; json: string } | null>(null);

  const catsVisiveis = useMemo(() => {
    return categorias.filter((c) => filtroPlat === 'TODAS' || c.plataforma === filtroPlat);
  }, [categorias, filtroPlat]);

  const itensFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista: Array<CatalogoItem & { categoriaNome: string }> = [];
    for (const c of catsVisiveis) {
      if (catSelId !== 'TODAS' && c.id !== catSelId) continue;
      for (const it of c.itens) {
        if (filtroStatus !== 'TODOS' && it.status !== filtroStatus) continue;
        if (q && !`${it.nome} ${it.sku} ${it.descricao} ${c.nome}`.toLowerCase().includes(q)) continue;
        lista.push({ ...it, categoriaNome: c.nome });
      }
    }
    return lista;
  }, [catsVisiveis, catSelId, filtroStatus, busca]);

  const stIfood = extrairStatusIfood(statusLoja);
  const statusIfood = stIfood.carregado;
  const lojaAberta = stIfood.aberta;
  const motivoFechada = stIfood.titulo;

  async function sincronizar() {
    setSincronizando(true);
    try {
      await aoRecarregarCatalogo(true);
      await aoRecarregarStatusLoja();
      notificar('ok', 'Cardápio sincronizado com o Hub e salvo no SQLite.');
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Falha ao sincronizar cardápio.');
    } finally {
      setSincronizando(false);
    }
  }

  async function pausarLojaRapido(minutos: number) {
    setOcupadoKey('pausa-loja');
    try {
      await erpApi.criarInterrupcao({ description: `Pausa rápida pelo ERP (${minutos} min)`, durationMinutes: minutos });
      await aoRecarregarStatusLoja();
      notificar('ok', `Loja pausada por ${minutos} minutos.`);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao pausar loja.');
    } finally {
      setOcupadoKey(null);
    }
  }

  async function alternarStatusItem(it: CatalogoItem) {
    const novo = it.status === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE';
    setOcupadoKey(`st-${it.id}`);
    try {
      await erpApi.statusItem(it.id, novo, it.plataforma);
      notificar('ok', novo === 'UNAVAILABLE' ? `"${it.nome}" pausado / ocultado da vitrine.` : `"${it.nome}" reativado no cardápio.`);
      await aoRecarregarCatalogo(false);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao alterar disponibilidade.');
    } finally {
      setOcupadoKey(null);
    }
  }

  async function salvarPrecoInline(it: CatalogoItem) {
    const valor = Number(precoEditVal.replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) {
      notificar('erro', 'Informe um preço válido.');
      return;
    }
    setOcupadoKey(`pr-${it.id}`);
    try {
      await erpApi.precoItem(it.id, valor, it.plataforma);
      setPrecoEditId(null);
      notificar('ok', `Preço de "${it.nome}" atualizado para ${formatarMoeda(valor)}.`);
      await aoRecarregarCatalogo(false);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao atualizar preço.');
    } finally {
      setOcupadoKey(null);
    }
  }

  async function moverCategoria(id: string, direcao: 'subir' | 'descer') {
    setOcupadoKey(`mcat-${id}`);
    try {
      await erpApi.moverCategoria(id, direcao);
      await aoRecarregarCatalogo(false);
      notificar('ok', 'Ordem da categoria atualizada.');
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao reordenar categoria.');
    } finally {
      setOcupadoKey(null);
    }
  }

  async function moverItem(id: string, direcao: 'subir' | 'descer') {
    setOcupadoKey(`mit-${id}`);
    try {
      await erpApi.moverItem(id, direcao);
      await aoRecarregarCatalogo(false);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao mover item.');
    } finally {
      setOcupadoKey(null);
    }
  }

  async function alternarStatusCategoria(c: CatalogoCategoria) {
    const novo = c.status === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE';
    setOcupadoKey(`cat-${c.id}`);
    try {
      await erpApi.atualizarCategoria(c.id, { status: novo });
      await aoRecarregarCatalogo(false);
      notificar('ok', `Categoria "${c.nome}" marcada como ${novo === 'AVAILABLE' ? 'Ativa' : 'Pausada'}.`);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao atualizar categoria.');
    } finally {
      setOcupadoKey(null);
    }
  }

  async function salvarCategoriaModal(e: React.FormEvent) {
    e.preventDefault();
    if (!modalCat || !modalCat.nome.trim()) return;
    setOcupadoKey('cat-modal');
    try {
      if (modalCat.modo === 'criar') {
        await erpApi.criarCategoria(modalCat.nome.trim(), 'AVAILABLE');
        notificar('ok', `Categoria "${modalCat.nome.trim()}" criada.`);
      } else if (modalCat.id) {
        await erpApi.atualizarCategoria(modalCat.id, { nome: modalCat.nome.trim() });
        notificar('ok', `Categoria renomeada para "${modalCat.nome.trim()}".`);
      }
      setModalCat(null);
      await aoRecarregarCatalogo(false);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao salvar categoria.');
    } finally {
      setOcupadoKey(null);
    }
  }

  async function abrirEditorItem(it: CatalogoItem) {
    setModalItem({
      modo: 'editar',
      id: it.id,
      productId: it.payload?.productId,
      categoriaId: it.categoriaId,
      plataforma: it.plataforma,
      nome: it.nome,
      descricao: it.descricao || '',
      sku: it.sku || '',
      preco: String(it.preco ?? 0),
      status: it.status,
      grupos: Array.isArray(it.grupos) ? it.grupos : [],
      payloadRaw: it.payload,
      mostrarJson: false,
    });
    if (it.plataforma === 'IFOOD' && (!Array.isArray(it.grupos) || it.grupos.length === 0)) {
      try {
        const det = await erpApi.detalheItem(it.id);
        setModalItem((cur) =>
          cur && cur.id === it.id
            ? {
                ...cur,
                productId: det.productId ?? cur.productId,
                grupos: Array.isArray(det.optionGroups) ? det.optionGroups : cur.grupos,
                payloadRaw: det,
              }
            : cur,
        );
      } catch {
        // mantem os dados já salvos no SQLite caso consistencia eventual retorne 404
      }
    }
  }

  async function salvarItemModal(e: React.FormEvent) {
    e.preventDefault();
    if (!modalItem) return;
    const preco = Number(modalItem.preco.replace(',', '.'));
    if (!modalItem.nome.trim() || !modalItem.categoriaId || !Number.isFinite(preco)) {
      notificar('erro', 'Preencha nome, categoria e preço válido.');
      return;
    }
    setOcupadoKey('item-modal');
    try {
      await erpApi.salvarItem({
        ...(modalItem.id ? { id: modalItem.id } : {}),
        ...(modalItem.productId ? { productId: modalItem.productId } : {}),
        plataforma: modalItem.plataforma,
        categoryId: modalItem.categoriaId,
        name: modalItem.nome.trim(),
        description: modalItem.descricao.trim(),
        externalCode: modalItem.sku.trim(),
        preco,
        status: modalItem.status,
      });
      notificar('ok', modalItem.modo === 'criar' ? `Item "${modalItem.nome}" criado na vitrine.` : `Item "${modalItem.nome}" salvo.`);
      setModalItem(null);
      await aoRecarregarCatalogo(false);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao salvar item.');
    } finally {
      setOcupadoKey(null);
    }
  }

  async function alternarStatusOpcao(opId: string, atual: string) {
    if (!modalItem) return;
    const novo = atual === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE';
    setOcupadoKey(`op-${opId}`);
    try {
      await erpApi.statusOpcao(opId, novo, modalItem.plataforma);
      setModalItem((cur) =>
        cur
          ? {
              ...cur,
              grupos: cur.grupos.map((g) => ({
                ...g,
                options: (g.options ?? []).map((op: any) => (op.id === opId ? { ...op, status: novo } : op)),
              })),
            }
          : cur,
      );
      notificar('ok', novo === 'UNAVAILABLE' ? 'Complemento pausado.' : 'Complemento reativado.');
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao alterar complemento.');
    } finally {
      setOcupadoKey(null);
    }
  }

  async function salvarPrecoOpcao(opId: string) {
    if (!modalItem || !opPrecoEdit) return;
    const valor = Number(opPrecoEdit.valor.replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) return;
    setOcupadoKey(`opr-${opId}`);
    try {
      await erpApi.precoOpcao(opId, valor, modalItem.plataforma);
      setModalItem((cur) =>
        cur
          ? {
              ...cur,
              grupos: cur.grupos.map((g) => ({
                ...g,
                options: (g.options ?? []).map((op: any) => (op.id === opId ? { ...op, price: { ...(op.price ?? {}), value: valor } } : op)),
              })),
            }
          : cur,
      );
      setOpPrecoEdit(null);
      notificar('ok', `Preço do complemento atualizado para ${formatarMoeda(valor)}.`);
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao atualizar preço do complemento.');
    } finally {
      setOcupadoKey(null);
    }
  }

  async function abrirNaoVendaveis() {
    try {
      const r = await erpApi.naoVendaveis();
      setModalTecnico({ titulo: 'Diagnóstico: Itens Não Vendáveis (iFood)', json: JSON.stringify(r, null, 2) });
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao consultar itens não vendáveis.');
    }
  }

  return (
    <div>
      {/* Barra de Operação Rápida da Loja + Filtros */}
      <div className="toolbar">
        <div className="toolbar-group">
          {statusIfood ? (
            <span className={lojaAberta ? 'pill pill-ok' : 'pill pill-err'}>
              <span className="dot" />
              iFood: {lojaAberta ? 'Aberta' : `Fechada${motivoFechada ? ` (${motivoFechada})` : ''}`}
            </span>
          ) : null}
          <input
            type="search"
            className="input input-sm"
            style={{ width: 220 }}
            placeholder="Buscar item ou código..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {(['TODOS', 'AVAILABLE', 'UNAVAILABLE'] as const).map((st) => (
            <button
              key={st}
              type="button"
              className={`btn btn-sm ${filtroStatus === st ? 'btn-primary' : ''}`}
              onClick={() => setFiltroStatus(st)}
            >
              {st === 'TODOS' ? 'Todos' : st === 'AVAILABLE' ? 'Visíveis' : 'Pausados / Sumidos'}
            </button>
          ))}
          {(['TODAS', 'IFOOD', '99FOOD'] as const).map((pl) => (
            <button
              key={pl}
              type="button"
              className={`btn btn-sm ${filtroPlat === pl ? 'btn-primary' : ''}`}
              onClick={() => {
                setFiltroPlat(pl);
                setCatSelId('TODAS');
              }}
            >
              {pl === 'TODAS' ? 'Todos canais' : pl === 'IFOOD' ? 'iFood' : '99Food'}
            </button>
          ))}
        </div>

        <div className="toolbar-group">
          <button type="button" className="btn btn-sm" onClick={sincronizar} disabled={sincronizando}>
            <IconeAtualizar size={14} /> {sincronizando ? 'Sincronizando...' : 'Sincronizar'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setModalCat({ modo: 'criar', nome: '' })}>
            + Categoria
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() =>
              setModalItem({
                modo: 'criar',
                categoriaId: catSelId !== 'TODAS' ? catSelId : catsVisiveis[0]?.id ?? '',
                plataforma: filtroPlat === '99FOOD' ? '99FOOD' : 'IFOOD',
                nome: '',
                descricao: '',
                sku: '',
                preco: '0',
                status: 'AVAILABLE',
                grupos: [],
              })
            }
          >
            + Novo Item
          </button>
          <MenuTresPontos
            titulo="Opções da loja e diagnósticos"
            itens={[
              { rotulo: 'Pausar loja iFood por 15 min', aoClicar: () => pausarLojaRapido(15) },
              { rotulo: 'Pausar loja iFood por 30 min', aoClicar: () => pausarLojaRapido(30) },
              { rotulo: 'Verificar itens não vendáveis (iFood)', separadorAntes: true, aoClicar: abrirNaoVendaveis },
              {
                rotulo: 'Ver JSON completo em cache SQLite',
                aoClicar: () => setModalTecnico({ titulo: 'Catálogo em SQLite', json: JSON.stringify(categorias, null, 2) }),
              },
              { rotulo: 'Abrir logs HTTP SQLite', aoClicar: aoAbrirLogs },
            ]}
          />
        </div>
      </div>

      {/* Layout Split: Categorias + Tabela de Itens */}
      <div className="catalog-layout">
        <div className="card" style={{ padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Categorias ({catsVisiveis.length})</strong>
            {catSelId !== 'TODAS' ? (
              <button type="button" className="btn btn-sm" onClick={() => setCatSelId('TODAS')}>
                Ver todas
              </button>
            ) : null}
          </div>

          <div className="cat-list">
            <div
              className={`cat-row${catSelId === 'TODAS' ? ' active' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setCatSelId('TODAS')}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>Todas as categorias</span>
              <span className="pill">{catsVisiveis.reduce((s, c) => s + c.itens.length, 0)}</span>
            </div>

            {catsVisiveis.map((c, idx) => (
              <div
                key={c.id}
                className={`cat-row${catSelId === c.id ? ' active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => setCatSelId(c.id)}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.nome}
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 2, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.itens.length} itens</span>
                    {c.status === 'UNAVAILABLE' ? <span className="pill pill-err" style={{ fontSize: 10, padding: '1px 6px' }}>Pausada</span> : null}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="btn-icon"
                    style={{ minWidth: 26, minHeight: 26 }}
                    title="Subir categoria"
                    disabled={idx === 0 || ocupadoKey === `mcat-${c.id}`}
                    onClick={() => moverCategoria(c.id, 'subir')}
                  >
                    <IconeSeta direcao="cima" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    style={{ minWidth: 26, minHeight: 26 }}
                    title="Descer categoria"
                    disabled={idx === catsVisiveis.length - 1 || ocupadoKey === `mcat-${c.id}`}
                    onClick={() => moverCategoria(c.id, 'descer')}
                  >
                    <IconeSeta direcao="baixo" />
                  </button>
                  <MenuTresPontos
                    compacto
                    titulo={`Ações da categoria ${c.nome}`}
                    itens={[
                      {
                        rotulo: c.status === 'AVAILABLE' ? 'Pausar categoria inteira' : 'Reativar categoria',
                        aoClicar: () => alternarStatusCategoria(c),
                      },
                      {
                        rotulo: 'Renomear categoria',
                        aoClicar: () => setModalCat({ modo: 'renomear', id: c.id, nome: c.nome }),
                      },
                      {
                        rotulo: '+ Adicionar item nesta categoria',
                        aoClicar: () =>
                          setModalItem({
                            modo: 'criar',
                            categoriaId: c.id,
                            plataforma: c.plataforma,
                            nome: '',
                            descricao: '',
                            sku: '',
                            preco: '0',
                            status: 'AVAILABLE',
                            grupos: [],
                          }),
                      },
                      {
                        rotulo: 'Ver JSON da categoria',
                        separadorAntes: true,
                        aoClicar: () => setModalTecnico({ titulo: `Categoria ${c.nome}`, json: JSON.stringify(c.payload ?? c, null, 2) }),
                      },
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Lista / Tabela de Itens */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>
              Itens ({itensFiltrados.length})
            </strong>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Clique no preço para editar rápido ou em Visível/Pausado para sumir/voltar o item.
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="item-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Canal</th>
                  <th>Preço</th>
                  <th>Visibilidade</th>
                  <th>Ordem</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {itensFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                      Nenhum item encontrado. Clique em Sincronizar para buscar da loja.
                    </td>
                  </tr>
                ) : null}

                {itensFiltrados.map((it) => {
                  const visivel = it.status === 'AVAILABLE';
                  const editandoPreco = precoEditId === it.id;
                  return (
                    <tr key={it.id} style={{ opacity: visivel ? 1 : 0.72 }}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{it.nome}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {it.categoriaNome}
                          {it.sku ? ` · Cód: ${it.sku}` : ''}
                        </div>
                        {it.descricao ? (
                          <div style={{ fontSize: 12, color: 'var(--text-subtle)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {it.descricao}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span className="pill">{it.plataforma === '99FOOD' ? '99Food' : 'iFood'}</span>
                      </td>
                      <td>
                        {editandoPreco ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              className="input input-sm"
                              style={{ width: 92 }}
                              value={precoEditVal}
                              onChange={(e) => setPrecoEditVal(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void salvarPrecoInline(it);
                                if (e.key === 'Escape') setPrecoEditId(null);
                              }}
                              autoFocus
                            />
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => salvarPrecoInline(it)}>
                              OK
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm"
                            title="Clique para editar preço"
                            onClick={() => {
                              setPrecoEditId(it.id);
                              setPrecoEditVal(String(it.preco ?? 0));
                            }}
                          >
                            {formatarMoeda(it.preco)}
                          </button>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`pill ${visivel ? 'pill-ok' : 'pill-err'}`}
                          style={{ cursor: 'pointer' }}
                          disabled={ocupadoKey === `st-${it.id}`}
                          onClick={() => alternarStatusItem(it)}
                          title={visivel ? 'Clique para pausar (sumir da vitrine)' : 'Clique para ativar na vitrine'}
                        >
                          <span className="dot" />
                          {visivel ? 'Visível' : 'Pausado'}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            type="button"
                            className="btn-icon"
                            style={{ minWidth: 28, minHeight: 28 }}
                            title="Subir item"
                            onClick={() => moverItem(it.id, 'subir')}
                          >
                            <IconeSeta direcao="cima" />
                          </button>
                          <button
                            type="button"
                            className="btn-icon"
                            style={{ minWidth: 28, minHeight: 28 }}
                            title="Descer item"
                            onClick={() => moverItem(it.id, 'descer')}
                          >
                            <IconeSeta direcao="baixo" />
                          </button>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <button type="button" className="btn btn-sm" onClick={() => abrirEditorItem(it)}>
                            Editar / Opções
                          </button>
                          <MenuTresPontos
                            compacto
                            titulo={`Opções de ${it.nome}`}
                            itens={[
                              { rotulo: 'Editar item e complementos', aoClicar: () => abrirEditorItem(it) },
                              { rotulo: visivel ? 'Sumir / Pausar item' : 'Voltar item ao ar', aoClicar: () => alternarStatusItem(it) },
                              {
                                rotulo: 'Ver JSON técnico do item',
                                separadorAntes: true,
                                aoClicar: () => setModalTecnico({ titulo: `Item: ${it.nome}`, json: JSON.stringify(it.payload ?? it, null, 2) }),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Categoria */}
      {modalCat ? (
        <div className="modal-backdrop" onClick={() => setModalCat(null)}>
          <div className="modal-panel" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 style={{ margin: 0, fontSize: 16 }}>{modalCat.modo === 'criar' ? 'Nova Categoria' : 'Renomear Categoria'}</h2>
              <button type="button" className="btn-icon" onClick={() => setModalCat(null)}>
                <IconeFechar />
              </button>
            </div>
            <form onSubmit={salvarCategoriaModal} className="modal-body">
              <div className="field">
                <label className="field-label">Nome da categoria</label>
                <input
                  className="input"
                  value={modalCat.nome}
                  onChange={(e) => setModalCat({ ...modalCat, nome: e.target.value })}
                  placeholder="Ex: Lanches Especiais"
                  autoFocus
                  required
                />
              </div>
              <div className="modal-foot" style={{ padding: '12px 0 0' }}>
                <button type="button" className="btn" onClick={() => setModalCat(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={ocupadoKey === 'cat-modal'}>
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal Item + Complementos */}
      {modalItem ? (
        <div className="modal-backdrop" onClick={() => setModalItem(null)}>
          <div className="modal-panel wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 16 }}>{modalItem.modo === 'criar' ? 'Novo Item no Cardápio' : `Editar: ${modalItem.nome}`}</h2>
                <span className="pill">{modalItem.plataforma}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {modalItem.payloadRaw ? (
                  <MenuTresPontos
                    titulo="Opções técnicas do item"
                    itens={[
                      {
                        rotulo: modalItem.mostrarJson ? 'Ocultar JSON bruto' : 'Ver JSON técnico do item',
                        aoClicar: () => setModalItem({ ...modalItem, mostrarJson: !modalItem.mostrarJson }),
                      },
                    ]}
                  />
                ) : null}
                <button type="button" className="btn-icon" onClick={() => setModalItem(null)}>
                  <IconeFechar />
                </button>
              </div>
            </div>

            <div className="modal-body">
              <form onSubmit={salvarItemModal} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="grid-2">
                  <div className="field">
                    <label className="field-label">Nome do produto</label>
                    <input className="input" value={modalItem.nome} onChange={(e) => setModalItem({ ...modalItem, nome: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label className="field-label">Categoria</label>
                    <select
                      className="select"
                      value={modalItem.categoriaId}
                      onChange={(e) => setModalItem({ ...modalItem, categoriaId: e.target.value })}
                      required
                    >
                      {catsVisiveis.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid-2">
                  <div className="field">
                    <label className="field-label">Preço (R$)</label>
                    <input className="input" value={modalItem.preco} onChange={(e) => setModalItem({ ...modalItem, preco: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label className="field-label">Código externo / SKU</label>
                    <input className="input" value={modalItem.sku} onChange={(e) => setModalItem({ ...modalItem, sku: e.target.value })} placeholder="Opcional" />
                  </div>
                </div>

                <div className="field">
                  <label className="field-label">Descrição</label>
                  <textarea
                    className="textarea"
                    rows={2}
                    value={modalItem.descricao}
                    onChange={(e) => setModalItem({ ...modalItem, descricao: e.target.value })}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="field-label">Disponibilidade:</span>
                    <button
                      type="button"
                      className={`btn btn-sm ${modalItem.status === 'AVAILABLE' ? 'btn-primary' : ''}`}
                      onClick={() => setModalItem({ ...modalItem, status: 'AVAILABLE' })}
                    >
                      Visível
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${modalItem.status === 'UNAVAILABLE' ? 'btn-danger' : ''}`}
                      onClick={() => setModalItem({ ...modalItem, status: 'UNAVAILABLE' })}
                    >
                      Pausado / Sumir
                    </button>
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={ocupadoKey === 'item-modal'}>
                    {ocupadoKey === 'item-modal' ? 'Salvando na loja...' : 'Salvar Item na Plataforma'}
                  </button>
                </div>
              </form>

              {modalItem.grupos && modalItem.grupos.length > 0 ? (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                  <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Grupos de Complementos e Adicionais</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {modalItem.grupos.map((g: any) => (
                      <div key={g.id} className="card" style={{ padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <strong>{g.name}</strong>
                          <span className="pill">
                            Mín {g.min ?? 0} · Máx {g.max ?? 1}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {(g.options ?? []).map((op: any) => {
                            const ativo = op.status === 'AVAILABLE';
                            const editando = opPrecoEdit?.id === op.id;
                            return (
                              <div
                                key={op.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 8,
                                  padding: '6px 0',
                                  borderTop: '1px solid var(--border)',
                                }}
                              >
                                <span style={{ fontSize: 13 }}>{op.name}</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {editando && opPrecoEdit ? (
                                    <>
                                      <input
                                        className="input input-sm"
                                        style={{ width: 84 }}
                                        value={opPrecoEdit.valor}
                                        onChange={(e) => setOpPrecoEdit({ id: op.id, valor: e.target.value })}
                                      />
                                      <button type="button" className="btn btn-sm btn-primary" onClick={() => salvarPrecoOpcao(op.id)}>
                                        OK
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      onClick={() => setOpPrecoEdit({ id: op.id, valor: String(op.price?.value ?? 0) })}
                                    >
                                      {formatarMoeda(Number(op.price?.value ?? 0))}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={`pill ${ativo ? 'pill-ok' : 'pill-err'}`}
                                    style={{ cursor: 'pointer' }}
                                    disabled={ocupadoKey === `op-${op.id}`}
                                    onClick={() => alternarStatusOpcao(op.id, op.status)}
                                  >
                                    <span className="dot" />
                                    {ativo ? 'Visível' : 'Pausado'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {modalItem.mostrarJson && modalItem.payloadRaw ? (
                <pre className="code-block">{JSON.stringify(modalItem.payloadRaw, null, 2)}</pre>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal Técnico (via 3 pontos) */}
      {modalTecnico ? (
        <div className="modal-backdrop" onClick={() => setModalTecnico(null)}>
          <div className="modal-panel wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 style={{ margin: 0, fontSize: 16 }}>{modalTecnico.titulo}</h2>
              <button type="button" className="btn-icon" onClick={() => setModalTecnico(null)}>
                <IconeFechar />
              </button>
            </div>
            <div className="modal-body">
              <pre className="code-block">{modalTecnico.json}</pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
