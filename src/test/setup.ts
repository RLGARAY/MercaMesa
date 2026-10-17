/**
 * Setup global de Vitest.
 * Se ejecuta antes de cada archivo de tests.
 */
import '@testing-library/jest-dom'
import 'fake-indexeddb/auto'
import { vi } from 'vitest'

// Mock para el módulo virtual de vite-plugin-pwa en tests
vi.mock('virtual:pwa-register/react', () => {
  return {
    useRegisterSW: vi.fn(() => ({
      offlineReady: [false, vi.fn()],
      needRefresh: [false, vi.fn()],
      updateServiceWorker: vi.fn(),
    })),
  }
})
