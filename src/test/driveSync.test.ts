import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MercaMesaDB, initDB } from '@/db/db'
import type { DriveClient, RemoteFileMeta } from '@/services/drive/driveClient'
import {
  uploadToDrive,
  fetchDriveRestorePreview,
  applyDriveRestore,
  formatLastSyncRelative,
  getLocalMeta,
} from '@/services/drive/driveSyncService'
import { createItem, verifyStockConsistency } from '@/services/itemService'
import { getActiveCategories } from '@/services/categoryService'
import { getLocalBackups, type BackupPayload } from '@/services/backupService'

/**
 * Cliente de Drive simulado en memoria para tests sin red (SPEC sección 7).
 */
class InMemoryDriveClient implements DriveClient {
  public file: {
    fileId: string
    revision: number
    content: string
  } | null = null

  async getFileMetadata(): Promise<RemoteFileMeta | null> {
    if (!this.file) return null
    return {
      fileId: this.file.fileId,
      revision: this.file.revision,
    }
  }

  async uploadFile(
    payload: BackupPayload,
    revision: number,
    existingFileId?: string,
  ): Promise<RemoteFileMeta> {
    const fileId = existingFileId || 'drive-file-' + crypto.randomUUID()
    this.file = {
      fileId,
      revision,
      content: JSON.stringify(payload),
    }
    return {
      fileId,
      revision,
    }
  }

  async downloadFile(fileId: string): Promise<string> {
    if (!this.file || this.file.fileId !== fileId) {
      throw new Error('Archivo no encontrado en Drive')
    }
    return this.file.content
  }
}

