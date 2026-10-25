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
  SaleLine,
  StockAdjustment,
  LocalBackup,
  ID,
} from '@/types'
import { db as defaultDb, type MercaMesaDB, SCHEMA_VERSION, META_KEY, initDB } from '@/db/db'
import { verifyStockConsistency } from '@/services/itemService'

export const CART_STORAGE_KEY = 'mercamesa_cart_v1'

export interface StockInconsistency {
  item: Item
  expected: number
  actual: number
}

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
  inconsistencies: StockInconsistency[]
}

export type BackupValidationResult =
  | { valid: true; payload: BackupPayload }
  | { valid: false; error: string; errors: string[] }

// ---------------------------------------------------------------------------
// Validación pura de backup (A2)
// ---------------------------------------------------------------------------

const MAX_VALIDATION_ERRORS = 10
const VALID_ADJUSTMENT_REASONS = new Set(['initial', 'restock', 'correction', 'loss', 'other'])

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0
}

function isValidIsoDateString(val: unknown): val is string {
  if (typeof val !== 'string' || val.trim().length === 0) return false
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) return false
  return !Number.isNaN(Date.parse(val))
}

/**
 * Valida que un objeto desconocido cumpla con la estructura de BackupPayload,
 * que schemaVersion no sea superior a la versión actual de la app, y que cada
 * registro, referencia e invariante de venta sea íntegro (A2).
 */
