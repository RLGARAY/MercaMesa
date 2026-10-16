import { useState, useEffect, useCallback } from 'react'
import type { ID } from '@/types'

const CART_STORAGE_KEY = 'mercamesa_cart_v1'

export type CartQuantities = Record<ID, number>

/**
 * Hook para la gestión del carrito de la compra.
 * Decisión 2: Se persiste en localStorage para sobrevivir recargas y reaperturas del navegador.
 * RN-1: El carrito es estado local de la pantalla de venta hasta que se cobra.
 */
export function useCart() {
  const [quantities, setQuantities] = useState<CartQuantities>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY)
      if (saved) {
        return JSON.parse(saved) as CartQuantities
      }
    } catch {
      // Ignorar error de parsing y empezar vacío
    }
    return {}
  })

  // Sincronizar cambios a localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(quantities))
    } catch {
      // Ignorar posibles errores de cuota de storage
    }
  }, [quantities])

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

  const getQuantity = useCallback((itemId: ID): number => {
    return quantities[itemId] ?? 0
  }, [quantities])

  const totalItemsCount = Object.values(quantities).reduce((sum, q) => sum + q, 0)

  return {
    quantities,
    totalItemsCount,
    getQuantity,
    addToCart,
    removeFromCart,
    setItemQuantity,
    clearCart,
  }
}
