import { z } from 'zod';

/**
 * Validacao das rotas de loja antes de falar com o Hub. Os corpos de dados e funcionamento sao validados e
 * repassados como vieram (o Hub recusa campos desconhecidos); a pausa iFood monta o corpo a partir do valor validado.
 */

const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

const inteiro = (min: number, max: number, nome: string) =>
  z
    .number({ error: `${nome} deve ser um número.` })
    .int({ error: `${nome} deve ser um número inteiro.` })
    .min(min, { error: `${nome}: o mínimo é ${min}.` })
    .max(max, { error: `${nome}: o máximo é ${max}.` });

export const interrupcaoSchema = z
  .object({
    description: z.string({ error: 'Motivo da pausa deve ser um texto.' }).trim().max(255, { error: 'Motivo da pausa: use no máximo 255 caracteres.' }).optional(),
    durationMinutes: inteiro(1, 1440, 'Duração da pausa').optional(),
    start: z.string({ error: 'Início da pausa deve ser um texto.' }).regex(ISO_LOCAL, { error: 'Início da pausa: use o formato AAAA-MM-DDTHH:mm:ss.' }).optional(),
    end: z.string({ error: 'Fim da pausa deve ser um texto.' }).regex(ISO_LOCAL, { error: 'Fim da pausa: use o formato AAAA-MM-DDTHH:mm:ss.' }).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.start && v.end && v.end <= v.start) ctx.addIssue({ code: 'custom', path: ['end'], message: 'Fim da pausa deve ser depois do início.' });
  });

const ACOES_FUNCIONAMENTO = ['ABRIR', 'FECHAR', 'PAUSAR', 'OCUPADO', 'NORMAL'] as const;

export const funcionamentoSchema = z
  .object({
    acao: z.enum(ACOES_FUNCIONAMENTO, { error: 'Ação inválida: use ABRIR, FECHAR, PAUSAR, OCUPADO ou NORMAL.' }),
    duracaoMinutos: inteiro(1, 10080, 'Duração').optional(),
    ateFimDoDia: z.boolean({ error: 'ateFimDoDia deve ser verdadeiro ou falso.' }).optional(),
    descricao: z.string({ error: 'Descrição deve ser um texto.' }).max(255, { error: 'Descrição: use no máximo 255 caracteres.' }).optional(),
    codigoMotivo: z.number({ error: 'Código do motivo deve ser um número.' }).int().min(1001, { error: 'Código do motivo: de 1001 a 1006.' }).max(1006, { error: 'Código do motivo: de 1001 a 1006.' }).optional(),
    acrescimoPreparoMinutos: inteiro(1, 30, 'Acréscimo de preparo').optional(),
    aberturaAutomatica: z.boolean({ error: 'aberturaAutomatica deve ser verdadeiro ou falso.' }).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.acao === 'PAUSAR' && (v.duracaoMinutos !== undefined) === (v.ateFimDoDia === true)) {
      ctx.addIssue({ code: 'custom', path: ['acao'], message: 'PAUSAR exige duração em minutos ou até o fim do dia, e apenas um dos dois.' });
    }
    if (v.acao === 'OCUPADO' && v.duracaoMinutos !== undefined && v.duracaoMinutos > 180) {
      ctx.addIssue({ code: 'custom', path: ['duracaoMinutos'], message: 'Modo ocupado: a duração máxima é 180 minutos.' });
    }
  });

const telefone = z.object({
  ddi: z.string({ error: 'DDI do telefone deve ser um texto.' }),
  numero: z.union([z.string(), z.number()], { error: 'Número do telefone deve ser um texto.' }),
  tipo: z.enum(['FIXO', 'CELULAR'], { error: 'Tipo do telefone: FIXO ou CELULAR.' }),
});

export const dadosSchema = z.object({
  horarios: z
    .array(z.object({ dia: inteiro(1, 7, 'Dia da semana'), faixas: z.array(z.object({ inicio: z.string(), fim: z.string() })) }), { error: 'Horários devem ser uma lista.' })
    .optional(),
  tempoPreparoMinutos: inteiro(1, 180, 'Tempo de preparo').optional(),
  telefones: z.array(telefone, { error: 'Telefones devem ser uma lista.' }).max(5, { error: 'Telefones: no máximo 5.' }).optional(),
});

/** Primeiro problema encontrado, em portugues e com o campo. Corpo valido devolve os dados tipados. */
export function validar<S extends z.ZodType>(schema: S, corpo: unknown): { ok: true; dados: z.output<S> } | { ok: false; erro: string } {
  const r = schema.safeParse(corpo ?? {});
  if (r.success) return { ok: true, dados: r.data as z.output<S> };
  const problema = r.error.issues[0];
  const campo = problema.path.length ? `${problema.path.join('.')}: ` : '';
  return { ok: false, erro: `${campo}${problema.message}` };
}

export const IDENTIFICADOR_PAUSA = /^[A-Za-z0-9_-]{1,64}$/;
