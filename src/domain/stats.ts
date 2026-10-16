/**
 * stats.ts — Cálculos de estadísticas e informes del dominio.
 *
 * Ref: SPEC.md sección 6.3 (RF-E1 a RF-E8).
 * REGLAS INNEGOCIABLES:
 *   - Lógica pura sin dependencias de React ni Dexie.
 *   - Todo el dinero en céntimos enteros (Cents).
 *   - RF-E8: TODAS las cifras excluyen ventas con status === 'voided'.
 *   - RF-E4: Para ingresos por categoría y artículo se usa lineNetCents.
 */

import type { Sale, Item, Category, Cents, ID } from '@/types'

export type PeriodType = 'today' | 'last7' | 'all' | 'custom'

export interface PeriodFilter {
  type: PeriodType
  customStart?: string | undefined // YYYY-MM-DD
  customEnd?: string | undefined   // YYYY-MM-DD
}

export interface SummaryMetrics {
  totalRevenueCents: Cents
  salesCount: number
  avgTicketCents: Cents
  unitsSold: number
  totalDiscountCents: Cents
}

export interface ItemSalesRank {
  itemId: ID
  name: string
  categoryId: ID
  unitsSold: number
  totalNetCents: Cents
}

export interface CategorySalesMetric {
  categoryId: ID
  categoryName: string
  unitsSold: number
  totalNetCents: Cents
  percentageOfRevenue: number // 0 a 100
}

export interface HourlySalesMetric {
  hour: number // 0 a 23
  hourLabel: string // "10:00", "11:00", etc.
  salesCount: number
  totalCents: Cents
  unitsSold: number
}

// ---------------------------------------------------------------------------
// Filtrado por periodo (RF-E1)
// ---------------------------------------------------------------------------

/**
 * Filtra las ventas dentro del periodo solicitado.
 * Excluye automáticamente ventas anuladas (RF-E8).
 *
 * @param referenceDate Fecha de referencia (por defecto Date.now() / hoy).
 */
export function filterSalesByPeriod(
  sales: Sale[],
  filter: PeriodFilter,
  referenceDate: Date = new Date(),
): Sale[] {
  // RF-E8: Solo ventas activas
  const activeSales = sales.filter(s => s.status === 'active')

  if (filter.type === 'all') {
    return activeSales
  }

  // Obtenemos YYYY-MM-DD de referencia local
  const refYear = referenceDate.getFullYear()
  const refMonth = String(referenceDate.getMonth() + 1).padStart(2, '0')
  const refDay = String(referenceDate.getDate()).padStart(2, '0')
  const todayStr = `${refYear}-${refMonth}-${refDay}`

  if (filter.type === 'today') {
    return activeSales.filter(s => s.createdAt.startsWith(todayStr))
  }

  if (filter.type === 'last7') {
    // 7 días atrás desde el inicio del día de referencia (00:00:00)
    const sevenDaysAgo = new Date(referenceDate)
    sevenDaysAgo.setDate(referenceDate.getDate() - 6)
    sevenDaysAgo.setHours(0, 0, 0, 0)
    const startIso = sevenDaysAgo.toISOString()

    return activeSales.filter(s => s.createdAt >= startIso)
  }

  if (filter.type === 'custom') {
    return activeSales.filter(s => {
      const saleDay = s.createdAt.slice(0, 10)
      if (filter.customStart && saleDay < filter.customStart) return false
      if (filter.customEnd && saleDay > filter.customEnd) return false
      return true
    })
  }

  return activeSales
}

// ---------------------------------------------------------------------------
// Métricas de Resumen (RF-E2)
// ---------------------------------------------------------------------------

/**
 * Calcula las tarjetas resumen del periodo:
 * - Total dinero cobrado (totalCents)
 * - Nº de ventas
 * - Ticket medio
 * - Unidades vendidas
 * - Descuento total concedido
 */
export function calculateSummaryMetrics(sales: Sale[]): SummaryMetrics {
  const activeSales = sales.filter(s => s.status === 'active')

  if (activeSales.length === 0) {
    return {
      totalRevenueCents: 0,
      salesCount: 0,
      avgTicketCents: 0,
      unitsSold: 0,
      totalDiscountCents: 0,
    }
  }

  let totalRevenueCents: Cents = 0
  let unitsSold = 0
  let totalDiscountCents: Cents = 0

  for (const sale of activeSales) {
    totalRevenueCents += sale.totalCents
    totalDiscountCents += sale.discountCents
    for (const line of sale.lines) {
      unitsSold += line.quantity
    }
  }

  const salesCount = activeSales.length
  const avgTicketCents = Math.round(totalRevenueCents / salesCount)

  return {
    totalRevenueCents,
    salesCount,
    avgTicketCents,
    unitsSold,
    totalDiscountCents,
  }
}

