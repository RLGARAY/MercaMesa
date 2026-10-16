import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import type { Sale } from '@/types'
import { UI } from '@/i18n'
import { formatCents } from '@/domain/money'
import { voidSale } from '@/services/saleService'
import Modal from '@/components/Modal'

export default function SalesHistorySection() {
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'voided'>('all')
  const [dateFilter, setDateFilter] = useState<string>('')
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [showVoidConfirm, setShowVoidConfirm] = useState(false)
  const [isVoiding, setIsVoiding] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)

  // Consulta reactiva de ventas
  const allSales = useLiveQuery(
    () => db.sales.orderBy('createdAt').reverse().toArray(),
    [],
  )

  // Aplicar filtros
  const filteredSales = (allSales ?? []).filter((sale) => {
    if (statusFilter !== 'all' && sale.status !== statusFilter) {
      return false
    }
    if (dateFilter && !sale.createdAt.startsWith(dateFilter)) {
      return false
    }
    return true
  })

  // Anular venta (RN-6)
  const handleVoidSale = async () => {
    if (!selectedSale) return
    setVoidError(null)

    try {
      setIsVoiding(true)
      await voidSale(selectedSale.id)
      setShowVoidConfirm(false)
      // Actualizar venta seleccionada en la vista de detalle
      const updated = await db.sales.get(selectedSale.id)
      if (updated) setSelectedSale(updated)
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : UI.errors.generic)
    } finally {
      setIsVoiding(false)
    }
  }

  const formatDateTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="space-y-4">
      {/* Cabecera y Filtros (RF-C3) */}
      <div className="space-y-3 pb-2 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{UI.settings.salesHistory}</h2>
          <p className="text-xs text-gray-500">Historial completo de cobros y opción de anulación</p>
        </div>

        {/* Filtros: Estado y Fecha */}
        <div className="flex flex-col sm:flex-row gap-2">
          {/* Selector de estado */}
          <div className="flex bg-gray-100 p-1 rounded-xl text-xs font-semibold flex-1">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`flex-1 py-1.5 rounded-lg text-center transition-colors ${
                statusFilter === 'all'
                  ? 'bg-white text-gray-900 shadow-sm font-bold'
                  : 'text-gray-600'
              }`}
            >
              Todas ({allSales?.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`flex-1 py-1.5 rounded-lg text-center transition-colors ${
                statusFilter === 'active'
                  ? 'bg-white text-green-700 shadow-sm font-bold'
                  : 'text-gray-600'
              }`}
            >
              Activas
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('voided')}
              className={`flex-1 py-1.5 rounded-lg text-center transition-colors ${
                statusFilter === 'voided'
                  ? 'bg-white text-red-700 shadow-sm font-bold'
                  : 'text-gray-600'
              }`}
            >
              Anuladas
            </button>
          </div>

          {/* Filtro de fecha */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Filtrar por fecha"
              className="px-2.5 py-1.5 text-xs bg-white border border-gray-300 rounded-lg min-h-10"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="text-xs text-brand-600 hover:text-brand-700 font-semibold px-2 py-1"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Lista de ventas */}
      <div className="divide-y divide-gray-100 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {filteredSales.length === 0 ? (
          <p className="p-8 text-center text-gray-400 text-sm">No hay ventas registradas para este filtro.</p>
        ) : (
          filteredSales.map((sale) => {
            const isVoided = sale.status === 'voided'
            const totalUnits = sale.lines.reduce((s, l) => s + l.quantity, 0)

            return (
              <button
                key={sale.id}
                type="button"
                onClick={() => {
                  setSelectedSale(sale)
                  setShowVoidConfirm(false)
                  setVoidError(null)
                }}
                className="w-full p-3.5 flex items-center justify-between text-left hover:bg-gray-50/60 active:bg-gray-100 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-700">
                      {formatDateTime(sale.createdAt)}
                    </span>
                    {isVoided ? (
                      <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                        Anulada
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                        Cobrada
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {totalUnits} artículo(s)
                    {sale.discountCents > 0 && ` · Oferta -${formatCents(sale.discountCents)}`}
                  </p>
                </div>

                <div className="text-right">
                  <span
                    className={`text-base font-black ${
                      isVoided ? 'line-through text-gray-400' : 'text-brand-700'
                    }`}
                  >
                    {formatCents(sale.totalCents)}
                  </span>
                  <span className="text-gray-400 text-xs block">Ver detalle →</span>
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* MODAL: DETALLE Y ANULACIÓN DE VENTA (RF-C3, RN-6) */}
      <Modal
        title={selectedSale ? `Detalle de venta` : ''}
        isOpen={Boolean(selectedSale)}
        onClose={() => {
          setSelectedSale(null)
          setShowVoidConfirm(false)
        }}
      >
        {selectedSale && (
          <div className="space-y-4 text-left">
            {voidError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm" role="alert">
                {voidError}
              </div>
            )}

            {/* Cabecera del detalle */}
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Fecha y hora</span>
                <span className="text-xs font-semibold text-gray-800">
                  {formatDateTime(selectedSale.createdAt)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Estado</span>
                {selectedSale.status === 'voided' ? (
                  <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">
                    Anulada {selectedSale.voidedAt && `el ${formatDateTime(selectedSale.voidedAt)}`}
                  </span>
                ) : (
                  <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded">
                    Activa
                  </span>
                )}
              </div>
            </div>

            {/* Desglose de líneas (Snapshots inmutables, RN-7) */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Artículos vendidos
              </h3>
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden bg-white">
                {selectedSale.lines.map((line, idx) => (
                  <div key={idx} className="p-3 flex items-center justify-between text-xs">
                    <div className="min-w-0 flex-1 pr-2">
                      <span className="font-semibold text-gray-900 block truncate">
                        {line.nameSnapshot}
                      </span>
                      <span className="text-gray-400">
                        {line.quantity} × {formatCents(line.unitPriceCents)}
                        {line.lineDiscountCents > 0 && ` (dto: -${formatCents(line.lineDiscountCents)})`}
                      </span>
                    </div>
                    <span className="font-bold text-gray-900 text-sm">
                      {formatCents(line.lineNetCents)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Resumen financiero */}
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-1.5 text-xs">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal lista</span>
                <span>{formatCents(selectedSale.subtotalCents)}</span>
              </div>
              {selectedSale.discountCents > 0 && (
                <div className="flex justify-between text-green-700 font-semibold">
                  <span>Descuento ticket</span>
                  <span>-{formatCents(selectedSale.discountCents)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-extrabold text-gray-900 pt-1 border-t border-gray-200">
                <span>Total cobrado</span>
                <span className={selectedSale.status === 'voided' ? 'line-through text-gray-400' : 'text-brand-700'}>
                  {formatCents(selectedSale.totalCents)}
                </span>
              </div>
            </div>

            {/* Botón y confirmación para Anular (RN-6) */}
            {selectedSale.status === 'active' && (
              <div className="pt-2">
                {showVoidConfirm ? (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl space-y-2">
                    <p className="text-xs font-semibold text-red-800">
                      {UI.settings.voidSaleConfirm}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleVoidSale}
                        disabled={isVoiding}
                        className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold rounded-lg text-xs min-h-12"
                      >
                        {isVoiding ? UI.common.loading : 'Sí, anular venta'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowVoidConfirm(false)}
                        className="flex-1 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-lg text-xs min-h-12"
                      >
                        {UI.common.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowVoidConfirm(true)}
                    className="w-full min-h-12 border border-red-300 bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-700 font-bold rounded-xl text-xs transition-colors"
                  >
                    {UI.settings.voidSale}
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setSelectedSale(null)}
              className="w-full min-h-12 text-gray-500 hover:text-gray-800 text-xs font-medium"
            >
              {UI.common.close}
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
