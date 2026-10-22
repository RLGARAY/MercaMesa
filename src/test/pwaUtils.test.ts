import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { isSaleCartActive, checkStoragePersistence } from '@/utils/pwaUtils'
import { useCart } from '@/features/sale/useCart'
import { CART_STORAGE_KEY } from '@/services/backupService'
import type { Item } from '@/types'

describe('pwaUtils (SPEC sección 8)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('isSaleCartActive', () => {
    it('devuelve false cuando no hay clave en localStorage', () => {
      expect(isSaleCartActive()).toBe(false)
    })

    it('devuelve false cuando las cantidades de los artículos son 0', () => {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ 'item-1': 0, 'item-2': 0 }))
      expect(isSaleCartActive()).toBe(false)
    })

    it('devuelve true cuando hay al menos un artículo con cantidad > 0', () => {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ 'item-1': 1 }))
      expect(isSaleCartActive()).toBe(true)
    })

    it('devuelve false cuando el contenido en localStorage es un JSON inválido', () => {
      localStorage.setItem(CART_STORAGE_KEY, '{ corrupt-json')
      expect(isSaleCartActive()).toBe(false)
    })
  })

  describe('Carrito con IDs huérfanos o archivados (C2, #7)', () => {
    const baseItem: Item = {
      id: 'item-active',
      name: 'Pendiente Sol',
      categoryId: 'cat-1',
      priceCents: 500,
      stock: 5,
      archived: false,
      createdAt: '2026-10-10T10:00:00.000Z',
      updatedAt: '2026-10-10T10:00:00.000Z',
    }

    it('artículo archivado con carrito lleno: purga el ID, totalItemsCount pasa a 0 e isSaleCartActive pasa a false', () => {
      const catalogInitial: Item[] = [baseItem]
      const { result, rerender } = renderHook(
        ({ items }) => useCart(items),
        { initialProps: { items: catalogInitial } },
      )

      act(() => {
        result.current.addToCart('item-active')
        result.current.addToCart('item-active')
      })

      expect(result.current.totalItemsCount).toBe(2)
      expect(result.current.cartLines).toHaveLength(1)
      expect(isSaleCartActive(catalogInitial)).toBe(true)

      // El artículo se archiva en el catálogo
      const catalogAfterArchive: Item[] = [{ ...baseItem, archived: true }]
      rerender({ items: catalogAfterArchive })

      expect(result.current.cartLines).toHaveLength(0)
      expect(result.current.totalItemsCount).toBe(0)
      expect(result.current.quantities).toEqual({})
      expect(isSaleCartActive(catalogAfterArchive)).toBe(false)
      expect(isSaleCartActive()).toBe(false)
    })

    it('artículo borrado o catálogo importado distinto: purga huérfanos y lee precio/nombre siempre en vivo', () => {
      // Pre-cargamos en localStorage un ID huérfano y uno válido
      localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({ 'orphan-id': 3, 'item-active': 2 }),
      )

      const { result, rerender } = renderHook(
        ({ items }) => useCart(items),
        { initialProps: { items: [baseItem] } },
      )

      // Solo cuenta el artículo válido (2 uds), nunca el huérfano (3 uds)
      expect(result.current.totalItemsCount).toBe(2)
      expect(result.current.cartLines).toHaveLength(1)
      expect(result.current.quantities).toEqual({ 'item-active': 2 })
      expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '{}')).toEqual({
        'item-active': 2,
      })

      // Si cambia el nombre y precio en vivo del artículo en el catálogo, cartLines refleja los nuevos datos
      const updatedItem: Item = { ...baseItem, name: 'Pendiente Luna', priceCents: 850 }
      rerender({ items: [updatedItem] })
      expect(result.current.cartLines[0]?.item.name).toBe('Pendiente Luna')
      expect(result.current.cartLines[0]?.item.priceCents).toBe(850)
    })

    it('carrito vacío tras purga de todos los IDs huérfanos', () => {
      localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({ 'deleted-1': 4, 'deleted-2': 1 }),
      )

      const { result } = renderHook(() => useCart([baseItem]))

      expect(result.current.cartLines).toHaveLength(0)
      expect(result.current.totalItemsCount).toBe(0)
      expect(result.current.quantities).toEqual({})
      expect(isSaleCartActive([baseItem])).toBe(false)
      expect(isSaleCartActive()).toBe(false)
    })
  })

  describe('checkStoragePersistence', () => {
    it('devuelve el valor resuelto por navigator.storage.persisted()', async () => {
      const persistedMock = vi.fn().mockResolvedValue(true)
      Object.defineProperty(navigator, 'storage', {
        writable: true,
        value: { persisted: persistedMock },
      })

      const isPersisted = await checkStoragePersistence()
      expect(isPersisted).toBe(true)
      expect(persistedMock).toHaveBeenCalledTimes(1)
    })

    it('devuelve false si navigator.storage.persisted() rechaza o falla', async () => {
      const persistedMock = vi.fn().mockRejectedValue(new Error('Storage error'))
      Object.defineProperty(navigator, 'storage', {
        writable: true,
        value: { persisted: persistedMock },
      })

      const isPersisted = await checkStoragePersistence()
      expect(isPersisted).toBe(false)
    })
  })
})
