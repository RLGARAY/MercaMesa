import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MercaMesaDB, initDB } from '@/db/db'
import { createItem, getItemById, verifyStockConsistency } from '@/services/itemService'
import { getActiveCategories } from '@/services/categoryService'
import { checkoutSale, voidSale, getSales } from '@/services/saleService'
import { calculateSummaryMetrics } from '@/domain/stats'

describe('saleService', () => {
  let testDb: MercaMesaDB
  let categoryId: string

  beforeEach(async () => {
    testDb = new MercaMesaDB(`test-sales-${crypto.randomUUID()}`)
    await initDB(testDb)
    const cats = await getActiveCategories(testDb)
    categoryId = cats[0]!.id
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('checkoutSale crea la venta con snapshots y descuenta el stock en una transacción (RN-2, RNF-7)', async () => {
    const itemA = await createItem(
      {
        name: 'Pendiente flor',
        categoryId,
        priceCents: 500,
        stockInitial: 10,
      },
      testDb,
    )
    const itemB = await createItem(
      {
        name: 'Llavero resina',
        categoryId,
        priceCents: 350,
        stockInitial: 4,
      },
      testDb,
    )

    const sale = await checkoutSale(
      {
        items: [
          { item: itemA, quantity: 2 },
          { item: itemB, quantity: 1 },
        ],
        discount: { enabled: false, mode: 'euros', value: 0 },
      },
      testDb,
    )

    expect(sale.id).toBeDefined()
    expect(sale.status).toBe('active')
    expect(sale.subtotalCents).toBe(1350) // 500*2 + 350 = 1350
    expect(sale.discountCents).toBe(0)
    expect(sale.totalCents).toBe(1350)
    expect(sale.lines).toHaveLength(2)

    // Snapshots
    expect(sale.lines[0]?.nameSnapshot).toBe('Pendiente flor')
    expect(sale.lines[0]?.unitPriceCents).toBe(500)
    expect(sale.lines[0]?.lineListCents).toBe(1000)

    // Comprobamos stock descontado en IndexedDB
    const updatedA = await getItemById(itemA.id, testDb)
    const updatedB = await getItemById(itemB.id, testDb)
    expect(updatedA?.stock).toBe(8) // 10 - 2
    expect(updatedB?.stock).toBe(3) // 4 - 1

    // Invariante de consistencia
    const inconsistencies = await verifyStockConsistency(testDb)
    expect(inconsistencies).toHaveLength(0)
  })

  it('checkoutSale permite stock insuficiente y deja el stock negativo (RN-3)', async () => {
    const item = await createItem(
      {
        name: 'Lámina única',
        categoryId,
        priceCents: 1000,
        stockInitial: 1,
      },
      testDb,
    )

    // Vendemos 3 cuando solo hay 1
    const sale = await checkoutSale(
      {
        items: [{ item, quantity: 3 }],
        discount: { enabled: false, mode: 'euros', value: 0 },
      },
      testDb,
    )

    expect(sale.totalCents).toBe(3000)
    const updated = await getItemById(item.id, testDb)
    expect(updated?.stock).toBe(-2) // 1 - 3 = -2

    // Invariante de consistencia sigue cumpliéndose estrictamente
    const inconsistencies = await verifyStockConsistency(testDb)
    expect(inconsistencies).toHaveLength(0)
  })

  it('checkoutSale con descuento aplica RN-4 y RN-5 correctamente', async () => {
    const item1 = await createItem(
      {
        name: 'Art 1',
        categoryId,
        priceCents: 600,
        stockInitial: 5,
      },
      testDb,
    )
    const item2 = await createItem(
      {
        name: 'Art 2',
        categoryId,
        priceCents: 400,
        stockInitial: 5,
      },
      testDb,
    )

    // Subtotal = 1000. Descuento 200 (precio final 800)
    const sale = await checkoutSale(
      {
        items: [
          { item: item1, quantity: 1 },
          { item: item2, quantity: 1 },
        ],
        discount: { enabled: true, mode: 'finalPrice', value: 800 },
      },
      testDb,
    )

    expect(sale.subtotalCents).toBe(1000)
    expect(sale.discountCents).toBe(200)
    expect(sale.totalCents).toBe(800)

    // Reparto RN-5 proporcional: 60% de 200 = 120, 40% de 200 = 80
    expect(sale.lines[0]?.lineDiscountCents).toBe(120)
    expect(sale.lines[0]?.lineNetCents).toBe(480)
    expect(sale.lines[1]?.lineDiscountCents).toBe(80)
    expect(sale.lines[1]?.lineNetCents).toBe(320)
  })

  it('voidSale devuelve el stock y marca la venta como voided (RN-6, RF-V6 Deshacer)', async () => {
    const item = await createItem(
      {
        name: 'Item prueba',
        categoryId,
        priceCents: 500,
        stockInitial: 5,
      },
      testDb,
    )

    // Cobramos 2 unidades -> stock pasa a 3
    const sale = await checkoutSale(
      {
        items: [{ item, quantity: 2 }],
        discount: { enabled: false, mode: 'euros', value: 0 },
      },
      testDb,
    )

    let fromDb = await getItemById(item.id, testDb)
    expect(fromDb?.stock).toBe(3)

    // Deshacer / anular venta
    await voidSale(sale.id, testDb)

    // Stock devuelto a 5
    fromDb = await getItemById(item.id, testDb)
    expect(fromDb?.stock).toBe(5)

    // Venta marcada como voided con voidedAt
    const voidedSale = await testDb.sales.get(sale.id)
    expect(voidedSale?.status).toBe('voided')
    expect(voidedSale?.voidedAt).toBeDefined()

    // Comprobamos el invariante
    const inconsistencies = await verifyStockConsistency(testDb)
    expect(inconsistencies).toHaveLength(0)
  })

  it('voidSale falla si la venta ya está anulada', async () => {
    const item = await createItem(
      {
        name: 'Item',
        categoryId,
        priceCents: 100,
        stockInitial: 1,
      },
      testDb,
    )

    const sale = await checkoutSale(
      {
        items: [{ item, quantity: 1 }],
        discount: { enabled: false, mode: 'euros', value: 0 },
      },
      testDb,
    )

    await voidSale(sale.id, testDb)

    await expect(voidSale(sale.id, testDb)).rejects.toThrow('La venta ya está anulada')
  })

  it('Deshacer (voidReason: "undo") devuelve el stock, oculta la venta del historial por defecto, la muestra con includeUndo y no cuenta en estadísticas (A4, #3)', async () => {
    const item = await createItem(
      {
        name: 'Anillo plata',
        categoryId,
        priceCents: 1200,
        stockInitial: 5,
      },
      testDb,
    )

    // 1. Cobrar venta y deshacerla inmediatamente (como desde el toast de venta)
    const undoneSale = await checkoutSale(
      {
        items: [{ item, quantity: 2 }],
        discount: { enabled: false, mode: 'euros', value: 0 },
      },
      testDb,
    )
    await voidSale(undoneSale.id, 'undo', testDb)

    // 2. El stock vuelve al valor original (5)
    const afterUndoItem = await getItemById(item.id, testDb)
    expect(afterUndoItem?.stock).toBe(5)

    // 3. Cobrar otra venta y anularla manualmente desde el historial
    const manualVoidSale = await checkoutSale(
      {
        items: [{ item, quantity: 1 }],
        discount: { enabled: false, mode: 'euros', value: 0 },
      },
      testDb,
    )
    await voidSale(manualVoidSale.id, testDb)

    // 4. Por defecto getSales NO devuelve la venta deshecha ('undo'), pero SÍ la anulada manualmente
    const defaultHistory = await getSales({}, testDb)
    expect(defaultHistory.map(s => s.id)).toEqual([manualVoidSale.id])

    // 5. Con includeUndo: true aparecen ambas
    const fullHistory = await getSales({ includeUndo: true }, testDb)
    expect(fullHistory).toHaveLength(2)
    const storedUndo = fullHistory.find(s => s.id === undoneSale.id)
    expect(storedUndo?.voidReason).toBe('undo')
    const storedManual = fullHistory.find(s => s.id === manualVoidSale.id)
    expect(storedManual?.voidReason).toBe('manual')

    // 6. No cuenta en estadísticas
    const metrics = calculateSummaryMetrics(fullHistory)
    expect(metrics.salesCount).toBe(0)
    expect(metrics.totalRevenueCents).toBe(0)
    expect(metrics.unitsSold).toBe(0)
  })
})
