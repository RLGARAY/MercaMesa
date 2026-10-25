import { useState } from 'react'
import { UI } from '@/i18n'
import InventorySection from '@/features/settings/InventorySection'
import SalesHistorySection from '@/features/settings/SalesHistorySection'
import CatalogSection from '@/features/settings/CatalogSection'
import ConsistencySection from '@/features/settings/ConsistencySection'
import DataBackupSection from '@/features/settings/DataBackupSection'

type SettingsTab = 'inventory' | 'sales' | 'catalog' | 'diagnostics'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('inventory')

  const tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'inventory',   label: UI.settings.tabs.inventory,   icon: '📦' },
    { id: 'sales',       label: UI.settings.tabs.sales,       icon: '🧾' },
    { id: 'catalog',     label: UI.settings.tabs.catalog,     icon: '🏷️' },
    { id: 'diagnostics', label: UI.settings.tabs.diagnostics, icon: '⚙️' },
  ]

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto">
      {/* Cabecera de Ajustes con selector horizontal de secciones */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 pt-3 pb-2 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900 mb-2 text-left">{UI.settings.title}</h1>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="tablist" aria-label={UI.settings.sectionsAria}>
          {tabs.map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors min-h-[44px] min-w-[44px] ${
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

            <DataBackupSection />
          </div>
        )}
      </div>
    </div>
  )
}
