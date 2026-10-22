import { describe, it, expect } from 'vitest'
import type { Sale, Category, Item } from '@/types'
import {
  filterSalesByPeriod,
  calculateSummaryMetrics,
  calculateTopItems,
  calculateCategoryMetrics,
  calculateHourlySales,
  getRelevantHourlySales,
  findItemsWithoutSales,
  classifyStockLevel,
  findCriticalStockItems,
  DEFAULT_LOW_STOCK_THRESHOLD,
} from '@/domain/stats'

describe('stats domain logic (RF-E1 a RF-E8)', () => {
  const catPendientes: Category = { id: 'cat-1', name: 'Pendientes', sortOrder: 0, archived: false }
  const catLlaveros: Category = { id: 'cat-2', name: 'Llaveros', sortOrder: 1, archived: false }
  const categories = [catPendientes, catLlaveros]

  const item1: Item = {
    id: 'item-1',
    name: 'Pendiente Flor',
    categoryId: 'cat-1',
    priceCents: 500,
    stock: 5,
    archived: false,
    createdAt: '2026-10-10T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
  }
  const item2: Item = {
    id: 'item-2',
    name: 'Llavero Resina',
    categoryId: 'cat-2',
    priceCents: 300,
    stock: 8,
    archived: false,
    createdAt: '2026-10-10T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
  }
  const item3: Item = {
    id: 'item-3',
    name: 'Sin Ventas',
    categoryId: 'cat-1',
    priceCents: 800,
    stock: 2,
    archived: false,
    createdAt: '2026-10-10T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
  }

  // Ventas de prueba
  // Venta 1: Hoy a las 11:30 - 2 item1 por 1000 céntimos (dto: 100 -> total 900)
  const sale1: Sale = {
    id: 'sale-1',
    createdAt: '2026-10-16T11:30:00.000Z',
    status: 'active',
    subtotalCents: 1000,
    discountCents: 100,
    totalCents: 900,
    lines: [
      {
        itemId: 'item-1',
        nameSnapshot: 'Pendiente Flor',
        categoryIdSnapshot: 'cat-1',
        unitPriceCents: 500,
        quantity: 2,
        lineListCents: 1000,
        lineDiscountCents: 100,
        lineNetCents: 900,
      },
    ],
  }

  // Venta 2: Hoy a las 11:45 - 1 item2 por 300 céntimos (sin descuento)
  const sale2: Sale = {
    id: 'sale-2',
    createdAt: '2026-10-16T11:45:00.000Z',
    status: 'active',
    subtotalCents: 300,
    discountCents: 0,
    totalCents: 300,
    lines: [
      {
        itemId: 'item-2',
        nameSnapshot: 'Llavero Resina',
        categoryIdSnapshot: 'cat-2',
        unitPriceCents: 300,
        quantity: 1,
        lineListCents: 300,
        lineDiscountCents: 0,
        lineNetCents: 300,
      },
    ],
  }

  // Venta 3: Hace 3 días (2026-10-13) - 1 item1 por 500 céntimos
  const sale3: Sale = {
    id: 'sale-3',
    createdAt: '2026-10-13T16:00:00.000Z',
    status: 'active',
    subtotalCents: 500,
    discountCents: 0,
    totalCents: 500,
    lines: [
      {
        itemId: 'item-1',
        nameSnapshot: 'Pendiente Flor',
        categoryIdSnapshot: 'cat-1',
        unitPriceCents: 500,
        quantity: 1,
        lineListCents: 500,
        lineDiscountCents: 0,
        lineNetCents: 500,
      },
    ],
  }

  // Venta 4: Anulada hoy (debe excluirse de todas las estadísticas, RF-E8)
  const saleVoided: Sale = {
    id: 'sale-void',
    createdAt: '2026-10-16T12:00:00.000Z',
    status: 'voided',
    voidedAt: '2026-10-16T12:05:00.000Z',
    subtotalCents: 2000,
    discountCents: 0,
    totalCents: 2000,
    lines: [
      {
        itemId: 'item-2',
        nameSnapshot: 'Llavero Resina',
        categoryIdSnapshot: 'cat-2',
        unitPriceCents: 300,
        quantity: 5,
        lineListCents: 1500,
        lineDiscountCents: 0,
        lineNetCents: 1500,
      },
    ],
  }

  const allSales = [sale1, sale2, sale3, saleVoided]
  const refDate = new Date('2026-10-16T18:00:00.000Z')

  describe('filterSalesByPeriod (RF-E1, RF-E8)', () => {
    it('filtro "today" devuelve solo las ventas activas de hoy', () => {
      const res = filterSalesByPeriod(allSales, { type: 'today' }, refDate)
      expect(res).toHaveLength(2)
      expect(res.map(s => s.id)).toEqual(['sale-1', 'sale-2'])
    })

    it('filtro "last7" devuelve las ventas activas de los últimos 7 días', () => {
      const res = filterSalesByPeriod(allSales, { type: 'last7' }, refDate)
      expect(res).toHaveLength(3)
      expect(res.map(s => s.id)).toEqual(['sale-1', 'sale-2', 'sale-3'])
    })

    it('filtro "all" devuelve todas las ventas activas excluyendo anuladas', () => {
      const res = filterSalesByPeriod(allSales, { type: 'all' }, refDate)
      expect(res).toHaveLength(3)
      expect(res.some(s => s.status === 'voided')).toBe(false)
    })

    it('filtro "custom" filtra por rango de fechas YYYY-MM-DD', () => {
      const res = filterSalesByPeriod(
        allSales,
        { type: 'custom', customStart: '2026-10-12', customEnd: '2026-10-14' },
        refDate,
      )
      expect(res).toHaveLength(1)
      expect(res[0]?.id).toBe('sale-3')
    })

    it('respeta la zona horaria local Europe/Madrid en verano (CEST, UTC+2) e invierno (CET, UTC+1), medianoche local y cambios de hora (B1, #4)', () => {
      const makeSale = (id: string, createdAt: string): Sale => ({
        id,
        createdAt,
        status: 'active',
        subtotalCents: 500,
        discountCents: 0,
        totalCents: 500,
        lines: [
          {
            itemId: 'item-1',
            nameSnapshot: 'Pendiente Flor',
            categoryIdSnapshot: 'cat-1',
            unitPriceCents: 500,
            quantity: 1,
            lineListCents: 500,
            lineDiscountCents: 0,
            lineNetCents: 500,
          },
        ],
      })

      // 1. Verano (CEST = UTC+2): el día local 2026-07-15 empieza en 2026-07-14T22:00:00.000Z
      // - 2026-07-14T21:59:59.999Z -> 23:59:59 del 14 de julio en Madrid (día anterior)
      // - 2026-07-14T22:00:00.000Z -> 00:00:00 del 15 de julio en Madrid (medianoche local exacta)
      // - 2026-07-14T22:30:00.000Z -> 00:30:00 del 15 de julio en Madrid (DEBE entrar en Hoy 15-jul)
      // - 2026-07-14T23:30:00.000Z -> 01:30:00 del 15 de julio en Madrid (DEBE entrar en Hoy 15-jul)
      const summerSales = [
        makeSale('summer-prev-day', '2026-07-14T21:59:59.999Z'),
        makeSale('summer-midnight', '2026-07-14T22:00:00.000Z'),
        makeSale('summer-2230-utc', '2026-07-14T22:30:00.000Z'),
        makeSale('summer-2330-utc', '2026-07-14T23:30:00.000Z'),
      ]
      const summerRef = new Date('2026-07-15T10:00:00.000Z')
      const summerToday = filterSalesByPeriod(summerSales, { type: 'today' }, summerRef)
      expect(summerToday.map(s => s.id)).toEqual([
        'summer-midnight',
        'summer-2230-utc',
        'summer-2330-utc',
      ])

      // 2. Invierno (CET = UTC+1): el día local 2026-01-15 empieza en 2026-01-14T23:00:00.000Z
      // - 2026-01-14T22:30:00.000Z -> 23:30:00 del 14 de enero en Madrid (día anterior)
      // - 2026-01-14T23:00:00.000Z -> 00:00:00 del 15 de enero en Madrid (medianoche local)
      // - 2026-01-14T23:30:00.000Z -> 00:30:00 del 15 de enero en Madrid (DEBE entrar en Hoy 15-ene)
      const winterSales = [
        makeSale('winter-2230-utc', '2026-01-14T22:30:00.000Z'),
        makeSale('winter-midnight', '2026-01-14T23:00:00.000Z'),
        makeSale('winter-2330-utc', '2026-01-14T23:30:00.000Z'),
      ]
      const winterRef = new Date('2026-01-15T10:00:00.000Z')
      const winterToday = filterSalesByPeriod(winterSales, { type: 'today' }, winterRef)
      expect(winterToday.map(s => s.id)).toEqual(['winter-midnight', 'winter-2330-utc'])

      // 3. Cambio de hora de primavera (último domingo de marzo: 2026-03-29, día de 23 horas)
      // Empieza en 2026-03-28T23:00:00.000Z (CET) y termina en 2026-03-29T21:59:59.999Z (CEST)
      const marchDstSales = [
        makeSale('march-before', '2026-03-28T22:59:59.999Z'),
        makeSale('march-start', '2026-03-28T23:00:00.000Z'),
        makeSale('march-end', '2026-03-29T21:59:59.999Z'),
        makeSale('march-next-day', '2026-03-29T22:00:00.000Z'),
      ]
      const marchToday = filterSalesByPeriod(
        marchDstSales,
        { type: 'today' },
        new Date('2026-03-29T12:00:00.000Z'),
      )
      expect(marchToday.map(s => s.id)).toEqual(['march-start', 'march-end'])

      // 4. Cambio de hora de otoño (último domingo de octubre: 2026-10-25, día de 25 horas)
      // Empieza en 2026-10-24T22:00:00.000Z (CEST) y termina en 2026-10-25T22:59:59.999Z (CET)
      const octDstSales = [
        makeSale('oct-before', '2026-10-24T21:59:59.999Z'),
        makeSale('oct-start', '2026-10-24T22:00:00.000Z'),
        makeSale('oct-end', '2026-10-25T22:59:59.999Z'),
        makeSale('oct-next-day', '2026-10-25T23:00:00.000Z'),
      ]
      const octToday = filterSalesByPeriod(
        octDstSales,
        { type: 'today' },
        new Date('2026-10-25T12:00:00.000Z'),
      )
      expect(octToday.map(s => s.id)).toEqual(['oct-start', 'oct-end'])

      // 5. Rango personalizado inclusivo en ambos extremos con horas locales
      const customRangeRes = filterSalesByPeriod(
        summerSales,
        { type: 'custom', customStart: '2026-07-15', customEnd: '2026-07-15' },
        summerRef,
      )
      expect(customRangeRes.map(s => s.id)).toEqual([
        'summer-midnight',
        'summer-2230-utc',
        'summer-2330-utc',
      ])
    })
  })

  describe('calculateSummaryMetrics (RF-E2, RF-E8)', () => {
    it('calcula métricas de resumen correctas del conjunto activo', () => {
      const metrics = calculateSummaryMetrics([sale1, sale2])
      // Total ingresos: 900 + 300 = 1200
      expect(metrics.totalRevenueCents).toBe(1200)
      expect(metrics.salesCount).toBe(2)
      // Ticket medio: 1200 / 2 = 600
      expect(metrics.avgTicketCents).toBe(600)
      // Unidades: 2 + 1 = 3
      expect(metrics.unitsSold).toBe(3)
      // Descuentos: 100
      expect(metrics.totalDiscountCents).toBe(100)
    })

    it('devuelve ceros si la lista está vacía o solo contiene anuladas', () => {
      const metrics = calculateSummaryMetrics([saleVoided])
      expect(metrics.totalRevenueCents).toBe(0)
      expect(metrics.salesCount).toBe(0)
      expect(metrics.avgTicketCents).toBe(0)
      expect(metrics.unitsSold).toBe(0)
    })
  })

  describe('calculateTopItems (RF-E3)', () => {
    it('ordena por unidades vendidas desc y calcula el neto', () => {
      const ranking = calculateTopItems([sale1, sale2, sale3])
      // item-1 vendió 2 (en sale1) + 1 (en sale3) = 3 unidades, neto 900 + 500 = 1400
      // item-2 vendió 1 unidad, neto 300
      expect(ranking).toHaveLength(2)
      expect(ranking[0]?.itemId).toBe('item-1')
      expect(ranking[0]?.unitsSold).toBe(3)
      expect(ranking[0]?.totalNetCents).toBe(1400)

      expect(ranking[1]?.itemId).toBe('item-2')
      expect(ranking[1]?.unitsSold).toBe(1)
      expect(ranking[1]?.totalNetCents).toBe(300)
    })
  })

  describe('calculateCategoryMetrics (RF-E4)', () => {
    it('agrupa por categoría usando lineNetCents y calcula porcentajes', () => {
      const catMetrics = calculateCategoryMetrics([sale1, sale2], categories)
      // Total neto = 900 (Pendientes) + 300 (Llaveros) = 1200
      // Pendientes: 900 / 1200 = 75%
      // Llaveros: 300 / 1200 = 25%
      const pend = catMetrics.find(c => c.categoryId === 'cat-1')
      const llav = catMetrics.find(c => c.categoryId === 'cat-2')

      expect(pend?.unitsSold).toBe(2)
      expect(pend?.totalNetCents).toBe(900)
      expect(pend?.percentageOfRevenue).toBe(75)

      expect(llav?.unitsSold).toBe(1)
      expect(llav?.totalNetCents).toBe(300)
      expect(llav?.percentageOfRevenue).toBe(25)
    })
  })

  describe('calculateHourlySales y getRelevantHourlySales (RF-E5, B2, #5)', () => {
    it('cuenta ventas y total en las horas correspondientes', () => {
      const hourly = calculateHourlySales([sale1, sale2])
      expect(hourly).toHaveLength(24)

      // Ambas ventas ocurrieron a las 11 UTC / hora local de la prueba
      const hourSale1 = new Date(sale1.createdAt).getHours()
      const entry = hourly.find(h => h.hour === hourSale1)

      expect(entry?.salesCount).toBe(2)
      expect(entry?.totalCents).toBe(1200)
      expect(entry?.unitsSold).toBe(3)
    })

    it('usa el rango 8-22 por defecto y se amplía para contener todas las horas con ventas, coincidiendo la suma con el total del periodo (B2, #5)', () => {
      // Caso 1: ventas solo dentro de 8-22 -> rango se mantiene en 8..22 (15 horas)
      const normalRange = getRelevantHourlySales([sale1, sale2])
      expect(normalRange[0]?.hour).toBe(8)
      expect(normalRange[normalRange.length - 1]?.hour).toBe(22)
      expect(normalRange).toHaveLength(15)

      // Caso 2: ventas a las 06:15 local (04:15 UTC en verano) y a las 23:40 local (21:40 UTC en verano)
      const earlySale: Sale = {
        ...sale1,
        id: 'sale-early',
        createdAt: '2026-07-15T04:15:00.000Z', // 06:15 CEST
        totalCents: 700,
      }
      const lateSale: Sale = {
        ...sale2,
        id: 'sale-late',
        createdAt: '2026-07-15T21:40:00.000Z', // 23:40 CEST
        totalCents: 400,
      }

      const periodSales = [earlySale, sale1, sale2, lateSale]
      const expandedRange = getRelevantHourlySales(periodSales)

      expect(expandedRange[0]?.hour).toBe(6)
      expect(expandedRange[expandedRange.length - 1]?.hour).toBe(23)
      expect(expandedRange).toHaveLength(18) // 6..23 inclusive

      const summary = calculateSummaryMetrics(periodSales)
      const chartTotalCents = expandedRange.reduce((sum, h) => sum + h.totalCents, 0)
      const chartSalesCount = expandedRange.reduce((sum, h) => sum + h.salesCount, 0)
      const chartUnitsSold = expandedRange.reduce((sum, h) => sum + h.unitsSold, 0)

      expect(chartTotalCents).toBe(summary.totalRevenueCents)
      expect(chartSalesCount).toBe(summary.salesCount)
      expect(chartUnitsSold).toBe(summary.unitsSold)
    })
  })

  describe('findItemsWithoutSales y stock bajo/cero/negativo (RF-E7, C1, #6)', () => {
    it('detecta artículos activos sin ventas en el periodo', () => {
      const withoutSales = findItemsWithoutSales([item1, item2, item3], [sale1, sale2])
      expect(withoutSales).toHaveLength(1)
      expect(withoutSales[0]?.id).toBe('item-3')
    })

    it('usa umbral por defecto <= 2, permite umbral configurable y distingue stock bajo, cero y negativo (C1, #6)', () => {
      expect(DEFAULT_LOW_STOCK_THRESHOLD).toBe(2)

      // Por defecto (umbral = 2): 2 y 1 son 'low', 0 es 'zero', -1 es 'negative', 3 es 'ok'
      expect(classifyStockLevel(3)).toBe('ok')
      expect(classifyStockLevel(2)).toBe('low')
      expect(classifyStockLevel(1)).toBe('low')
      expect(classifyStockLevel(0)).toBe('zero')
      expect(classifyStockLevel(-2)).toBe('negative')

      // Con umbral configurado en 4: 4 es 'low', 5 es 'ok'
      expect(classifyStockLevel(4, 4)).toBe('low')
      expect(classifyStockLevel(5, 4)).toBe('ok')

      const sampleItems: Item[] = [
        { ...item1, id: 'i-ok', stock: 5 },
        { ...item1, id: 'i-low2', stock: 2 },
        { ...item1, id: 'i-low1', stock: 1 },
        { ...item1, id: 'i-zero', stock: 0 },
        { ...item1, id: 'i-neg', stock: -1 },
        { ...item3, id: 'i-arch', stock: 0, archived: true },
      ]

      // Con umbral por defecto (2) incluye 2, 1, 0 y -1 (excluye archivados y > 2)
      expect(findCriticalStockItems(sampleItems).map(i => i.id)).toEqual([
        'i-low2',
        'i-low1',
        'i-zero',
        'i-neg',
      ])

      // Con umbral = 5 incluye también i-ok
      expect(findCriticalStockItems(sampleItems, 5).map(i => i.id)).toEqual([
        'i-ok',
        'i-low2',
        'i-low1',
        'i-zero',
        'i-neg',
      ])
    })
  })
})
