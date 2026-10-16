import { UI } from '@/i18n'

/**
 * Pantalla de Venta — placeholder para Fase 0.
 * Se implementa en Fase 2.
 */
export default function SalePage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <span className="text-6xl" aria-hidden="true">🛒</span>
      <h1 className="text-2xl font-bold text-gray-800">{UI.nav.sale}</h1>
      <p className="text-gray-500">
        Aquí podrás añadir artículos al carrito y cobrar.
        <br />
        <span className="text-sm">Disponible en Fase 2.</span>
      </p>
    </div>
  )
}
