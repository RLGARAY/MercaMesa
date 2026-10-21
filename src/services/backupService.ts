/**
 * backupService.ts — Exportación, importación y copias locales de seguridad.
 *
 * Ref: SPEC.md secciones 7 y 8 (RF-C6, RF-C7, RF-C11).
 * REGLAS INNEGOCIABLES:
 *   - No perder datos del usuario: ANTES de importar, restaurar o resetear, guardar copia en localBackups.
 *   - Conservar como máximo las últimas 3 copias en localBackups.
 *   - Validar estrictamente la estructura y schemaVersion antes de tocar la base de datos.
 *   - Si schemaVersion del archivo > versión que entiende la app: RECHAZAR con mensaje claro.
 *   - Toda sustitución de datos se hace en UNA única transacción atómica Dexie.
 */

import type {
  Category,
  Item,
  Sale,
  StockAdjustment,
  LocalBackup,
  ID,
} from '@/types'
import { db as defaultDb, type MercaMesaDB, SCHEMA_VERSION, META_KEY, initDB } from '@/db/db'

export const CART_STORAGE_KEY = 'mercamesa_cart_v1'

/**
 * Estructura estándar del archivo JSON de copia de seguridad (SPEC sección 7).
 */
export interface BackupPayload {
  schemaVersion: number
  revision: number
  exportedAt: string
  deviceId: ID
  categories: Category[]
  items: Item[]
  sales: Sale[]
  adjustments: StockAdjustment[]
}

export interface ImportSummary {
  categoriesCount: number
  itemsCount: number
  salesCount: number
  adjustmentsCount: number
  exportedAt: string
}

// ---------------------------------------------------------------------------
// Validación pura de backup
// ---------------------------------------------------------------------------

/**
 * Valida que un objeto desconocido cumpla con la estructura de BackupPayload
 * y que schemaVersion no sea superior a la versión actual de la app.
 */
export function validateBackupPayload(
  data: unknown,
): { valid: true; payload: BackupPayload } | { valid: false; error: string } {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'El archivo no contiene un objeto JSON válido' }
  }

  const obj = data as Record<string, unknown>

  // 1. Validar schemaVersion
  if (typeof obj.schemaVersion !== 'number' || !Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) {
    return { valid: false, error: 'El archivo no contiene una versión de esquema válida' }
  }

  if (obj.schemaVersion > SCHEMA_VERSION) {
    return {
      valid: false,
      error: `El archivo es de una versión más nueva (v${obj.schemaVersion}). Actualiza la app para poder importarlo.`,
    }
  }

  // 2. Validar metadatos requeridos
  if (typeof obj.exportedAt !== 'string' || !obj.exportedAt) {
    return { valid: false, error: 'El archivo no contiene la fecha de exportación' }
  }

  if (typeof obj.deviceId !== 'string' || !obj.deviceId) {
    return { valid: false, error: 'El archivo no contiene el identificador de dispositivo' }
  }

  // 3. Validar arrays de datos
  if (!Array.isArray(obj.categories)) {
    return { valid: false, error: 'Falta la colección de categorías en el archivo' }
  }
  if (!Array.isArray(obj.items)) {
    return { valid: false, error: 'Falta la colección de artículos en el archivo' }
  }
  if (!Array.isArray(obj.sales)) {
    return { valid: false, error: 'Falta la colección de ventas en el archivo' }
  }
  if (!Array.isArray(obj.adjustments)) {
    return { valid: false, error: 'Falta la colección de ajustes de inventario en el archivo' }
  }

  const payload: BackupPayload = migrateBackupPayload({
    schemaVersion: obj.schemaVersion,
    revision: typeof obj.revision === 'number' ? obj.revision : 1,
    exportedAt: obj.exportedAt,
    deviceId: obj.deviceId,
    categories: obj.categories as Category[],
    items: obj.items as Item[],
    sales: obj.sales as Sale[],
    adjustments: obj.adjustments as StockAdjustment[],
  })

  return { valid: true, payload }
}

/**
 * Migra un BackupPayload de una versión anterior (p. ej. v1) al esquema actual (SPEC sección 8).
 * En v1 -> v2 las colecciones exportadas mantienen su estructura y se normaliza schemaVersion.
 */
