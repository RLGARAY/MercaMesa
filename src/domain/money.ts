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
 * Convierte un string introducido por el usuario (en euros) a céntimos enteros
 * empleando exclusivamente aritmética entera (C3, #8).
 * - Acepta tanto punto como coma como separador decimal.
 * - Rechaza notación exponencial y más de 2 decimales.
 *
 * Devuelve null si el string no es un importe válido.
 *
 * @example
 * parseCentsFromString("1,50")  → 150
 * parseCentsFromString("1.50")  → 150
 * parseCentsFromString("2")     → 200
 * parseCentsFromString("1.005") → null
 * parseCentsFromString("1e2")   → null
 * parseCentsFromString("")      → null
 */
export function parseCentsFromString(value: string): number | null {
  const trimmed = value.trim()
  if (!/^-?\d+([.,]\d{1,2})?$/.test(trimmed)) return null

  const isNegative = trimmed.startsWith('-')
  const unsigned = isNegative ? trimmed.slice(1) : trimmed
  const [intPart = '0', decPart = ''] = unsigned.split(/[.,]/)

  const euros = Number(intPart)
  const centsPart = Number(decPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(euros) || !Number.isSafeInteger(centsPart)) return null

  const total = euros * 100 + centsPart
  if (!Number.isSafeInteger(total)) return null
  if (total === 0) return 0

  return isNegative ? -total : total
}

/**
 * Formatea un importe en céntimos enteros para prellenar un campo de entrada en euros,
 * empleando exclusivamente aritmética entera (sin división en coma flotante, C3, #8).
 *
 * @example
 * formatCentsToEurosInput(500) → "5"
 * formatCentsToEurosInput(550) → "5,50"
 * formatCentsToEurosInput(505) → "5,05"
 */
export function formatCentsToEurosInput(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(cents))
  const euros = Math.floor(abs / 100)
  const rem = abs % 100
  if (rem === 0) {
    return `${sign}${euros}`
  }
  return `${sign}${euros},${String(rem).padStart(2, '0')}`
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
