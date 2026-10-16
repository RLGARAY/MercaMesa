/**
 * itemService.ts — Casos de uso de artículos.
 *
 * Reglas de negocio que aplica:
 *   RF-A3: Stock inicial > 0 → registrar StockAdjustment reason:'initial'
 *   RN-7:  Editar artículo NO modifica ventas pasadas (usan snapshots)
 *   RN-8:  Archivar → desaparece del catálogo; mantiene historial
 *
 * Invariante de stock (SPEC sección 4):
 *   stock = suma(adjustments.delta) - suma(quantity de líneas en ventas activas)
 *
 * TODAS las operaciones que cambian stock van en UNA transacción Dexie. (RNF-7)
 */

import type { ID, Item, StockAdjustment } from '@/types'
import { db as defaultDb, type MercaMesaDB } from '@/db/db'
import {
  validateItemName,
  validateItemPriceCents,
  validateItemStock,
} from '@/domain/validation'

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export interface CreateItemInput {
  name: string
  categoryId: ID
  priceCents: number
  stockInitial: number
  imageThumb?: string
}

export interface UpdateItemInput {
  name?: string
  categoryId?: ID
  priceCents?: number
  imageThumb?: string | null | undefined
}

// ---------------------------------------------------------------------------
// Queries (lectura)
// ---------------------------------------------------------------------------

/** Devuelve todos los artículos activos. */
export async function getActiveItems(dbInstance: MercaMesaDB = defaultDb): Promise<Item[]> {
  const all = await dbInstance.items.toArray()
  return all.filter(item => !item.archived)
}

/** Devuelve todos los artículos archivados. */
export async function getArchivedItems(dbInstance: MercaMesaDB = defaultDb): Promise<Item[]> {
  const all = await dbInstance.items.toArray()
  return all.filter(item => item.archived)
}

