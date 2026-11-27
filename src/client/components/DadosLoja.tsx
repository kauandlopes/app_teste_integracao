import React, { useEffect, useState } from 'react';
import {
  AcaoLoja,
  AlteracaoLoja,
  ApiErro,
  CampoAlterado,
  CanalPublicacao,
  ComandoLoja,
  ConsultaLoja,
  erpApi,
  ErroLoja,
  HorarioDia,
  LojaPlataforma,
  mensagemDe,
  nomeCanal,
  ResultadoLoja,
  Sessao,
  TelefoneLoja,
} from '../api';
import { Confirmacao, Contagem } from './Comuns';
import { IconeAtualizar } from './Icones';

/** Dados e funcionamento da loja nas duas plataformas (loja/dados e loja/funcionamento do Hub). */

type Notificar = (tipo: 'ok' | 'erro', msg: string) => void;

const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const CAMPOS: Record<string, string> = {
  horarios: 'horários',
  tempoPreparoMinutos: 'tempo de preparo',
  telefones: 'telefones',
  feriados: 'feriados',
  imagens: 'fotos',
  categorias: 'categorias da loja',
  aceitePedidos: 'forma de aceite',
  solicitacoesCliente: 'pedidos de cancelamento e reembolso',
  areasEntrega: 'área de entrega',
  nome: 'nome',
  razaoSocial: 'razão social',
  descricao: 'descrição',
  endereco: 'endereço',
  localizacao: 'localização',
  modalidadeEntrega: 'modalidade de entrega',
};
const NESTA_TELA = ['horarios', 'tempoPreparoMinutos', 'telefones'];
const ACOES: Record<AcaoLoja, string> = { ABRIR: 'Abrir a loja', FECHAR: 'Fechar a loja', PAUSAR: 'Pausar pedidos', OCUPADO: 'Ativar modo ocupado', NORMAL: 'Encerrar modo ocupado' };
const ACOES_PADRAO: Record<CanalPublicacao, AcaoLoja[]> = { IFOOD: ['ABRIR', 'FECHAR', 'PAUSAR'], '99FOOD': ['ABRIR', 'FECHAR', 'PAUSAR', 'OCUPADO', 'NORMAL'] };
const ESTADOS: Record<string, [string, string]> = {
  APLICADO: ['Aplicado', 'pill-ok'],
  ENVIADO: ['Enviado, confirmação posterior', 'pill-info'],
  EM_ANALISE: ['Em análise', 'pill-info'],
  PARCIAL: ['Aplicado em parte', 'pill-warn'],
  FALHOU: ['Falhou', 'pill-err'],
  NAO_SUPORTADO: ['Não permitido', 'pill-warn'],
};

const lista = (campos: string[]) => campos.map((c) => CAMPOS[c] ?? c).join(', ');
const doDia = (horarios: HorarioDia[], dia: number) => horarios.find((h) => h.dia === dia)?.faixas ?? [];
const textoFaixas = (faixas: HorarioDia['faixas']) => (faixas.length ? faixas.map((f) => `${f.inicio} às ${f.fim}`).join(', ') : 'fechado');
const textoTelefone = (t: TelefoneLoja) => `+${t.ddi} ${t.numero} (${t.tipo === 'FIXO' ? 'fixo' : 'celular'})`;
/** Horario do iFood vem no relogio da loja, sem fuso: mostra como veio. */
const dataHora = (v?: string | null) => (v ? v.replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d).*$/, '$2/$1 $3') : '');
/** Sem nenhum sucesso o Hub responde com erro e o mesmo detalhe por plataforma. */
const plataformasDoErro = (err: unknown) => (err instanceof ApiErro ? err.payload?.detalhes?.plataformas : undefined);

function AvisoErro({ erro }: { erro: ErroLoja }) {
  return (
    <div className="observacao">
      [{erro.codigo}] {erro.erro} {erro.retryAfterSegundos ? <Contagem segundos={erro.retryAfterSegundos} antes="Pode repetir em" depois="Já pode repetir." /> : null}
    </div>
  );
}

