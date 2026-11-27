/**
 * Le JSON sem arredondar inteiros com 16+ digitos (order_id, apply_id e shop_id da 99Food sao 64 bits):
 * eles viram texto. Strings sao casadas primeiro e ficam intactas; casas decimais longas continuam numero.
 */
export function lerJson<T = any>(texto: string): T | null {
  if (!texto) return null;
  try {
    return JSON.parse(texto.replace(/"(?:[^"\\]|\\.)*"|(?<![\d.eE+])-?\d{16,}(?![\d.eE])/g, (t) => (t.startsWith('"') ? t : `"${t}"`))) as T;
  } catch {
    return null;
  }
}
