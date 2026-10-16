import { UI } from '@/i18n'

/**
 * Pantalla de Ajustes / Corrección — placeholder para Fase 0.
 * Se implementa en Fase 3.
 */
export default function SettingsPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <span className="text-6xl" aria-hidden="true">⚙️</span>
      <h1 className="text-2xl font-bold text-gray-800">{UI.settings.title}</h1>
      <p className="text-gray-500">
        Aquí podrás corregir el inventario, ver el historial de ventas
        y gestionar los datos.
        <br />
        <span className="text-sm">Disponible en Fase 3.</span>
      </p>
    </div>
  )
}
