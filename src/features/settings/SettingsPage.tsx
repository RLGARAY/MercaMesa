import { useState } from 'react'
import { UI } from '@/i18n'
import InventorySection from '@/features/settings/InventorySection'
import SalesHistorySection from '@/features/settings/SalesHistorySection'
import CatalogSection from '@/features/settings/CatalogSection'
import ConsistencySection from '@/features/settings/ConsistencySection'

type SettingsTab = 'inventory' | 'sales' | 'catalog' | 'diagnostics'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('inventory')

  const tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'inventory',   label: 'Inventario',   icon: '📦' },
    { id: 'sales',       label: 'Ventas',       icon: '🧾' },
    { id: 'catalog',     label: 'Catálogo',     icon: '🏷️' },
    { id: 'diagnostics', label: 'Datos / Test', icon: '⚙️' },
  ]

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto">
      {/* Cabecera de Ajustes con selector horizontal de secciones */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 pt-3 pb-2 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900 mb-2 text-left">{UI.settings.title}</h1>

        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none" role="tablist" aria-label="Secciones de Ajustes">
          {tabs.map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors min-h-10 ${
                activeTab === id
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span aria-hidden="true">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Contenido de la sección activa */}
      <div className="flex-1 p-4 pb-20 max-w-2xl mx-auto w-full">
        {activeTab === 'inventory'   && <InventorySection />}
        {activeTab === 'sales'       && <SalesHistorySection />}
        {activeTab === 'catalog'     && <CatalogSection />}
        {activeTab === 'diagnostics' && (
          <div className="space-y-6">
            <ConsistencySection />

            {/* Placeholders de Fases 5 y 7 */}
            <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm text-left space-y-3">
              <h2 className="text-base font-bold text-gray-900">{UI.settings.data}</h2>
              <p className="text-xs text-gray-500">
                Copias locales en JSON y sincronización manual con Google Drive.
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  disabled
                  className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-400 font-semibold text-center cursor-not-allowed"
                >
                  📁 Exportar JSON (Fase 5)
                </button>
                <button
                  type="button"
                  disabled
                  className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-400 font-semibold text-center cursor-not-allowed"
                >
                  📥 Importar JSON (Fase 5)
                </button>
              </div>
              <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-xl text-xs text-amber-800">
                ☁️ Sincronización con Google Drive disponible en <strong>Fase 7</strong>.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
