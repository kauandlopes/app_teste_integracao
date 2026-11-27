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

  // Modal Item & Complementos (Simples + Pizza + Foto + Sincronizacao multi-canal)
  const [modalItem, setModalItem] = useState<{
    modo: 'criar' | 'editar';
    id?: string;
    productId?: string;
    categoriaId: string;
    plataforma: string;
    tipo: 'DEFAULT' | 'PIZZA';
    nome: string;
    descricao: string;
    sku: string;
    imagem: string;
    preco: string;
    status: 'AVAILABLE' | 'UNAVAILABLE';
    grupos: any[];
    tamanhos: Array<{ externalCode: string; nome: string; preco: string; pedacos: string; fracoes: string }>;
    massas: Array<{ externalCode: string; nome: string; preco: string }>;
    bordas: Array<{ externalCode: string; nome: string; preco: string }>;
    bordaObrigatoria: boolean;
    sabores: Array<{ externalCode: string; nome: string; acrescimo: string }>;
    payloadRaw?: any;
    mostrarJson?: boolean;
  } | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);

  const criarEstadoNovoItem = (categoriaId: string, plataforma: string) => ({
    modo: 'criar' as const,
    categoriaId,
    plataforma,
    tipo: 'DEFAULT' as const,
    nome: '',
    descricao: '',
    sku: '',
    imagem: '',
    preco: '0',
    status: 'AVAILABLE' as const,
    grupos: [] as any[],
    tamanhos: [{ externalCode: 'TAM-G', nome: 'Grande', preco: '55', pedacos: '8', fracoes: '1,2' }],
    massas: [{ externalCode: 'MAS-TR', nome: 'Tradicional', preco: '0' }],
    bordas: [{ externalCode: 'BOR-CAT', nome: 'Catupiry', preco: '8' }],
    bordaObrigatoria: false,
    sabores: [{ externalCode: 'SAB-CAL', nome: 'Calabresa', acrescimo: '0' }],
  });

  // Edição preço complemento dentro do Modal Item
  const [opPrecoEdit, setOpPrecoEdit] = useState<{ id: string; valor: string } | null>(null);

  // Modal Diagnóstico Técnico (via menu 3 pontos)
  const [modalTecnico, setModalTecnico] = useState<{ titulo: string; json: string } | null>(null);

  const syncCanais = useMemo(() => {
    const mapa = new Map<string, Set<string>>();
    const plats = new Set<string>();
    for (const c of categorias) {
      plats.add(c.plataforma);
      for (const it of c.itens) {
        const chave = (it.sku || it.nome || '').trim().toLowerCase();
        if (!chave) continue;
        if (!mapa.has(chave)) mapa.set(chave, new Set());
        mapa.get(chave)!.add(it.plataforma);
      }
    }
    return { mapa, ambasAtivas: plats.has('IFOOD') && plats.has('99FOOD') };
  }, [categorias]);

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
      tipo: it.tipo === 'PIZZA' ? 'PIZZA' : 'DEFAULT',
      nome: it.nome,
      descricao: it.descricao || '',
      sku: it.sku || '',
      imagem: it.imagemUrl || it.payload?.imagemUrl || '',
      preco: String(it.preco ?? 0),
      status: it.status,
      grupos: Array.isArray(it.grupos) ? it.grupos : [],
      tamanhos: [{ externalCode: 'TAM-G', nome: 'Grande', preco: String(it.preco ?? 55), pedacos: '8', fracoes: '1,2' }],
      massas: [{ externalCode: 'MAS-TR', nome: 'Tradicional', preco: '0' }],
      bordas: [{ externalCode: 'BOR-CAT', nome: 'Catupiry', preco: '8' }],
      bordaObrigatoria: false,
      sabores: [{ externalCode: 'SAB-CAL', nome: 'Calabresa', acrescimo: '0' }],
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
                imagem: det.imagePath ?? cur.imagem,
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

  async function uploadFotoArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !modalItem) return;
    setEnviandoFoto(true);
    try {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Falha ao ler imagem.'));
        reader.readAsDataURL(file);
      });
      const plat = modalItem.plataforma === 'AMBOS' ? 'IFOOD' : modalItem.plataforma;
      const res = await erpApi.enviarImagem(dataUri, plat);
      const urlFinal = res.url || res.imagePath || dataUri;
      setModalItem((cur) => (cur ? { ...cur, imagem: urlFinal } : cur));
      notificar('ok', 'Imagem enviada para a plataforma.');
    } catch (err) {
      notificar('erro', err instanceof ApiErro ? err.message : 'Erro ao enviar imagem.');
    } finally {
      setEnviandoFoto(false);
    }
  }

  async function salvarItemModal(e: React.FormEvent) {
    e.preventDefault();
    if (!modalItem) return;
    const preco = Number(modalItem.preco.replace(',', '.'));
    if (!modalItem.nome.trim() || !modalItem.categoriaId || (modalItem.tipo === 'DEFAULT' && !Number.isFinite(preco))) {
      notificar('erro', 'Preencha nome, categoria e preço válido.');
      return;
    }
    setOcupadoKey('item-modal');
    try {
      const alvos = modalItem.plataforma === 'AMBOS' ? ['IFOOD', '99FOOD'] : [modalItem.plataforma];
      for (const plat of alvos) {
        const catAlvo =
          plat === modalItem.plataforma
            ? modalItem.categoriaId
            : categorias.find((c) => c.plataforma === plat)?.id ?? modalItem.categoriaId;
        if (modalItem.tipo === 'PIZZA') {
          const tamanhos = modalItem.tamanhos.map((t) => ({
            externalCode: t.externalCode || t.nome.toLowerCase().replace(/\s+/g, '-'),
            nome: t.nome,
            preco: Number(t.preco.replace(',', '.')) || 0,
            pedacos: Number(t.pedacos) || 8,
            fracoes: t.fracoes
              .split(',')
              .map((n) => Number(n.trim()))
              .filter((n) => n > 0),
          }));
          await erpApi.salvarItem({
            ...(modalItem.id && alvos.length === 1 ? { id: modalItem.id } : {}),
            ...(modalItem.productId && alvos.length === 1 ? { productId: modalItem.productId } : {}),
            plataforma: plat,
            tipo: 'PIZZA',
            categoriaId: catAlvo,
            nome: modalItem.nome.trim(),
            descricao: modalItem.descricao.trim(),
            externalCode: modalItem.sku.trim() || `PZ-${Date.now().toString(36)}`,
            ...(modalItem.imagem ? { imagem: modalItem.imagem } : {}),
            tamanhos,
            massas: modalItem.massas.map((m) => ({
              externalCode: m.externalCode || m.nome,
              nome: m.nome,
              preco: Number(m.preco.replace(',', '.')) || 0,
            })),
            bordas: modalItem.bordas.map((b) => ({
              externalCode: b.externalCode || b.nome,
              nome: b.nome,
              preco: Number(b.preco.replace(',', '.')) || 0,
            })),
            bordaObrigatoria: modalItem.bordaObrigatoria,
            sabores: modalItem.sabores.map((s) => ({
              externalCode: s.externalCode || s.nome,
              nome: s.nome,
              acrescimoPorTamanho: Object.fromEntries(tamanhos.map((t) => [t.externalCode, Number(s.acrescimo.replace(',', '.')) || 0])),
            })),
            extras: modalItem.grupos,
          });
        } else {
          await erpApi.salvarItem({
            ...(modalItem.id && alvos.length === 1 ? { id: modalItem.id } : {}),
            ...(modalItem.productId && alvos.length === 1 ? { productId: modalItem.productId } : {}),
            plataforma: plat,
            tipo: 'DEFAULT',
            categoriaId: catAlvo,
            name: modalItem.nome.trim(),
            nome: modalItem.nome.trim(),
            description: modalItem.descricao.trim(),
            descricao: modalItem.descricao.trim(),
            externalCode: modalItem.sku.trim(),
            sku: modalItem.sku.trim(),
            ...(modalItem.imagem ? { imagem: modalItem.imagem, imagePath: modalItem.imagem } : {}),
            preco,
            status: modalItem.status,
            grupos: modalItem.grupos,
          });
        }
      }
      notificar(
        'ok',
        alvos.length === 2
          ? `"${modalItem.nome}" sincronizado no iFood e na 99Food.`
          : modalItem.modo === 'criar'
            ? `Item "${modalItem.nome}" criado na vitrine.`
            : `Item "${modalItem.nome}" salvo.`,
      );
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
      if (!String(opId).startsWith('op-') && modalItem.modo !== 'criar' && modalItem.plataforma !== 'AMBOS') {
        await erpApi.statusOpcao(opId, novo, modalItem.plataforma);
      }
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
      if (!String(opId).startsWith('op-') && modalItem.modo !== 'criar' && modalItem.plataforma !== 'AMBOS') {
        await erpApi.precoOpcao(opId, valor, modalItem.plataforma);
      }
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
              setModalItem(
                criarEstadoNovoItem(
                  catSelId !== 'TODAS' ? catSelId : catsVisiveis[0]?.id ?? '',
                  filtroPlat === '99FOOD' ? '99FOOD' : 'IFOOD',
                ),
              )
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
                        aoClicar: () => setModalItem(criarEstadoNovoItem(c.id, c.plataforma)),
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
                  const chaveSync = (it.sku || it.nome || '').trim().toLowerCase();
                  const canaisProduto = syncCanais.mapa.get(chaveSync);
                  const nosDois = Boolean(canaisProduto?.has('IFOOD') && canaisProduto?.has('99FOOD'));
                  const totalOpcoes = (it.grupos ?? []).reduce((s: number, g: any) => s + (g.options ?? g.opcoes ?? []).length, 0);
                  return (
                    <tr key={it.id} style={{ opacity: visivel ? 1 : 0.72 }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {it.imagemUrl ? (
                            <img
                              src={it.imagemUrl}
                              alt={it.nome}
                              style={{ width: 38, height: 38, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }}
                            />
                          ) : null}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 600 }}>{it.nome}</span>
                              <span className="pill" style={{ fontSize: 10, padding: '1px 6px' }}>
                                {it.tipo === 'PIZZA' ? 'PIZZA' : 'SIMPLES'}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {it.categoriaNome}
                              {it.sku ? ` · SKU: ${it.sku}` : ''}
                              {it.grupos && it.grupos.length > 0 ? ` · ${it.grupos.length} grupos (${totalOpcoes} opções)` : ''}
                            </div>
                            {it.descricao ? (
                              <div style={{ fontSize: 12, color: 'var(--text-subtle)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {it.descricao}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          <span className="pill">{it.plataforma === '99FOOD' ? '99Food' : 'iFood'}</span>
                          {nosDois ? (
                            <span className="pill pill-ok" style={{ fontSize: 10, padding: '1px 6px' }}>
                              Sincronizado nos 2
                            </span>
                          ) : syncCanais.ambasAtivas ? (
                            <span className="pill pill-warn" style={{ fontSize: 10, padding: '1px 6px' }}>
                              Só {it.plataforma === '99FOOD' ? '99Food' : 'iFood'}
                            </span>
                          ) : null}
                        </div>
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
                    <label className="field-label">Canal de destino</label>
                    <select
                      className="select"
                      value={modalItem.plataforma}
                      onChange={(e) => setModalItem({ ...modalItem, plataforma: e.target.value })}
                      disabled={modalItem.modo === 'editar'}
                    >
                      <option value="IFOOD">iFood</option>
                      <option value="99FOOD">99Food</option>
                      {modalItem.modo === 'criar' ? <option value="AMBOS">Ambos (iFood + 99Food)</option> : null}
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">Tipo do produto</label>
                    <select
                      className="select"
                      value={modalItem.tipo}
                      onChange={(e) => setModalItem({ ...modalItem, tipo: e.target.value === 'PIZZA' ? 'PIZZA' : 'DEFAULT' })}
                    >
                      <option value="DEFAULT">Produto Simples (DEFAULT)</option>
                      <option value="PIZZA">Pizza (Tamanhos, Sabores, Bordas e Massas)</option>
                    </select>
                  </div>
                </div>

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
                          {c.nome} ({c.plataforma})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid-2">
                  {modalItem.tipo === 'DEFAULT' ? (
                    <div className="field">
                      <label className="field-label">Preço (R$)</label>
                      <input className="input" value={modalItem.preco} onChange={(e) => setModalItem({ ...modalItem, preco: e.target.value })} required />
                    </div>
                  ) : (
                    <div className="field">
                      <label className="field-label">Preço</label>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingTop: 8 }}>Definido pelos tamanhos da Pizza abaixo.</div>
                    </div>
                  )}
                  <div className="field">
                    <label className="field-label">Código externo / SKU (chave de unificação entre canais)</label>
                    <input className="input" value={modalItem.sku} onChange={(e) => setModalItem({ ...modalItem, sku: e.target.value })} placeholder="Ex: PZ-CAL-01" />
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

                <div className="field">
                  <label className="field-label">Foto do produto (upload direto para a plataforma ou URL)</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {modalItem.imagem ? (
                      <img src={modalItem.imagem} alt={modalItem.nome || 'Foto'} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)' }} />
                    ) : null}
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 200 }}
                      placeholder="URL ou caminho retornado pelo upload"
                      value={modalItem.imagem}
                      onChange={(e) => setModalItem({ ...modalItem, imagem: e.target.value })}
                    />
                    <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                      {enviandoFoto ? 'Enviando...' : 'Enviar foto'}
                      <input type="file" accept="image/*" style={{ display: 'none' }} disabled={enviandoFoto} onChange={(e) => void uploadFotoArquivo(e)} />
                    </label>
                  </div>
                </div>

                {modalItem.tipo === 'PIZZA' ? (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <strong style={{ fontSize: 13 }}>Configuração de Pizza (iFood e 99Food)</strong>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span className="field-label">Tamanhos</span>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            setModalItem({
                              ...modalItem,
                              tamanhos: [...modalItem.tamanhos, { externalCode: `TAM-${modalItem.tamanhos.length + 1}`, nome: 'Família', preco: '72', pedacos: '12', fracoes: '1,2,3' }],
                            })
                          }
                        >
                          + Tamanho
                        </button>
                      </div>
                      {modalItem.tamanhos.map((t, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 80px 70px 90px auto', gap: 6, marginBottom: 6 }}>
                          <input className="input input-sm" placeholder="Nome" value={t.nome} onChange={(e) => { const n = [...modalItem.tamanhos]; n[idx] = { ...t, nome: e.target.value }; setModalItem({ ...modalItem, tamanhos: n }); }} />
                          <input className="input input-sm" placeholder="SKU" value={t.externalCode} onChange={(e) => { const n = [...modalItem.tamanhos]; n[idx] = { ...t, externalCode: e.target.value }; setModalItem({ ...modalItem, tamanhos: n }); }} />
                          <input className="input input-sm" placeholder="R$" value={t.preco} onChange={(e) => { const n = [...modalItem.tamanhos]; n[idx] = { ...t, preco: e.target.value }; setModalItem({ ...modalItem, tamanhos: n }); }} />
                          <input className="input input-sm" placeholder="Fatias" value={t.pedacos} onChange={(e) => { const n = [...modalItem.tamanhos]; n[idx] = { ...t, pedacos: e.target.value }; setModalItem({ ...modalItem, tamanhos: n }); }} />
                          <input className="input input-sm" placeholder="Frações (1,2)" value={t.fracoes} onChange={(e) => { const n = [...modalItem.tamanhos]; n[idx] = { ...t, fracoes: e.target.value }; setModalItem({ ...modalItem, tamanhos: n }); }} />
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => setModalItem({ ...modalItem, tamanhos: modalItem.tamanhos.filter((_, i) => i !== idx) })}>×</button>
                        </div>
                      ))}
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span className="field-label">Sabores (meio-a-meio)</span>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            setModalItem({
                              ...modalItem,
                              sabores: [...modalItem.sabores, { externalCode: `SAB-${modalItem.sabores.length + 1}`, nome: 'Portuguesa', acrescimo: '0' }],
                            })
                          }
                        >
                          + Sabor
                        </button>
                      </div>
                      {modalItem.sabores.map((s, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 90px auto', gap: 6, marginBottom: 6 }}>
                          <input className="input input-sm" placeholder="Sabor" value={s.nome} onChange={(e) => { const n = [...modalItem.sabores]; n[idx] = { ...s, nome: e.target.value }; setModalItem({ ...modalItem, sabores: n }); }} />
                          <input className="input input-sm" placeholder="SKU" value={s.externalCode} onChange={(e) => { const n = [...modalItem.sabores]; n[idx] = { ...s, externalCode: e.target.value }; setModalItem({ ...modalItem, sabores: n }); }} />
                          <input className="input input-sm" placeholder="Acrésc. R$" value={s.acrescimo} onChange={(e) => { const n = [...modalItem.sabores]; n[idx] = { ...s, acrescimo: e.target.value }; setModalItem({ ...modalItem, sabores: n }); }} />
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => setModalItem({ ...modalItem, sabores: modalItem.sabores.filter((_, i) => i !== idx) })}>×</button>
                        </div>
                      ))}
                    </div>

                    <div className="grid-2">
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span className="field-label">Bordas</span>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
                              <input type="checkbox" checked={modalItem.bordaObrigatoria} onChange={(e) => setModalItem({ ...modalItem, bordaObrigatoria: e.target.checked })} />
                              Obrigatória
                            </label>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => setModalItem({ ...modalItem, bordas: [...modalItem.bordas, { externalCode: `BOR-${modalItem.bordas.length + 1}`, nome: 'Cheddar', preco: '9' }] })}
                            >
                              + Borda
                            </button>
                          </div>
                        </div>
                        {modalItem.bordas.map((b, idx) => (
                          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 80px auto', gap: 6, marginBottom: 6 }}>
                            <input className="input input-sm" placeholder="Borda" value={b.nome} onChange={(e) => { const n = [...modalItem.bordas]; n[idx] = { ...b, nome: e.target.value }; setModalItem({ ...modalItem, bordas: n }); }} />
                            <input className="input input-sm" placeholder="R$" value={b.preco} onChange={(e) => { const n = [...modalItem.bordas]; n[idx] = { ...b, preco: e.target.value }; setModalItem({ ...modalItem, bordas: n }); }} />
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => setModalItem({ ...modalItem, bordas: modalItem.bordas.filter((_, i) => i !== idx) })}>×</button>
                          </div>
                        ))}
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span className="field-label">Massas</span>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setModalItem({ ...modalItem, massas: [...modalItem.massas, { externalCode: `MAS-${modalItem.massas.length + 1}`, nome: 'Fina', preco: '0' }] })}
                          >
                            + Massa
                          </button>
                        </div>
                        {modalItem.massas.map((m, idx) => (
                          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 80px auto', gap: 6, marginBottom: 6 }}>
                            <input className="input input-sm" placeholder="Massa" value={m.nome} onChange={(e) => { const n = [...modalItem.massas]; n[idx] = { ...m, nome: e.target.value }; setModalItem({ ...modalItem, massas: n }); }} />
                            <input className="input input-sm" placeholder="R$" value={m.preco} onChange={(e) => { const n = [...modalItem.massas]; n[idx] = { ...m, preco: e.target.value }; setModalItem({ ...modalItem, massas: n }); }} />
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => setModalItem({ ...modalItem, massas: modalItem.massas.filter((_, i) => i !== idx) })}>×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

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
                    {ocupadoKey === 'item-modal' ? 'Salvando na loja...' : modalItem.plataforma === 'AMBOS' ? 'Salvar nos 2 canais' : 'Salvar Item na Plataforma'}
                  </button>
                </div>
              </form>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>Grupos de Complementos, Adicionais e Opcionais</h3>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      setModalItem({
                        ...modalItem,
                        grupos: [
                          ...modalItem.grupos,
                          { id: `grp-${Date.now().toString(36)}`, name: 'Adicionais', min: 0, max: 3, obrigatorio: false, options: [{ id: `op-${Date.now().toString(36)}`, name: 'Adicional Extra', externalCode: '', status: 'AVAILABLE', price: { value: 5 } }] },
                        ],
                      })
                    }
                  >
                    + Adicionar Grupo
                  </button>
                </div>

                {modalItem.grupos && modalItem.grupos.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {modalItem.grupos.map((g: any, gIdx: number) => (
                      <div key={g.id || gIdx} className="card" style={{ padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                            <input
                              className="input input-sm"
                              style={{ maxWidth: 220, fontWeight: 600 }}
                              value={g.name ?? g.nome ?? ''}
                              onChange={(e) => {
                                const ng = [...modalItem.grupos];
                                ng[gIdx] = { ...g, name: e.target.value, nome: e.target.value };
                                setModalItem({ ...modalItem, grupos: ng });
                              }}
                            />
                            <span className="pill">{Number(g.min ?? 0) > 0 || g.obrigatorio ? 'Obrigatório' : 'Opcional'}</span>
                            <input
                              className="input input-sm"
                              type="number"
                              min={0}
                              style={{ width: 58 }}
                              title="Mínimo"
                              value={g.min ?? 0}
                              onChange={(e) => {
                                const ng = [...modalItem.grupos];
                                ng[gIdx] = { ...g, min: Number(e.target.value) };
                                setModalItem({ ...modalItem, grupos: ng });
                              }}
                            />
                            <input
                              className="input input-sm"
                              type="number"
                              min={1}
                              style={{ width: 58 }}
                              title="Máximo"
                              value={g.max ?? 1}
                              onChange={(e) => {
                                const ng = [...modalItem.grupos];
                                ng[gIdx] = { ...g, max: Number(e.target.value) };
                                setModalItem({ ...modalItem, grupos: ng });
                              }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => {
                                const ng = [...modalItem.grupos];
                                const curOps = Array.isArray(g.options) ? g.options : [];
                                ng[gIdx] = {
                                  ...g,
                                  options: [...curOps, { id: `op-${Date.now().toString(36)}`, name: 'Nova Opção', externalCode: '', status: 'AVAILABLE', price: { value: 0 } }],
                                };
                                setModalItem({ ...modalItem, grupos: ng });
                              }}
                            >
                              + Opção
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => setModalItem({ ...modalItem, grupos: modalItem.grupos.filter((_, idx) => idx !== gIdx) })}
                            >
                              Remover
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {(g.options ?? []).map((op: any) => {
                            const ativo = op.status === 'AVAILABLE';
                            const editando = opPrecoEdit?.id === op.id;
                            return (
                              <div key={op.id} style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
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
                                {Array.isArray(op.subgrupos) && op.subgrupos.length > 0 ? (
                                  <div style={{ marginLeft: 14, marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                                    {op.subgrupos.map((sg: any) => (
                                      <div key={sg.id}>
                                        ↳ {sg.name}: {(sg.options ?? []).map((sop: any) => `${sop.name} (${formatarMoeda(Number(sop.price?.value ?? 0))})`).join(', ')}
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum grupo de adicionais neste produto.</div>
                )}
              </div>

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
