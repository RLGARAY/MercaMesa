import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PWAUpdatePrompt from '@/components/PWAUpdatePrompt'
import { CART_STORAGE_KEY } from '@/services/backupService'
import * as pwaRegister from 'virtual:pwa-register/react'

describe('PWAUpdatePrompt (SPEC sección 8 y RNF-3)', () => {
  const updateSW = vi.fn()
  const setNeedRefresh = vi.fn()
  const setOfflineReady = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()

    // Mock por defecto sin actualización pendiente
    vi.spyOn(pwaRegister, 'useRegisterSW').mockReturnValue({
      offlineReady: [false, setOfflineReady],
      needRefresh: [false, setNeedRefresh],
      updateServiceWorker: updateSW,
    })
  })

  it('no muestra el banner de actualización si no hay versión nueva', () => {
    render(<PWAUpdatePrompt />)
    expect(screen.queryByText(/Hay una versión nueva disponible/i)).not.toBeInTheDocument()
  })

  it('muestra el banner cuando needRefresh es true', () => {
    vi.spyOn(pwaRegister, 'useRegisterSW').mockReturnValue({
      offlineReady: [false, setOfflineReady],
      needRefresh: [true, setNeedRefresh],
      updateServiceWorker: updateSW,
    })

    render(<PWAUpdatePrompt />)
    expect(screen.getByText(/Hay una versión nueva disponible/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Actualizar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Más tarde/i })).toBeInTheDocument()
  })

  it('permite posponer la actualización pulsando "Más tarde"', () => {
    vi.spyOn(pwaRegister, 'useRegisterSW').mockReturnValue({
      offlineReady: [false, setOfflineReady],
      needRefresh: [true, setNeedRefresh],
      updateServiceWorker: updateSW,
    })

    render(<PWAUpdatePrompt />)
    fireEvent.click(screen.getByRole('button', { name: /Más tarde/i }))
    expect(setNeedRefresh).toHaveBeenCalledWith(false)
  })

  it('al pulsar "Actualizar" sin artículos en el carrito, recarga directamente', () => {
    vi.spyOn(pwaRegister, 'useRegisterSW').mockReturnValue({
      offlineReady: [false, setOfflineReady],
      needRefresh: [true, setNeedRefresh],
      updateServiceWorker: updateSW,
    })

    render(<PWAUpdatePrompt />)
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/i }))

    // Carrito vacío: updateServiceWorker se llama directamente
    expect(updateSW).toHaveBeenCalledWith(true)
    expect(screen.queryByText(/Tienes artículos en el carrito/i)).not.toBeInTheDocument()
  })

  it('al pulsar "Actualizar" CON venta en curso en el carrito, muestra advertencia y previene recarga accidental (SPEC sección 8)', () => {
    vi.spyOn(pwaRegister, 'useRegisterSW').mockReturnValue({
      offlineReady: [false, setOfflineReady],
      needRefresh: [true, setNeedRefresh],
      updateServiceWorker: updateSW,
    })

    // Simular carrito con 2 unidades
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ 'item-1': 2 }))

    render(<PWAUpdatePrompt />)
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/i }))

    // NO debe llamar a updateServiceWorker todavía
    expect(updateSW).not.toHaveBeenCalled()

    // Debe abrir el modal con la advertencia de venta en curso
    expect(screen.getByText(/Tienes artículos en el carrito/i)).toBeInTheDocument()
    expect(screen.getByText(/Venta en curso/i)).toBeInTheDocument()

    // Si el usuario elige "Continuar venta", el modal se cierra y no se recarga
    fireEvent.click(screen.getByRole('button', { name: /Continuar venta/i }))
    expect(screen.queryByText(/Tienes artículos en el carrito/i)).not.toBeInTheDocument()
    expect(updateSW).not.toHaveBeenCalled()
  })

  it('permite forzar la actualización desde el modal de advertencia de carrito', () => {
    vi.spyOn(pwaRegister, 'useRegisterSW').mockReturnValue({
      offlineReady: [false, setOfflineReady],
      needRefresh: [true, setNeedRefresh],
      updateServiceWorker: updateSW,
    })

    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ 'item-1': 1 }))

    render(<PWAUpdatePrompt />)
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/i }))

    // Confirmar en el modal
    fireEvent.click(screen.getByRole('button', { name: /Actualizar ahora/i }))
    expect(updateSW).toHaveBeenCalledWith(true)
  })

  it('muestra aviso efímero cuando la app está lista para modo offline (offlineReady = true)', () => {
    vi.spyOn(pwaRegister, 'useRegisterSW').mockReturnValue({
      offlineReady: [true, setOfflineReady],
      needRefresh: [false, setNeedRefresh],
      updateServiceWorker: updateSW,
    })

    render(<PWAUpdatePrompt />)
    expect(screen.getByText(/App lista para funcionar sin conexión/i)).toBeInTheDocument()
  })
})
