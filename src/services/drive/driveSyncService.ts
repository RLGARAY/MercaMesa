/**
 * driveSyncService.ts — Orquestador de sincronización con Google Drive.
 *
 * Ref: SPEC.md sección 7.
 * REGLAS INNEGOCIABLES:
 *   - Los datos viven siempre en local; Drive es copia de seguridad / traspaso.
 *   - Sin sincronización automática ni fusión de datos.
 *   - Aislado tras la interfaz DriveClient para pruebas unitarias sin red.
 *   - Manejo de conflicto de revisión: si remoteRevision > meta.lastSyncedRevision,
 *     se avisa al usuario con 3 opciones: Cancelar, Reemplazar Drive o Restaurar primero.
 */

import type { DriveClient, RemoteFileMeta } from './driveClient'
import {
  createBackupPayload,
  parseAndValidateBackup,
  saveLocalBackup,
  CART_STORAGE_KEY,
  type BackupPayload,
  type ImportSummary,
} from '@/services/backupService'
import { db as defaultDb, type MercaMesaDB, SCHEMA_VERSION } from '@/db/db'
import type { Meta } from '@/types'

export type UploadResult =
  | { outcome: 'success'; revision: number; fileId: string; syncedAt: string }
  | { outcome: 'conflict'; remoteRevision: number; localRevision: number; remoteFileId: string }

export interface DriveRestorePreview {
  remoteMeta: RemoteFileMeta
  payload: BackupPayload
  summary: ImportSummary
}

/**
 * Obtiene el registro Meta actual de la base de datos local.
 */
export async function getLocalMeta(dbInstance: MercaMesaDB = defaultDb): Promise<Meta> {
  const meta = await dbInstance.meta.toCollection().first()
  if (!meta) {
    return {
      schemaVersion: SCHEMA_VERSION,
      deviceId: crypto.randomUUID(),
      lastSyncedRevision: 0,
    }
  }
  return meta
}

/**
 * Flujo "Actualizar a Drive" (RF-C8).
 * 1. Consulta la revisión remota en Drive.
 * 2. Comprueba si hay conflicto de revisión (remoteRevision > localRevision).
 * 3. Si hay conflicto y no se fuerza sobreescritura, retorna outcome 'conflict'.
 * 4. Si no hay conflicto o forceOverwrite=true, sube el backup con revision incrementada y actualiza meta.
 */
export async function uploadToDrive(
  driveClient: DriveClient,
  options: { forceOverwrite?: boolean } = {},
  dbInstance: MercaMesaDB = defaultDb,
): Promise<UploadResult> {
  const localMeta = await getLocalMeta(dbInstance)
  const remoteMeta = await driveClient.getFileMetadata()

  // Comprobar conflicto de revisión
  if (remoteMeta && remoteMeta.revision > localMeta.lastSyncedRevision && !options.forceOverwrite) {
    return {
      outcome: 'conflict',
      remoteRevision: remoteMeta.revision,
      localRevision: localMeta.lastSyncedRevision,
      remoteFileId: remoteMeta.fileId,
    }
  }

  // Calcular nueva revisión
  const baseRevision = remoteMeta
    ? Math.max(remoteMeta.revision, localMeta.lastSyncedRevision)
    : localMeta.lastSyncedRevision
  const nextRevision = baseRevision + 1

  // Crear payload local con la nueva revisión
  const payload = await createBackupPayload(dbInstance)
  payload.revision = nextRevision

  // Subir archivo a Drive
  const targetFileId = remoteMeta?.fileId || localMeta.driveFileId
  const result = await driveClient.uploadFile(payload, nextRevision, targetFileId)

  const syncedAt = new Date().toISOString()

  // Actualizar meta localmente
  await dbInstance.transaction('rw', dbInstance.meta, async () => {
    const existing = await dbInstance.meta.toCollection().first()
    if (existing) {
      await dbInstance.meta.update(existing.schemaVersion, {
        lastSyncedRevision: nextRevision,
        lastSyncedAt: syncedAt,
        driveFileId: result.fileId,
      })
    } else {
      await dbInstance.meta.add({
        schemaVersion: SCHEMA_VERSION,
        deviceId: payload.deviceId,
        lastSyncedRevision: nextRevision,
        lastSyncedAt: syncedAt,
        driveFileId: result.fileId,
      })
    }
  })

  return {
    outcome: 'success',
    revision: nextRevision,
    fileId: result.fileId,
    syncedAt,
  }
}

/**
 * Descarga y valida el archivo en Drive para previsualizar antes de restaurar (RF-C8).
 */
export async function fetchDriveRestorePreview(
  driveClient: DriveClient,
): Promise<DriveRestorePreview> {
  const remoteMeta = await driveClient.getFileMetadata()
  if (!remoteMeta) {
    throw new Error('No se encontró el archivo mercadillo-datos.json en tu Google Drive.')
  }

  const jsonStr = await driveClient.downloadFile(remoteMeta.fileId)
  const validation = parseAndValidateBackup(jsonStr)

  if (!validation.valid) {
    throw new Error(`El archivo de Drive no es válido: ${validation.error}`)
  }

  const payload = validation.payload

  return {
    remoteMeta,
    payload,
    summary: {
      categoriesCount: payload.categories.length,
      itemsCount: payload.items.length,
      salesCount: payload.sales.length,
      adjustmentsCount: payload.adjustments.length,
      exportedAt: payload.exportedAt,
    },
  }
}

/**
 * Aplica la restauración desde Drive reemplazando datos atómicamente
 * tras haber guardado una copia previa en localBackups (RF-C8).
 */
export async function applyDriveRestore(
  preview: DriveRestorePreview,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<ImportSummary> {
  const { payload, remoteMeta } = preview

  // 1. Guardar copia de seguridad previa innegociable
  await saveLocalBackup('before-restore', dbInstance)

  const syncedAt = new Date().toISOString()

  // 2. Transacción de reemplazo total atómica
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

      await dbInstance.meta.clear()
      await dbInstance.meta.add({
        schemaVersion: payload.schemaVersion,
        deviceId: payload.deviceId,
        lastSyncedRevision: remoteMeta.revision,
        lastSyncedAt: syncedAt,
        driveFileId: remoteMeta.fileId,
      })
    },
  )

  // 3. Resetear carrito si existe
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(CART_STORAGE_KEY)
    } catch {
      // Ignorar
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

/**
 * Formatea la fecha de última sincronización en texto relativo en español (RF-C9).
 */
export function formatLastSyncRelative(dateStr?: string, now = new Date()): string {
  if (!dateStr) {
    return 'Nunca sincronizado'
  }

  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  if (Number.isNaN(diffMs) || diffMs < 0) {
    return 'Reciente'
  }

  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) {
    return 'Hace unos segundos'
  }

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) {
    return `Hace ${diffMin} min`
  }

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) {
    return `Hace ${diffHours} h`
  }

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) {
    return 'Ayer'
  }
  if (diffDays < 7) {
    return `Hace ${diffDays} días`
  }

  return date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
