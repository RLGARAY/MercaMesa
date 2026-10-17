import { CART_STORAGE_KEY } from '@/services/backupService'

/**
 * Comprueba si hay artículos activos en el carrito de venta actual.
 * Ref: SPEC.md sección 8 ("Nunca recargar en mitad de una venta con carrito abierto sin avisar").
 */
export function isSaleCartActive(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY)
    if (!raw) return false
    const quantities = JSON.parse(raw) as Record<string, number>
    return Object.values(quantities).some((qty) => typeof qty === 'number' && qty > 0)
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
