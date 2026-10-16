/**
 * Esquema de la base de datos local (IndexedDB via Dexie).
 * Ref: SPEC.md secciones 3, 4 y 8.
 *
 * Reglas importantes:
 * - schemaVersion empieza en 1 y sube con cada cambio de esquema.
 * - Cada cambio de esquema DEBE incluir un bloque upgrade() con su test.
 * - Las escrituras que cambian stock siempre van en una única transacción (RNF-7).
 */

import Dexie, { type Table, type DexieOptions } from 'dexie'
import type {
  Category,
  Item,
  Sale,
  StockAdjustment,
  Meta,
  LocalBackup,
} from '@/types'

/** Versión actual del esquema. Subir al añadir/cambiar tablas o índices. */
export const SCHEMA_VERSION = 1

export class MercaMesaDB extends Dexie {
  // Dexie infiere el tipo de cada tabla a partir de la declaración
  categories!: Table<Category>
  items!: Table<Item>
  sales!: Table<Sale>
  adjustments!: Table<StockAdjustment>
  meta!: Table<Meta>
  localBackups!: Table<LocalBackup>

  constructor(dbName = 'MercaMesaDB', options?: DexieOptions) {
    super(dbName, options)

    /**
     * Versión 1 — esquema inicial.
     * Índices (SPEC sección 4):
     *   - sales: por fecha (para filtros de periodo) y por estado (para excluir anuladas)
     *   - adjustments: por artículo (para recalcular stock)
     *   - items: por categoría (para filtros de la pantalla de venta)
     */
    this.version(SCHEMA_VERSION).stores({
      categories: 'id, sortOrder, archived',
      items: 'id, categoryId, archived',
      sales: 'id, createdAt, status',
      adjustments: 'id, itemId, createdAt',
      meta: 'schemaVersion',
      localBackups: 'id, createdAt',
    })
  }
}

/** Instancia singleton de la base de datos. Importar desde aquí en servicios. */
export const db = new MercaMesaDB()

// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------

/**
 * Inicializa la base de datos al arrancar la app:
 * 1. Pide almacenamiento persistente al navegador (SPEC sección 8).
 * 2. Crea el registro Meta si no existe.
 * 3. Crea las categorías iniciales si la base de datos está vacía.
 *
 * Debe llamarse una sola vez en main.tsx antes de montar React.
 */
export async function initDB(dbInstance: MercaMesaDB = db): Promise<void> {
  // Solicitar almacenamiento persistente: evita que el navegador borre IndexedDB
  // cuando hay poca memoria. El usuario puede denegar; lo intentamos igualmente.
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    await navigator.storage.persist()
  }

  // Crear o recuperar el registro Meta (siempre hay exactamente uno)
  const existingMeta = await dbInstance.meta.count()
  if (existingMeta === 0) {
    await dbInstance.meta.add({
      schemaVersion: SCHEMA_VERSION,
      deviceId: crypto.randomUUID(),
      lastSyncedRevision: 0,
    })
  }

  // Categorías iniciales (SPEC sección 5, RN-9 y sección 14)
  const categoryCount = await dbInstance.categories.count()
  if (categoryCount === 0) {
    await dbInstance.categories.bulkAdd([
      { id: crypto.randomUUID(), name: 'Pendientes', sortOrder: 0, archived: false },
      { id: crypto.randomUUID(), name: 'Llaveros',   sortOrder: 1, archived: false },
      { id: crypto.randomUUID(), name: 'Láminas',    sortOrder: 2, archived: false },
    ])
  }
}
