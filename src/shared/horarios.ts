import type { HorarioDia } from './tipos.js';

/** Regras dos horarios da loja, conferidas na tela antes de enviar. */

type Faixas = HorarioDia['faixas'];

const INICIO = /^([01]\d|2[0-3]):[0-5]\d$/;
const FIM = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** Completa o que o operador digitou: "9" vira 09:00, "930" vira 09:30 e "9:00" vira 09:00. */
export function normalizarHora(texto: string): string {
  const t = texto.trim().replace(/[h.]/i, ':').replace(/:$/, '');
  const m = /^(\d{1,2}):?(\d{2})$/.exec(t) ?? /^(\d{1,2})$/.exec(t);
  return m ? `${m[1].padStart(2, '0')}:${m[2] ?? '00'}` : t;
}

const minutos = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** Motivo pelo qual o dia nao pode ser enviado; vazio quando esta certo. Dia sem faixa e dia fechado. */
export function erroDoDia(faixas: Faixas): string {
  const lidas = faixas.map((f) => ({ inicio: normalizarHora(f.inicio), fim: normalizarHora(f.fim) }));
  if (lidas.some((f) => !INICIO.test(f.inicio) || !FIM.test(f.fim))) return 'use horários no formato 11:00 (24:00 só no fim).';
  if (lidas.some((f) => f.inicio === f.fim)) return 'o início precisa ser diferente do fim.';
  // Fim menor que o inicio passa da meia-noite
  const intervalos = lidas.map((f) => [minutos(f.inicio), minutos(f.fim) + (minutos(f.fim) < minutos(f.inicio) ? 1440 : 0)]).sort((a, b) => a[0] - b[0]);
  if (intervalos.some((x, i) => i > 0 && x[0] < intervalos[i - 1][1])) return 'há faixas sobrepostas.';
  return '';
}
