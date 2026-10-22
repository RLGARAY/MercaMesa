import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ID, Item } from '@/types'
import { CART_STORAGE_KEY } from '@/services/backupService'

export type CartQuantities = Record<ID, number>

export interface CartLine {
  item: Item
  quantity: number
}

/**
 * Purga IDs huérfanos, archivados o cantidades no válidas de un mapa de carrito (C2, #7).
 * El carrito solo almacena `itemId` y `quantity` entera >= 1.
 */
export function sanitizeCartQuantities(
  raw: unknown,
  catalogItems?: Pick<Item, 'id' | 'archived'>[],
): CartQuantities {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {}
  }

  const validActiveIds =
    catalogItems !== undefined
      ? new Set(catalogItems.filter(i => !i.archived).map(i => i.id))
      : null

  const clean: CartQuantities = {}
  for (const [itemId, qty] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty <= 0) {
      continue
    }
    if (validActiveIds !== null && !validActiveIds.has(itemId)) {
      continue
    }
    clean[itemId] = qty
  }

  return clean
}

function readStoredCart(catalogItems?: Pick<Item, 'id' | 'archived'>[]): CartQuantities {
  if (typeof localStorage === 'undefined') return {}
  try {
    const saved = localStorage.getItem(CART_STORAGE_KEY)
    if (!saved) return {}
    const parsed: unknown = JSON.parse(saved)
    const sanitized = sanitizeCartQuantities(parsed, catalogItems)
    if (catalogItems !== undefined) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(sanitized))
    }
    return sanitized
  } catch {
    return {}
  }
}

/**
 * Hook para la gestión del carrito de la compra.
 * Decisión 2: Se persiste en localStorage (solo itemId y cantidad) para sobrevivir recargas.
 * RN-1 / C2 (#7):
 *   - Purga automáticamente IDs huérfanos o archivados al cargar y cuando cambia el catálogo.
 *   - Calcula `cartLines`, `totalItemsCount` e `isActive` siempre desde las líneas válidas,
 *     leyendo nombre y precio en vivo del catálogo.
 */
export function useCart(catalogItems?: Item[]) {
  const [quantities, setQuantities] = useState<CartQuantities>(() =>
    readStoredCart(catalogItems),
  )

  // Purgar IDs huérfanos o archivados cuando cargue o cambie el catálogo (C2, #7)
  useEffect(() => {
    if (catalogItems === undefined) return
    setQuantities((prev) => {
      const purged = sanitizeCartQuantities(prev, catalogItems)
      const prevKeys = Object.keys(prev)
      const purgedKeys = Object.keys(purged)
      if (
        prevKeys.length === purgedKeys.length &&
        prevKeys.every(k => prev[k] === purged[k])
      ) {
        return prev
      }
      return purged
    })
  }, [catalogItems])

  // Sincronizar cambios a localStorage
  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    try {
      const toStore =
        catalogItems !== undefined
          ? sanitizeCartQuantities(quantities, catalogItems)
          : quantities
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(toStore))
    } catch {
      // Ignorar posibles errores de cuota de storage
    }
  }, [quantities, catalogItems])

  const addToCart = useCallback((itemId: ID) => {
    setQuantities((prev) => {
      const current = prev[itemId] ?? 0
      return { ...prev, [itemId]: current + 1 }
    })
  }, [])

  const removeFromCart = useCallback((itemId: ID) => {
    setQuantities((prev) => {
      const current = prev[itemId] ?? 0
      if (current <= 1) {
        const next = { ...prev }
        delete next[itemId]
        return next
      }
      return { ...prev, [itemId]: current - 1 }
    })
  }, [])

  const setItemQuantity = useCallback((itemId: ID, quantity: number) => {
    setQuantities((prev) => {
      if (quantity <= 0) {
        const next = { ...prev }
        delete next[itemId]
        return next
      }
      return { ...prev, [itemId]: Math.round(quantity) }
    })
  }, [])

  const clearCart = useCallback(() => {
    setQuantities({})
    try {
      localStorage.removeItem(CART_STORAGE_KEY)
    } catch {
      // Ignorar
    }
  }, [])

  // Líneas válidas del carrito (artículos existentes y no archivados, con nombre y precio en vivo)
  const cartLines = useMemo<CartLine[]>(() => {
    if (!catalogItems) return []
    const activeMap = new Map<ID, Item>()
    for (const item of catalogItems) {
      if (!item.archived) {
        activeMap.set(item.id, item)
      }
    }

    const lines: CartLine[] = []
    for (const [itemId, qty] of Object.entries(quantities)) {
      if (qty <= 0) continue
      const liveItem = activeMap.get(itemId)
      if (liveItem) {
        lines.push({ item: liveItem, quantity: qty })
      }
    }
    return lines
  }, [catalogItems, quantities])

  const getQuantity = useCallback(
    (itemId: ID): number => {
      if (catalogItems !== undefined) {
        const line = cartLines.find(l => l.item.id === itemId)
        return line?.quantity ?? 0
      }
      return quantities[itemId] ?? 0
    },
    [catalogItems, cartLines, quantities],
  )

  // Contadores y estado "activo" calculados exclusivamente desde las líneas válidas (C2, #7)
  const totalItemsCount = useMemo(() => {
    if (catalogItems !== undefined) {
      return cartLines.reduce((sum, line) => sum + line.quantity, 0)
    }
    return Object.values(quantities).reduce((sum, q) => sum + q, 0)
  }, [catalogItems, cartLines, quantities])

  const isActive = totalItemsCount > 0

  return {
    quantities,
    cartLines,
    totalItemsCount,
    isActive,
    getQuantity,
    addToCart,
    removeFromCart,
    setItemQuantity,
    clearCart,
  }
}
