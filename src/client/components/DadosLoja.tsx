import React, { useEffect, useRef, useState } from 'react';
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
import { erroDoDia, normalizarHora } from '../../shared/horarios';
import { Confirmacao, Contagem, Mudanca, useAvisoDeSaida } from './Comuns';
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
const textoFaixas = (faixas: HorarioDia['faixas']) => (faixas.length ? [...faixas].sort((a, b) => a.inicio.localeCompare(b.inicio)).map((f) => `${f.inicio} às ${f.fim}`).join(', ') : 'fechado');
const horaCurta = (v: number | string) => new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const textoTelefones = (t: TelefoneLoja[]) => (t.length ? t.map(textoTelefone).join(', ') : 'não informado');
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

/** Loja como a tela a guarda: quando foi consultada e se os valores sao de uma consulta anterior. */
type LojaLida = LojaPlataforma & { consultadoEm?: number; anterior?: boolean };
type Consulta = { plataformas: Partial<Record<CanalPublicacao, LojaLida>> };

function CartaoLoja({ titulo, loja, consultando }: { titulo: string; loja?: LojaLida; consultando: boolean }) {
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
      {d && loja.consultadoEm ? (
        <span className={loja.anterior ? 'observacao' : 'suave'}>
          {loja.anterior
            ? `Sem resposta agora: abaixo, a consulta das ${horaCurta(loja.consultadoEm)}.`
            : loja.lidoEm
              ? `Leitura guardada: a plataforma respondeu às ${horaCurta(loja.lidoEm)}.`
              : `Consultado às ${horaCurta(loja.consultadoEm)}.`}
        </span>
      ) : null}
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
        /* Recolhido: o Hub informa por plataforma o que e editavel (editaveis, naoEditaveis, observacoes) */
        <details className="suave secao">
          <summary>O que pode ser alterado</summary>
          <p>Nesta tela: {lista(editaveis.filter((c) => NESTA_TELA.includes(c)))} e funcionamento.</p>
          {foraDaTela.length ? <p>Pela API, fora desta tela: {lista(foraDaTela)}.</p> : null}
          {loja.naoEditaveis?.length ? <p>Não permitido: {lista(loja.naoEditaveis)}.</p> : null}
          {loja.observacoes?.map((o) => (
            <p key={o}>{o}</p>
          ))}
        </details>
      ) : null}
    </div>
  );
}

