import { describe, it, expect } from 'vitest'
import Dexie from 'dexie'
import { MercaMesaDB, SCHEMA_VERSION } from '@/db/db'
import { uploadToDrive, getLocalMeta } from '@/services/drive/driveSyncService'
import { parseAndValidateBackup, importBackupPayload, type BackupPayload } from '@/services/backupService'
import type { DriveClient, RemoteFileMeta } from '@/services/drive/driveClient'

describe('Migración de esquema v1 -> v2 y clave fija en meta (A1, puntos #2 y #11)', () => {
  it('migra una base de datos v1 real a v2 conservando todos los datos, moviendo meta a la clave "main" y creando copia en localBackups', async () => {
    const dbName = `test-mig-v1-v2-${crypto.randomUUID()}`

    // 1. Crear y poblar una base de datos en versión 1 exactamente con el esquema antiguo
    const v1Db = new Dexie(dbName)
    v1Db.version(1).stores({
      categories: 'id, sortOrder, archived',
      items: 'id, categoryId, archived',
      sales: 'id, createdAt, status',
      adjustments: 'id, itemId, createdAt',
      meta: 'schemaVersion',
      localBackups: 'id, createdAt',
    })

    await v1Db.open()

    await v1Db.table('categories').add({
      id: 'cat-1',
      name: 'Pendientes',
      sortOrder: 0,
      archived: false,
    })

    await v1Db.table('items').add({
      id: 'item-1',
      name: 'Pendiente Aro',
      categoryId: 'cat-1',
      priceCents: 1000,
      stock: 4,
      archived: false,
      createdAt: '2026-10-15T10:00:00.000Z',
      updatedAt: '2026-10-15T10:00:00.000Z',
    })

    await v1Db.table('adjustments').add({
      id: 'adj-1',
      itemId: 'item-1',
      createdAt: '2026-10-15T10:00:00.000Z',
      delta: 5,
      reason: 'initial',
    })

    await v1Db.table('sales').add({
      id: 'sale-1',
      createdAt: '2026-10-15T11:00:00.000Z',
      lines: [
        {
          itemId: 'item-1',
          nameSnapshot: 'Pendiente Aro',
          categoryIdSnapshot: 'cat-1',
          unitPriceCents: 1000,
          quantity: 1,
          lineListCents: 1000,
          lineDiscountCents: 0,
          lineNetCents: 1000,
        },
      ],
      subtotalCents: 1000,
      discountCents: 0,
      totalCents: 1000,
      status: 'active',
    })

    await v1Db.table('meta').add({
      schemaVersion: 1,
      deviceId: 'device-v1-original',
      lastSyncedRevision: 7,
      lastSyncedAt: '2026-10-15T12:00:00.000Z',
      driveFileId: 'drive-file-v1-abc',
    })

    // Cerrar DB v1
    v1Db.close()

    // 2. Abrir la misma base de datos con MercaMesaDB (versión 2)
    expect(SCHEMA_VERSION).toBe(2)
    const v2Db = new MercaMesaDB(dbName)
    await v2Db.open()

    try {
      // 3. Verificar que no se ha perdido ningún registro de negocio
      const categories = await v2Db.categories.toArray()
      const items = await v2Db.items.toArray()
      const sales = await v2Db.sales.toArray()
      const adjustments = await v2Db.adjustments.toArray()

      expect(categories).toHaveLength(1)
      expect(categories[0]?.id).toBe('cat-1')
      expect(items).toHaveLength(1)
      expect(items[0]?.name).toBe('Pendiente Aro')
      expect(sales).toHaveLength(1)
      expect(sales[0]?.id).toBe('sale-1')
      expect(adjustments).toHaveLength(1)
      expect(adjustments[0]?.id).toBe('adj-1')

      // 4. Verificar que meta está bajo la clave fija 'main' con todos sus campos intactos
      const metaByMain = await v2Db.meta.get('main')
      expect(metaByMain).toBeDefined()
      expect(metaByMain?.id).toBe('main')
      expect(metaByMain?.schemaVersion).toBe(2)
      expect(metaByMain?.deviceId).toBe('device-v1-original')
      expect(metaByMain?.lastSyncedRevision).toBe(7)
      expect(metaByMain?.lastSyncedAt).toBe('2026-10-15T12:00:00.000Z')
      expect(metaByMain?.driveFileId).toBe('drive-file-v1-abc')

      // 5. Verificar que antes de migrar se guardó copia en localBackups (SPEC sección 8)
      const backups = await v2Db.localBackups.toArray()
      expect(backups).toHaveLength(1)
      expect(backups[0]?.reason).toBe('before-migration')
      const backupData = JSON.parse(backups[0]!.data) as BackupPayload
      expect(backupData.deviceId).toBe('device-v1-original')
      expect(backupData.items).toHaveLength(1)
      expect(backupData.sales).toHaveLength(1)

      // 6. Verificar que uploadToDrive actualiza correctamente el registro 'main' tras la migración
      const dummyDrive: DriveClient = {
        async getFileMetadata(): Promise<RemoteFileMeta | null> {
          return { fileId: 'drive-file-v1-abc', revision: 7 }
        },
        async uploadFile(_payload, revision, existingFileId): Promise<RemoteFileMeta> {
          return { fileId: existingFileId ?? 'drive-file-v1-abc', revision }
        },
        async downloadFile(): Promise<string> {
          return '{}'
        },
      }

      const upRes = await uploadToDrive(dummyDrive, {}, v2Db)
      expect(upRes.outcome).toBe('success')
      const updatedMeta = await getLocalMeta(v2Db)
      expect(updatedMeta.id).toBe('main')
      expect(updatedMeta.lastSyncedRevision).toBe(8)
    } finally {
      await v2Db.delete()
    }
  })

  it('permite importar un JSON de versión anterior (v1) migrando su esquema a v2, y rechaza versión posterior (v3)', async () => {
    const dbName = `test-import-v1-${crypto.randomUUID()}`
    const testDb = new MercaMesaDB(dbName)

    try {
      const v1Json = JSON.stringify({
        schemaVersion: 1,
        revision: 4,
        exportedAt: '2026-10-16T10:00:00.000Z',
        deviceId: 'dev-from-v1',
        categories: [{ id: 'c1', name: 'Láminas', sortOrder: 0, archived: false }],
        items: [],
        sales: [],
        adjustments: [],
      })

      const parsedV1 = parseAndValidateBackup(v1Json)
      expect(parsedV1.valid).toBe(true)
      if (parsedV1.valid) {
        await importBackupPayload(parsedV1.payload, testDb)
        const meta = await testDb.meta.get('main')
        expect(meta?.id).toBe('main')
        expect(meta?.schemaVersion).toBe(2)
        expect(meta?.deviceId).toBe('dev-from-v1')
        expect(meta?.lastSyncedRevision).toBe(4)
      }

      const v3Json = JSON.stringify({
        schemaVersion: 3,
        revision: 1,
        exportedAt: '2026-10-16T10:00:00.000Z',
        deviceId: 'dev-from-v3',
        categories: [],
        items: [],
        sales: [],
        adjustments: [],
      })
      const parsedV3 = parseAndValidateBackup(v3Json)
      expect(parsedV3.valid).toBe(false)
    } finally {
      await testDb.delete()
    }
  })
})