function CartaoLoja({ titulo, loja, consultando }: { titulo: string; loja?: LojaPlataforma; consultando: boolean }) {
  const d = loja?.dados;
  const linha = (rotulo: string, valor: React.ReactNode) => (
    <div className="ficha-linha">
      <span className="field-label">{rotulo}</span>
      <span>{valor || <span className="suave">não informado pela plataforma</span>}</span>
    </div>
  );
  const editaveis = loja?.editaveis ?? [];
  const foraDaTela = editaveis.filter((c) => !NESTA_TELA.includes(c));
  return (
    <div className="card pilha">
      <strong>{titulo}</strong>
      {!loja ? <span className="suave">{consultando ? 'Consultando...' : 'Sem dados desta plataforma.'}</span> : null}
      {loja?.erro ? <AvisoErro erro={loja.erro} /> : null}
      {loja?.falhas?.map((f) => (
        <div className="observacao" key={f.secao}>
          Não foi possível ler {f.secao}: {f.erro}
        </div>
      ))}
      {d ? (
        <>
          {linha('Situação', d.situacao ? [d.situacao.aberta === null ? null : d.situacao.aberta ? 'Aberta' : 'Fechada', d.situacao.titulo, ...(d.situacao.motivos ?? []).map((m) => m.titulo)].filter(Boolean).join(' · ') : null)}
          {d.pausas ? linha('Pausas', d.pausas.length ? d.pausas.map((p) => `${p.descricao || 'Pausa'} (${p.ativa ? 'em vigor' : 'agendada'}, até ${dataHora(p.fim)})`).join('; ') : 'nenhuma') : null}
          {d.modoOcupado ? linha('Modo ocupado', d.modoOcupado.ativo ? `ativo${d.modoOcupado.acrescimoPreparoMinutos ? `, mais ${d.modoOcupado.acrescimoPreparoMinutos} min de preparo` : ''}` : 'desligado') : null}
          {linha(
            'Horários',
            d.horarios ? (
              <span className="semana">
                {DIAS.map((nome, i) => (
                  <span key={nome}>
                    {nome}: {textoFaixas(doDia(d.horarios!, i + 1))}
                  </span>
                ))}
              </span>
            ) : null,
          )}
          {linha('Tempo de preparo', d.tempoPreparoMinutos ? `${d.tempoPreparoMinutos} min` : null)}
          {linha('Telefones', d.telefones?.map(textoTelefone).join(', '))}
          {d.aberturaAutomatica === undefined || d.aberturaAutomatica === null ? null : linha('Abre sozinha no horário', d.aberturaAutomatica ? 'sim' : 'não')}
        </>
      ) : null}
      {loja?.editaveis ? (
        <div className="suave secao">
          <span>Alterável nesta tela: {lista(editaveis.filter((c) => NESTA_TELA.includes(c)))} e funcionamento.</span>
          {foraDaTela.length ? <span>Permitido pela plataforma, fora desta tela: {lista(foraDaTela)}.</span> : null}
          {loja.naoEditaveis?.length ? <span>Não permitido por esta integração: {lista(loja.naoEditaveis)}.</span> : null}
          {loja.observacoes?.length ? (
            <details>
              <summary>Observações da plataforma</summary>
              {loja.observacoes.map((o) => (
                <p key={o}>{o}</p>
              ))}
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Resultado({ resultado }: { resultado: ResultadoLoja }) {
  return (
    <div className="pilha" role="status">
      {Object.entries(resultado.plataformas).map(([plataforma, r]) => {
        // Campos enviados na mesma chamada falham juntos: o motivo aparece uma vez
        const grupos = new Map<string, { nomes: string[]; campo: CampoAlterado }>();
        for (const [nome, campo] of Object.entries(r.campos ?? {})) {
          const chave = `${campo.estado}|${campo.erro?.erro ?? campo.motivo ?? campo.avisos?.join()}`;
          const grupo = grupos.get(chave) ?? { nomes: [], campo };
          grupo.nomes.push(nome);
          grupos.set(chave, grupo);
        }
        return (
          <div className="banner pilha" key={plataforma}>
            <div className="linha">
              <strong>{nomeCanal(plataforma)}</strong>
              <span className={`pill ${ESTADOS[r.estado]?.[1] ?? ''}`}>{ESTADOS[r.estado]?.[0] ?? r.estado}</span>
            </div>
            {r.estado === 'ENVIADO' ? <span>A plataforma aceitou o pedido e aplica em seguida. Consulte de novo em até 2 minutos.</span> : null}
            {r.motivo ? <span>{r.motivo}</span> : null}
            {r.erro ? <AvisoErro erro={r.erro} /> : null}
            {[...grupos.values()].map(({ nomes, campo }) => (
              <div key={nomes.join()}>
                {lista(nomes)}: {ESTADOS[campo.estado]?.[0] ?? campo.estado}
                {campo.motivo ? `. ${campo.motivo}` : ''}
                {campo.erro ? <AvisoErro erro={campo.erro} /> : null}
                {campo.avisos?.map((a) => <div className="suave" key={a}>{a}</div>)}
              </div>
            ))}
            {r.pausa?.fim ? <span>Pausa até {dataHora(r.pausa.fim)}.</span> : null}
            {r.pausasAgendadas?.length ? <span>Pausas agendadas mantidas: {r.pausasAgendadas.length}.</span> : null}
            {r.avisos?.map((a) => <span className="observacao" key={a}>{a}</span>)}
          </div>
        );
      })}
    </div>
  );
}

interface PropsFormulario {
  ativas: CanalPublicacao[];
  consulta: ConsultaLoja | null;
  rotulo: (p: CanalPublicacao) => string;
  notificar: Notificar;
}

/** Envio comum aos dois formularios: resultado por plataforma e mensagem de erro. */
function useEnvio(notificar: Notificar) {
  const [resultado, setResultado] = useState<ResultadoLoja | null>(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function enviar(chamada: () => Promise<ResultadoLoja>): Promise<ResultadoLoja | null> {
    setEnviando(true);
    setErro('');
    setResultado(null);
    try {
      const r = await chamada();
      setResultado(r);
      if (r.ok === false) notificar('erro', 'Aplicado em parte. Veja o resultado por plataforma.');
      else notificar('ok', 'Alteração enviada. Veja o resultado por plataforma.');
      return r;
    } catch (err) {
      const mensagem = mensagemDe(err, 'Não foi possível enviar. Consulte a loja antes de repetir.');
      const plataformas = plataformasDoErro(err);
      if (plataformas) setResultado({ plataformas });
      setErro(mensagem);
      notificar('erro', mensagem);
      return null;
    } finally {
      setEnviando(false);
    }
  }
  return { resultado, erro, setErro, enviando, enviar };
}

function Funcionamento({ ativas, consulta, rotulo, notificar, aoConcluir }: PropsFormulario & { aoConcluir: () => void }) {
  const [alvo, setAlvo] = useState<'TODAS' | CanalPublicacao>(ativas.length > 1 ? 'TODAS' : ativas[0]);
  const [escolhida, setEscolhida] = useState<AcaoLoja>('PAUSAR');
  const [duracaoEscolhida, setDuracao] = useState('30');
  const [ocupadoMin, setOcupadoMin] = useState('60');
  const [acrescimo, setAcrescimo] = useState('15');
  const [automatica, setAutomatica] = useState(true);
  const [pendente, setPendente] = useState<{ comando: ComandoLoja; plataformas: CanalPublicacao[] } | null>(null);
  const { resultado, erro, setErro, enviando, enviar } = useEnvio(notificar);

  const selecionadas = alvo === 'TODAS' ? ativas : [alvo];
  const permite = (p: CanalPublicacao, a: AcaoLoja) => (consulta?.plataformas[p]?.funcionamento ?? ACOES_PADRAO[p]).includes(a);
  const acoes = (Object.keys(ACOES) as AcaoLoja[]).filter((a) => selecionadas.some((p) => permite(p, a)));
  const acao = acoes.includes(escolhida) ? escolhida : acoes[0];
  const aplicaveis = selecionadas.filter((p) => permite(p, acao));
  const com99 = aplicaveis.includes('99FOOD');
  // A 99Food so pausa por 10, 20 ou 30 minutos, ou ate o fim do dia
  const duracoes = com99 ? ['10', '20', '30'] : ['10', '20', '30', '60', '120', '240', '1440'];
  const duracao = duracaoEscolhida === 'DIA' || duracoes.includes(duracaoEscolhida) ? duracaoEscolhida : '30';

  function revisar(e: React.FormEvent) {
    e.preventDefault();
    const comando: ComandoLoja = { acao };
    if (acao === 'PAUSAR') Object.assign(comando, duracao === 'DIA' ? { ateFimDoDia: true } : { duracaoMinutos: Number(duracao) });
    if (acao === 'OCUPADO') {
      const minutos = Number(ocupadoMin);
      const extra = Number(acrescimo);
      if (!Number.isInteger(minutos) || minutos < 1 || minutos > 180) return setErro('Modo ocupado: duração de 1 a 180 minutos.');
      if (!Number.isInteger(extra) || extra < 1 || extra > 30) return setErro('Modo ocupado: acréscimo de preparo de 1 a 30 minutos.');
      Object.assign(comando, { duracaoMinutos: minutos, acrescimoPreparoMinutos: extra });
    }
    if (acao === 'ABRIR' && com99) comando.aberturaAutomatica = automatica;
    setErro('');
    setPendente({ comando, plataformas: aplicaveis });
  }

  async function confirmar() {
    const { comando, plataformas } = pendente!;
    const r = await enviar(() => erpApi.funcionamentoLoja(comando, plataformas.length === 1 ? plataformas[0] : undefined));
    setPendente(null);
    if (r) aoConcluir();
  }

  const efeitos = (c: ComandoLoja, plataformas: CanalPublicacao[]) => {
    const em = (p: CanalPublicacao) => plataformas.includes(p);
    return [
      c.acao === 'PAUSAR' ? (c.ateFimDoDia ? 'Pausa até o fim do dia.' : `Pausa de ${c.duracaoMinutos} minutos.`) : '',
      c.acao === 'OCUPADO' ? `Por ${c.duracaoMinutos} minutos, com mais ${c.acrescimoPreparoMinutos} minutos de preparo.` : '',
      c.acao === 'FECHAR' && em('IFOOD') ? 'No iFood o fechamento é uma pausa de 7 dias. Para manter, use Abrir e Fechar de novo antes de vencer.' : '',
      c.acao === 'FECHAR' && em('99FOOD') ? 'Na 99Food a loja fica fechada até um novo Abrir.' : '',
      c.acao === 'ABRIR' && em('IFOOD') ? 'No iFood as pausas em vigor são removidas. Fora do horário a loja continua fechada.' : '',
    ].filter(Boolean);
  };

  return (
    <div className="card pilha">
      <h3 style={{ margin: 0, fontSize: 15 }}>Funcionamento</h3>
      <form className="linha linha-campos" onSubmit={revisar}>
        <label className="field">
          <span className="field-label">Loja</span>
          <select className="select input-sm" value={alvo} onChange={(e) => setAlvo(e.target.value as 'TODAS' | CanalPublicacao)}>
            {ativas.length > 1 ? <option value="TODAS">iFood e 99Food</option> : null}
            {ativas.map((p) => (
              <option key={p} value={p}>
                {nomeCanal(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Ação</span>
          <select className="select input-sm" value={acao} onChange={(e) => setEscolhida(e.target.value as AcaoLoja)}>
            {acoes.map((a) => (
              <option key={a} value={a}>
                {ACOES[a]}
                {permite('IFOOD', a) ? '' : ' (só 99Food)'}
              </option>
            ))}
          </select>
        </label>
        {acao === 'PAUSAR' ? (
          <label className="field">
            <span className="field-label">Duração</span>
            <select className="select input-sm" value={duracao} onChange={(e) => setDuracao(e.target.value)}>
              {duracoes.map((d) => (
                <option key={d} value={d}>
                  {Number(d) < 60 ? `${d} minutos` : `${Number(d) / 60} h`}
                </option>
              ))}
              <option value="DIA">Até o fim do dia</option>
            </select>
          </label>
        ) : null}
        {acao === 'OCUPADO' ? (
          <>
            <label className="field">
              <span className="field-label">Duração (min)</span>
              <input className="input input-sm" inputMode="numeric" value={ocupadoMin} onChange={(e) => setOcupadoMin(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Preparo a mais (min)</span>
              <input className="input input-sm" inputMode="numeric" value={acrescimo} onChange={(e) => setAcrescimo(e.target.value)} />
            </label>
          </>
        ) : null}
        {acao === 'ABRIR' && com99 ? (
          <label className="chave">
            <input type="checkbox" checked={automatica} onChange={(e) => setAutomatica(e.target.checked)} />
            99Food: abrir sozinha no horário
          </label>
        ) : null}
        <button type="submit" className="btn btn-sm btn-primary" disabled={enviando}>
          Revisar e enviar
        </button>
      </form>
      {erro ? (
        <div className="banner banner-err" role="alert">
          {erro}
        </div>
      ) : null}
      {resultado ? <Resultado resultado={resultado} /> : null}
      {pendente ? (
        <Confirmacao
          titulo={`${ACOES[pendente.comando.acao]}?`}
          confirmar={ACOES[pendente.comando.acao]}
          perigo={pendente.comando.acao === 'FECHAR' || pendente.comando.acao === 'PAUSAR'}
          ocupado={enviando}
          aoConfirmar={() => void confirmar()}
          aoCancelar={() => setPendente(null)}
        >
          {pendente.plataformas.map((p) => (
            <strong key={p}>{rotulo(p)}</strong>
          ))}
          {efeitos(pendente.comando, pendente.plataformas).map((t) => (
            <span key={t}>{t}</span>
          ))}
          {selecionadas
            .filter((p) => !pendente.plataformas.includes(p))
            .map((p) => (
              <span className="suave" key={p}>
                {nomeCanal(p)} não tem esta ação e não será alterado.
              </span>
            ))}
        </Confirmacao>
      ) : null}
    </div>
  );
}

type Semana = HorarioDia['faixas'][];
const paraSemana = (horarios?: HorarioDia[] | null): Semana => DIAS.map((_, i) => doDia(horarios ?? [], i + 1).map((f) => ({ ...f })));
const hora = (t: string) => t.trim().replace(/^(\d):/, '0$1:');
const INICIO = /^([01]\d|2[0-3]):[0-5]\d$/;
const FIM = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const normalizarTelefones = (t: TelefoneLoja[]) => t.map((x) => ({ ddi: x.ddi.replace(/\D/g, ''), numero: x.numero.replace(/\D/g, ''), tipo: x.tipo }));

function Alteracao({ ativas, consulta, rotulo, notificar, versao }: PropsFormulario & { versao: number }) {
  const [desmarcadas, setDesmarcadas] = useState<CanalPublicacao[]>([]);
  const [comHorarios, setComHorarios] = useState(false);
  const [fonte, setFonte] = useState<CanalPublicacao>('IFOOD');
  // null = o operador ainda nao editou: mostra o que a plataforma informou
  const [semanaEditada, setSemana] = useState<Semana | null>(null);
  const [preparoEditado, setPreparo] = useState<string | null>(null);
  const [telefonesEditados, setTelefones] = useState<TelefoneLoja[] | null>(null);
  /** Enviado com sucesso e ainda nao relido: a plataforma demora a devolver o valor novo. */
  const [aplicado, setAplicado] = useState<{ preparo?: string; telefones?: TelefoneLoja[] }>({});
  const [pendente, setPendente] = useState<{ dados: AlteracaoLoja; plataformas: CanalPublicacao[] } | null>(null);
  const { resultado, erro, setErro, enviando, enviar } = useEnvio(notificar);
  useEffect(() => setAplicado({}), [versao]);

  const tem99 = ativas.includes('99FOOD');
  const d99 = consulta?.plataformas['99FOOD']?.dados;
  const fontes = ativas.filter((p) => consulta?.plataformas[p]?.dados?.horarios);
  const fonteAtual = fontes.includes(fonte) ? fonte : fontes[0];
  const semana = semanaEditada ?? paraSemana(fonteAtual ? consulta?.plataformas[fonteAtual]?.dados?.horarios : null);
  const basePreparo = aplicado.preparo ?? String(d99?.tempoPreparoMinutos ?? '');
  const preparo = preparoEditado ?? basePreparo;
  const baseTelefones = normalizarTelefones(aplicado.telefones ?? d99?.telefones ?? []);
  const telefones = telefonesEditados ?? baseTelefones;
  const marcadas = ativas.filter((p) => !desmarcadas.includes(p));

  const mudarDia = (dia: number, faixas: HorarioDia['faixas']) => setSemana(semana.map((f, i) => (i === dia ? faixas : f)));
  const mudarTelefone = (i: number, parte: Partial<TelefoneLoja>) => setTelefones(telefones.map((t, j) => (j === i ? { ...t, ...parte } : t)));

  function montar(): { dados: AlteracaoLoja; plataformas: CanalPublicacao[] } | string {
    const dados: AlteracaoLoja = {};
    if (!marcadas.length) return 'Marque pelo menos uma plataforma.';
    if (comHorarios) {
      const dias = semana.map((faixas, i) => ({ dia: i + 1, faixas: faixas.map((f) => ({ inicio: hora(f.inicio), fim: hora(f.fim) })) })).filter((d) => d.faixas.length);
      const ruim = dias.find((d) => d.faixas.some((f) => !INICIO.test(f.inicio) || !FIM.test(f.fim) || f.inicio === f.fim));
      if (ruim) return `${DIAS[ruim.dia - 1]}: use horários no formato 11:00, com início diferente do fim.`;
      if (!dias.length) return 'Informe ao menos uma faixa de horário. Para fechar a loja, use Funcionamento.';
      dados.horarios = dias;
    }
    if (preparoEditado !== null && preparo.trim() && preparo.trim() !== basePreparo) {
      const minutos = Number(preparo);
      if (!Number.isInteger(minutos) || minutos < 1 || minutos > 180) return 'Tempo de preparo: de 1 a 180 minutos.';
      dados.tempoPreparoMinutos = minutos;
    }
    const novos = normalizarTelefones(telefones);
    if (telefonesEditados !== null && JSON.stringify(novos) !== JSON.stringify(baseTelefones)) {
      if (!novos.length) return 'A 99Food exige pelo menos um telefone.';
      if (novos.some((t) => !/^[1-9]\d{0,3}$/.test(t.ddi) || !/^[1-9]\d{7,12}$/.test(t.numero))) return 'Telefone: informe o DDI e o número com DDD, somente dígitos.';
      dados.telefones = novos;
    }
    if (!Object.keys(dados).length) return 'Nada foi alterado.';
    const so99 = dados.tempoPreparoMinutos !== undefined || !!dados.telefones;
    if (so99 && !marcadas.includes('99FOOD')) return 'Tempo de preparo e telefones são da 99Food: marque a 99Food ou desfaça essas mudanças.';
    return { dados, plataformas: dados.horarios ? marcadas : ['99FOOD'] };
  }

  function revisar(e: React.FormEvent) {
    e.preventDefault();
    const r = montar();
    if (typeof r === 'string') return setErro(r);
    setErro('');
    setPendente(r);
  }

  async function confirmar() {
    const { dados, plataformas } = pendente!;
    const r = await enviar(() => erpApi.alterarLoja(dados, plataformas.length === 1 ? plataformas[0] : undefined));
    setPendente(null);
    if (!r) return;
    const entrou = (p: CanalPublicacao, campo: string) => r.plataformas[p]?.campos?.[campo]?.estado === 'APLICADO';
    if (dados.horarios && plataformas.every((p) => entrou(p, 'horarios'))) setComHorarios(false);
    if (dados.tempoPreparoMinutos !== undefined && entrou('99FOOD', 'tempoPreparoMinutos')) {
      setAplicado((a) => ({ ...a, preparo: String(dados.tempoPreparoMinutos) }));
      setPreparo(null);
    }
    if (dados.telefones && entrou('99FOOD', 'telefones')) {
      setAplicado((a) => ({ ...a, telefones: dados.telefones }));
      setTelefones(null);
    }
  }

  return (
    <form className="card pilha" onSubmit={revisar} noValidate>
      <h3 style={{ margin: 0, fontSize: 15 }}>Alterar dados</h3>
      <div className="linha">
        <span className="field-label">Enviar para</span>
        {ativas.map((p) => (
          <label className="chave" key={p}>
            <input type="checkbox" checked={!desmarcadas.includes(p)} onChange={(e) => setDesmarcadas(e.target.checked ? desmarcadas.filter((x) => x !== p) : [...desmarcadas, p])} />
            {nomeCanal(p)}
          </label>
        ))}
      </div>

      <section className="secao">
        <label className="chave" style={{ alignSelf: 'flex-start' }}>
          <input type="checkbox" checked={comHorarios} onChange={(e) => setComHorarios(e.target.checked)} />
          Alterar horários de funcionamento
        </label>
        {comHorarios ? (
          <>
            <p className="suave">Substitui a semana inteira: dia sem faixa fica fechado. Fim menor que o início passa da meia-noite; 24:00 é o fim do dia.</p>
            {fontes.length > 1 ? (
              <label className="field campo-curto">
                <span className="field-label">Preencher com os horários de</span>
                <select
                  className="select input-sm"
                  value={fonteAtual}
                  onChange={(e) => {
                    setFonte(e.target.value as CanalPublicacao);
                    setSemana(null);
                  }}
                >
                  {fontes.map((p) => (
                    <option key={p} value={p}>
                      {nomeCanal(p)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {!fontes.length ? <div className="banner banner-warn">Os horários atuais não foram lidos. Preencha a semana inteira antes de enviar.</div> : null}
            {semana.map((faixas, dia) => (
              <div className="dia-horario" key={DIAS[dia]}>
                <strong>{DIAS[dia]}</strong>
                <div className="pilha">
                  {faixas.map((f, i) => (
                    <div className="faixa" key={i}>
                      <input className="input input-sm" aria-label={`${DIAS[dia]}, início`} placeholder="11:00" maxLength={5} value={f.inicio} onChange={(e) => mudarDia(dia, faixas.map((x, j) => (j === i ? { ...x, inicio: e.target.value } : x)))} />
                      <span className="suave">às</span>
                      <input className="input input-sm" aria-label={`${DIAS[dia]}, fim`} placeholder="23:00" maxLength={5} value={f.fim} onChange={(e) => mudarDia(dia, faixas.map((x, j) => (j === i ? { ...x, fim: e.target.value } : x)))} />
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => mudarDia(dia, faixas.filter((_, j) => j !== i))}>
                        Remover
                      </button>
                    </div>
                  ))}
                  <div className="linha">
                    {!faixas.length ? <span className="suave">Fechado</span> : null}
                    {faixas.length < 10 ? (
                      <button type="button" className="btn btn-sm" onClick={() => mudarDia(dia, [...faixas, { inicio: '', fim: '' }])}>
                        Adicionar faixa
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : null}
      </section>

      {tem99 ? (
        <section className="secao">
          <h3>Somente 99Food</h3>
          <label className="field campo-curto">
            <span className="field-label">Tempo de preparo (min)</span>
            <input className="input input-sm" inputMode="numeric" placeholder="não informado" value={preparo} onChange={(e) => setPreparo(e.target.value)} />
          </label>
          <span className="field-label">Telefones (a lista enviada substitui a atual)</span>
          {telefones.map((t, i) => (
            <div className="telefone" key={i}>
              <input className="input input-sm" aria-label="DDI" inputMode="numeric" value={t.ddi} onChange={(e) => mudarTelefone(i, { ddi: e.target.value })} />
              <input className="input input-sm" aria-label="Número com DDD" inputMode="numeric" placeholder="DDD e número" value={t.numero} onChange={(e) => mudarTelefone(i, { numero: e.target.value })} />
              <select className="select input-sm" aria-label="Tipo" value={t.tipo} onChange={(e) => mudarTelefone(i, { tipo: e.target.value as TelefoneLoja['tipo'] })}>
                <option value="CELULAR">Celular</option>
                <option value="FIXO">Fixo</option>
              </select>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setTelefones(telefones.filter((_, j) => j !== i))}>
                Remover
              </button>
            </div>
          ))}
          {telefones.length < 5 ? (
            <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setTelefones([...telefones, { ddi: '55', numero: '', tipo: 'CELULAR' }])}>
              Adicionar telefone
            </button>
          ) : null}
        </section>
      ) : null}

      {erro ? (
        <div className="banner banner-err" role="alert">
          {erro}
        </div>
      ) : null}
      <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={enviando}>
        Revisar e enviar
      </button>
      <span className="suave">A 99Food aceita 1 alteração de dados e horários por minuto: envie tudo junto.</span>
      {resultado ? <Resultado resultado={resultado} /> : null}
      {pendente ? (
        <Confirmacao titulo="Enviar alteração da loja?" confirmar="Confirmar e enviar" ocupado={enviando} aoConfirmar={() => void confirmar()} aoCancelar={() => setPendente(null)}>
          {pendente.plataformas.map((p) => (
            <strong key={p}>{rotulo(p)}</strong>
          ))}
          {pendente.dados.horarios ? (
            <div className="semana">
              <span className="field-label">Novos horários (semana inteira)</span>
              {DIAS.map((nome, i) => (
                <span key={nome}>
                  {nome}: {textoFaixas(doDia(pendente.dados.horarios!, i + 1))}
                </span>
              ))}
            </div>
          ) : null}
          {pendente.dados.tempoPreparoMinutos ? <span>Tempo de preparo na 99Food: {pendente.dados.tempoPreparoMinutos} min</span> : null}
          {pendente.dados.telefones ? <span>Telefones na 99Food: {pendente.dados.telefones.map(textoTelefone).join(', ')}</span> : null}
        </Confirmacao>
      ) : null}
    </form>
  );
}

export function DadosLoja({ sessao, notificar, aoAtualizarStatusLoja }: { sessao: Sessao; notificar: Notificar; aoAtualizarStatusLoja: () => Promise<void> }) {
  const lojaDe = (p: CanalPublicacao) => sessao.lojas.find((l) => l.plataforma === p && l.estado === 'ATIVA');
  const ativas = (['IFOOD', '99FOOD'] as const).filter(lojaDe);
  const disponivel = !!sessao.cnpj && sessao.temTokenConexao && !sessao.conexaoEncerrada && ativas.length > 0;
  const [consulta, setConsulta] = useState<ConsultaLoja | null>(null);
  const [versao, setVersao] = useState(0);
  const [erro, setErro] = useState('');
  const [consultando, setConsultando] = useState(false);
  const rotulo = (p: CanalPublicacao) => `${nomeCanal(p)}: ${lojaDe(p)?.nome || consulta?.plataformas[p]?.loja?.nome || lojaDe(p)?.loja || ''}`;

  /** Plataforma que nao respondeu mantem os valores da consulta anterior, com o erro ao lado. */
  const receber = (plataformas: ConsultaLoja['plataformas']) => {
    setConsulta((anterior) => ({
      plataformas: Object.fromEntries(Object.entries(plataformas).map(([p, l]) => [p, { ...l, dados: l.dados ?? anterior?.plataformas[p as CanalPublicacao]?.dados ?? null }])),
    }));
    setVersao((v) => v + 1);
  };

  async function consultar() {
    setConsultando(true);
    setErro('');
    try {
      receber((await erpApi.dadosLoja()).plataformas);
    } catch (err) {
      setErro(mensagemDe(err, 'Não foi possível consultar a loja.'));
      const parcial = plataformasDoErro(err);
      if (parcial) receber(parcial);
    } finally {
      setConsultando(false);
    }
  }

  // Uma consulta ao abrir a tela; depois so no clique (a 99Food limita a 1 por minuto)
  useEffect(() => {
    if (disponivel) void consultar();
  }, [disponivel]);

  if (!disponivel) return <div className="card vazio">Conecte o CNPJ e vincule o iFood ou a 99Food em "Lojas e operação" para ver e alterar os dados da loja.</div>;

  const props = { ativas, consulta, rotulo, notificar };
  return (
    <div className="pilha">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Dados da loja</h2>
          <span className="suave">Toda alteração vale na loja real. A 99Food aceita 1 consulta por minuto.</span>
        </div>
        <button type="button" className="btn btn-sm" disabled={consultando} onClick={() => void consultar()}>
          <IconeAtualizar size={14} /> {consultando ? 'Consultando...' : 'Consultar de novo'}
        </button>
      </div>
      {erro ? (
        <div className="banner banner-err" role="alert">
          {erro}
        </div>
      ) : null}
      <div className="grid-2">
        {ativas.map((p) => (
          <CartaoLoja key={p} titulo={rotulo(p)} loja={consulta?.plataformas[p]} consultando={consultando} />
        ))}
      </div>
      <Funcionamento {...props} aoConcluir={() => void aoAtualizarStatusLoja()} />
      <Alteracao {...props} versao={versao} />
    </div>
  );
}