/** Devuelve un artículo por ID, o undefined si no existe. */
export async function getItemById(
  id: ID,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<Item | undefined> {
  return dbInstance.items.get(id)
}

// ---------------------------------------------------------------------------
// Mutaciones (escritura)
// ---------------------------------------------------------------------------

/**
 * Crea un artículo nuevo.
 * Si stockInitial > 0, registra un StockAdjustment con reason:'initial'
 * en la misma transacción. (RF-A3, RNF-7)
 *
 * @throws {Error} Si los datos de entrada no son válidos.
 */
export async function createItem(
  input: CreateItemInput,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<Item> {
  // Validar antes de tocar la BD
  const nameErr = validateItemName(input.name)
  if (nameErr !== null) throw new Error(nameErr)

  const priceErr = validateItemPriceCents(input.priceCents)
  if (priceErr !== null) throw new Error(priceErr)

  const stockErr = validateItemStock(input.stockInitial)
  if (stockErr !== null) throw new Error(stockErr)

  // Comprobar que la categoría existe
  const category = await dbInstance.categories.get(input.categoryId)
  if (!category) throw new Error('La categoría seleccionada no existe')

  const now = new Date().toISOString()

  const item: Item = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    categoryId: input.categoryId,
    priceCents: input.priceCents,
    stock: input.stockInitial,
    archived: false,
    createdAt: now,
    updatedAt: now,
    // Solo incluir imageThumb si se proporcionó (exactOptionalPropertyTypes)
    ...(input.imageThumb !== undefined ? { imageThumb: input.imageThumb } : {}),
  }

  // Transacción atómica: item + ajuste inicial juntos (RNF-7)
  await dbInstance.transaction('rw', [dbInstance.items, dbInstance.adjustments], async () => {
    await dbInstance.items.add(item)

    // RF-A3: si hay stock inicial, registrar el ajuste
    if (input.stockInitial > 0) {
      const adjustment: StockAdjustment = {
        id: crypto.randomUUID(),
        createdAt: now,
        itemId: item.id,
        delta: input.stockInitial,
        reason: 'initial',
      }
      await dbInstance.adjustments.add(adjustment)
    }
  })

  return item
}

/**
 * Edita un artículo existente (nombre, precio, categoría o imagen).
 * RN-7: No modifica las ventas ya realizadas (usan snapshots).
 * No toca el stock (para eso existe adjustStock).
 *
 * @throws {Error} Si el artículo no existe o los datos no son válidos.
 */
export async function updateItem(
  id: ID,
  input: UpdateItemInput,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<void> {
  const item = await dbInstance.items.get(id)
  if (!item) throw new Error('Artículo no encontrado')

  let updatedName = item.name
  if (input.name !== undefined) {
    const err = validateItemName(input.name)
    if (err !== null) throw new Error(err)
    updatedName = input.name.trim()
  }

  let updatedPrice = item.priceCents
  if (input.priceCents !== undefined) {
    const err = validateItemPriceCents(input.priceCents)
    if (err !== null) throw new Error(err)
    updatedPrice = input.priceCents
  }

  let updatedCategoryId = item.categoryId
  if (input.categoryId !== undefined) {
    const category = await dbInstance.categories.get(input.categoryId)
    if (!category) throw new Error('La categoría seleccionada no existe')
    updatedCategoryId = input.categoryId
  }

  const updatedItem: Item = {
    ...item,
    name: updatedName,
    priceCents: updatedPrice,
    categoryId: updatedCategoryId,
    updatedAt: new Date().toISOString(),
  }

  if (input.imageThumb === null) {
    delete updatedItem.imageThumb
  } else if (input.imageThumb !== undefined) {
    updatedItem.imageThumb = input.imageThumb
  }

  await dbInstance.items.put(updatedItem)
}

/**
 * Archiva un artículo. RN-8.
 * El artículo desaparece de la pantalla de venta pero mantiene su historial.
 *
 * @throws {Error} Si el artículo no existe.
 */
export async function archiveItem(
  id: ID,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<void> {
  const item = await dbInstance.items.get(id)
  if (!item) throw new Error('Artículo no encontrado')

  await dbInstance.items.update(id, { archived: true, updatedAt: new Date().toISOString() })
}

/**
 * Restaura un artículo archivado. RN-8.
 *
 * @throws {Error} Si el artículo no existe.
 */
export async function restoreItem(
  id: ID,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<void> {
  const item = await dbInstance.items.get(id)
  if (!item) throw new Error('Artículo no encontrado')

  await dbInstance.items.update(id, { archived: false, updatedAt: new Date().toISOString() })
}

/**
 * Ajusta el stock de un artículo (para la pantalla de Corrección, RF-C1).
 * Siempre crea un StockAdjustment y actualiza item.stock en la misma transacción.
 *
 * @param delta - Diferencia a aplicar (positivo = añadir, negativo = reducir)
 * @throws {Error} Si el artículo no existe.
 */
export async function adjustStock(
  id: ID,
  delta: number,
  reason: StockAdjustment['reason'],
  note?: string,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<void> {
  if (!Number.isInteger(delta)) throw new Error('El delta de stock debe ser un entero')

  const item = await dbInstance.items.get(id)
  if (!item) throw new Error('Artículo no encontrado')

  const now = new Date().toISOString()

  await dbInstance.transaction('rw', [dbInstance.items, dbInstance.adjustments], async () => {
    const adjustment: StockAdjustment = {
      id: crypto.randomUUID(),
      createdAt: now,
      itemId: id,
      delta,
      reason,
      ...(note !== undefined ? { note } : {}),
    }
    await dbInstance.adjustments.add(adjustment)
    await dbInstance.items.update(id, {
      stock: item.stock + delta,
      updatedAt: now,
    })
  })
}

/**
 * Fija el stock de un artículo a un valor absoluto exacto (RF-C1 opción b).
 * Calcula el delta automáticamente y guarda el StockAdjustment en una transacción atómica.
 * Si targetStock === stock actual y delta === 0, no hace falta ajuste.
 */
export async function setStockAbsolute(
  id: ID,
  targetStock: number,
  reason: StockAdjustment['reason'],
  note?: string,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<number> {
  if (!Number.isInteger(targetStock)) {
    throw new Error('El stock debe ser un número entero')
  }

  const item = await dbInstance.items.get(id)
  if (!item) throw new Error('Artículo no encontrado')

  const delta = targetStock - item.stock
  if (delta === 0) {
    return 0 // Sin cambios necesarios
  }

  await adjustStock(id, delta, reason, note, dbInstance)
  return delta
}

/**
 * Obtiene el historial de ajustes de stock de un artículo (RF-C2).
 * Ordenado por fecha descendente (más recientes primero).
 */
export async function getAdjustmentsByItem(
  itemId: ID,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<StockAdjustment[]> {
  const list = await dbInstance.adjustments
    .where('itemId')
    .equals(itemId)
    .toArray()

  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ---------------------------------------------------------------------------
// Verificación de consistencia (RF-C10, SPEC sección 4)
// ---------------------------------------------------------------------------

/**
 * Verifica la consistencia del stock de todos los artículos.
 * Invariante: stock = suma(adjustments.delta) - suma(quantity de ventas activas)
 *
 * Devuelve la lista de artículos con inconsistencia (si la hay).
 * Esta función es de diagnóstico; la corrección la hace el usuario en RF-C1.
 */
export async function verifyStockConsistency(
  dbInstance: MercaMesaDB = defaultDb,
): Promise<Array<{ item: Item; expected: number; actual: number }>> {
  const [items, adjustments, sales] = await Promise.all([
    dbInstance.items.toArray(),
    dbInstance.adjustments.toArray(),
    dbInstance.sales.filter(s => s.status === 'active').toArray(),
  ])

  const inconsistencies: Array<{ item: Item; expected: number; actual: number }> = []

  for (const item of items) {
    const totalAdjustments = adjustments
      .filter(a => a.itemId === item.id)
      .reduce((sum, a) => sum + a.delta, 0)

    const totalSold = sales
      .flatMap(s => s.lines)
      .filter(l => l.itemId === item.id)
      .reduce((sum, l) => sum + l.quantity, 0)

    const expected = totalAdjustments - totalSold

    if (expected !== item.stock) {
      inconsistencies.push({ item, expected, actual: item.stock })
    }
  }

  return inconsistencies
}
