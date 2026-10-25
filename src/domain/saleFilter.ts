/**
 * saleFilter.ts — Filtrado, búsqueda y ordenación pura de artículos para la ventana de venta.
 *
 * Ref: SPEC.md sección 6.1 (RF-V1, RF-V2, RF-V8).
 * REGLAS INNEGOCIABLES:
 *   - Lógica 100% pura sin dependencias de React ni Dexie.
 *   - No muta el array de entrada ni los artículos ni el carrito.
 *   - Orden de aplicación estricto:
 *       1. Excluir artículos archivados.
 *       2. Filtro por categoría.
 *       3. Buscador por nombre (parcial, sin mayúsculas ni acentos).
 *       4. Filtro de ocultar sin stock (stock <= 0), salvo artículos presentes en el carrito.
 *       5. Orden elegido (por defecto Nombre A → Z; desempate por Nombre A → Z).
 */

import type { ID, Item } from '@/types'

export type SaleSortOrder = 'name-asc' | 'name-desc' | 'stock-asc' | 'stock-desc'

export const DEFAULT_SALE_SORT: SaleSortOrder = 'name-asc'

export const SALE_SORT_OPTIONS: readonly SaleSortOrder[] = [
  'name-asc',
  'name-desc',
  'stock-asc',
  'stock-desc',
] as const

export interface FilterAndSortOptions {
  /** ID de categoría seleccionada, o 'ALL' / undefined para todas */
  categoryId?: ID | 'ALL' | undefined
  /** Texto buscado por el usuario */
  query?: string | undefined
  /** Si es true, oculta artículos con stock <= 0 (salvo que estén en el carrito) */
  hideOutOfStock?: boolean | undefined
  /** Criterio de ordenación (si es inválido o no se indica, se usa 'name-asc') */
  sort?: SaleSortOrder | string | null | undefined
  /** Conjunto o lista de IDs de artículos actualmente en el carrito (con cantidad > 0) */
  cartItemIds?: Iterable<ID> | undefined
}

/**
 * Comprueba si un valor desconocido es un criterio de ordenación válido.
 */
export function isValidSaleSort(value: unknown): value is SaleSortOrder {
  return (
    typeof value === 'string' &&
    (SALE_SORT_OPTIONS as readonly string[]).includes(value)
  )
}

/**
 * Normaliza un valor de preferencia de ordenación; si no existe o no es válido,
 * devuelve el orden por defecto ('name-asc').
 */
export function parseSaleSort(value: unknown): SaleSortOrder {
  return isValidSaleSort(value) ? value : DEFAULT_SALE_SORT
}

/**
 * Normaliza un valor de preferencia del interruptor de ocultar sin stock;
 * por defecto false (mostrar todos).
 */
export function parseHideOutOfStock(value: unknown): boolean {
  return value === true
}

/**
 * Normaliza un texto para búsqueda:
 * - Elimina espacios al principio y al final.
 * - Descompone caracteres con `normalize('NFD')` y elimina los signos diacríticos.
 * - Convierte a minúsculas.
 */
export function normalizeForSearch(text: string): string {
  return text
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Compara dos nombres de artículo según las reglas del español:
 * - Sin distinguir mayúsculas ni acentos (`sensitivity: 'base'`)
 * - Con números en orden natural (`numeric: true`, p. ej. "Llavero 2" antes de "Llavero 10")
 */
export function compareItemNamesEs(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true })
}

/**
 * Paso común 1..3: filtra artículos activos por categoría y búsqueda por nombre.
 */
function filterByActiveCategoryAndQuery(
  items: readonly Item[],
  options?: Pick<FilterAndSortOptions, 'categoryId' | 'query'>,
): Item[] {
  const categoryId = options?.categoryId
  const normalizedQuery = normalizeForSearch(options?.query ?? '')

  return items.filter((item) => {
    // 1. Excluir artículos archivados
    if (item.archived) return false

    // 2. Filtro por categoría
    if (categoryId && categoryId !== 'ALL' && item.categoryId !== categoryId) {
      return false
    }

    // 3. Buscador por nombre
    if (normalizedQuery.length > 0) {
      const normalizedName = normalizeForSearch(item.name)
      if (!normalizedName.includes(normalizedQuery)) {
        return false
      }
    }

    return true
  })
}

/**
 * Filtra y ordena la lista de artículos de la ventana de venta aplicando en orden:
 * 1. Excluir artículos archivados.
 * 2. Filtro por categoría.
 * 3. Buscador por nombre.
 * 4. Filtro de "ocultar sin stock" (con la excepción de los artículos que están en el carrito).
 * 5. Orden elegido (con desempate por Nombre A → Z).
 */
export function filterAndSortItems(
  items: readonly Item[],
  options: FilterAndSortOptions = {},
): Item[] {
  // Pasos 1, 2 y 3
  const afterSearch = filterByActiveCategoryAndQuery(items, options)

  // Paso 4: Filtro de "ocultar sin stock" (respetando artículos en el carrito)
  const hideOutOfStock = parseHideOutOfStock(options.hideOutOfStock)
  const cartSet = options.cartItemIds ? new Set(options.cartItemIds) : null

  const afterStockFilter = hideOutOfStock
    ? afterSearch.filter((item) => item.stock > 0 || (cartSet?.has(item.id) ?? false))
    : afterSearch.slice()

  // Paso 5: Orden elegido
  const sort = parseSaleSort(options.sort)

  afterStockFilter.sort((a, b) => {
    switch (sort) {
      case 'name-asc':
        return compareItemNamesEs(a.name, b.name)
      case 'name-desc':
        return compareItemNamesEs(b.name, a.name)
      case 'stock-asc': {
        if (a.stock !== b.stock) return a.stock - b.stock
        return compareItemNamesEs(a.name, b.name)
      }
      case 'stock-desc': {
        if (a.stock !== b.stock) return b.stock - a.stock
        return compareItemNamesEs(a.name, b.name)
      }
    }
  })

  return afterStockFilter
}

/**
 * Calcula cuántos artículos han quedado ocultos específicamente por el filtro
 * "ocultar sin stock" (tras aplicar exclusión de archivados, categoría y búsqueda).
 */
export function countHiddenOutOfStockItems(
  items: readonly Item[],
  options: FilterAndSortOptions = {},
): number {
  if (!parseHideOutOfStock(options.hideOutOfStock)) {
    return 0
  }

  const afterSearch = filterByActiveCategoryAndQuery(items, options)
  const cartSet = options.cartItemIds ? new Set(options.cartItemIds) : null

  let hiddenCount = 0
  for (const item of afterSearch) {
    if (item.stock <= 0 && !(cartSet?.has(item.id) ?? false)) {
      hiddenCount++
    }
  }

  return hiddenCount
}