export function migrateBackupPayload(payload: BackupPayload): BackupPayload {
  if (payload.schemaVersion >= SCHEMA_VERSION) {
    return payload
  }
  return {
    ...payload,
    schemaVersion: SCHEMA_VERSION,
  }
}

/**
 * Parsea un string JSON y valida su contenido como BackupPayload.
 */
export function parseAndValidateBackup(
  jsonString: string,
): { valid: true; payload: BackupPayload } | { valid: false; error: string } {
  try {
    const data = JSON.parse(jsonString)
    return validateBackupPayload(data)
  } catch {
    return { valid: false, error: 'El archivo no contiene un JSON válido o está dañado' }
  }
}

// ---------------------------------------------------------------------------
// Exportación (RF-C6)
// ---------------------------------------------------------------------------

/**
 * Genera el objeto BackupPayload completo a partir de la base de datos local.
 */
export async function createBackupPayload(
  dbInstance: MercaMesaDB = defaultDb,
): Promise<BackupPayload> {
  const meta = await dbInstance.meta.get(META_KEY)
  const [categories, items, sales, adjustments] = await Promise.all([
    dbInstance.categories.toArray(),
    dbInstance.items.toArray(),
    dbInstance.sales.toArray(),
    dbInstance.adjustments.toArray(),
  ])

  return {
    schemaVersion: SCHEMA_VERSION,
    revision: meta?.lastSyncedRevision ?? 0,
    exportedAt: new Date().toISOString(),
    deviceId: meta?.deviceId ?? crypto.randomUUID(),
    categories,
    items,
    sales,
    adjustments,
  }
}

/**
 * Descarga el archivo de copia JSON en el navegador del usuario (RF-C6).
 */
export async function downloadBackupFile(
  dbInstance: MercaMesaDB = defaultDb,
): Promise<string> {
  const payload = await createBackupPayload(dbInstance)
  const jsonStr = JSON.stringify(payload, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json' })

  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '')
  const fileName = `mercadillo-datos-${dateStr}-${timeStr}.json`

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  return fileName
}

// ---------------------------------------------------------------------------
// Copias locales de seguridad (localBackups) - SPEC sección 7
// ---------------------------------------------------------------------------

/**
 * Guarda una instantánea del estado local completo en la tabla localBackups
 * y conserva un máximo de 3 copias (elimina las más antiguas).
 */
export async function saveLocalBackup(
  reason: LocalBackup['reason'],
  dbInstance: MercaMesaDB = defaultDb,
): Promise<LocalBackup> {
  const payload = await createBackupPayload(dbInstance)
  const now = new Date().toISOString()

  const backup: LocalBackup = {
    id: crypto.randomUUID(),
    createdAt: now,
    schemaVersion: SCHEMA_VERSION,
    data: JSON.stringify(payload),
    reason,
  }

  await dbInstance.transaction('rw', dbInstance.localBackups, async () => {
    await dbInstance.localBackups.add(backup)

    // Conservar solo las 3 más recientes
    const all = await dbInstance.localBackups.orderBy('createdAt').toArray()
    if (all.length > 3) {
      const toDelete = all.slice(0, all.length - 3)
      for (const old of toDelete) {
        await dbInstance.localBackups.delete(old.id)
      }
    }
  })

  return backup
}

/**
 * Obtiene la lista de copias locales de seguridad guardadas en localBackups,
 * ordenadas de la más reciente a la más antigua.
 */