export function validateBackupPayload(data: unknown): BackupValidationResult {
  if (!isRecord(data)) {
    const msg = 'El archivo no contiene un objeto JSON válido'
    return { valid: false, error: msg, errors: [msg] }
  }

  const obj = data

  // 1. Validar schemaVersion
  if (typeof obj.schemaVersion !== 'number' || !Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) {
    const msg = 'El archivo no contiene una versión de esquema válida'
    return { valid: false, error: msg, errors: [msg] }
  }

  if (obj.schemaVersion > SCHEMA_VERSION) {
    const msg = `El archivo es de una versión más nueva (v${obj.schemaVersion}). Actualiza la app para poder importarlo.`
    return { valid: false, error: msg, errors: [msg] }
  }

  // 2. Validar metadatos requeridos
  if (!isValidIsoDateString(obj.exportedAt)) {
    const msg = 'El archivo no contiene una fecha de exportación ISO válida'
    return { valid: false, error: msg, errors: [msg] }
  }

  if (!isNonEmptyString(obj.deviceId)) {
    const msg = 'El archivo no contiene el identificador de dispositivo'
    return { valid: false, error: msg, errors: [msg] }
  }

  if (obj.revision !== undefined && (typeof obj.revision !== 'number' || !Number.isInteger(obj.revision) || obj.revision < 0)) {
    const msg = 'El número de revisión del archivo no es un entero válido'
    return { valid: false, error: msg, errors: [msg] }
  }

  // 3. Validar que las colecciones sean arrays
  if (!Array.isArray(obj.categories)) {
    const msg = 'Falta la colección de categorías en el archivo'
    return { valid: false, error: msg, errors: [msg] }
  }
  if (!Array.isArray(obj.items)) {
    const msg = 'Falta la colección de artículos en el archivo'
    return { valid: false, error: msg, errors: [msg] }
  }
  if (!Array.isArray(obj.sales)) {
    const msg = 'Falta la colección de ventas en el archivo'
    return { valid: false, error: msg, errors: [msg] }
  }
  if (!Array.isArray(obj.adjustments)) {
    const msg = 'Falta la colección de ajustes de inventario en el archivo'
    return { valid: false, error: msg, errors: [msg] }
  }

  const errors: string[] = []
  const addError = (msg: string) => {
    if (errors.length < MAX_VALIDATION_ERRORS) {
      errors.push(msg)
    }
  }

  // 4. Validar categorías y unicidad de IDs
  const categoryIds = new Set<string>()
  for (let i = 0; i < obj.categories.length; i++) {
    const raw = obj.categories[i]
    const label = `Categoría #${i + 1}`
    if (!isRecord(raw)) {
      addError(`${label}: no es un objeto válido`)
      continue
    }
    if (!isNonEmptyString(raw.id)) {
      addError(`${label}: id ausente o inválido`)
    } else if (categoryIds.has(raw.id)) {
      addError(`${label} (${raw.id}): id de categoría duplicado`)
    } else {
      categoryIds.add(raw.id)
    }
    if (!isNonEmptyString(raw.name)) {
      addError(`${label}: nombre vacío o inválido`)
    }
    if (typeof raw.sortOrder !== 'number' || !Number.isInteger(raw.sortOrder)) {
      addError(`${label}: sortOrder debe ser un entero`)
    }
    if (typeof raw.archived !== 'boolean') {
      addError(`${label}: archived debe ser booleano`)
    }
  }

  // 5. Validar artículos, unicidad de IDs e integridad referencial con categorías
  const itemIds = new Set<string>()
  for (let i = 0; i < obj.items.length; i++) {
    const raw = obj.items[i]
    const label = `Artículo #${i + 1}`
    if (!isRecord(raw)) {
      addError(`${label}: no es un objeto válido`)
      continue
    }
    if (!isNonEmptyString(raw.id)) {
      addError(`${label}: id ausente o inválido`)
    } else if (itemIds.has(raw.id)) {
      addError(`${label} (${raw.id}): id de artículo duplicado`)
    } else {
      itemIds.add(raw.id)
    }
    if (!isNonEmptyString(raw.name)) {
      addError(`${label}: nombre vacío o inválido`)
    }
    if (!isNonEmptyString(raw.categoryId) || !categoryIds.has(raw.categoryId)) {
      addError(`${label}: categoryId (${String(raw.categoryId)}) no referencia una categoría existente`)
    }
    if (typeof raw.priceCents !== 'number' || !Number.isInteger(raw.priceCents) || raw.priceCents <= 0) {
      addError(`${label}: priceCents debe ser un entero > 0`)
    }
    if (typeof raw.stock !== 'number' || !Number.isInteger(raw.stock)) {
      addError(`${label}: stock debe ser un número entero`)
    }
    if (raw.imageThumb !== undefined && typeof raw.imageThumb !== 'string') {
      addError(`${label}: imageThumb debe ser texto si está presente`)
    }
    if (typeof raw.archived !== 'boolean') {
      addError(`${label}: archived debe ser booleano`)
    }
    if (!isValidIsoDateString(raw.createdAt)) {
      addError(`${label}: createdAt no es una fecha ISO válida`)
    }
    if (!isValidIsoDateString(raw.updatedAt)) {
      addError(`${label}: updatedAt no es una fecha ISO válida`)
    }
  }

  // 6. Validar ventas, líneas, referencias a artículos e invariantes aritméticos
  const saleIds = new Set<string>()
  for (let i = 0; i < obj.sales.length; i++) {
    const raw = obj.sales[i]
    const label = `Venta #${i + 1}`
    if (!isRecord(raw)) {
      addError(`${label}: no es un objeto válido`)
      continue
    }
    if (!isNonEmptyString(raw.id)) {
      addError(`${label}: id ausente o inválido`)
    } else if (saleIds.has(raw.id)) {
      addError(`${label} (${raw.id}): id de venta duplicado`)
    } else {
      saleIds.add(raw.id)
    }
    if (!isValidIsoDateString(raw.createdAt)) {
      addError(`${label}: createdAt no es una fecha ISO válida`)
    }
    if (raw.status !== 'active' && raw.status !== 'voided') {
      addError(`${label}: status inválido (${String(raw.status)})`)
    }
    if (raw.voidedAt !== undefined && !isValidIsoDateString(raw.voidedAt)) {
      addError(`${label}: voidedAt no es una fecha ISO válida`)
    }
    if (raw.voidReason !== undefined && raw.voidReason !== 'undo' && raw.voidReason !== 'manual') {
      addError(`${label}: voidReason inválido (${String(raw.voidReason)})`)
    }
    if (typeof raw.subtotalCents !== 'number' || !Number.isInteger(raw.subtotalCents) || raw.subtotalCents < 0) {
      addError(`${label}: subtotalCents debe ser un entero >= 0`)
    }
    if (typeof raw.discountCents !== 'number' || !Number.isInteger(raw.discountCents) || raw.discountCents < 0) {
      addError(`${label}: discountCents debe ser un entero >= 0`)
    }
    if (typeof raw.totalCents !== 'number' || !Number.isInteger(raw.totalCents) || raw.totalCents < 0) {
      addError(`${label}: totalCents debe ser un entero >= 0`)
    }

    if (!Array.isArray(raw.lines) || raw.lines.length === 0) {
      addError(`${label}: debe contener al menos una línea de venta`)
      continue
    }

    let sumLineList = 0
    let sumLineDiscount = 0
    let linesAreNumbersValid = true

    for (let j = 0; j < raw.lines.length; j++) {
      const lRaw = raw.lines[j] as unknown
      const lineLabel = `${label}, línea #${j + 1}`
      if (!isRecord(lRaw)) {
        addError(`${lineLabel}: no es un objeto válido`)
        linesAreNumbersValid = false
        continue
      }
      if (!isNonEmptyString(lRaw.itemId) || !itemIds.has(lRaw.itemId)) {
        addError(`${lineLabel}: itemId (${String(lRaw.itemId)}) no referencia un artículo existente`)
      }
      if (!isNonEmptyString(lRaw.nameSnapshot)) {
        addError(`${lineLabel}: nameSnapshot vacío o inválido`)
      }
      if (!isNonEmptyString(lRaw.categoryIdSnapshot)) {
        addError(`${lineLabel}: categoryIdSnapshot vacío o inválido`)
      }
      if (typeof lRaw.unitPriceCents !== 'number' || !Number.isInteger(lRaw.unitPriceCents) || lRaw.unitPriceCents <= 0) {
        addError(`${lineLabel}: unitPriceCents debe ser un entero > 0`)
        linesAreNumbersValid = false
      }
      if (typeof lRaw.quantity !== 'number' || !Number.isInteger(lRaw.quantity) || lRaw.quantity < 1) {
        addError(`${lineLabel}: quantity debe ser un entero >= 1`)
        linesAreNumbersValid = false
      }
      if (typeof lRaw.lineListCents !== 'number' || !Number.isInteger(lRaw.lineListCents) || lRaw.lineListCents < 0) {
        addError(`${lineLabel}: lineListCents debe ser un entero >= 0`)
        linesAreNumbersValid = false
      }
      if (typeof lRaw.lineDiscountCents !== 'number' || !Number.isInteger(lRaw.lineDiscountCents) || lRaw.lineDiscountCents < 0) {
        addError(`${lineLabel}: lineDiscountCents debe ser un entero >= 0`)
        linesAreNumbersValid = false
      }
      if (typeof lRaw.lineNetCents !== 'number' || !Number.isInteger(lRaw.lineNetCents) || lRaw.lineNetCents < 0) {
        addError(`${lineLabel}: lineNetCents debe ser un entero >= 0`)
        linesAreNumbersValid = false
      }

      if (linesAreNumbersValid) {
        const line = lRaw as unknown as SaleLine
        if (line.lineListCents !== line.unitPriceCents * line.quantity) {
          addError(`${lineLabel}: lineListCents (${line.lineListCents}) != unitPriceCents × quantity (${line.unitPriceCents * line.quantity})`)
        }
        if (line.lineDiscountCents > line.lineListCents) {
          addError(`${lineLabel}: lineDiscountCents (${line.lineDiscountCents}) supera lineListCents (${line.lineListCents})`)
        }
        if (line.lineNetCents !== line.lineListCents - line.lineDiscountCents) {
          addError(`${lineLabel}: lineNetCents (${line.lineNetCents}) != lineListCents − lineDiscountCents`)
        }
        sumLineList += line.lineListCents
        sumLineDiscount += line.lineDiscountCents
      }
    }

    if (
      linesAreNumbersValid &&
      typeof raw.subtotalCents === 'number' &&
      typeof raw.discountCents === 'number' &&
      typeof raw.totalCents === 'number'
    ) {
      if (raw.subtotalCents !== sumLineList) {
        addError(`${label}: subtotalCents (${raw.subtotalCents}) != suma de lineListCents (${sumLineList})`)
      }
      if (raw.discountCents > raw.subtotalCents) {
        addError(`${label}: discountCents (${raw.discountCents}) supera subtotalCents (${raw.subtotalCents})`)
      }
      if (sumLineDiscount !== raw.discountCents) {
        addError(`${label}: suma de lineDiscountCents (${sumLineDiscount}) != discountCents (${raw.discountCents})`)
      }
      if (raw.totalCents !== raw.subtotalCents - raw.discountCents) {
        addError(`${label}: totalCents (${raw.totalCents}) != subtotalCents − discountCents (${raw.subtotalCents - raw.discountCents})`)
      }
    }
  }

  // 7. Validar ajustes de stock, unicidad e integridad referencial
  const adjIds = new Set<string>()
  for (let i = 0; i < obj.adjustments.length; i++) {
    const raw = obj.adjustments[i]
    const label = `Ajuste #${i + 1}`
    if (!isRecord(raw)) {
      addError(`${label}: no es un objeto válido`)
      continue
    }
    if (!isNonEmptyString(raw.id)) {
      addError(`${label}: id ausente o inválido`)
    } else if (adjIds.has(raw.id)) {
      addError(`${label} (${raw.id}): id de ajuste duplicado`)
    } else {
      adjIds.add(raw.id)
    }
    if (!isValidIsoDateString(raw.createdAt)) {
      addError(`${label}: createdAt no es una fecha ISO válida`)
    }
    if (!isNonEmptyString(raw.itemId) || !itemIds.has(raw.itemId)) {
      addError(`${label}: itemId (${String(raw.itemId)}) no referencia un artículo existente`)
    }
    if (typeof raw.delta !== 'number' || !Number.isInteger(raw.delta)) {
      addError(`${label}: delta debe ser un número entero`)
    }
    if (typeof raw.reason !== 'string' || !VALID_ADJUSTMENT_REASONS.has(raw.reason)) {
      addError(`${label}: reason inválido (${String(raw.reason)})`)
    }
    if (raw.note !== undefined && typeof raw.note !== 'string') {
      addError(`${label}: note debe ser texto si está presente`)
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: `Archivo inválido (${errors.length} error(es)): ${errors.join(' | ')}`,
      errors,
    }
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
): BackupValidationResult {
  try {
    const data = JSON.parse(jsonString)
    return validateBackupPayload(data)
  } catch {
    const msg = 'El archivo no contiene un JSON válido o está dañado'
    return { valid: false, error: msg, errors: [msg] }
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
 * Error específico cuando IndexedDB rechaza guardar en localBackups por falta de espacio / cuota (E4).
 */
export class BackupQuotaError extends Error {
  constructor(
    message = 'No hay espacio suficiente (cuota agotada) en el dispositivo para guardar la copia de seguridad previa.',
  ) {
    super(message)
    this.name = 'BackupQuotaError'
  }
}

export interface BackupApplyOptions {
  skipPreBackup?: boolean
}

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

  try {
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
  } catch (err) {
    const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err)
    if (/quota|espacio|storage/i.test(msg)) {
      throw new BackupQuotaError()
    }
    throw err
  }

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
  rawPayload: BackupPayload,
  reason: LocalBackup['reason'],
  dbInstance: MercaMesaDB = defaultDb,
  options?: BackupApplyOptions,
): Promise<ImportSummary> {
  // 0. Validar todo o nada antes de tocar la base de datos ni crear backups (A2)
  const validation = validateBackupPayload(rawPayload)
  if (!validation.valid) {
    throw new Error(validation.error)
  }
  const payload = validation.payload

  // 1. Guardar copia previa innegociable (salvo confirmación explícita ante falta de cuota, E4)
  if (!options?.skipPreBackup) {
    await saveLocalBackup(reason, dbInstance)
  }

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

      // Actualizar registro Meta bajo clave fija 'main' preservando preferencias locales del dispositivo (C1)
      const prevMeta = await dbInstance.meta.get(META_KEY)
      await dbInstance.meta.clear()
      await dbInstance.meta.put({
        id: META_KEY,
        schemaVersion: SCHEMA_VERSION,
        deviceId: payload.deviceId,
        lastSyncedRevision: payload.revision,
        ...(prevMeta?.lowStockThreshold !== undefined
          ? { lowStockThreshold: prevMeta.lowStockThreshold }
          : {}),
        ...(prevMeta?.saleSort !== undefined
          ? { saleSort: prevMeta.saleSort }
          : {}),
        ...(prevMeta?.hideOutOfStock !== undefined
          ? { hideOutOfStock: prevMeta.hideOutOfStock }
          : {}),
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

  // 4. Comprobar consistencia de inventario tras importar sin corregir en silencio (A2)
  const inconsistencies = await verifyStockConsistency(dbInstance)

  return {
    categoriesCount: payload.categories.length,
    itemsCount: payload.items.length,
    salesCount: payload.sales.length,
    adjustmentsCount: payload.adjustments.length,
    exportedAt: payload.exportedAt,
    inconsistencies,
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
  options?: BackupApplyOptions,
): Promise<ImportSummary> {
  return applyBackupPayload(payload, 'before-import', dbInstance, options)
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
  options?: BackupApplyOptions,
): Promise<ImportSummary> {
  const backup = await dbInstance.localBackups.get(backupId)
  if (!backup) {
    throw new Error('No se encontró la copia de seguridad solicitada')
  }

  const result = parseAndValidateBackup(backup.data)
  if (!result.valid) {
    throw new Error(`Copia corrupta: ${result.error}`)
  }

  return applyBackupPayload(result.payload, 'before-restore', dbInstance, options)
}

// ---------------------------------------------------------------------------
// Zona de peligro: Resetear todos los datos locales (RF-C11)
// ---------------------------------------------------------------------------

/**
 * Borra todos los datos locales y restablece el estado inicial.
 * Guarda una copia de seguridad previa en localBackups ('before-reset') antes de borrar.
 */
export async function resetAllData(
  dbInstance: MercaMesaDB = defaultDb,
  options?: BackupApplyOptions,
): Promise<void> {
  // 1. Guardar copia de seguridad previa (E3, E4)
  if (!options?.skipPreBackup) {
    await saveLocalBackup('before-reset', dbInstance)
  }

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
