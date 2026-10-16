/**
 * categoryService.ts — Casos de uso de categorías.
 *
 * Reglas de negocio que aplica:
 *   RN-9: Un artículo siempre tiene categoría.
 *         No se puede archivar una categoría con artículos activos.
 *
 * Todas las funciones reciben una instancia de la DB para facilitar
 * los tests (se puede pasar una DB con fake-indexeddb).
 */

import type { Category, ID } from '@/types'
import { db as defaultDb, type MercaMesaDB } from '@/db/db'
import { validateCategoryName } from '@/domain/validation'

// ---------------------------------------------------------------------------
// Queries (lectura)
// ---------------------------------------------------------------------------

/** Devuelve todas las categorías ordenadas por sortOrder, incluyendo archivadas. */
export async function getAllCategories(dbInstance: MercaMesaDB = defaultDb): Promise<Category[]> {
  return dbInstance.categories.orderBy('sortOrder').toArray()
}

/** Devuelve solo las categorías activas (no archivadas), ordenadas. */
export async function getActiveCategories(dbInstance: MercaMesaDB = defaultDb): Promise<Category[]> {
  const all = await dbInstance.categories.orderBy('sortOrder').toArray()
  return all.filter(c => !c.archived)
}

// ---------------------------------------------------------------------------
// Mutaciones (escritura)
// ---------------------------------------------------------------------------

/**
 * Crea una nueva categoría.
 * La añade al final del orden actual.
 *
 * @throws {Error} Si el nombre no es válido.
 */
export async function createCategory(
  name: string,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<Category> {
  const nameErr = validateCategoryName(name)
  if (nameErr !== null) throw new Error(nameErr)

  // sortOrder: poner al final
  const allCategories = await dbInstance.categories.toArray()
  const maxOrder = allCategories.reduce((max, c) => Math.max(max, c.sortOrder), -1)

  const category: Category = {
    id: crypto.randomUUID(),
    name: name.trim(),
    sortOrder: maxOrder + 1,
    archived: false,
  }

  await dbInstance.categories.add(category)
  return category
}

/**
 * Renombra una categoría.
 * No afecta a las ventas existentes (usan categoryIdSnapshot). RN-7.
 *
 * @throws {Error} Si el nombre no es válido o la categoría no existe.
 */
export async function renameCategory(
  id: ID,
  name: string,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<void> {
  const nameErr = validateCategoryName(name)
  if (nameErr !== null) throw new Error(nameErr)

  const count = await dbInstance.categories.where('id').equals(id).count()
  if (count === 0) throw new Error('Categoría no encontrada')

  await dbInstance.categories.update(id, { name: name.trim() })
}

/**
 * Archiva una categoría.
 * RN-9: No se puede archivar si tiene artículos activos.
 *
 * @throws {Error} Si la categoría tiene artículos activos.
 */
export async function archiveCategory(
  id: ID,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<void> {
  // Comprobar que no tiene artículos activos (RN-9)
  const activeItems = await dbInstance.items
    .where('categoryId').equals(id)
    .filter(item => !item.archived)
    .count()

  if (activeItems > 0) {
    throw new Error(
      `No se puede archivar: la categoría tiene ${activeItems} artículo(s) activo(s). Archívalos primero.`,
    )
  }

  await dbInstance.categories.update(id, { archived: true })
}

/**
 * Restaura una categoría archivada.
 */
export async function restoreCategory(
  id: ID,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<void> {
  await dbInstance.categories.update(id, { archived: false })
}

/**
 * Reordena las categorías según el array de IDs proporcionado.
 * El índice en el array se convierte en el sortOrder.
 */
export async function reorderCategories(
  orderedIds: ID[],
  dbInstance: MercaMesaDB = defaultDb,
): Promise<void> {
  await dbInstance.transaction('rw', dbInstance.categories, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await dbInstance.categories.update(orderedIds[i], { sortOrder: i })
    }
  })
}
