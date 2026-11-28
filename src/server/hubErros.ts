/** Mensagem de erro do Hub para a tela: o texto real, o codigo e o que o operador deve fazer. */

const LIMITE_99 = /PLATAFORMA_ERRNO_(10005|12021)|errno (10005|12021)|calling frequency/i;

/** Segundos de espera informados em um erro de limite da 99Food; 0 quando o texto nao e de limite. */
export function segundosDoLimite(texto: string, retryAfterS?: number): number {
  if (!LIMITE_99.test(texto)) return 0;
  return retryAfterS || Number(/window:\s*(\d+)s|Aguarde (\d+) segundo/i.exec(texto)?.slice(1).find(Boolean)) || 60;
}

const O_QUE_FAZER: Record<string, string> = {
  TOKEN_INVALIDO: 'Confira o token da integração. Para trocar, use "Sair e trocar token".',
  CONEXAO_ENCERRADA: 'Clique em "Conectar de novo".',
  SEM_CONEXAO: 'Conecte o CNPJ em "Lojas e operação".',
  CONEXAO_NAO_ENCONTRADA: 'A conexão foi excluída no Hub. Conecte o CNPJ de novo.',
  CONEXAO_REVOGADA: 'Peça à Target para reativar a conexão.',
  CNPJ_INVALIDO: 'Confira os 14 dígitos do CNPJ, inclusive os dois verificadores.',
  CNPJ_JA_CONECTADO: 'Peça à Target para excluir ou migrar a conexão anterior deste CNPJ.',
  SELECAO_REQUER_TARGET: 'Peça à Target para confirmar a loja desta conexão.',
  SELECAO_NAO_HABILITADA: 'Peça à Target para habilitar a escolha de loja para este integrador.',
  SELECAO_EM_ANDAMENTO: 'Aguarde alguns segundos e atualize a tela.',
  PLATAFORMA_JA_VINCULADA: 'Desvincule a loja atual antes de escolher outra.',
  LOJA_INDISPONIVEL: 'Abra a lista de lojas de novo e escolha uma disponível.',
  LOJA_NAO_AUTORIZADA_NO_APP: 'Autorize o aplicativo da Target no portal da plataforma para esta loja e consulte a lista de novo.',
  LOJA_NAO_ENCONTRADA: 'Vincule o iFood ou a 99Food em "Lojas e operação".',
  PLATAFORMA_INDISPONIVEL: 'A plataforma não respondeu. Aguarde um instante e tente de novo.',
  DESTINO_NAO_AUTORIZADO: 'Confira a URL do webhook.',
  HUB_DESLIGADO: 'O Hub está desligado. Fale com a Target.',
  VINCULO_NAO_ATIVO: 'Fale com a Target: o vínculo desta conexão não está ativo.',
  IFOOD_PAUSA_JA_EXISTE: 'Remova a pausa atual em "3. Horário e pausa imediata" ou use "Abrir" em "Dados da loja" antes de criar outra.',
  CATEGORIA_JA_EXISTE: 'Escolha outro nome.',
  COMANDO_RESULTADO_INCERTO: 'A ação pode ter sido executada: confira o pedido antes de repetir.',
  COMANDO_EM_ANDAMENTO: 'Aguarde alguns segundos e confira o pedido.',
};

export function mensagemDoHub(r: { status: number; json: unknown; text: string; retryAfterS?: number }): string {
  const j = r.json as any;
  if (r.status === 0) return `Sem resposta do Hub: ${r.text}. Confira a rede e o endereço da API e tente de novo.`;
  const texto = j?.erro ?? j?.message ?? j?.mensagem ?? `Hub respondeu HTTP ${r.status}`;
  const resposta = j?.detalhes?.resposta;
  const causas = (resposta?.error?.details ?? []).map((d: any) => d?.message).filter(Boolean).join('; ');
  const detalhe = [resposta?.errmsg ?? resposta?.error?.message ?? j?.detalhes?.motivo, causas].filter(Boolean).join(': ');
  const base = `${j?.codigo ? `[${j.codigo}] ` : ''}${texto}${detalhe && !String(texto).includes(detalhe) ? ` (${detalhe})` : ''}`;
  const espera = segundosDoLimite(`${j?.codigo} ${base}`, r.retryAfterS) || (r.status === 429 ? (r.retryAfterS ?? 60) : 0);
  const acao = espera
    ? `Limite de chamadas: aguarde ${espera} ${espera === 1 ? 'segundo' : 'segundos'} antes de repetir.`
    : j?.codigo === 'ERRO_INTERNO'
      ? `Falha no Hub. Informe à Target o requestId ${j.requestId ?? 'do log'}.`
      : O_QUE_FAZER[j?.codigo];
  return acao ? `${base.replace(/\.?$/, '.')} ${acao}` : base;
}
