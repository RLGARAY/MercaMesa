import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isSaleCartActive, checkStoragePersistence } from '@/utils/pwaUtils'
import { CART_STORAGE_KEY } from '@/services/backupService'

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