// ---------------------------------------------------------------------------
// Ranking de Artículos más vendidos (RF-E3)
// ---------------------------------------------------------------------------

/**
 * Genera el ranking de artículos más vendidos ordenado por unidades vendidas desc.
 * En empate, desempata por importe neto desc.
 */
export function calculateTopItems(sales: Sale[]): ItemSalesRank[] {
  const map = new Map<ID, ItemSalesRank>()

  for (const sale of sales) {
    if (sale.status !== 'active') continue

    for (const line of sale.lines) {
      const existing = map.get(line.itemId)
      if (existing) {
        existing.unitsSold += line.quantity
        existing.totalNetCents += line.lineNetCents
      } else {
        map.set(line.itemId, {
          itemId: line.itemId,
          name: line.nameSnapshot,
          categoryId: line.categoryIdSnapshot,
          unitsSold: line.quantity,
          totalNetCents: line.lineNetCents,
        })
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.unitsSold !== a.unitsSold) {
      return b.unitsSold - a.unitsSold
    }
    return b.totalNetCents - a.totalNetCents
  })
}

// ---------------------------------------------------------------------------
// Ingresos y Unidades por Categoría (RF-E4)
// ---------------------------------------------------------------------------

/**
 * Calcula ingresos netos y unidades vendidas por categoría.
 * Usa lineNetCents para repartir exactamente el descuento (RF-E4).
 */
export function calculateCategoryMetrics(
  sales: Sale[],
  categories: Category[],
): CategorySalesMetric[] {
  const categoryMap = new Map<ID, { name: string; units: number; netCents: number }>()

  // Inicializar todas las categorías conocidas (incluso las que tengan 0 ventas)
  for (const cat of categories) {
    categoryMap.set(cat.id, {
      name: cat.name,
      units: 0,
      netCents: 0,
    })
  }

  let grandTotalNet: Cents = 0

  for (const sale of sales) {
    if (sale.status !== 'active') continue

    for (const line of sale.lines) {
      grandTotalNet += line.lineNetCents
      let data = categoryMap.get(line.categoryIdSnapshot)
      if (!data) {
        data = { name: 'Sin categoría', units: 0, netCents: 0 }
        categoryMap.set(line.categoryIdSnapshot, data)
      }
      data.units += line.quantity
      data.netCents += line.lineNetCents
    }
  }

  const results: CategorySalesMetric[] = []

  for (const [id, data] of categoryMap.entries()) {
    // Calculamos el porcentaje sobre el total de ventas del periodo
    const pct = grandTotalNet > 0 ? (data.netCents / grandTotalNet) * 100 : 0
    results.push({
      categoryId: id,
      categoryName: data.name,
      unitsSold: data.units,
      totalNetCents: data.netCents,
      percentageOfRevenue: Math.round(pct * 10) / 10, // 1 decimal
    })
  }

  // Ordenar por importe neto desc
  return results.sort((a, b) => b.totalNetCents - a.totalNetCents)
}

// ---------------------------------------------------------------------------
// Ventas por Hora (RF-E5)
// ---------------------------------------------------------------------------

/**
 * Agrupa las ventas por la hora del día (0..23) dentro del periodo
 * para identificar las horas punta del mercadillo.
 */
export function calculateHourlySales(sales: Sale[]): HourlySalesMetric[] {
  // Inicializamos 24 horas
  const hoursMap = new Map<number, HourlySalesMetric>()
  for (let h = 0; h < 24; h++) {
    hoursMap.set(h, {
      hour: h,
      hourLabel: `${String(h).padStart(2, '0')}:00`,
      salesCount: 0,
      totalCents: 0,
      unitsSold: 0,
    })
  }

  for (const sale of sales) {
    if (sale.status !== 'active') continue

    const date = new Date(sale.createdAt)
    const h = date.getHours()
    const entry = hoursMap.get(h)

    if (entry) {
      entry.salesCount++
      entry.totalCents += sale.totalCents
      for (const line of sale.lines) {
        entry.unitsSold += line.quantity
      }
    }
  }

  return Array.from(hoursMap.values())
}

// ---------------------------------------------------------------------------
// Artículos sin ventas y alertas (RF-E7)
// ---------------------------------------------------------------------------

/**
 * Identifica artículos activos que no tuvieron ninguna venta en el periodo.
 */
export function findItemsWithoutSales(allItems: Item[], sales: Sale[]): Item[] {
  const soldItemIds = new Set<ID>()

  for (const sale of sales) {
    if (sale.status !== 'active') continue
    for (const line of sale.lines) {
      soldItemIds.add(line.itemId)
    }
  }

  return allItems.filter(item => !item.archived && !soldItemIds.has(item.id))
}
