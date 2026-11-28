/** Aceita "1.234,50", "12,5" e "12.5". Devolve NaN quando o texto nao e um numero. */
export const lerPreco = (texto: string) => {
  const t = texto.trim();
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};

/** Dinheiro tem duas casas: "10,999" seria arredondado sem o operador saber. */
export const casasDemais = (valor: number) => Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-6;
