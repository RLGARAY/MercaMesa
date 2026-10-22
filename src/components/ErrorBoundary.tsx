import { Component, type ErrorInfo, type ReactNode } from 'react'
import { UI } from '@/i18n'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * ErrorBoundary — Atrapa errores inesperados de renderizado de React
 * y presenta una pantalla accesible de recuperación sin dejar la pantalla en blanco (RNF-7).
 */
export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Registro para diagnóstico en desarrollo sin enviar datos a terceros (RNF-8)
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary capturó un fallo:', error, errorInfo)
    }
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-dvh p-6 bg-gray-50 text-center font-sans">
          <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center text-3xl mb-4 shadow-sm" aria-hidden="true">
            ⚠️
          </div>

          <h1 className="text-xl font-bold text-gray-900 mb-2">
            {UI.errorBoundary.title}
          </h1>

          <p className="text-sm text-gray-600 max-w-sm mb-6">
            {UI.errorBoundary.desc}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
            <button
              type="button"
              onClick={this.handleReset}
              className="w-full py-3 px-4 border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 text-sm font-semibold rounded-xl min-h-[48px] shadow-sm transition-colors"
            >
              {UI.errorBoundary.retry}
            </button>

            <button
              type="button"
              onClick={this.handleReload}
              className="w-full py-3 px-4 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl min-h-[48px] shadow-sm transition-colors active:scale-95"
            >
              {UI.errorBoundary.reload}
            </button>
          </div>

          {import.meta.env.DEV && this.state.error && (
            <details className="mt-8 text-left max-w-md w-full bg-white p-3 rounded-xl border border-gray-200 text-xs text-rose-700 overflow-x-auto">
              <summary className="font-semibold cursor-pointer text-gray-700">{UI.errorBoundary.techDetails}</summary>
              <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap">{this.state.error.stack || this.state.error.message}</pre>
            </details>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
