/**
 * money.ts — Formateo y parseo de importes monetarios en céntimos.
 *
 * Regla fundamental (SPEC sección 3):
 *   El dinero se almacena y opera SIEMPRE en céntimos enteros.
 *   Nunca se usan floats para cálculos de dinero.
 *
 * Este módulo solo convierte entre la representación interna (céntimos)
 * y la representación visual (string en euros para el usuario).
 */

/** Locale y moneda usados en toda la aplicación. RNF-5: idioma es-ES */
const LOCALE = 'es-ES'
const CURRENCY = 'EUR'

/**
 * Formatea un importe en céntimos como string en euros para mostrar al usuario.
 *
 * @example
 * formatCents(0)     → "0,00 €"
 * formatCents(150)   → "1,50 €"
 * formatCents(1999)  → "19,99 €"
 * formatCents(-50)   → "-0,50 €"
 */
export function formatCents(cents: number): string {
  // Intl.NumberFormat se encarga del formato local correcto (coma decimal en es-ES)
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/**
 * Convierte un string introducido por el usuario (en euros) a céntimos enteros.
 * Acepta tanto punto como coma como separador decimal.
 * Redondea al céntimo más cercano.
 *
 * Devuelve null si el string no es un número válido.
 *
 * @example
 * parseCentsFromString("1,50")  → 150
 * parseCentsFromString("1.50")  → 150
 * parseCentsFromString("2")     → 200
 * parseCentsFromString("")      → null
 * parseCentsFromString("abc")   → null
 */
export function parseCentsFromString(value: string): number | null {
  if (value.trim() === '') return null

  // Normalizamos: reemplazamos la coma decimal por punto para parseFloat
  const normalized = value.trim().replace(',', '.')

  // Validamos que solo contenga un número (dígitos, punto decimal y signo opcional).
  // Necesario porque parseFloat('1.50€') = 1.5 ignorando el '€', lo cual sería silencioso.
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null

  const euros = parseFloat(normalized)

  if (isNaN(euros)) return null

  // Multiplicamos por 100 y redondeamos para evitar errores de punto flotante
  return Math.round(euros * 100)
}

/**
 * Convierte céntimos a euros (number) para usar en inputs numéricos.
 * NO usar para cálculos; solo para mostrar en campos de formulario.
 *
 * @example
 * centsToEuros(150)  → 1.5
 * centsToEuros(1999) → 19.99
 */
export function centsToEuros(cents: number): number {
  return cents / 100
}