export async function getLocalBackups(
  dbInstance: MercaMesaDB = defaultDb,
): Promise<LocalBackup[]> {
  const list = await dbInstance.localBackups.toArray()
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ---------------------------------------------------------------------------
// Aplicación de Backup atómica
// ---------------------------------------------------------------------------

async function applyBackupPayload(
  payload: BackupPayload,
  reason: LocalBackup['reason'],
  dbInstance: MercaMesaDB = defaultDb,
): Promise<ImportSummary> {
  // 1. Guardar copia previa innegociable
  await saveLocalBackup(reason, dbInstance)

  // 2. Transacción atómica de reemplazo total
  await dbInstance.transaction(
    'rw',
    [
      dbInstance.categories,
      dbInstance.items,
      dbInstance.sales,
      dbInstance.adjustments,
      dbInstance.meta,
    ],
    async () => {
      // Limpiar colecciones actuales
      await dbInstance.categories.clear()
      await dbInstance.items.clear()
      await dbInstance.sales.clear()
      await dbInstance.adjustments.clear()

      // Insertar nuevos datos
      if (payload.categories.length > 0) {
        await dbInstance.categories.bulkAdd(payload.categories)
      }
      if (payload.items.length > 0) {
        await dbInstance.items.bulkAdd(payload.items)
      }
      if (payload.sales.length > 0) {
        await dbInstance.sales.bulkAdd(payload.sales)
      }
      if (payload.adjustments.length > 0) {
        await dbInstance.adjustments.bulkAdd(payload.adjustments)
      }

      // Actualizar registro Meta bajo clave fija 'main'
      await dbInstance.meta.clear()
      await dbInstance.meta.put({
        id: META_KEY,
        schemaVersion: SCHEMA_VERSION,
        deviceId: payload.deviceId,
        lastSyncedRevision: payload.revision,
      })
    },
  )

  // 3. Resetear carrito en localStorage si existe para evitar referencias a artículos inexistentes
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(CART_STORAGE_KEY)
    } catch {
      // Ignorar errores en entornos sin localStorage
    }
  }

  return {
    categoriesCount: payload.categories.length,
    itemsCount: payload.items.length,
    salesCount: payload.sales.length,
    adjustmentsCount: payload.adjustments.length,
    exportedAt: payload.exportedAt,
  }
}

// ---------------------------------------------------------------------------
// Importación (RF-C7)
// ---------------------------------------------------------------------------

/**
 * Importa los datos desde un BackupPayload:
 * 1. Guarda copia local en localBackups ('before-import').
 * 2. En una única transacción Dexie atómica, reemplaza las tablas de datos.
 * 3. Actualiza el registro Meta.
 */
export async function importBackupPayload(
  payload: BackupPayload,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<ImportSummary> {
  return applyBackupPayload(payload, 'before-import', dbInstance)
}

/**
 * Restaura el estado desde una copia de seguridad en localBackups:
 * 1. Valida el JSON almacenado.
 * 2. Guarda copia previa ('before-restore').
 * 3. Reemplaza los datos atómicamente.
 */
export async function restoreLocalBackup(
  backupId: ID,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<ImportSummary> {
  const backup = await dbInstance.localBackups.get(backupId)
  if (!backup) {
    throw new Error('No se encontró la copia de seguridad solicitada')
  }

  const result = parseAndValidateBackup(backup.data)
  if (!result.valid) {
    throw new Error(`Copia corrupta: ${result.error}`)
  }

  return applyBackupPayload(result.payload, 'before-restore', dbInstance)
}

// ---------------------------------------------------------------------------
// Zona de peligro: Resetear todos los datos locales (RF-C11)
// ---------------------------------------------------------------------------

/**
 * Borra todos los datos locales y restablece el estado inicial.
 * Guarda una copia de seguridad previa en localBackups antes de borrar.
 */
export async function resetAllData(
  dbInstance: MercaMesaDB = defaultDb,
): Promise<void> {
  // 1. Guardar copia de seguridad previa
  await saveLocalBackup('before-migration', dbInstance)

  // 2. Limpiar todas las tablas de negocio
  await dbInstance.transaction(
    'rw',
    [
      dbInstance.categories,
      dbInstance.items,
      dbInstance.sales,
      dbInstance.adjustments,
      dbInstance.meta,
    ],
    async () => {
      await dbInstance.categories.clear()
      await dbInstance.items.clear()
      await dbInstance.sales.clear()
      await dbInstance.adjustments.clear()
      await dbInstance.meta.clear()
    },
  )

  // 3. Limpiar carrito de localStorage
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(CART_STORAGE_KEY)
    } catch {
      // Ignorar errores
    }
  }

  // 4. Recrear categorías iniciales por defecto y meta (RN-9)
  await initDB(dbInstance)
}
