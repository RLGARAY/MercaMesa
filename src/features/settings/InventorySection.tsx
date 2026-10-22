import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, META_KEY, setLowStockThreshold } from '@/db/db'
import type { Item, StockAdjustment, ID } from '@/types'
import { UI } from '@/i18n'
import { adjustStock, setStockAbsolute, getAdjustmentsByItem } from '@/services/itemService'
import { classifyStockLevel, DEFAULT_LOW_STOCK_THRESHOLD } from '@/domain/stats'
import { parseStrictIntegerString } from '@/domain/validation'
import Modal from '@/components/Modal'

export default function InventorySection() {
  const [showArchived, setShowArchived] = useState(false)
  const [selectedItemForAdjust, setSelectedItemForAdjust] = useState<Item | null>(null)
  const [selectedItemForHistory, setSelectedItemForHistory] = useState<Item | null>(null)
  const [historyList, setHistoryList] = useState<StockAdjustment[]>([])

  // Estado del formulario de ajuste (RF-C1)
  const [adjustMode, setAdjustMode] = useState<'absolute' | 'delta'>('absolute')
  const [targetStockStr, setTargetStockStr] = useState('')
  const [deltaStr, setDeltaStr] = useState('')
  const [reason, setReason] = useState<StockAdjustment['reason']>('correction')
  const [note, setNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Consultas reactivas
  const items = useLiveQuery(
    () => db.items.toArray(),
    [],
  )

  const categories = useLiveQuery(
    () => db.categories.toArray(),
    [],
  )

  const meta = useLiveQuery(
    () => db.meta.get(META_KEY),
    [],
  )
  const lowStockThreshold = meta?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD
  const [thresholdInput, setThresholdInput] = useState<string>(String(lowStockThreshold))
  const [thresholdError, setThresholdError] = useState<string | null>(null)
  const [thresholdSaved, setThresholdSaved] = useState(false)

  useEffect(() => {
    setThresholdInput(String(lowStockThreshold))
  }, [lowStockThreshold])

  const handleSaveThreshold = async (e: React.FormEvent) => {
    e.preventDefault()
    setThresholdError(null)
    setThresholdSaved(false)
    const parsed = parseStrictIntegerString(thresholdInput, { allowNegative: false })
    if (parsed === null || parsed < 1) {
      setThresholdError('Introduce un número entero mayor o igual a 1')
      return
    }
    try {
      await setLowStockThreshold(parsed)
      setThresholdSaved(true)
    } catch (err) {
      setThresholdError(err instanceof Error ? err.message : UI.errors.generic)
    }
  }

  const filteredItems = items?.filter(item => (showArchived ? true : !item.archived)) ?? []

  const getCategoryName = (catId: ID): string => {
    return categories?.find(c => c.id === catId)?.name ?? ''
  }

  // Abrir modal de ajuste
  const handleOpenAdjust = (item: Item) => {
    setSelectedItemForAdjust(item)
    setAdjustMode('absolute')
    setTargetStockStr(String(item.stock))
    setDeltaStr('1')
    setReason('correction')
    setNote('')
    setErrorMsg(null)
  }

  // Abrir modal de historial (RF-C2)
  const handleOpenHistory = async (item: Item) => {
    setSelectedItemForHistory(item)
    const list = await getAdjustmentsByItem(item.id)
    setHistoryList(list)
  }

  // Guardar ajuste de stock (RF-C1)
  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedItemForAdjust) return
    setErrorMsg(null)

    try {
      setIsSubmitting(true)
      if (adjustMode === 'absolute') {
        const target = parseStrictIntegerString(targetStockStr, { allowNegative: true })
        if (target === null) {
          throw new Error('Introduce un número entero para el stock real')
        }
        await setStockAbsolute(selectedItemForAdjust.id, target, reason, note.trim() || undefined)
      } else {
        const delta = parseStrictIntegerString(deltaStr, { allowNegative: true })
        if (delta === null || delta === 0) {
          throw new Error('Introduce una cantidad válida distinta de 0 para sumar o restar')
        }
        await adjustStock(selectedItemForAdjust.id, delta, reason, note.trim() || undefined)
      }

      setSelectedItemForAdjust(null)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : UI.errors.generic)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Calcular delta visual para el modo absoluto
  const parsedTargetPreview = parseStrictIntegerString(targetStockStr, { allowNegative: true })
  const previewDelta =
    selectedItemForAdjust && parsedTargetPreview !== null
      ? parsedTargetPreview - selectedItemForAdjust.stock
      : null
  const parsedDeltaPreview = parseStrictIntegerString(deltaStr, { allowNegative: true })

  return (
    <div className="space-y-4">
      {/* Controles superiores */}
      <div className="flex items-center justify-between pb-2 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{UI.settings.inventory}</h2>
          <p className="text-xs text-gray-500">Ajusta el recuento físico real o añade reposiciones</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="rounded border-gray-300 text-brand-600"
          />
          <span>Ver archivados</span>
        </label>
      </div>

      {/* Ajuste del umbral de stock bajo (RF-E7, C1) */}
      <form
        onSubmit={handleSaveThreshold}
        className="p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div>
          <label htmlFor="low-stock-threshold-input" className="text-xs font-bold text-gray-800 block">
            Umbral de aviso de poco stock (≤ unidades)
          </label>
          <p className="text-[11px] text-gray-500">
            Preferencia de este dispositivo (por defecto ≤ {DEFAULT_LOW_STOCK_THRESHOLD}). No se incluye en las copias de seguridad.
          </p>
          {thresholdError && (
            <p className="text-xs text-red-600 font-semibold mt-1" role="alert">
              {thresholdError}
            </p>
          )}
          {thresholdSaved && !thresholdError && (
            <p className="text-xs text-green-700 font-semibold mt-1" role="status">
              Umbral guardado ({lowStockThreshold} uds).
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            id="low-stock-threshold-input"
            type="number"
            inputMode="numeric"
            min={1}
            value={thresholdInput}
            onChange={(e) => {
              setThresholdInput(e.target.value)
              setThresholdSaved(false)
            }}
            className="w-20 px-2.5 py-2 border border-gray-300 rounded-xl text-sm font-bold text-center min-h-12"
          />
          <button
            type="submit"
            className="px-3.5 py-2 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-bold text-xs rounded-xl min-h-12 transition-colors"
          >
            {UI.common.save}
          </button>
        </div>
      </form>

      {/* Lista de artículos */}
      <div className="divide-y divide-gray-100 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {filteredItems.length === 0 ? (
          <p className="p-6 text-center text-gray-400 text-sm">{UI.common.empty}</p>
        ) : (
          filteredItems.map((item) => {
            const stockLevel = classifyStockLevel(item.stock, lowStockThreshold)

            return (
              <div
                key={item.id}
                className="p-3.5 flex items-center justify-between gap-3 hover:bg-gray-50/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-gray-900 text-sm truncate">
                      {item.name}
                    </span>
                    {item.archived && (
                      <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                        {UI.items.archived}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {getCategoryName(item.categoryId)}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-bold text-gray-800">
                      Stock: <span className="text-sm font-extrabold">{item.stock}</span>
                    </span>
                    {stockLevel === 'low' && (
                      <span className="text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded">
                        {item.stock === 1 ? `${UI.sale.lastUnit} (1)` : `Poco stock (${item.stock})`}
                      </span>
                    )}
                    {stockLevel === 'zero' && (
                      <span className="text-[10px] font-semibold bg-gray-200 text-gray-800 border border-gray-300 px-1.5 py-0.5 rounded">
                        {UI.sale.outOfStock} (0)
                      </span>
                    )}
                    {stockLevel === 'negative' && (
                      <span className="text-[10px] font-bold bg-red-100 text-red-800 border border-red-300 px-1.5 py-0.5 rounded">
                        Stock negativo ({item.stock})
                      </span>
                    )}
                  </div>
                </div>

                {/* Acciones para el artículo */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenHistory(item)}
                    aria-label={`Ver historial de ${item.name}`}
                    className="p-2 text-gray-500 hover:text-brand-600 active:bg-gray-100 rounded-lg text-xs font-semibold min-h-12 flex items-center gap-1"
                  >
                    <span>📜</span>
                    <span className="hidden sm:inline">Historial</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenAdjust(item)}
                    aria-label={`Ajustar stock de ${item.name}`}
                    className="px-3.5 py-2 bg-brand-50 hover:bg-brand-100 active:bg-brand-200 text-brand-700 font-bold text-xs rounded-xl min-h-12 flex items-center transition-colors"
                  >
                    {UI.settings.adjustStock}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* MODAL: AJUSTAR STOCK (RF-C1) */}
      <Modal
        title={selectedItemForAdjust ? `Ajustar stock: ${selectedItemForAdjust.name}` : ''}
        isOpen={Boolean(selectedItemForAdjust)}
        onClose={() => setSelectedItemForAdjust(null)}
      >
        {selectedItemForAdjust && (
          <form onSubmit={handleSaveAdjustment} className="space-y-4 text-left">
            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm" role="alert">
                {errorMsg}
              </div>
            )}

            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex justify-between items-center text-sm">
              <span className="text-gray-600">Stock registrado actualmente:</span>
              <span className="font-extrabold text-base text-gray-900">{selectedItemForAdjust.stock}</span>
            </div>

            {/* Selector de modo: Fijar valor exacto o Sumar/Restar */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">
                Método de ajuste
              </label>
              <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1 rounded-xl text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setAdjustMode('absolute')}
                  className={`py-2 rounded-lg text-center transition-colors ${
                    adjustMode === 'absolute'
                      ? 'bg-white text-brand-700 shadow-sm font-bold'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Fijar valor exacto
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustMode('delta')}
                  className={`py-2 rounded-lg text-center transition-colors ${
                    adjustMode === 'delta'
                      ? 'bg-white text-brand-700 shadow-sm font-bold'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Sumar / Restar
                </button>
              </div>
            </div>

            {/* Entrada según modo */}
            {adjustMode === 'absolute' ? (
              <div>
                <label htmlFor="adjust-absolute-stock" className="block text-sm font-medium text-gray-700 mb-1">
                  Nuevo stock físico real
                </label>
                <input
                  id="adjust-absolute-stock"
                  type="number"
                  inputMode="numeric"
                  value={targetStockStr}
                  onChange={(e) => setTargetStockStr(e.target.value)}
                  className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base font-bold"
                  required
                />
                {previewDelta !== null && (
                  <p className="mt-1 text-xs text-gray-500">
                    Cambio neto que se registrará:{' '}
                    <strong className={previewDelta >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {previewDelta > 0 ? `+${previewDelta}` : previewDelta}
                    </strong>
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label htmlFor="adjust-delta-stock" className="block text-sm font-medium text-gray-700 mb-1">
                  Cantidad a sumar o restar (usa signo − para restar)
                </label>
                <input
                  id="adjust-delta-stock"
                  type="number"
                  inputMode="numeric"
                  value={deltaStr}
                  onChange={(e) => setDeltaStr(e.target.value)}
                  placeholder="Ej: 5 o -2"
                  className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base font-bold"
                  required
                />
                {parsedDeltaPreview !== null && (
                  <p className="mt-1 text-xs text-gray-500">
                    El nuevo stock quedará en:{' '}
                    <strong>{selectedItemForAdjust.stock + parsedDeltaPreview}</strong>
                  </p>
                )}
              </div>
            )}

            {/* Motivo (obligatorio) */}
            <div>
              <label htmlFor="adjust-reason" className="block text-sm font-medium text-gray-700 mb-1">
                Motivo del ajuste
              </label>
              <select
                id="adjust-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as StockAdjustment['reason'])}
                className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm bg-white"
                required
              >
                <option value="correction">{UI.settings.adjustReason.correction}</option>
                <option value="restock">{UI.settings.adjustReason.restock}</option>
                <option value="loss">{UI.settings.adjustReason.loss}</option>
                <option value="other">{UI.settings.adjustReason.other}</option>
              </select>
            </div>

            {/* Nota opcional */}
            <div>
              <label htmlFor="adjust-note" className="block text-sm font-medium text-gray-700 mb-1">
                Nota u observación (opcional)
              </label>
              <input
                id="adjust-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej: Recuento al montar la mesa"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            {/* Botones de acción */}
            <div className="pt-2 flex flex-col gap-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-12 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-bold rounded-xl shadow transition-colors"
              >
                {isSubmitting ? UI.common.loading : UI.common.confirm}
              </button>
              <button
                type="button"
                onClick={() => setSelectedItemForAdjust(null)}
                className="w-full min-h-12 text-gray-600 hover:text-gray-800 font-medium"
              >
                {UI.common.cancel}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL: HISTORIAL DE AJUSTES (RF-C2) */}
      <Modal
        title={selectedItemForHistory ? `Historial: ${selectedItemForHistory.name}` : ''}
        isOpen={Boolean(selectedItemForHistory)}
        onClose={() => setSelectedItemForHistory(null)}
      >
        <div className="space-y-3">
          {historyList.length === 0 ? (
            <p className="text-center py-6 text-gray-400 text-sm">No hay movimientos de stock registrados.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {historyList.map((adj) => {
                const date = new Date(adj.createdAt)
                const formattedDate = date.toLocaleDateString('es-ES', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })

                return (
                  <div key={adj.id} className="py-2.5 flex items-start justify-between gap-3 text-left">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-gray-900">
                          {adj.reason === 'initial'
                            ? 'Stock inicial'
                            : UI.settings.adjustReason[adj.reason] ?? adj.reason}
                        </span>
                        <span className="text-[11px] text-gray-400">{formattedDate}</span>
                      </div>
                      {adj.note && (
                        <p className="text-xs text-gray-500 italic mt-0.5">«{adj.note}»</p>
                      )}
                    </div>

                    <span
                      className={`text-sm font-extrabold ${
                        adj.delta > 0
                          ? 'text-green-600'
                          : adj.delta < 0
                          ? 'text-red-600'
                          : 'text-gray-400'
                      }`}
                    >
                      {adj.delta > 0 ? `+${adj.delta}` : adj.delta}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          <button
            type="button"
            onClick={() => setSelectedItemForHistory(null)}
            className="w-full min-h-12 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-xl mt-4"
          >
            {UI.common.close}
          </button>
        </div>
      </Modal>
    </div>
  )
}
