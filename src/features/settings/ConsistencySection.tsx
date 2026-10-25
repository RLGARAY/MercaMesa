import { useState } from 'react'
import type { Item } from '@/types'
import { UI } from '@/i18n'
import { verifyStockConsistency, repairStockInconsistencies } from '@/services/itemService'

interface InconsistencyResult {
  item: Item
  expected: number
  actual: number
}

interface ConsistencySectionProps {
  onFixItem?: (item: Item) => void
}

export default function ConsistencySection({ onFixItem }: ConsistencySectionProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<{
    tested: boolean
    inconsistencies: InconsistencyResult[]
  }>({
    tested: false,
    inconsistencies: [],
  })

  const handleRunCheck = async () => {
    setIsRunning(true)
    try {
      const issues = await verifyStockConsistency()
      setResult({
        tested: true,
        inconsistencies: issues,
      })
    } finally {
      setIsRunning(false)
    }
  }

  const handleRepairAll = async () => {
    setIsRunning(true)
    try {
      await repairStockInconsistencies()
      const issues = await verifyStockConsistency()
      setResult({
        tested: true,
        inconsistencies: issues,
      })
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3 text-left">
      <div>
        <h2 className="text-base font-bold text-gray-900">{UI.settings.consistencyTitle}</h2>
        <p className="text-xs text-gray-500">
          {UI.settings.consistencySubtitle}
        </p>
      </div>

      <button
        type="button"
        onClick={handleRunCheck}
        disabled={isRunning}
        className="w-full min-h-12 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-800 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors"
      >
        <span>🔍</span>
        <span>{isRunning ? UI.common.loading : UI.settings.checkConsistency}</span>
      </button>

      {result.tested && (
        <div className="pt-2 animate-in fade-in duration-200">
          {result.inconsistencies.length === 0 ? (
            <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-green-800 text-xs flex items-center gap-2">
              <span className="text-base">✅</span>
              <span>
                <strong>{UI.settings.consistencyOkStrong}</strong> {UI.settings.consistencyOkDesc}
              </span>
            </div>
          ) : (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-amber-800">
                <span>⚠️</span>
                <span>{UI.settings.consistencyIssuesFound(result.inconsistencies.length)}</span>
              </div>

              <div className="divide-y divide-amber-200/60">
                {result.inconsistencies.map(({ item, expected, actual }) => (
                  <div key={item.id} className="py-2 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{item.name}</p>
                      <p className="text-[11px] text-gray-600">
                        Esperado según historial: <strong>{expected}</strong> · Stock actual: <strong>{actual}</strong>
                      </p>
                    </div>

                    {onFixItem && (
                      <button
                        type="button"
                        onClick={() => onFixItem(item)}
                        className="px-3 py-2 min-h-[44px] min-w-[44px] bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-bold transition-colors"
                      >
                        {UI.settings.fixBtn}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={handleRepairAll}
                disabled={isRunning}
                className="w-full min-h-12 mt-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors disabled:opacity-50"
              >
                {UI.settings.repairConsistencyBtn}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
