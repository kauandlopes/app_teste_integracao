/** Leitura da disputa do iFood (HANDSHAKE_DISPUTE) para a tela e para o servidor. Funcoes puras. */

export interface AlternativaDisputa {
  id: string;
  tipo: 'REFUND' | 'ADDITIONAL_TIME';
  /** Reembolso: maior valor aceito, em reais. */
  valorMaximo: number | null;
  /** Tempo adicional: opcoes oferecidas (vazio = livre). */
  minutos: string[];
  motivos: string[];
}

const textos = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** So as alternativas que o ERP sabe responder. */
export function lerAlternativas(lista: unknown[] | undefined): AlternativaDisputa[] {
  return ((lista ?? []) as any[])
    .filter((a) => !!a?.id && (a.type === 'REFUND' || a.type === 'ADDITIONAL_TIME'))
    .map((a) => {
      const m = a.metadata ?? {};
      const centavos = Number(m.maxAmount?.value);
      return {
        id: String(a.id),
        tipo: a.type,
        valorMaximo: Number.isFinite(centavos) && centavos > 0 ? centavos / 100 : null,
        minutos: textos(m.allowedsAdditionalTimeInMinutes),
        motivos: textos(m.allowedsAdditionalTimeReasons),
      };
    });
}

export function consequenciaDoPrazo(aoExpirar: string | null | undefined): string {
  const a = String(aoExpirar ?? '').toUpperCase();
  if (a.startsWith('ACCEPT')) return 'Sem resposta no prazo, o iFood aceita a solicitação do cliente.';
  if (a.startsWith('REJECT')) return 'Sem resposta no prazo, o iFood recusa a solicitação do cliente.';
  if (a === 'VOID') return 'Sem resposta no prazo, o iFood encerra a solicitação sem decisão da loja.';
  return `O iFood não informou o que acontece no fim do prazo${a ? ` (código ${a})` : ''}. Responda antes dele.`;
}
