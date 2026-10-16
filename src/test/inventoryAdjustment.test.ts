import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MercaMesaDB, initDB } from '@/db/db'
import {
  createItem,
  adjustStock,
  setStockAbsolute,
  getAdjustmentsByItem,
  getItemById,
  verifyStockConsistency,
} from '@/services/itemService'
import { getActiveCategories } from '@/services/categoryService'
import { checkoutSale, voidSale } from '@/services/saleService'

describe('inventoryAdjustment (RF-C1, RF-C2, RF-C10)', () => {
  let testDb: MercaMesaDB
  let categoryId: string

  beforeEach(async () => {
    testDb = new MercaMesaDB(`test-inv-${crypto.randomUUID()}`)
    await initDB(testDb)
    const cats = await getActiveCategories(testDb)
    categoryId = cats[0]!.id
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('setStockAbsolute calcula delta positivo cuando el nuevo stock es mayor (RF-C1)', async () => {
    const item = await createItem(
      {
        name: 'Pendiente perla',
        categoryId,
        priceCents: 500,
        stockInitial: 3,
      },
      testDb,
    )

    // Fijamos stock físico a 8 (delta = +5)
    const delta = await setStockAbsolute(item.id, 8, 'restock', 'Conteo en mesa', testDb)
    expect(delta).toBe(5)

    const updated = await getItemById(item.id, testDb)
    expect(updated?.stock).toBe(8)

    // Comprobar ajuste guardado
    const adjustments = await getAdjustmentsByItem(item.id, testDb)
    expect(adjustments[0]?.delta).toBe(5)
    expect(adjustments[0]?.reason).toBe('restock')
    expect(adjustments[0]?.note).toBe('Conteo en mesa')

    // Invariante
    const inconsistencies = await verifyStockConsistency(testDb)
    expect(inconsistencies).toHaveLength(0)
  })

  it('setStockAbsolute calcula delta negativo cuando el nuevo stock es menor (RF-C1)', async () => {
    const item = await createItem(
      {
        name: 'Llavero oso',
        categoryId,
        priceCents: 400,
        stockInitial: 10,
      },
      testDb,
    )

    // Fijamos stock a 4 (delta = -6)
    const delta = await setStockAbsolute(item.id, 4, 'loss', 'Merma detectada', testDb)
    expect(delta).toBe(-6)

    const updated = await getItemById(item.id, testDb)
    expect(updated?.stock).toBe(4)

    // Invariante
    const inconsistencies = await verifyStockConsistency(testDb)
    expect(inconsistencies).toHaveLength(0)
  })

  it('setStockAbsolute no crea ajuste si el stock ya era igual', async () => {
    const item = await createItem(
      {
        name: 'Lámina',
        categoryId,
        priceCents: 1000,
        stockInitial: 5,
      },
      testDb,
    )

    const delta = await setStockAbsolute(item.id, 5, 'correction', undefined, testDb)
    expect(delta).toBe(0)

    const adjustments = await getAdjustmentsByItem(item.id, testDb)
    // Solo el ajuste 'initial' de la creación
    expect(adjustments).toHaveLength(1)
  })

  it('getAdjustmentsByItem devuelve los ajustes ordenados por fecha descendente (RF-C2)', async () => {
    const item = await createItem(
      {
        name: 'Item multi-ajuste',
        categoryId,
        priceCents: 300,
        stockInitial: 2,
      },
      testDb,
    )

    await adjustStock(item.id, 3, 'restock', 'Primero', testDb)
    await adjustStock(item.id, -1, 'loss', 'Segundo', testDb)

    const history = await getAdjustmentsByItem(item.id, testDb)
    expect(history).toHaveLength(3) // initial, restock, loss
    expect(history[0]?.reason).toBe('loss')
    expect(history[0]?.delta).toBe(-1)
    expect(history[1]?.reason).toBe('restock')
    expect(history[1]?.delta).toBe(3)
    expect(history[2]?.reason).toBe('initial')
    expect(history[2]?.delta).toBe(2)
  })

  it('Invariante estricto: ciclo completo de creación, ventas, anulación y ajustes (RF-C10)', async () => {
    // 1. Crear item con stock inicial 10
    const item = await createItem(
      {
        name: 'Item ciclo completo',
        categoryId,
        priceCents: 500,
        stockInitial: 10,
      },
      testDb,
    )

    // 2. Venta 1: 3 unidades -> stock = 7
    const sale1 = await checkoutSale(
      {
        items: [{ item, quantity: 3 }],
        discount: { enabled: false, mode: 'euros', value: 0 },
      },
      testDb,
    )

    // 3. Venta 2: 2 unidades -> stock = 5
    await checkoutSale(
      {
        items: [{ item, quantity: 2 }],
        discount: { enabled: false, mode: 'euros', value: 0 },
      },
      testDb,
    )

    // 4. Anular Venta 1: devuelve 3 unidades -> stock = 8
    await voidSale(sale1.id, testDb)

    // 5. Ajuste manual de reposición: +4 -> stock = 12
    await adjustStock(item.id, 4, 'restock', 'Reposición', testDb)

    // 6. Ajuste fijando stock físico a 15: +3 -> stock = 15
    await setStockAbsolute(item.id, 15, 'correction', 'Recuento real', testDb)

    const currentItem = await getItemById(item.id, testDb)
    expect(currentItem?.stock).toBe(15)

    // Verificar invariante:
    // suma(adjustments) = 10 (initial) + 4 (restock) + 3 (correction) = 17
    // suma(ventas activas) = 2 (de la venta 2, porque venta 1 está voided)
    // stock esperado = 17 - 2 = 15.
    const inconsistencies = await verifyStockConsistency(testDb)
    expect(inconsistencies).toHaveLength(0)
  })
})
