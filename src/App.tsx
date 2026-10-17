import { useState } from 'react'
import { UI } from '@/i18n'
import SalePage from '@/features/sale/SalePage'
import StatsPage from '@/features/stats/StatsPage'
import SettingsPage from '@/features/settings/SettingsPage'
import PWAUpdatePrompt from '@/components/PWAUpdatePrompt'
import { useSyncInfo } from '@/hooks/useSyncInfo'

// Iconos SVG inline simples para la barra de navegación.
// En Fase 8 se puede sustituir por una librería de iconos si hace falta.
function IconCart({ active }: { active: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={active ? 0 : 2}
      className="w-6 h-6"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 9m5-9v9m4-9v9m5-9l2 9"
      />
    </svg>
  )
}

function IconChart({ active }: { active: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={active ? 0 : 2}
      className="w-6 h-6"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      />
    </svg>
  )
}

function IconSettings({ active }: { active: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={active ? 0 : 2}
      className="w-6 h-6"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

type Tab = 'sale' | 'stats' | 'settings'

/**
 * App — shell principal con navegación inferior de 3 pestañas.
 * La navegación es estado local simple; no usamos react-router en Fase 0
 * porque la app es una SPA con 3 vistas, no necesita URLs navegables.
 * Decisión anotada en DECISIONS.md.
 */
export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('sale')
  const { formattedRelative, lastSyncedRevision } = useSyncInfo()

  const tabs: { id: Tab; label: string; Icon: typeof IconCart }[] = [
    { id: 'sale',     label: UI.nav.sale,     Icon: IconCart },
    { id: 'stats',    label: UI.nav.stats,    Icon: IconChart },
    { id: 'settings', label: UI.nav.settings, Icon: IconSettings },
  ]

  return (
    // Contenedor principal: ocupa toda la pantalla con safe areas
    <div className="flex flex-col h-dvh bg-white">
      {/* Banner de actualización y avisos PWA / offline */}
      <PWAUpdatePrompt />

      {/* Cabecera compacta con indicador de última sincronización (RF-C9) */}
      <header className="flex items-center justify-between px-4 py-1.5 bg-gray-50/80 border-b border-gray-200 text-[11px] text-gray-500 shrink-0">
        <span className="font-bold text-gray-700 tracking-tight flex items-center gap-1.5">
          <span>🛒</span>
          <span>MercaMesa</span>
        </span>
        <div
          className="flex items-center gap-1.5"
          title={`Última sincronización con Google Drive: ${formattedRelative}`}
        >
          <span aria-hidden="true" className="text-xs">☁️</span>
          <span>{formattedRelative}</span>
          {lastSyncedRevision > 0 && (
            <span className="text-[10px] text-gray-400">· r{lastSyncedRevision}</span>
          )}
        </div>
      </header>

      {/* Contenido de la pestaña activa — ocupa el espacio restante */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'sale'     && <SalePage />}
        {activeTab === 'stats'    && <StatsPage />}
        {activeTab === 'settings' && <SettingsPage />}
      </main>

      {/* Barra de navegación inferior fija */}
      <nav
        className="flex border-t border-gray-200 bg-white pb-safe"
        aria-label="Navegación principal"
      >
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            aria-label={label}
            aria-current={activeTab === id ? 'page' : undefined}
            className={`
              flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px]
              text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
              ${activeTab === id
                ? 'text-brand-600 font-bold'
                : 'text-gray-500 hover:text-gray-700'
              }
            `}
          >
            <Icon active={activeTab === id} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
