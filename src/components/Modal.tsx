import { useEffect, type ReactNode } from 'react'
import { UI } from '@/i18n'

interface ModalProps {
  title: string
  isOpen: boolean
  onClose: () => void
  children: ReactNode
}

/**
 * Modal accesible y adaptado a móvil.
 * - Targets táctiles >= 48px (RNF-1)
 * - Cierre con tecla Escape y clic en backdrop
 * - aria-modal="true" y rol dialog (RNF-6)
 */
export default function Modal({ title, isOpen, onClose, children }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    // Prevenir scroll en el fondo mientras el modal está abierto
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = originalOverflow
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex flex-col w-full max-w-lg max-h-[90dvh] bg-white rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom duration-200">
        {/* Cabecera */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 id="modal-title" className="text-lg font-bold text-gray-900 truncate">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={UI.common.close}
            className="flex items-center justify-center w-12 h-12 text-gray-500 hover:text-gray-700 active:bg-gray-100 rounded-full transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Contenido con scroll */}
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  )
}