function Resultado({ resultado }: { resultado: ResultadoLoja }) {
  return (
    <div className="pilha" role="status">
      {/* Os quadros no alto sao da ultima consulta: a plataforma demora a devolver o valor novo */}
      <span className="suave">Resultado do último envio</span>
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
            {/* ENVIADO (99Food): aceito, aplicado em seguida; a situacao final chega pelo evento shopStatus */}
            {r.estado === 'ENVIADO' ? <span>Consulte de novo em até 2 minutos.</span> : null}
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
  consulta: Consulta | null;
  rotulo: (p: CanalPublicacao) => string;
  notificar: Notificar;
}

/** Envio comum aos dois formularios: resultado por plataforma, mensagem de erro e espera pedida pela plataforma. */
function useEnvio(notificar: Notificar) {
  const [resultado, setResultado] = useState<ResultadoLoja | null>(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  /** Ate quando cada plataforma pediu para esperar. */
  const [esperas, setEsperas] = useState<Partial<Record<CanalPublicacao, number>>>({});
  function receber(r: ResultadoLoja) {
    setResultado(r);
    setEsperas((atuais) => {
      const novas = { ...atuais };
      for (const [p, v] of Object.entries(r.plataformas)) {
        const segundos = Math.max(0, v.erro?.retryAfterSegundos ?? 0, ...Object.values(v.campos ?? {}).map((c) => c.erro?.retryAfterSegundos ?? 0));
        if (segundos) novas[p as CanalPublicacao] = Date.now() + segundos * 1000;
        else delete novas[p as CanalPublicacao];
      }
      return novas;
    });
  }
  async function enviar(chamada: () => Promise<ResultadoLoja>): Promise<ResultadoLoja | null> {
    setEnviando(true);
    setErro('');
    setResultado(null);
    try {
      const r = await chamada();
      receber(r);
      if (r.ok === false) notificar('erro', 'Aplicado em parte. Veja o resultado por plataforma.');
      else notificar('ok', 'Alteração enviada. Veja o resultado por plataforma.');
      return r;
    } catch (err) {
      const mensagem = mensagemDe(err, 'Não foi possível enviar. Consulte a loja antes de repetir.');
      const plataformas = plataformasDoErro(err);
      if (plataformas) receber({ plataformas });
      setErro(mensagem);
      notificar('erro', mensagem);
      return null;
    } finally {
      setEnviando(false);
    }
  }
  /** Aviso no dialogo de confirmacao enquanto a plataforma escolhida ainda pede espera. */
  const avisoDeEspera = (plataformas: CanalPublicacao[]) =>
    plataformas.map((p) => {
      const segundos = Math.ceil(((esperas[p] ?? 0) - Date.now()) / 1000);
      return segundos > 0 ? (
        <span className="observacao" key={p}>
          <Contagem segundos={segundos} antes={`${nomeCanal(p)} pediu espera. Pode enviar em`} depois={`${nomeCanal(p)}: espera encerrada.`} />
        </span>
      ) : null;
    });
  return { resultado, erro, setErro, enviando, enviar, avisoDeEspera };
}

function Funcionamento({ ativas, consulta, rotulo, notificar, aoConcluir }: PropsFormulario & { aoConcluir: () => void }) {
  const [alvo, setAlvo] = useState<'TODAS' | CanalPublicacao>(ativas.length > 1 ? 'TODAS' : ativas[0]);
  const [escolhida, setEscolhida] = useState<AcaoLoja>('PAUSAR');
  const [duracaoEscolhida, setDuracao] = useState('30');
  const [ocupadoMin, setOcupadoMin] = useState('60');
  const [acrescimo, setAcrescimo] = useState('15');
  const [automatica, setAutomatica] = useState(true);
  const [pendente, setPendente] = useState<{ comando: ComandoLoja; plataformas: CanalPublicacao[] } | null>(null);
  const { resultado, erro, setErro, enviando, enviar, avisoDeEspera } = useEnvio(notificar);

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

  /** O que a ultima consulta informou e o que passa a valer, por plataforma. */
  const mudancaEm = (c: ComandoLoja, p: CanalPublicacao) => {
    const d = consulta?.plataformas[p]?.dados;
    const emVigor = d?.pausas?.filter((x) => x.ativa !== false).length ?? 0;
    if (c.acao === 'OCUPADO' || c.acao === 'NORMAL') {
      return {
        rotulo: 'Modo ocupado',
        de: d?.modoOcupado ? (d.modoOcupado.ativo ? 'ativo' : 'desligado') : 'não consultado',
        para: c.acao === 'NORMAL' ? 'desligado' : `ativo por ${c.duracaoMinutos} minutos, com mais ${c.acrescimoPreparoMinutos} minutos de preparo`,
        nota: '',
      };
    }
    const aberta = d?.situacao?.aberta;
    const de = [aberta === true ? 'aberta' : aberta === false ? 'fechada' : (d?.situacao?.titulo ?? 'não consultada'), emVigor ? `${emVigor} pausa(s)` : ''].filter(Boolean).join(', ');
    const ifood = p === 'IFOOD';
    const textos: Record<'ABRIR' | 'FECHAR' | 'PAUSAR', [string, string]> = {
      ABRIR: ifood
        ? ['aberta dentro do horário', 'No iFood as pausas em vigor são removidas. Fora do horário a loja continua fechada.']
        : ['aberta', `${c.aberturaAutomatica === false ? 'Não abre' : 'Abre'} sozinha no horário. A 99Food confirma a situação depois.`],
      FECHAR: ifood
        ? ['fechada por 7 dias', 'No iFood o fechamento é uma pausa de 7 dias. Para manter, use Abrir e Fechar de novo antes de vencer.']
        : ['fechada', 'Na 99Food a loja fica fechada até um novo Abrir.'],
      PAUSAR: [c.ateFimDoDia ? 'pausada até o fim do dia' : `pausada por ${c.duracaoMinutos} minutos`, ''],
    };
    return { rotulo: 'Situação', de, para: textos[c.acao][0], nota: textos[c.acao][1] };
  };

  return (
    <div className="card pilha">
      <h3 style={{ margin: 0, fontSize: 15 }}>Funcionamento</h3>
      <form className="linha linha-campos" onSubmit={revisar} onChange={() => setErro('')}>
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
          Revisar ação
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
          {pendente.plataformas.map((p) => {
            const m = mudancaEm(pendente.comando, p);
            const lida = consulta?.plataformas[p]?.consultadoEm;
            return (
              <div className="bloco-loja" key={p}>
                <strong>{rotulo(p)}</strong>
                <Mudanca rotulo={`${m.rotulo}${lida ? ` (consulta das ${horaCurta(lida)})` : ''}`} de={m.de} para={m.para} />
                {m.nota ? <span>{m.nota}</span> : null}
              </div>
            );
          })}
          {avisoDeEspera(pendente.plataformas)}
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
const normalizarTelefones = (t: TelefoneLoja[]) => t.map((x) => ({ ddi: x.ddi.replace(/\D/g, ''), numero: x.numero.replace(/\D/g, ''), tipo: x.tipo }));
const COPIAS: Array<[string, string]> = [
  ['0123456', 'Todos os dias'],
  ['01234', 'Segunda a sexta'],
  ['56', 'Sábado e domingo'],
  ...DIAS.map((nome, i): [string, string] => [String(i), nome]),
];

/** Semana editavel: dia fechado, copia entre dias com desfazer e erro no proprio dia. */
function EditorSemana({ semana, revisado, mudar }: { semana: Semana; revisado: boolean; mudar: (s: Semana) => void }) {
  /** Faixas de um dia fechado voltam se o operador reabrir. */
  const guardadas = useRef<Semana>([]);
  const [copia, setCopia] = useState<{ texto: string; antes: Semana; depois: Semana } | null>(null);
  const mudarDia = (dia: number, faixas: HorarioDia['faixas']) => mudar(semana.map((f, i) => (i === dia ? faixas : f)));
  const mudarHora = (dia: number, i: number, parte: { inicio?: string; fim?: string }) => mudarDia(dia, semana[dia].map((x, j) => (j === i ? { ...x, ...parte } : x)));

  function abrirOuFechar(dia: number, aberto: boolean) {
    if (!aberto) guardadas.current[dia] = semana[dia];
    mudarDia(dia, aberto ? (guardadas.current[dia] ?? [{ inicio: '', fim: '' }]) : []);
  }

  function copiar(origem: number, alvos: string) {
    const destinos = [...alvos].map(Number).filter((d) => d !== origem);
    if (!destinos.length) return;
    const depois = semana.map((f, i) => (destinos.includes(i) ? semana[origem].map((x) => ({ ...x })) : f));
    setCopia({ texto: `${DIAS[origem]} (${textoFaixas(semana[origem])}) copiado para ${destinos.map((d) => DIAS[d]).join(', ')}.`, antes: semana, depois });
    mudar(depois);
  }

  const fechados = DIAS.filter((_, i) => !semana[i].length);

  return (
    <>
      {semana.map((faixas, dia) => {
        const completo = faixas.every((f) => f.inicio.length >= 4 && f.fim.length >= 4);
        const erro = revisado || completo ? erroDoDia(faixas) : '';
        return (
          <div className="dia-horario" key={DIAS[dia]}>
            <div className="dia-nome">
              <strong>{DIAS[dia]}</strong>
              <label className="chave">
                <input type="checkbox" aria-label={`${DIAS[dia]} aberto`} checked={faixas.length > 0} onChange={(e) => abrirOuFechar(dia, e.target.checked)} />
                Aberto
              </label>
            </div>
            <div className="pilha">
              {faixas.map((f, i) => (
                <div className="faixa" key={i}>
                  {(['inicio', 'fim'] as const).map((campo) => (
                    <React.Fragment key={campo}>
                      {campo === 'fim' ? <span className="suave">às</span> : null}
                      <input
                        className="input input-sm"
                        aria-label={`${DIAS[dia]}, ${campo === 'inicio' ? 'início' : 'fim'}`}
                        aria-invalid={!!erro}
                        inputMode="numeric"
                        placeholder={campo === 'inicio' ? '11:00' : '23:00'}
                        maxLength={5}
                        value={f[campo]}
                        onChange={(e) => mudarHora(dia, i, { [campo]: e.target.value })}
                        onBlur={() => {
                          const completa = normalizarHora(f[campo]);
                          if (completa !== f[campo]) mudarHora(dia, i, { [campo]: completa });
                        }}
                      />
                    </React.Fragment>
                  ))}
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => mudarDia(dia, faixas.filter((_, j) => j !== i))}>
                    Remover
                  </button>
                </div>
              ))}
              <div className="linha">
                {!faixas.length ? <span className="observacao">Fechado o dia todo</span> : null}
                {faixas.length && faixas.length < 10 ? (
                  <button type="button" className="btn btn-sm" onClick={() => mudarDia(dia, [...faixas, { inicio: '', fim: '' }])}>
                    Adicionar faixa
                  </button>
                ) : null}
                <select className="select input-sm copiar-dia" aria-label={`Copiar ${DIAS[dia]} para`} value="" onChange={(e) => copiar(dia, e.target.value)}>
                  <option value="">Copiar para...</option>
                  {COPIAS.filter(([v]) => v !== String(dia)).map(([v, nome]) => (
                    <option key={v} value={v}>
                      {nome}
                    </option>
                  ))}
                </select>
              </div>
              {erro ? (
                <span className="observacao" role="alert">
                  {DIAS[dia]}: {erro}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
      {copia && copia.depois === semana ? (
        <div className="banner linha" role="status">
          <span style={{ flex: 1, minWidth: 200 }}>{copia.texto}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              mudar(copia.antes);
              setCopia(null);
            }}
          >
            Desfazer cópia
          </button>
        </div>
      ) : null}
      {fechados.length === 7 ? (
        <div className="banner banner-warn">Todos os dias estão fechados, e uma semana vazia não é enviada. Para fechar a loja, use Funcionamento.</div>
      ) : fechados.length ? (
        <div className="banner banner-warn">Ao enviar, a loja fica fechada em: {fechados.join(', ')}.</div>
      ) : null}
    </>
  );
}

/** Enviado com sucesso e ainda nao relido: a plataforma demora a devolver o valor novo. */
type Aplicado = Partial<Record<CanalPublicacao, { em: number; horarios?: HorarioDia[]; preparo?: string; telefones?: TelefoneLoja[] }>>;

function Alteracao({ ativas, consulta, rotulo, notificar, versao, aoMudarRascunho }: PropsFormulario & { versao: number; aoMudarRascunho: (tem: boolean) => void }) {
  const [desmarcadas, setDesmarcadas] = useState<CanalPublicacao[]>([]);
  const [comHorarios, setComHorarios] = useState(false);
  const [fonte, setFonte] = useState<CanalPublicacao>('IFOOD');
  const [trocarFonte, setTrocarFonte] = useState<CanalPublicacao | null>(null);
  const [revisado, setRevisado] = useState(false);
  // null = o operador ainda nao editou: mostra o que a plataforma informou
  const [semanaEditada, setSemana] = useState<Semana | null>(null);
  const [preparoEditado, setPreparo] = useState<string | null>(null);
  const [telefonesEditados, setTelefones] = useState<TelefoneLoja[] | null>(null);
  const [aplicado, setAplicado] = useState<Aplicado>({});
  const [pendente, setPendente] = useState<{ dados: AlteracaoLoja; plataformas: CanalPublicacao[] } | null>(null);
  const { resultado, erro, setErro, enviando, enviar, avisoDeEspera } = useEnvio(notificar);
  // Uma leitura nova substitui o que foi aplicado; leitura anterior ao envio (ou sem resposta) nao
  useEffect(() => {
    setAplicado((atual) =>
      Object.fromEntries(
        Object.entries(atual).filter(([p, v]) => {
          const l = consulta?.plataformas[p as CanalPublicacao];
          return !l || l.anterior || (!!l.lidoEm && Date.parse(l.lidoEm) < v.em);
        }),
      ),
    );
  }, [versao]);

  const tem99 = ativas.includes('99FOOD');
  const d99 = consulta?.plataformas['99FOOD']?.dados;
  const horariosDe = (p?: CanalPublicacao) => (p ? (aplicado[p]?.horarios ?? consulta?.plataformas[p]?.dados?.horarios) : null);
  const fontes = ativas.filter((p) => horariosDe(p));
  const fonteAtual = fontes.includes(fonte) ? fonte : fontes[0];
  const semanaBase = paraSemana(horariosDe(fonteAtual));
  const semana = semanaEditada ?? semanaBase;
  const basePreparo = aplicado['99FOOD']?.preparo ?? String(d99?.tempoPreparoMinutos ?? '');
  const preparo = preparoEditado ?? basePreparo;
  const baseTelefones = normalizarTelefones(aplicado['99FOOD']?.telefones ?? d99?.telefones ?? []);
  const telefones = telefonesEditados ?? baseTelefones;
  const marcadas = ativas.filter((p) => !desmarcadas.includes(p));
  const semanaMudou = semanaEditada !== null && JSON.stringify(semanaEditada) !== JSON.stringify(semanaBase);
  const rascunho =
    semanaMudou || (preparoEditado !== null && preparo.trim() !== basePreparo) || (telefonesEditados !== null && JSON.stringify(normalizarTelefones(telefonesEditados)) !== JSON.stringify(baseTelefones));
  useAvisoDeSaida(rascunho);
  useEffect(() => {
    aoMudarRascunho(rascunho);
    return () => aoMudarRascunho(false);
  }, [rascunho]);

  const mudarTelefone = (i: number, parte: Partial<TelefoneLoja>) => setTelefones(telefones.map((t, j) => (j === i ? { ...t, ...parte } : t)));
  const usarFonte = (p: CanalPublicacao) => {
    setFonte(p);
    setSemana(null);
    setTrocarFonte(null);
    setRevisado(false);
  };

  function montar(): { dados: AlteracaoLoja; plataformas: CanalPublicacao[] } | string {
    const dados: AlteracaoLoja = {};
    if (!marcadas.length) return 'Marque pelo menos uma plataforma.';
    if (comHorarios) {
      const ruim = semana.findIndex((faixas) => erroDoDia(faixas));
      if (ruim >= 0) return `${DIAS[ruim]}: ${erroDoDia(semana[ruim])}`;
      const dias = semana.map((faixas, i) => ({ dia: i + 1, faixas: faixas.map((f) => ({ inicio: normalizarHora(f.inicio), fim: normalizarHora(f.fim) })) })).filter((d) => d.faixas.length);
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
    setRevisado(true);
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
    const preparoEntrou = dados.tempoPreparoMinutos !== undefined && entrou('99FOOD', 'tempoPreparoMinutos');
    const telefonesEntraram = !!dados.telefones && entrou('99FOOD', 'telefones');
    setAplicado((atual) => {
      const novo = { ...atual };
      for (const p of plataformas) {
        const campos = {
          ...(dados.horarios && entrou(p, 'horarios') ? { horarios: dados.horarios } : {}),
          ...(p === '99FOOD' && preparoEntrou ? { preparo: String(dados.tempoPreparoMinutos) } : {}),
          ...(p === '99FOOD' && telefonesEntraram ? { telefones: dados.telefones } : {}),
        };
        if (Object.keys(campos).length) novo[p] = { ...novo[p], ...campos, em: Date.now() };
      }
      return novo;
    });
    if (dados.horarios && plataformas.every((p) => entrou(p, 'horarios'))) {
      setComHorarios(false);
      setSemana(null);
      setFonte(plataformas[0]);
      setRevisado(false);
    }
    if (preparoEntrou) setPreparo(null);
    if (telefonesEntraram) setTelefones(null);
  }

  /** Atual e novo de cada dia na plataforma; a semana enviada substitui a que esta la. */
  function resumoHorarios(p: CanalPublicacao, novos: HorarioDia[]) {
    const atuais = horariosDe(p);
    const novo = (i: number) => textoFaixas(doDia(novos, i + 1));
    const mudam = atuais ? DIAS.map((_, i) => i).filter((i) => textoFaixas(doDia(atuais, i + 1)) !== novo(i)) : [];
    const fechados = DIAS.filter((_, i) => !doDia(novos, i + 1).length);
    return (
      <>
        {atuais ? (
          <>
            {mudam.map((i) => (
              <Mudanca key={i} rotulo={DIAS[i]} de={textoFaixas(doDia(atuais, i + 1))} para={novo(i)} />
            ))}
            <span className="suave">
              {mudam.length ? `${7 - mudam.length} dia(s) sem mudança.` : 'Horários iguais aos da última consulta.'} A semana inteira é reenviada.
            </span>
          </>
        ) : (
          <div className="semana">
            <span className="observacao">Horários atuais não lidos. Semana que será gravada:</span>
            {DIAS.map((nome, i) => (
              <span key={nome}>
                {nome}: {novo(i)}
              </span>
            ))}
          </div>
        )}
        {fechados.length ? <span className="observacao">Fica fechada em: {fechados.join(', ')}.</span> : null}
      </>
    );
  }

  return (
    <>
      <form className="card pilha" onSubmit={revisar} onChange={() => setErro('')} noValidate>
        <h3 style={{ margin: 0, fontSize: 15 }}>Alterar dados</h3>
        <div className="linha">
          <span className="field-label">Enviar horários para</span>
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
              {/* Fim menor que o inicio passa da meia-noite; 24:00 e o fim do dia (a 99Food recebe 23:59 e divide a faixa) */}
              <p className="suave">Substitui a semana inteira.</p>
              {fontes.length > 1 ? (
                <label className="field campo-curto">
                  <span className="field-label">Preencher com os horários de</span>
                  <select
                    className="select input-sm"
                    value={fonteAtual}
                    onChange={(e) => {
                      const p = e.target.value as CanalPublicacao;
                      if (semanaMudou) setTrocarFonte(p);
                      else usarFonte(p);
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
              <EditorSemana semana={semana} revisado={revisado} mudar={setSemana} />
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
          Revisar alterações
        </button>
        {/* 99Food: 1 alteracao de dados e horarios por minuto (vao juntos). O Hub devolve retryAfterSegundos e o dialogo avisa. */}
        {resultado ? <Resultado resultado={resultado} /> : null}
      </form>

      {trocarFonte ? (
        <Confirmacao
          titulo="Descartar os horários digitados?"
          confirmar={`Usar horários ${trocarFonte === 'IFOOD' ? 'do iFood' : 'da 99Food'}`}
          cancelar="Continuar editando"
          aviso=""
          perigo
          aoConfirmar={() => usarFonte(trocarFonte)}
          aoCancelar={() => setTrocarFonte(null)}
        >
          <span>As mudanças feitas na semana serão substituídas pelos horários lidos da plataforma.</span>
        </Confirmacao>
      ) : null}
      {pendente ? (
        <Confirmacao titulo="Enviar alteração da loja?" confirmar="Confirmar e enviar" ocupado={enviando} aoConfirmar={() => void confirmar()} aoCancelar={() => setPendente(null)}>
          {pendente.plataformas.map((p) => {
            const { horarios, tempoPreparoMinutos: minutos, telefones: novos } = pendente.dados;
            return (
              <div className="bloco-loja" key={p}>
                <strong>{rotulo(p)}</strong>
                {horarios ? resumoHorarios(p, horarios) : null}
                {p === '99FOOD' && minutos !== undefined ? <Mudanca rotulo="Tempo de preparo" de={basePreparo ? `${basePreparo} min` : 'não informado'} para={`${minutos} min`} /> : null}
                {p === '99FOOD' && novos ? <Mudanca rotulo="Telefones" de={textoTelefones(baseTelefones)} para={textoTelefones(novos)} /> : null}
                {p === 'IFOOD' && (minutos !== undefined || novos) ? <span className="suave">O iFood altera somente os horários: os outros campos voltam como não permitidos.</span> : null}
              </div>
            );
          })}
          {avisoDeEspera(pendente.plataformas)}
        </Confirmacao>
      ) : null}
    </>
  );
}

export function DadosLoja({
  sessao,
  notificar,
  aoAtualizarStatusLoja,
  aoMudarRascunho,
}: {
  sessao: Sessao;
  notificar: Notificar;
  aoAtualizarStatusLoja: () => Promise<void>;
  /** Avisa que ha algo digitado e ainda nao enviado. */
  aoMudarRascunho: (tem: boolean) => void;
}) {
  const lojaDe = (p: CanalPublicacao) => sessao.lojas.find((l) => l.plataforma === p && l.estado === 'ATIVA');
  const ativas = (['IFOOD', '99FOOD'] as const).filter(lojaDe);
  const disponivel = !!sessao.cnpj && sessao.temTokenConexao && !sessao.conexaoEncerrada && ativas.length > 0;
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [versao, setVersao] = useState(0);
  const [erro, setErro] = useState('');
  const [consultando, setConsultando] = useState(false);
  const rotulo = (p: CanalPublicacao) => `${nomeCanal(p)}: ${lojaDe(p)?.nome || consulta?.plataformas[p]?.loja?.nome || lojaDe(p)?.loja || ''}`;

  /** Plataforma que nao respondeu mantem os valores da consulta anterior, com o erro ao lado. */
  const receber = (plataformas: ConsultaLoja['plataformas']) => {
    const agora = Date.now();
    setConsulta((anterior) => ({
      plataformas: Object.fromEntries(
        Object.entries(plataformas).map(([p, l]) => {
          const antes = anterior?.plataformas[p as CanalPublicacao];
          return [p, l.dados ? { ...l, consultadoEm: agora } : { ...l, dados: antes?.dados ?? null, consultadoEm: antes?.consultadoEm, anterior: !!antes?.dados }];
        }),
      ),
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
          {/* 99Food: 1 consulta por minuto e ate 2 minutos para refletir a mudanca; por isso a leitura so roda no clique */}
          <span className="suave">As alterações valem na loja real.</span>
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
      <Alteracao {...props} versao={versao} aoMudarRascunho={aoMudarRascunho} />
    </div>
  );
}
