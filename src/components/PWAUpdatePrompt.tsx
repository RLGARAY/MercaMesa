import { useState, useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { isSaleCartActive } from '@/utils/pwaUtils'
import Modal from '@/components/Modal'

/**
 * PWAUpdatePrompt — Gestiona el aviso de nuevas versiones del Service Worker
 * y el estado de conectividad sin conexión (RNF-3).
 *
 * REGLA INNEGOCIABLE (SPEC sección 8):
 * "PWA con registerType: 'prompt': cuando hay versión nueva, mostrar aviso
 *  'Hay una versión nueva — Actualizar'. NUNCA recargar en mitad de una venta
 *  con carrito abierto sin avisar."
 */
export default function PWAUpdatePrompt() {
  const { isOnline } = useNetworkStatus()
  const [showCartWarning, setShowCartWarning] = useState(false)

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // Registro exitoso del service worker
      if (r) {
        // Comprobar actualizaciones periódicamente cada 60 minutos
        setInterval(() => {
          r.update().catch(() => {})
        }, 60 * 60 * 1000)
      }
    },
    onRegisterError() {
      // Fallo silencioso en entornos restringidos
    },
  })

  // Auto-ocultar notificación de offlineReady a los 4 segundos
  useEffect(() => {
    if (!offlineReady) return
    const timer = setTimeout(() => {
      setOfflineReady(false)
    }, 4000)
    return () => clearTimeout(timer)
  }, [offlineReady, setOfflineReady])

  const handleUpdateClick = () => {
    // Comprobar si hay una venta activa con carrito abierto (SPEC sección 8)
    if (isSaleCartActive()) {
      setShowCartWarning(true)
      return
    }

    // Sin venta en curso: recargar con la nueva versión de forma segura
    updateServiceWorker(true)
  }

  const handleForceUpdate = () => {
    setShowCartWarning(false)
    updateServiceWorker(true)
  }

  return (
    <>
      {/* 1. Indicador de modo offline (RNF-3) */}
      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          className="bg-amber-600 text-white text-xs font-semibold px-4 py-1.5 flex items-center justify-center gap-2 shadow-sm animate-in fade-in duration-200"
        >
          <span aria-hidden="true">📶</span>
          <span>Modo sin conexión: la aplicación funciona 100% en local</span>
        </div>
      )}

      {/* 2. Notificación efímera: lista para offline */}
      {offlineReady && (
        <div
          role="status"
          className="fixed bottom-20 left-4 right-4 z-40 max-w-md mx-auto bg-gray-900/90 text-white text-xs font-medium px-4 py-3 rounded-2xl shadow-xl flex items-center justify-between gap-3 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-base">✅</span>
            <span>App lista para funcionar sin conexión</span>
          </div>
          <button
            type="button"
            onClick={() => setOfflineReady(false)}
            aria-label="Cerrar aviso de modo sin conexión"
            className="text-gray-400 hover:text-white text-sm font-bold px-2 py-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* 3. Banner de actualización pendiente (SPEC sección 8) */}
      {needRefresh && (
        <aside
          role="alert"
          aria-label="Actualización disponible"
          className="bg-brand-600 text-white px-4 py-2.5 shadow-md flex items-center justify-between gap-3 animate-in slide-in-from-top duration-300 z-50 sticky top-0"
        >
          <div className="flex items-center gap-2 text-xs font-medium">
            <span aria-hidden="true" className="text-base">🚀</span>
            <span>Hay una versión nueva disponible</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setNeedRefresh(false)}
              className="px-2.5 py-1.5 text-xs text-brand-100 hover:text-white font-medium rounded-lg hover:bg-brand-700/50 transition-colors min-h-[40px]"
            >
              Más tarde
            </button>
            <button
              type="button"
              onClick={handleUpdateClick}
              className="px-3 py-1.5 bg-white text-brand-700 hover:bg-brand-50 text-xs font-bold rounded-lg shadow-sm transition-colors min-h-[40px] active:scale-95"
            >
              Actualizar
            </button>
          </div>
        </aside>
      )}

      {/* 4. Modal de advertencia si hay carrito activo (SPEC sección 8) */}
      <Modal
        title="Venta en curso"
        isOpen={showCartWarning}
        onClose={() => setShowCartWarning(false)}
      >
        <div className="p-4 space-y-4 text-left">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
            <p className="font-bold">⚠️ Tienes artículos en el carrito</p>
            <p>
              Si actualizas la aplicación ahora, la página se recargará para aplicar la nueva versión.
              Te recomendamos terminar o cobrar la venta actual antes de actualizar.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowCartWarning(false)}
              className="flex-1 py-3 px-4 border border-gray-300 rounded-xl text-gray-700 font-semibold text-xs hover:bg-gray-50 min-h-[48px]"
            >
              Continuar venta
            </button>
            <button
              type="button"
              onClick={handleForceUpdate}
              className="flex-1 py-3 px-4 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl text-xs min-h-[48px]"
            >
              Actualizar ahora
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
