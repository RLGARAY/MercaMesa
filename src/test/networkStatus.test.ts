import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'

describe('useNetworkStatus (RNF-3)', () => {
  const originalOnLine = navigator.onLine

  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: originalOnLine,
    })
  })

  it('inicia con el estado actual de navigator.onLine (online = true)', () => {
    const { result } = renderHook(() => useNetworkStatus())
    expect(result.current.isOnline).toBe(true)
  })

  it('detecta cuando el navegador pasa a modo offline (evento offline)', () => {
    const { result } = renderHook(() => useNetworkStatus())

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(result.current.isOnline).toBe(false)
  })

  it('detecta cuando el navegador recupera la conexión (evento online)', () => {
    const { result } = renderHook(() => useNetworkStatus())

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current.isOnline).toBe(false)

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current.isOnline).toBe(true)
  })

  it('elimina los event listeners al desmontar el hook', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useNetworkStatus())

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function))
    removeEventListenerSpy.mockRestore()
  })
})
