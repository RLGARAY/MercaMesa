import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MercaMesaDB, initDB, SCHEMA_VERSION } from '@/db/db'
import {
  validateBackupPayload,
  parseAndValidateBackup,
  createBackupPayload,
  saveLocalBackup,
  getLocalBackups,
  importBackupPayload,
  restoreLocalBackup,
  resetAllData,
  type BackupPayload,
} from '@/services/backupService'
import { createItem, adjustStock, verifyStockConsistency } from '@/services/itemService'
import { getActiveCategories } from '@/services/categoryService'
import { checkoutSale } from '@/services/saleService'

describe('backupService (RF-C6, RF-C7, RF-C11)', () => {
  let testDb: MercaMesaDB

  beforeEach(async () => {
    testDb = new MercaMesaDB(`test-backup-${crypto.randomUUID()}`)
    await initDB(testDb)
  })

  afterEach(async () => {
    await testDb.delete()
  })

  describe('Validación de BackupPayload (SPEC secciones 7 y 8)', () => {
    const validData: BackupPayload = {
      schemaVersion: 1,
      revision: 2,
      exportedAt: '2026-10-16T12:00:00.000Z',
      deviceId: 'dev-123',
      categories: [{ id: 'cat-1', name: 'Pendientes', sortOrder: 0, archived: false }],
      items: [],
      sales: [],
      adjustments: [],
    }

    it('acepta un payload bien estructurado con schemaVersion actual', () => {
      const res = validateBackupPayload(validData)
      expect(res.valid).toBe(true)
      if (res.valid) {
        expect(res.payload.schemaVersion).toBe(1)
        expect(res.payload.categories).toHaveLength(1)
      }
    })

    it('parseAndValidateBackup parsea y valida un string JSON correctamente', () => {
      const json = JSON.stringify(validData)
      const res = parseAndValidateBackup(json)
      expect(res.valid).toBe(true)
    })

    it('rechaza strings con JSON corrupto o mal formado', () => {
      const res = parseAndValidateBackup('{ not a json }')
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/no contiene un JSON válido/i)
      }
    })

    it('rechaza valores no objetos o nulos', () => {
      expect(validateBackupPayload(null).valid).toBe(false)
      expect(validateBackupPayload('string').valid).toBe(false)
      expect(validateBackupPayload(123).valid).toBe(false)
    })

    it('rechaza si falta schemaVersion o no es un entero positivo', () => {
      const invalid = { ...validData, schemaVersion: 0 }
      const res = validateBackupPayload(invalid)
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/versión de esquema válida/i)
      }
    })

    it('rechaza si schemaVersion es mayor que la versión soportada (SPEC sección 8)', () => {
      const future = { ...validData, schemaVersion: SCHEMA_VERSION + 1 }
      const res = validateBackupPayload(future)
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toContain('Actualiza la app')
      }
    })

    it('rechaza si faltan metadatos requeridos (exportedAt, deviceId)', () => {
      expect(validateBackupPayload({ ...validData, exportedAt: '' }).valid).toBe(false)
      expect(validateBackupPayload({ ...validData, deviceId: '' }).valid).toBe(false)
    })

    it('rechaza si alguna de las colecciones requeridas no es un array', () => {
      expect(validateBackupPayload({ ...validData, categories: null }).valid).toBe(false)
      expect(validateBackupPayload({ ...validData, items: 'not an array' }).valid).toBe(false)
      expect(validateBackupPayload({ ...validData, sales: {} }).valid).toBe(false)
      expect(validateBackupPayload({ ...validData, adjustments: undefined }).valid).toBe(false)
    })
  })

  describe('Copias locales (localBackups) - SPEC sección 7', () => {
    it('guarda copias locales y retiene únicamente un máximo de 3 (elimina las más antiguas)', async () => {
      // Guardar 4 copias sucesivas
      await saveLocalBackup('before-import', testDb)
      await new Promise((r) => setTimeout(r, 10))
      await saveLocalBackup('before-restore', testDb)
      await new Promise((r) => setTimeout(r, 10))
      await saveLocalBackup('before-migration', testDb)
      await new Promise((r) => setTimeout(r, 10))
      const fourth = await saveLocalBackup('before-import', testDb)

      const backups = await getLocalBackups(testDb)
      expect(backups).toHaveLength(3)

      // La más reciente debe ser la cuarta
      expect(backups[0]?.id).toBe(fourth.id)
      expect(backups[0]?.reason).toBe('before-import')
    })
  })

  describe('Round-trip Exportar -> Limpiar -> Importar (Criterio de aceptación Fase 5)', () => {
    it('exporta todos los datos y al importarlos en una base de datos limpia produce datos idénticos y consistentes', async () => {
      const cats = await getActiveCategories(testDb)
      const catId = cats[0]!.id

      // 1. Crear artículos con stock inicial
      const item1 = await createItem(
        {
          name: 'Pendiente plata',
          categoryId: catId,
          priceCents: 1200,
          stockInitial: 5,
        },
        testDb,
      )

      const item2 = await createItem(
        {
          name: 'Llavero resina',
          categoryId: catId,
          priceCents: 850,
          stockInitial: 10,
        },
        testDb,
      )

      // 2. Realizar una venta
      await checkoutSale(
        {
          items: [
            { item: item1, quantity: 2 },
            { item: item2, quantity: 3 },
          ],
          discount: { enabled: false, mode: 'euros', value: 0 },
        },
        testDb,
      )

      // 3. Realizar un ajuste de stock adicional
      await adjustStock(item1.id, 4, 'restock', 'Lote recibido', testDb)

      // 4. Verificar consistencia antes de exportar
      const preExportInconsistencies = await verifyStockConsistency(testDb)
      expect(preExportInconsistencies).toHaveLength(0)

      // 5. Exportar backup
      const exportedPayload = await createBackupPayload(testDb)
      expect(exportedPayload.categories.length).toBeGreaterThanOrEqual(3)
      expect(exportedPayload.items).toHaveLength(2)
      expect(exportedPayload.sales).toHaveLength(1)
      // Ajustes: 2 iniciales + 1 restock = 3
      expect(exportedPayload.adjustments).toHaveLength(3)

      // 6. Resetear / borrar los datos en la base de datos
      await testDb.items.clear()
      await testDb.sales.clear()
      await testDb.adjustments.clear()
      await testDb.categories.clear()

      expect(await testDb.items.count()).toBe(0)
      expect(await testDb.sales.count()).toBe(0)
      expect(await testDb.adjustments.count()).toBe(0)

      // 7. Importar el payload exportado
      const summary = await importBackupPayload(exportedPayload, testDb)
      expect(summary.itemsCount).toBe(2)
      expect(summary.salesCount).toBe(1)
      expect(summary.adjustmentsCount).toBe(3)

      // 8. Comprobar que los datos importados son 100% idénticos
      const importedCategories = await testDb.categories.toArray()
      const importedItems = await testDb.items.toArray()
      const importedSales = await testDb.sales.toArray()
      const importedAdjustments = await testDb.adjustments.toArray()

      expect(importedCategories).toEqual(exportedPayload.categories)
      expect(importedItems).toEqual(exportedPayload.items)
      expect(importedSales).toEqual(exportedPayload.sales)
      expect(importedAdjustments).toEqual(exportedPayload.adjustments)

      // 9. Comprobar el invariante de stock tras la importación
      const postImportInconsistencies = await verifyStockConsistency(testDb)
      expect(postImportInconsistencies).toHaveLength(0)

      // 10. Comprobar que se guardó una copia automática en localBackups antes de sobreescribir
      const backups = await getLocalBackups(testDb)
      expect(backups.length).toBeGreaterThanOrEqual(1)
      expect(backups[0]?.reason).toBe('before-import')
    })
  })

  describe('Resetear todos los datos locales (RF-C11)', () => {
    it('guarda copia previa en localBackups, limpia datos de negocio y recrea categorías por defecto', async () => {
      const cats = await getActiveCategories(testDb)
      await createItem(
        {
          name: 'Artículo a borrar',
          categoryId: cats[0]!.id,
          priceCents: 500,
          stockInitial: 2,
        },
        testDb,
      )

      expect(await testDb.items.count()).toBe(1)

      // Ejecutar reseteo total
      await resetAllData(testDb)

      // Comprobar que items, ventas y ajustes están vacíos
      expect(await testDb.items.count()).toBe(0)
      expect(await testDb.sales.count()).toBe(0)
      expect(await testDb.adjustments.count()).toBe(0)

      // Comprobar que las categorías por defecto se han recreado (RN-9)
      const restoredCats = await testDb.categories.toArray()
      expect(restoredCats.length).toBe(3)
      const names = restoredCats.map((c) => c.name)
      expect(names).toContain('Pendientes')
      expect(names).toContain('Llaveros')
      expect(names).toContain('Láminas')

      // Comprobar que se creó la copia de seguridad previa
      const backups = await getLocalBackups(testDb)
      expect(backups.length).toBe(1)
      expect(backups[0]?.reason).toBe('before-migration')

      // Verificar que el payload de la copia contiene el artículo que existía antes
      const savedPayload = JSON.parse(backups[0]!.data) as BackupPayload
      expect(savedPayload.items).toHaveLength(1)
      expect(savedPayload.items[0]?.name).toBe('Artículo a borrar')
    })
  })

  describe('Restaurar copia local (restoreLocalBackup)', () => {
    it('restaura datos de un snapshot local y crea copia previa before-restore', async () => {
      const cats = await getActiveCategories(testDb)
      const item = await createItem(
        {
          name: 'Artículo estado 1',
          categoryId: cats[0]!.id,
          priceCents: 700,
          stockInitial: 4,
        },
        testDb,
      )

      // Tomar snapshot local
      const backup = await saveLocalBackup('before-migration', testDb)

      // Modificar la base de datos (estado 2)
      await createItem(
        {
          name: 'Artículo estado 2',
          categoryId: cats[0]!.id,
          priceCents: 1500,
          stockInitial: 1,
        },
        testDb,
      )
      expect(await testDb.items.count()).toBe(2)

      // Restaurar el snapshot
      const summary = await restoreLocalBackup(backup.id, testDb)
      expect(summary.itemsCount).toBe(1)

      // Comprobar que la base de datos vuelve a tener solo el artículo del estado 1
      const currentItems = await testDb.items.toArray()
      expect(currentItems).toHaveLength(1)
      expect(currentItems[0]?.id).toBe(item.id)
      expect(currentItems[0]?.name).toBe('Artículo estado 1')

      // Comprobar que se generó una copia con reason 'before-restore'
      const backups = await getLocalBackups(testDb)
      const latest = backups[0]
      expect(latest?.reason).toBe('before-restore')
    })
  })
})
