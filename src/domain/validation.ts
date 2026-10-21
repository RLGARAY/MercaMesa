/**
 * validation.ts — Funciones puras de validación del dominio.
 *
 * Regla: sin imports de React ni Dexie. Solo lógica de validación.
 * Cada función devuelve null si es válido, o el mensaje de error si no.
 * Ref: RF-A5, RN-9
 */

import { parseCentsFromString } from '@/domain/money'

// ---------------------------------------------------------------------------
// Artículos (RF-A5)
// ---------------------------------------------------------------------------

/**
 * Valida el nombre de un artículo.
 * Regla: no vacío, máximo 100 caracteres.
 */
export function validateItemName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'El nombre es obligatorio'
  if (trimmed.length > 100) return 'El nombre no puede superar 100 caracteres'
  return null
}

/**
 * Valida el precio de venta de un artículo ya en céntimos.
 * Regla: entero estricto > 0. Ref: SPEC sección 3.
 */
export function validateItemPriceCents(priceCents: number): string | null {
  if (!Number.isInteger(priceCents)) return 'El precio debe ser un número entero de céntimos'
  if (priceCents <= 0) return 'El precio debe ser mayor que 0'
  return null
}

/**
 * Valida un string de precio introducido por el usuario (en euros).
 * Devuelve el precio en céntimos si es válido, o un mensaje de error.
 */
export function validateAndParsePriceString(
  value: string,
): { cents: number; error: null } | { cents: null; error: string } {
  const cents = parseCentsFromString(value)
  if (cents === null) return { cents: null, error: 'Introduce un precio válido (ej: 1,50)' }
  const err = validateItemPriceCents(cents)
  if (err !== null) return { cents: null, error: err }
  return { cents, error: null }
}

/**
 * Valida el stock de un artículo.
 * Regla: entero >= 0 para el stock inicial (RF-A5).
 */
export function validateItemStock(stock: number): string | null {
  if (!Number.isInteger(stock)) return 'El stock debe ser un número entero'
  if (stock < 0) return 'El stock inicial no puede ser negativo'
  return null
}

/**
 * Parsea un string que debe representar un número entero estricto.
 * Rechaza decimales ('1.5', '1,5'), notación científica ('1e2'), '-0', vacío y texto (A3, #9).
 * Si allowNegative es true, admite el signo '-' delante de dígitos distintos de todo ceros.
 */
export function parseStrictIntegerString(
  value: string,
  options: { allowNegative?: boolean } = {},
): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null

  // Rechazar -0 explícitamente (incluyendo '-00', etc.)
  if (/^-0+$/.test(trimmed)) return null

  const pattern = options.allowNegative ? /^-?\d+$/ : /^\d+$/
  if (!pattern.test(trimmed)) return null

  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isSafeInteger(parsed)) return null

  return parsed
}

/**
 * Valida un string de stock inicial introducido por el usuario.
 * Rechaza cualquier valor no entero sin redondear en silencio (A3, #9).
 */
export function validateAndParseStockString(
  value: string,
): { stock: number; error: null } | { stock: null; error: string } {
  const trimmed = value.trim()
  if (trimmed === '') return { stock: null, error: 'El stock es obligatorio' }

  // Detectar entero negativo (distinto de -0) para dar el mensaje específico de stock inicial
  if (/^-[1-9]\d*$/.test(trimmed)) {
    return { stock: null, error: 'El stock inicial no puede ser negativo' }
  }

  const stock = parseStrictIntegerString(trimmed, { allowNegative: false })
  if (stock === null) return { stock: null, error: 'Introduce un número entero válido' }

  const err = validateItemStock(stock)
  if (err !== null) return { stock: null, error: err }
  return { stock, error: null }
}

// ---------------------------------------------------------------------------
// Categorías (RN-9)
// ---------------------------------------------------------------------------

/**
 * Valida el nombre de una categoría.
 * Regla: no vacío, máximo 50 caracteres.
 */
export function validateCategoryName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'El nombre de la categoría es obligatorio'
  if (trimmed.length > 50) return 'El nombre no puede superar 50 caracteres'
  return null
}
