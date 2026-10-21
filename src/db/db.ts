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
export const SCHEMA_VERSION = 2

/** Clave primaria fija del único registro en la tabla meta. */
export const META_KEY = 'main' as const

export class MercaMesaDB extends Dexie {
  // Dexie infiere el tipo de cada tabla a partir de la declaración
  categories!: Table<Category>
  items!: Table<Item>
  sales!: Table<Sale>
  adjustments!: Table<StockAdjustment>
  meta!: Table<Meta, 'main'>
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
    this.version(1).stores({
      categories: 'id, sortOrder, archived',
      items: 'id, categoryId, archived',
      sales: 'id, createdAt, status',
      adjustments: 'id, itemId, createdAt',
      meta: 'schemaVersion',
      localBackups: 'id, createdAt',
    })

    /**
     * Paso intermedio 1.5 — preparación para cambio de clave primaria de `meta`.
     * Dexie no permite cambiar la clave primaria de un almacén existente en un solo paso.
     * 1. Guarda copia automática en `localBackups` con motivo 'before-migration' (SPEC sección 8).
     * 2. Copia la fila existente de `meta` a un almacén temporal `meta_v2_tmp` bajo la clave fija 'main'.
     * 3. Elimina el almacén `meta` antiguo (`meta: null`).
     */
    this.version(1.5)
      .stores({
        meta: null,
        meta_v2_tmp: 'id',
      })
      .upgrade(async (tx) => {
        const [oldMetas, categories, items, sales, adjustments] = await Promise.all([
          tx.table('meta').toArray(),
          tx.table('categories').toArray(),
          tx.table('items').toArray(),
          tx.table('sales').toArray(),
          tx.table('adjustments').toArray(),
        ])

        const oldMeta = oldMetas[0] as Omit<Meta, 'id'> | undefined
        const now = new Date().toISOString()

        // Guardar copia en localBackups antes de aplicar la migración (SPEC sección 8)
        const backupPayload = {
          schemaVersion: oldMeta?.schemaVersion ?? 1,
          revision: oldMeta?.lastSyncedRevision ?? 0,
          exportedAt: now,
          deviceId: oldMeta?.deviceId ?? crypto.randomUUID(),
          categories,
          items,
          sales,
          adjustments,
        }

        const localBackupsTable = tx.table<LocalBackup>('localBackups')
        await localBackupsTable.add({
          id: crypto.randomUUID(),
          createdAt: now,
          schemaVersion: oldMeta?.schemaVersion ?? 1,
          data: JSON.stringify(backupPayload),
          reason: 'before-migration',
        })

        const allBackups = await localBackupsTable.orderBy('createdAt').toArray()
        if (allBackups.length > 3) {
          const toDelete = allBackups.slice(0, allBackups.length - 3)
          for (const old of toDelete) {
            await localBackupsTable.delete(old.id)
          }
        }

        // Migrar fila de meta a clave fija 'main'
        const migratedMeta: Meta = {
          id: META_KEY,
          schemaVersion: SCHEMA_VERSION,
          deviceId: oldMeta?.deviceId ?? crypto.randomUUID(),
          lastSyncedRevision: oldMeta?.lastSyncedRevision ?? 0,
          ...(oldMeta?.lastSyncedAt !== undefined ? { lastSyncedAt: oldMeta.lastSyncedAt } : {}),
          ...(oldMeta?.driveFileId !== undefined ? { driveFileId: oldMeta.driveFileId } : {}),
        }

        await tx.table('meta_v2_tmp').put(migratedMeta)
      })

    /**
     * Versión 2 — recrea `meta` con clave primaria `'id'` (valor fijo `'main'`)
     * y elimina el almacén temporal `meta_v2_tmp`.
     */
    this.version(SCHEMA_VERSION)
      .stores({
        meta_v2_tmp: null,
        meta: 'id',
      })
      .upgrade(async (tx) => {
        const tmpRows = await tx.table<Meta>('meta_v2_tmp').toArray()
        if (tmpRows.length > 0) {
          await tx.table<Meta>('meta').bulkPut(tmpRows)
        }
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

  // Crear o recuperar el registro Meta bajo la clave fija 'main'
  const existingMeta = await dbInstance.meta.get(META_KEY)
  if (!existingMeta) {
    await dbInstance.meta.put({
      id: META_KEY,
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
