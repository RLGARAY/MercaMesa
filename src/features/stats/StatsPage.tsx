import { UI } from '@/i18n'

/**
 * Pantalla de Estadísticas — placeholder para Fase 0.
 * Se implementa en Fase 4.
 */
export default function StatsPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <span className="text-6xl" aria-hidden="true">📊</span>
      <h1 className="text-2xl font-bold text-gray-800">{UI.stats.title}</h1>
      <p className="text-gray-500">
        Aquí verás ingresos, ventas y artículos más vendidos.
        <br />
        <span className="text-sm">Disponible en Fase 4.</span>
      </p>
    </div>
  )
}
