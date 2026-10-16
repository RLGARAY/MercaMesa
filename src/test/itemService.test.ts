import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MercaMesaDB, initDB } from '@/db/db'
import {
  createItem,
  updateItem,
  archiveItem,
  restoreItem,
  adjustStock,
  getActiveItems,
  getArchivedItems,
  getItemById,
  verifyStockConsistency,
} from '@/services/itemService'
import { getActiveCategories } from '@/services/categoryService'
import type { Sale } from '@/types'

describe('itemService', () => {
  let testDb: MercaMesaDB
  let defaultCategoryId: string

  beforeEach(async () => {
    testDb = new MercaMesaDB(`test-item-${crypto.randomUUID()}`)
    await initDB(testDb)
    const cats = await getActiveCategories(testDb)
    defaultCategoryId = cats[0]!.id
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('crear artículo con stock 0 no crea ningún StockAdjustment (RF-A1, RF-A3)', async () => {
    const item = await createItem(
      {
        name: 'Llavero resina',
        categoryId: defaultCategoryId,
        priceCents: 350,
        stockInitial: 0,
      },
      testDb,
    )

    expect(item.id).toBeDefined()
    expect(item.stock).toBe(0)
    expect(item.priceCents).toBe(350)
    expect(item.archived).toBe(false)

    // Ajustes en la base de datos
    const adjustments = await testDb.adjustments.where('itemId').equals(item.id).toArray()
    expect(adjustments).toHaveLength(0)

    // Invariante de consistencia
    const inconsistencies = await verifyStockConsistency(testDb)
    expect(inconsistencies).toHaveLength(0)
  })

  it('crear artículo con stock > 0 crea un StockAdjustment con reason "initial" (RF-A3)', async () => {
    const item = await createItem(
      {
        name: 'Lámina A4 Bosque',
        categoryId: defaultCategoryId,
        priceCents: 1200,
        stockInitial: 5,
        imageThumb: 'data:image/jpeg;base64,stub',
      },
      testDb,
    )

    expect(item.stock).toBe(5)
    expect(item.imageThumb).toBe('data:image/jpeg;base64,stub')

    const adjustments = await testDb.adjustments.where('itemId').equals(item.id).toArray()
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0]?.delta).toBe(5)
    expect(adjustments[0]?.reason).toBe('initial')

    // Invariante de consistencia verificado
    const inconsistencies = await verifyStockConsistency(testDb)
    expect(inconsistencies).toHaveLength(0)
  })

  it('rechaza crear artículo con categoría inexistente o datos inválidos (RF-A5)', async () => {
    await expect(
      createItem(
        {
          name: 'Item',
          categoryId: 'id-inexistente',
          priceCents: 100,
          stockInitial: 0,
        },
        testDb,
      ),
    ).rejects.toThrow('La categoría seleccionada no existe')

    await expect(
      createItem(
        {
          name: '',
          categoryId: defaultCategoryId,
          priceCents: 100,
          stockInitial: 0,
        },
        testDb,
      ),
    ).rejects.toThrow('El nombre es obligatorio')

    await expect(
      createItem(
        {
          name: 'Válido',
          categoryId: defaultCategoryId,
          priceCents: 0,
          stockInitial: 0,
        },
        testDb,
      ),
    ).rejects.toThrow('El precio debe ser mayor que 0')
  })

  it('updateItem actualiza campos sin modificar ventas pasadas (RN-7)', async () => {
    const item = await createItem(
      {
        name: 'Pendiente original',
        categoryId: defaultCategoryId,
        priceCents: 400,
        stockInitial: 2,
      },
      testDb,
    )

    // Simulamos una venta pasada con snapshot
    const pastSale: Sale = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      lines: [
        {
          itemId: item.id,
          nameSnapshot: 'Pendiente original',
          categoryIdSnapshot: defaultCategoryId,
          unitPriceCents: 400,
          quantity: 1,
          lineListCents: 400,
          lineDiscountCents: 0,
          lineNetCents: 400,
        },
      ],
      subtotalCents: 400,
      discountCents: 0,
      totalCents: 400,
      status: 'active',
    }
    await testDb.sales.add(pastSale)

    // Actualizamos el artículo
    await updateItem(
      item.id,
      {
        name: 'Pendiente renombreado',
        priceCents: 600,
      },
      testDb,
    )

    const updated = await getItemById(item.id, testDb)
    expect(updated?.name).toBe('Pendiente renombreado')
    expect(updated?.priceCents).toBe(600)

    // Verificamos que la venta pasada NO se modificó (RN-7)
    const saleFromDb = await testDb.sales.get(pastSale.id)
    expect(saleFromDb?.lines[0]?.nameSnapshot).toBe('Pendiente original')
    expect(saleFromDb?.lines[0]?.unitPriceCents).toBe(400)
  })

  it('updateItem permite quitar la imagen enviando imageThumb: null', async () => {
    const item = await createItem(
      {
        name: 'Con foto',
        categoryId: defaultCategoryId,
        priceCents: 200,
        stockInitial: 1,
        imageThumb: 'data:image/jpeg;base64,ejemplo',
      },
      testDb,
    )
    expect(item.imageThumb).toBeDefined()

    await updateItem(item.id, { imageThumb: null }, testDb)

    const updated = await getItemById(item.id, testDb)
    expect(updated?.imageThumb).toBeUndefined()
  })

  it('archiveItem y restoreItem ocultan y recuperan el artículo (RN-8)', async () => {
    const item = await createItem(
      {
        name: 'Artículo a archivar',
        categoryId: defaultCategoryId,
        priceCents: 300,
        stockInitial: 1,
      },
      testDb,
    )

    await archiveItem(item.id, testDb)

    const activas = await getActiveItems(testDb)
    expect(activas.some(i => i.id === item.id)).toBe(false)

    const archivadas = await getArchivedItems(testDb)
    expect(archivadas.some(i => i.id === item.id)).toBe(true)

    // Restaurar
    await restoreItem(item.id, testDb)

    const activasDespues = await getActiveItems(testDb)
    expect(activasDespues.some(i => i.id === item.id)).toBe(true)
  })

  it('adjustStock modifica el stock y registra el motivo en una transacción (RF-C1, RNF-7)', async () => {
    const item = await createItem(
      {
        name: 'Item stock',
        categoryId: defaultCategoryId,
        priceCents: 100,
        stockInitial: 5,
      },
      testDb,
    )

    // Reposición +3
    await adjustStock(item.id, 3, 'restock', 'Llegó paquete', testDb)

    let updated = await getItemById(item.id, testDb)
    expect(updated?.stock).toBe(8)

    // Merma -2
    await adjustStock(item.id, -2, 'loss', 'Se rompió', testDb)

    updated = await getItemById(item.id, testDb)
    expect(updated?.stock).toBe(6)

    const adjustments = await testDb.adjustments.where('itemId').equals(item.id).toArray()
    expect(adjustments).toHaveLength(3) // initial + restock + loss

    const inconsistencies = await verifyStockConsistency(testDb)
    expect(inconsistencies).toHaveLength(0)
  })

  it('verifyStockConsistency detecta discrepancias si el stock fue alterado fuera del invariante', async () => {
    const item = await createItem(
      {
        name: 'Item corrupto',
        categoryId: defaultCategoryId,
        priceCents: 100,
        stockInitial: 5,
      },
      testDb,
    )

    // Corrompemos el stock manualmente sin ajuste para probar la detección
    await testDb.items.update(item.id, { stock: 99 })

    const inconsistencies = await verifyStockConsistency(testDb)
    expect(inconsistencies).toHaveLength(1)
    expect(inconsistencies[0]?.expected).toBe(5)
    expect(inconsistencies[0]?.actual).toBe(99)
  })
})