describe('driveSyncService (RF-C8, RF-C9, SPEC sección 7)', () => {
  let testDb: MercaMesaDB
  let mockClient: InMemoryDriveClient

  beforeEach(async () => {
    testDb = new MercaMesaDB(`test-drive-${crypto.randomUUID()}`)
    await initDB(testDb)
    mockClient = new InMemoryDriveClient()
  })

  afterEach(async () => {
    await testDb.delete()
  })

  describe('Subida inicial y consecutiva a Drive', () => {
    it('primera subida a Drive vacío crea el archivo con revisión 1 y actualiza meta', async () => {
      const cats = await getActiveCategories(testDb)
      await createItem(
        {
          name: 'Colgante sol',
          categoryId: cats[0]!.id,
          priceCents: 1500,
          stockInitial: 5,
        },
        testDb,
      )

      const result = await uploadToDrive(mockClient, {}, testDb)
      expect(result.outcome).toBe('success')
      if (result.outcome === 'success') {
        expect(result.revision).toBe(1)
        expect(result.fileId).toBeTruthy()
      }

      // Comprobar que en Drive el archivo tiene revisión 1
      const remote = await mockClient.getFileMetadata()
      expect(remote?.revision).toBe(1)

      // Comprobar que meta local se ha actualizado
      const meta = await getLocalMeta(testDb)
      expect(meta.lastSyncedRevision).toBe(1)
      expect(meta.driveFileId).toBe(remote?.fileId)
      expect(meta.lastSyncedAt).toBeTruthy()
    })

    it('subidas consecutivas incrementan la revisión (revisión 2)', async () => {
      // Primera subida (rev 1)
      await uploadToDrive(mockClient, {}, testDb)

      // Segunda subida
      const result2 = await uploadToDrive(mockClient, {}, testDb)
      expect(result2.outcome).toBe('success')
      if (result2.outcome === 'success') {
        expect(result2.revision).toBe(2)
      }

      const meta = await getLocalMeta(testDb)
      expect(meta.lastSyncedRevision).toBe(2)
    })
  })

  describe('Detección y resolución de conflicto de revisión (SPEC sección 7)', () => {
    it('detecta conflicto cuando la revisión en Drive es superior a la local (remoteRevision > localRevision)', async () => {
      // 1. Subida local inicial (rev 1)
      await uploadToDrive(mockClient, {}, testDb)

      // 2. Simular que otro dispositivo subió cambios a Drive hasta la revisión 4
      if (mockClient.file) {
        mockClient.file.revision = 4
      }

      // 3. Intento de subida desde este dispositivo (que solo conoce rev 1)
      const result = await uploadToDrive(mockClient, {}, testDb)

      expect(result.outcome).toBe('conflict')
      if (result.outcome === 'conflict') {
        expect(result.remoteRevision).toBe(4)
        expect(result.localRevision).toBe(1)
      }

      // Comprobar que ni la base local ni Drive se han modificado
      const meta = await getLocalMeta(testDb)
      expect(meta.lastSyncedRevision).toBe(1)
      expect(mockClient.file?.revision).toBe(4)
    })

    it('permite resolver el conflicto forzando sobreescritura (forceOverwrite = true)', async () => {
      await uploadToDrive(mockClient, {}, testDb)

      // Drive tiene revisión 4
      if (mockClient.file) {
        mockClient.file.revision = 4
      }

      // Forzar sobreescritura
      const result = await uploadToDrive(mockClient, { forceOverwrite: true }, testDb)
      expect(result.outcome).toBe('success')
      if (result.outcome === 'success') {
        // La nueva revisión es max(4, 1) + 1 = 5
        expect(result.revision).toBe(5)
      }

      const meta = await getLocalMeta(testDb)
      expect(meta.lastSyncedRevision).toBe(5)
      expect(mockClient.file?.revision).toBe(5)
    })
  })

  describe('Restaurar desde Drive (RF-C8)', () => {
    it('descarga, previsualiza y restaura datos de Drive guardando copia de seguridad previa', async () => {
      const cats = await getActiveCategories(testDb)
      const remotePayload: BackupPayload = {
        schemaVersion: 1,
        revision: 3,
        exportedAt: '2026-10-17T12:00:00.000Z',
        deviceId: 'other-device',
        categories: cats,
        items: [
          {
            id: 'item-remoto-1',
            categoryId: cats[0]!.id,
            name: 'Pendiente luna remoto',
            priceCents: 1800,
            stock: 7,
            archived: false,
            createdAt: '2026-10-17T12:00:00.000Z',
            updatedAt: '2026-10-17T12:00:00.000Z',
          },
        ],
        sales: [],
        adjustments: [
          {
            id: 'adj-remoto-1',
            itemId: 'item-remoto-1',
            createdAt: '2026-10-17T12:00:00.000Z',
            delta: 7,
            reason: 'initial',
          },
        ],
      }

      mockClient.file = {
        fileId: 'file-123',
        revision: 3,
        content: JSON.stringify(remotePayload),
      }

      // 1. Previsualizar
      const preview = await fetchDriveRestorePreview(mockClient)
      expect(preview.remoteMeta.revision).toBe(3)
      expect(preview.summary.itemsCount).toBe(1)
      expect(preview.payload.items[0]?.name).toBe('Pendiente luna remoto')

      // 2. Aplicar restauración
      const summary = await applyDriveRestore(preview, testDb)
      expect(summary.itemsCount).toBe(1)

      // Verificar que los datos en la base local son los de Drive
      const items = await testDb.items.toArray()
      expect(items).toHaveLength(1)
      expect(items[0]?.name).toBe('Pendiente luna remoto')

      // Verificar consistencia de inventario
      const inconsistencies = await verifyStockConsistency(testDb)
      expect(inconsistencies).toHaveLength(0)

      // Verificar que se guardó una copia automática en localBackups con 'before-restore'
      const backups = await getLocalBackups(testDb)
      expect(backups.length).toBeGreaterThanOrEqual(1)
      expect(backups[0]?.reason).toBe('before-restore')

      // Verificar que meta local se actualizó con la revisión de Drive
      const meta = await getLocalMeta(testDb)
      expect(meta.lastSyncedRevision).toBe(3)
      expect(meta.driveFileId).toBe('file-123')
      expect(meta.lastSyncedAt).toBeTruthy()
    })

    it('rechaza restaurar si no existe archivo en Drive', async () => {
      mockClient.file = null
      await expect(fetchDriveRestorePreview(mockClient)).rejects.toThrow(
        /No se encontró el archivo/i,
      )
    })
  })

  describe('formatLastSyncRelative (RF-C9)', () => {
    it('devuelve "Nunca sincronizado" si no hay fecha', () => {
      expect(formatLastSyncRelative(undefined)).toBe('Nunca sincronizado')
      expect(formatLastSyncRelative('')).toBe('Nunca sincronizado')
    })

    it('formatea fechas recientes correctamente', () => {
      const now = new Date('2026-10-17T14:30:00Z')

      // 20 segundos antes
      const t1 = new Date('2026-10-17T14:29:40Z').toISOString()
      expect(formatLastSyncRelative(t1, now)).toBe('Hace unos segundos')

      // 5 minutos antes
      const t2 = new Date('2026-10-17T14:25:00Z').toISOString()
      expect(formatLastSyncRelative(t2, now)).toBe('Hace 5 min')

      // 3 horas antes
      const t3 = new Date('2026-10-17T11:30:00Z').toISOString()
      expect(formatLastSyncRelative(t3, now)).toBe('Hace 3 h')

      // 1 día antes
      const t4 = new Date('2026-10-16T14:30:00Z').toISOString()
      expect(formatLastSyncRelative(t4, now)).toBe('Ayer')
    })
  })
})
