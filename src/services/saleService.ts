/**
 * saleService.ts — Casos de uso de ventas (cobro y anulación).
 *
 * Reglas de negocio que aplica:
 *   RN-2: Cobrar crea una Sale activa con snapshots de nombre, categoría y precio,
 *         descuenta el stock de cada artículo en una única transacción atómica.
 *   RN-3: Stock insuficiente permite continuar (stock puede quedar negativo).
 *   RN-4: Cálculo de discountCents normalizado.
 *   RN-5: Reparto del descuento entre líneas según método del mayor resto.
 *   RN-6: Anular venta cambia status a 'voided', guarda voidedAt y devuelve el stock
 *         en una única transacción. No modifica la venta, la anula.
 *
 * Invariante de stock (SPEC sección 4):
 *   stock = suma(adjustments.delta) - suma(quantity de líneas en ventas activas)
 */

import type { ID, Item, Sale, SaleLine, Cents } from '@/types'
import { db as defaultDb, type MercaMesaDB } from '@/db/db'
import {
  calculateDiscountCents,
  distributeDiscount,
  type RawDiscountInput,
} from '@/domain/discount'
import { localDayRange } from '@/domain/stats'

export interface CartItemInput {
  item: Item
  quantity: number
}

export interface CheckoutInput {
  items: CartItemInput[]
  discount: RawDiscountInput
}

// ---------------------------------------------------------------------------
// Cobrar (RN-2)
// ---------------------------------------------------------------------------

/**
 * Registra una venta completa y descuenta el stock de los artículos correspondientes.
 * Operación 100% atómica dentro de una transacción Dexie (RNF-7).
 *
 * @throws {Error} Si el carrito está vacío o algún dato es inconsistente.
 */
export async function checkoutSale(
  input: CheckoutInput,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<Sale> {
  const activeLines = input.items.filter(i => i.quantity > 0)
  if (activeLines.length === 0) {
    throw new Error('El carrito está vacío')
  }

  // 1. Calcular subtotales preliminares
  let subtotalCents: Cents = 0
  const linesPreliminary = activeLines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new Error(`Cantidad no válida para el artículo ${line.item.name}`)
    }
    const lineListCents = line.item.priceCents * line.quantity
    subtotalCents += lineListCents
    return {
      line,
      lineListCents,
    }
  })

  // 2. Normalizar descuento (RN-4)
  const discountCents = calculateDiscountCents(subtotalCents, input.discount)
  const totalCents = subtotalCents - discountCents

  // 3. Repartir descuento entre líneas (RN-5)
  const distributed = distributeDiscount(
    linesPreliminary.map((l, index) => ({
      id: String(index),
      lineListCents: l.lineListCents,
    })),
    discountCents,
    subtotalCents,
  )

  // 4. Construir las SaleLine con snapshots definitivos
  const saleLines: SaleLine[] = linesPreliminary.map((l, index) => {
    const dist = distributed[index]!
    return {
      itemId: l.line.item.id,
      nameSnapshot: l.line.item.name,
      categoryIdSnapshot: l.line.item.categoryId,
      unitPriceCents: l.line.item.priceCents,
      quantity: l.line.quantity,
      lineListCents: l.lineListCents,
      lineDiscountCents: dist.lineDiscountCents,
      lineNetCents: dist.lineNetCents,
    }
  })

  const now = new Date().toISOString()
  const saleId = crypto.randomUUID()

  const sale: Sale = {
    id: saleId,
    createdAt: now,
    lines: saleLines,
    subtotalCents,
    discountCents,
    totalCents,
    status: 'active',
  }

  // 5. Transacción atómica: guardar Sale y actualizar stock de cada item
  await dbInstance.transaction('rw', [dbInstance.sales, dbInstance.items], async () => {
    await dbInstance.sales.add(sale)

    for (const line of activeLines) {
      const currentItem = await dbInstance.items.get(line.item.id)
      if (currentItem) {
        // RN-3: Si supera el stock, permite continuar y el stock queda negativo
        await dbInstance.items.update(line.item.id, {
          stock: currentItem.stock - line.quantity,
          updatedAt: now,
        })
      }
    }
  })

  return sale
}

// ---------------------------------------------------------------------------
// Anular venta (RN-6 / Deshacer RF-V6)
// ---------------------------------------------------------------------------

/**
 * Anula una venta previamente registrada.
 * - Cambia status a 'voided' y añade voidedAt.
 * - Devuelve el stock a los artículos correspondientes.
 * - Operación atómica en una transacción Dexie.
 *
 * @throws {Error} Si la venta no existe o ya estaba anulada.
 */
export async function voidSale(
  saleId: ID,
  reasonOrDb: 'undo' | 'manual' | MercaMesaDB = 'manual',
  dbInstance: MercaMesaDB = defaultDb,
): Promise<void> {
  const voidReason: 'undo' | 'manual' = typeof reasonOrDb === 'string' ? reasonOrDb : 'manual'
  const db: MercaMesaDB = typeof reasonOrDb === 'string' ? dbInstance : reasonOrDb
  const now = new Date().toISOString()

  await db.transaction('rw', [db.sales, db.items], async () => {
    const sale = await db.sales.get(saleId)
    if (!sale) {
      throw new Error('Venta no encontrada')
    }
    if (sale.status === 'voided') {
      throw new Error('La venta ya está anulada')
    }

    // Marcar venta como anulada registrando el motivo ('undo' | 'manual')
    await db.sales.update(saleId, {
      status: 'voided',
      voidedAt: now,
      voidReason,
    })

    // Devolver stock de cada línea
    for (const line of sale.lines) {
      const currentItem = await db.items.get(line.itemId)
      if (currentItem) {
        await db.items.update(line.itemId, {
          stock: currentItem.stock + line.quantity,
          updatedAt: now,
        })
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Consultas de ventas (RF-C3)
// ---------------------------------------------------------------------------

export interface SalesFilterOptions {
  status?: 'all' | 'active' | 'voided'
  date?: string // Formato YYYY-MM-DD
  includeUndo?: boolean // Por defecto false: excluye anulaciones por 'undo' (A4)
}

/**
 * Obtiene la lista de ventas ordenadas por fecha descendente (más recientes primero).
 * Permite filtrar por estado y por fecha del día (RF-C3).
 * Por defecto excluye las ventas anuladas mediante el botón "Deshacer" (voidReason === 'undo'),
 * salvo que se indique includeUndo: true (A4).
 */
export async function getSales(
  options: SalesFilterOptions = {},
  dbInstance: MercaMesaDB = defaultDb,
): Promise<Sale[]> {
  const query = dbInstance.sales.toCollection()

  let sales = await query.toArray()

  // Ocultar ventas deshechas ('undo') por defecto (A4)
  if (!options.includeUndo) {
    sales = sales.filter(s => !(s.status === 'voided' && s.voidReason === 'undo'))
  }

  // Filtro por estado
  if (options.status && options.status !== 'all') {
    sales = sales.filter(s => s.status === options.status)
  }

  // Filtro por fecha en hora local (YYYY-MM-DD)
  if (options.date) {
    const { startMs, endMs } = localDayRange(options.date)
    sales = sales.filter(s => {
      const t = new Date(s.createdAt).getTime()
      return t >= startMs && t <= endMs
    })
  }

  // Ordenar más recientes primero
  return sales.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Obtiene el detalle de una venta por su ID.
 */
export async function getSaleById(
  saleId: ID,
  dbInstance: MercaMesaDB = defaultDb,
): Promise<Sale | undefined> {
  return dbInstance.sales.get(saleId)
}
