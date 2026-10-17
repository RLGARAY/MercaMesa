import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ErrorBoundary from '@/components/ErrorBoundary'

// Componente defectuoso de prueba
function ProblemChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Fallo crítico simulado en UI')
  }
  return <div>Contenido sin errores</div>
}

describe('ErrorBoundary (RNF-7)', () => {
  const originalError = console.error

  beforeEach(() => {
    // Silenciar error logs esperados de React en test
    console.error = vi.fn()
  })

  afterEach(() => {
    console.error = originalError
  })

  it('renderiza a los hijos normalmente cuando no hay errores', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Contenido sin errores')).toBeInTheDocument()
  })

  it('atrapa errores de renderizado y muestra pantalla de recuperación sin pantalla en blanco', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>,
    )

    expect(screen.getByText(/Algo ha ido mal/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Recargar app/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reintentar/i })).toBeInTheDocument()
  })

  it('permite reintentar el renderizado al pulsar Reintentar', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>,
    )

    expect(screen.getByText(/Algo ha ido mal/i)).toBeInTheDocument()

    // Cambiamos el estado a no defectuoso y pulsamos Reintentar
    rerender(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }))
    expect(screen.getByText('Contenido sin errores')).toBeInTheDocument()
  })
})
