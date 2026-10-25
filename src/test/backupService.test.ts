import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  MercaMesaDB,
  initDB,
  SCHEMA_VERSION,
  setLowStockThreshold,
  setSaleSortPreference,
  setHideOutOfStockPreference,
  META_KEY,
} from '@/db/db'
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
import { createItem, adjustStock, verifyStockConsistency, repairStockInconsistencies } from '@/services/itemService'
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
      schemaVersion: SCHEMA_VERSION,
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
        expect(res.payload.schemaVersion).toBe(SCHEMA_VERSION)
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

    it('rechaza registros con campos obligatorios ausentes o tipos/rangos erróneos (A2)', () => {
      // Precio decimal o <= 0
      const badPrice = {
        ...validData,
        items: [
          {
            id: 'item-1',
            name: 'Collar',
            categoryId: 'cat-1',
            priceCents: 12.5,
            stock: 3,
            archived: false,
            createdAt: '2026-10-16T12:00:00.000Z',
            updatedAt: '2026-10-16T12:00:00.000Z',
          },
        ],
      }
      expect(validateBackupPayload(badPrice).valid).toBe(false)

      // Stock decimal
      const badStock = {
        ...validData,
        items: [
          {
            id: 'item-1',
            name: 'Collar',
            categoryId: 'cat-1',
            priceCents: 1200,
            stock: 1.5,
            archived: false,
            createdAt: '2026-10-16T12:00:00.000Z',
            updatedAt: '2026-10-16T12:00:00.000Z',
          },
        ],
      }
      expect(validateBackupPayload(badStock).valid).toBe(false)

      // Fecha ISO inválida
      const badDate = {
        ...validData,
        items: [
          {
            id: 'item-1',
            name: 'Collar',
            categoryId: 'cat-1',
            priceCents: 1200,
            stock: 2,
            archived: false,
            createdAt: 'no-es-fecha',
            updatedAt: '2026-10-16T12:00:00.000Z',
          },
        ],
      }
      expect(validateBackupPayload(badDate).valid).toBe(false)
    })

    it('rechaza IDs duplicados dentro de una misma colección (A2)', () => {
      const dupCategories = {
        ...validData,
        categories: [
          { id: 'cat-1', name: 'Pendientes', sortOrder: 0, archived: false },
          { id: 'cat-1', name: 'Repetida', sortOrder: 1, archived: false },
        ],
      }
      const res = validateBackupPayload(dupCategories)
      expect(res.valid).toBe(false)
      if (!res.valid) {
        expect(res.error).toMatch(/duplicado/i)
      }
    })

    it('rechaza referencias rotas en artículos, líneas de venta y ajustes (A2)', () => {
      // item.categoryId inexistente
      const brokenCatRef = {
        ...validData,
        items: [
          {
            id: 'item-1',
            name: 'Collar',
            categoryId: 'cat-inexistente',
            priceCents: 1000,
            stock: 1,
            archived: false,
            createdAt: '2026-10-16T12:00:00.000Z',
            updatedAt: '2026-10-16T12:00:00.000Z',
          },
        ],
      }
      expect(validateBackupPayload(brokenCatRef).valid).toBe(false)

      // adjustment.itemId inexistente
      const brokenAdjRef = {
        ...validData,
        adjustments: [
          {
            id: 'adj-1',
            itemId: 'item-fantasma',
            createdAt: '2026-10-16T12:00:00.000Z',
            delta: 5,
            reason: 'initial' as const,
          },
        ],
      }
      expect(validateBackupPayload(brokenAdjRef).valid).toBe(false)

      // sale.lines[].itemId inexistente
      const brokenSaleRef = {
        ...validData,
        sales: [
          {
            id: 'sale-1',
            createdAt: '2026-10-16T12:05:00.000Z',
            lines: [
              {
                itemId: 'item-fantasma',
                nameSnapshot: 'Fantasma',
                categoryIdSnapshot: 'cat-1',
                unitPriceCents: 500,
                quantity: 1,
                lineListCents: 500,
                lineDiscountCents: 0,
                lineNetCents: 500,
              },
            ],
            subtotalCents: 500,
            discountCents: 0,
            totalCents: 500,
            status: 'active' as const,
          },
        ],
      }
      expect(validateBackupPayload(brokenSaleRef).valid).toBe(false)
    })

    it('rechaza ventas con importes o descuentos incoherentes (A2)', () => {
      const baseWithItem = {
        ...validData,
        items: [
          {
            id: 'item-1',
            name: 'Anillo',
            categoryId: 'cat-1',
            priceCents: 1000,
            stock: 5,
            archived: false,
            createdAt: '2026-10-16T12:00:00.000Z',
            updatedAt: '2026-10-16T12:00:00.000Z',
          },
        ],
      }

      // Descuento de línea no suma igual a discountCents de la venta
      const badDiscountSum = {
        ...baseWithItem,
        sales: [
          {
            id: 'sale-1',
            createdAt: '2026-10-16T12:05:00.000Z',
            lines: [
              {
                itemId: 'item-1',
                nameSnapshot: 'Anillo',
                categoryIdSnapshot: 'cat-1',
                unitPriceCents: 1000,
                quantity: 2,
                lineListCents: 2000,
                lineDiscountCents: 100, // dice 100 pero la venta dice 300
                lineNetCents: 1900,
              },
            ],
            subtotalCents: 2000,
            discountCents: 300,
            totalCents: 1700,
            status: 'active' as const,
          },
        ],
      }
      const res = validateBackupPayload(badDiscountSum)
      expect(res.valid).toBe(false)

      // totalCents != subtotalCents - discountCents
      const badTotal = {
        ...baseWithItem,
        sales: [
          {
            id: 'sale-1',
            createdAt: '2026-10-16T12:05:00.000Z',
            lines: [
              {
                itemId: 'item-1',
                nameSnapshot: 'Anillo',
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
            totalCents: 900,
            status: 'active' as const,
          },
        ],
      }
      expect(validateBackupPayload(badTotal).valid).toBe(false)
    })

    it('limita el resumen de errores a un máximo de 10 mensajes y no modifica la BD si la importación falla (todo o nada, A2)', async () => {
      const cats = await getActiveCategories(testDb)
      await createItem(
        { name: 'Artículo previo intacto', categoryId: cats[0]!.id, priceCents: 500, stockInitial: 3 },
        testDb,
      )

      const manyInvalidItems = Array.from({ length: 15 }, (_, idx) => ({
        id: `bad-${idx}`,
        name: '',
        categoryId: 'no-existe',
        priceCents: -10,
        stock: 1.2,
        archived: false,
        createdAt: 'bad-date',
        updatedAt: 'bad-date',
      }))

      const invalidPayload = {
        ...validData,
        items: manyInvalidItems,
      } as unknown as BackupPayload

      const validation = validateBackupPayload(invalidPayload)
      expect(validation.valid).toBe(false)
      if (!validation.valid) {
        expect(validation.errors?.length).toBeLessThanOrEqual(10)
      }

      await expect(importBackupPayload(invalidPayload, testDb)).rejects.toThrow()

      // La BD sigue intacta con el artículo previo
      const itemsAfter = await testDb.items.toArray()
      expect(itemsAfter).toHaveLength(1)
      expect(itemsAfter[0]?.name).toBe('Artículo previo intacto')
    })

    it('detecta discrepancias de stock tras importar sin corregirlas en silencio (A2)', async () => {
      const payloadWithDiscrepancy: BackupPayload = {
        ...validData,
        items: [
          {
            id: 'item-disc',
            name: 'Pulsera con desajuste',
            categoryId: 'cat-1',
            priceCents: 1000,
            stock: 99, // El ajuste inicial dice 5, pero el stock dice 99
            archived: false,
            createdAt: '2026-10-16T12:00:00.000Z',
            updatedAt: '2026-10-16T12:00:00.000Z',
          },
        ],
        adjustments: [
          {
            id: 'adj-disc',
            itemId: 'item-disc',
            createdAt: '2026-10-16T12:00:00.000Z',
            delta: 5,
            reason: 'initial',
          },
        ],
      }

      const summary = await importBackupPayload(payloadWithDiscrepancy, testDb)
      expect(summary.inconsistencies).toHaveLength(1)
      expect(summary.inconsistencies[0]?.expected).toBe(5)
      expect(summary.inconsistencies[0]?.actual).toBe(99)

      // No se ha corregido en silencio: en la BD sigue siendo 99 hasta que el usuario repare
      const itemInDb = await testDb.items.get('item-disc')
      expect(itemInDb?.stock).toBe(99)

      // Al ejecutar la reparación explícita, el stock se alinea con el historial (5)
      const repairedCount = await repairStockInconsistencies(testDb)
      expect(repairedCount).toBe(1)
      const itemAfterRepair = await testDb.items.get('item-disc')
      expect(itemAfterRepair?.stock).toBe(5)
      expect(await verifyStockConsistency(testDb)).toHaveLength(0)
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

      // Comprobar que se creó la copia de seguridad previa con motivo 'before-reset' (E3)
      const backups = await getLocalBackups(testDb)
      expect(backups.length).toBe(1)
      expect(backups[0]?.reason).toBe('before-reset')

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

    it('guarda lowStockThreshold en meta ("main"), no lo incluye en el archivo de copia y lo preserva al importar (C1, #6)', async () => {
      await setLowStockThreshold(4, testDb)
      const metaBefore = await testDb.meta.get(META_KEY)
      expect(metaBefore?.lowStockThreshold).toBe(4)

      const exported = await createBackupPayload(testDb)
      expect('lowStockThreshold' in (exported as unknown as Record<string, unknown>)).toBe(false)

      await importBackupPayload(exported, testDb)
      const metaAfter = await testDb.meta.get(META_KEY)
      expect(metaAfter?.lowStockThreshold).toBe(4)
    })

    it('guarda saleSort y hideOutOfStock en meta ("main"), no los incluye en la copia de seguridad y los preserva al importar', async () => {
      await setSaleSortPreference('stock-desc', testDb)
      await setHideOutOfStockPreference(true, testDb)

      const metaBefore = await testDb.meta.get(META_KEY)
      expect(metaBefore?.saleSort).toBe('stock-desc')
      expect(metaBefore?.hideOutOfStock).toBe(true)

      const exported = await createBackupPayload(testDb)
      const exportedRecord = exported as unknown as Record<string, unknown>
      expect('saleSort' in exportedRecord).toBe(false)
      expect('hideOutOfStock' in exportedRecord).toBe(false)

      await importBackupPayload(exported, testDb)
      const metaAfter = await testDb.meta.get(META_KEY)
      expect(metaAfter?.saleSort).toBe('stock-desc')
      expect(metaAfter?.hideOutOfStock).toBe(true)
    })

    it('elimina las copias más antiguas al superar 3 y permite continuar con skipPreBackup si localBackups falla por cuota (E4)', async () => {
      // Crear 4 copias seguidas
      await saveLocalBackup('before-import', testDb)
      await saveLocalBackup('before-restore', testDb)
      await saveLocalBackup('before-migration', testDb)
      const fourth = await saveLocalBackup('before-reset', testDb)

      const backups = await getLocalBackups(testDb)
      expect(backups).toHaveLength(3)
      expect(backups[0]?.id).toBe(fourth.id)
      expect(backups[0]?.reason).toBe('before-reset')

      // Simular fallo de cuota (QuotaExceededError) al guardar en localBackups
      const origAdd = testDb.localBackups.add.bind(testDb.localBackups)
      testDb.localBackups.add = () => {
        const quotaErr = new Error('QuotaExceededError: The quota has been exceeded.')
        quotaErr.name = 'QuotaExceededError'
        return Promise.reject(quotaErr) as ReturnType<typeof origAdd>
      }

      try {
        // Sin confirmación, lanza error comprensible de falta de espacio
        await expect(resetAllData(testDb)).rejects.toThrow(/espacio|cuota/i)

        // Si el usuario confirma continuar sin copia previa (skipPreBackup: true), la operación principal se completa
        await expect(resetAllData(testDb, { skipPreBackup: true })).resolves.toBeUndefined()
      } finally {
        testDb.localBackups.add = origAdd
      }
    })
  })
})
