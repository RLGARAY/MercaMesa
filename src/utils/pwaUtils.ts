import type { Item } from '@/types'
import { CART_STORAGE_KEY } from '@/services/backupService'
import { sanitizeCartQuantities } from '@/features/sale/useCart'

/**
 * Comprueba si hay artículos activos y válidos en el carrito de venta actual.
 * Si se proporciona el catálogo, purga además cualquier ID huérfano o archivado del almacenamiento (C2, #7).
 * Ref: SPEC.md sección 8 ("Nunca recargar en mitad de una venta con carrito abierto sin avisar").
 */
export function isSaleCartActive(
  catalogItems?: Pick<Item, 'id' | 'archived'>[],
): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY)
    if (!raw) return false
    const parsed: unknown = JSON.parse(raw)
    const validQuantities = sanitizeCartQuantities(parsed, catalogItems)
    if (catalogItems !== undefined) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(validQuantities))
    }
    return Object.values(validQuantities).some((qty) => qty > 0)
  } catch {
    return false
  }
}

/**
 * Consulta el estado de persistencia del almacenamiento en el navegador (SPEC sección 8).
 */
export async function checkStoragePersistence(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
    try {
      return await navigator.storage.persisted()
    } catch {
      return false
    }
  }
  return false
}
