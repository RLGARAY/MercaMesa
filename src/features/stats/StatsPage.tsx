import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, META_KEY } from '@/db/db'
import type { Sale } from '@/types'
import { UI } from '@/i18n'
import { formatCents, centsToEuros } from '@/domain/money'
import {
  filterSalesByPeriod,
  calculateSummaryMetrics,
  calculateTopItems,
  calculateCategoryMetrics,
  getRelevantHourlySales,
  findItemsWithoutSales,
  findCriticalStockItems,
  classifyStockLevel,
  DEFAULT_LOW_STOCK_THRESHOLD,
  type PeriodType,
} from '@/domain/stats'
import { voidSale } from '@/services/saleService'
import Modal from '@/components/Modal'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

export default function StatsPage() {
  const [periodType, setPeriodType] = useState<PeriodType>('today')
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd, setCustomEnd] = useState<string>('')
  const [showAllTopItems, setShowAllTopItems] = useState(false)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [isVoiding, setIsVoiding] = useState(false)
  const [showVoidConfirm, setShowVoidConfirm] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)

  // Consultas reactivas desde IndexedDB
  const allSales = useLiveQuery(() => db.sales.toArray(), [])
  const allItems = useLiveQuery(() => db.items.toArray(), [])
  const allCategories = useLiveQuery(() => db.categories.toArray(), [])
  const meta = useLiveQuery(() => db.meta.get(META_KEY), [])
  const lowStockThreshold = meta?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD

  // 1. Filtrar ventas por el periodo seleccionado (RF-E1, RF-E8)
  const filteredSales = useMemo(() => {
    if (!allSales) return []
    return filterSalesByPeriod(allSales, {
      type: periodType,
      customStart: customStart || undefined,
      customEnd: customEnd || undefined,
    })
  }, [allSales, periodType, customStart, customEnd])

  // 2. Tarjetas resumen (RF-E2)
  const summary = useMemo(() => {
    return calculateSummaryMetrics(filteredSales)
  }, [filteredSales])

  // 3. Ranking más vendidos (RF-E3)
  const topItems = useMemo(() => {
    return calculateTopItems(filteredSales)
  }, [filteredSales])

  const displayedTopItems = showAllTopItems ? topItems : topItems.slice(0, 10)

  // 4. Métricas por categoría (RF-E4)
  const categoryMetrics = useMemo(() => {
    return calculateCategoryMetrics(filteredSales, allCategories ?? [])
  }, [filteredSales, allCategories])

  const categoryChartData = useMemo(() => {
    return categoryMetrics
      .filter(c => c.totalNetCents > 0)
      .map(c => ({
        name: c.categoryName,
        euros: Number(centsToEuros(c.totalNetCents).toFixed(2)),
        units: c.unitsSold,
      }))
  }, [categoryMetrics])

  // 5. Ventas por hora (RF-E5, B2)
  const hourlyData = useMemo(() => {
    const relevantHours = getRelevantHourlySales(filteredSales)
    return relevantHours.map(h => ({
      hour: h.hourLabel,
      euros: Number(centsToEuros(h.totalCents).toFixed(2)),
      sales: h.salesCount,
    }))
  }, [filteredSales])

  // 6. Artículos sin ventas y alertas de stock (RF-E7, C1)
  const itemsWithoutSales = useMemo(() => {
    if (!allItems) return []
    return findItemsWithoutSales(allItems, filteredSales)
  }, [allItems, filteredSales])

  const criticalStockItems = useMemo(() => {
    if (!allItems) return []
    return findCriticalStockItems(allItems, lowStockThreshold)
  }, [allItems, lowStockThreshold])

  // Ventas recientes del periodo (RF-E6)
  const recentSales = useMemo(() => {
    return [...filteredSales]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5)
  }, [filteredSales])

  // Anulación desde el modal de detalle (RF-E6, RN-6)
  const handleVoidSale = async () => {
    if (!selectedSale) return
    try {
      setIsVoiding(true)
      setVoidError(null)
      await voidSale(selectedSale.id)
      setSelectedSale(null)
      setShowVoidConfirm(false)
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

  const COLORS = ['#ea580c', '#f97316', '#fb923c', '#fdba74', '#fed7aa']

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto text-left">
      {/* Cabecera y Selector de periodo (RF-E1) */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 pt-3 pb-2 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900 mb-2">{UI.stats.title}</h1>

        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none" role="tablist" aria-label={UI.stats.selectPeriodAria}>
          {(
            [
              { id: 'today',  label: UI.stats.today },
              { id: 'last7',  label: UI.stats.last7 },
              { id: 'all',    label: UI.stats.all },
              { id: 'custom', label: UI.stats.custom },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={periodType === id}
              onClick={() => setPeriodType(id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors min-h-10 ${
                periodType === id
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Inputs de fecha si se elige rango personalizado */}
        {periodType === 'custom' && (
          <div className="flex items-center gap-2 pt-2 text-xs">
            <div className="flex-1">
              <label htmlFor="custom-start-date" className="block text-[10px] text-gray-500 font-medium">{UI.stats.fromDate}</label>
              <input
                id="custom-start-date"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full px-2 py-1 bg-white border border-gray-300 rounded-lg text-xs"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="custom-end-date" className="block text-[10px] text-gray-500 font-medium">{UI.stats.toDate}</label>
              <input
                id="custom-end-date"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full px-2 py-1 bg-white border border-gray-300 rounded-lg text-xs"
              />
            </div>
          </div>
        )}
      </header>

      {/* Contenido principal */}
      <div className="flex-1 p-4 pb-24 space-y-6 max-w-2xl mx-auto w-full">
        {/* TARJETAS RESUMEN (RF-E2) */}
        <section aria-label={UI.stats.summaryCardsAria}>
          <div className="grid grid-cols-2 gap-3">
            {/* Dinero cobrado */}
            <div className="col-span-2 p-4 bg-gradient-to-br from-brand-600 to-brand-700 rounded-2xl shadow text-white flex items-center justify-between">
              <div>
                <span className="text-xs uppercase tracking-wider font-semibold opacity-90 block">
                  {UI.stats.revenue}
                </span>
                <span className="text-3xl font-black mt-0.5 block">
                  {formatCents(summary.totalRevenueCents)}
                </span>
                <span className="text-xs opacity-80 mt-1 block">
                  {UI.stats.salesCountLabel(summary.salesCount)}
                </span>
              </div>
              <span className="text-4xl opacity-80" aria-hidden="true">💰</span>
            </div>

            {/* Ticket medio */}
            <div className="p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-500 font-medium block">{UI.stats.avgTicket}</span>
                <span className="text-xl font-extrabold text-gray-900 mt-0.5 block">
                  {formatCents(summary.avgTicketCents)}
                </span>
              </div>
              <span className="text-2xl" aria-hidden="true">🏷️</span>
            </div>

            {/* Unidades vendidas */}
            <div className="p-3.5 bg-white rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-500 font-medium block">{UI.stats.units}</span>
                <span className="text-xl font-extrabold text-gray-900 mt-0.5 block">
                  {summary.unitsSold}
                </span>
              </div>
              <span className="text-2xl" aria-hidden="true">📦</span>
            </div>

            {/* Descuentos concedidos */}
            <div className="col-span-2 p-3 bg-white rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl" aria-hidden="true">🎁</span>
                <div>
                  <span className="text-xs text-gray-500 font-medium block">{UI.stats.totalDiscount}</span>
                  <span className="text-sm font-bold text-gray-800">
                    {formatCents(summary.totalDiscountCents)}
                  </span>
                </div>
              </div>
              <span className="text-xs text-gray-400">{UI.stats.totalInOffers}</span>
            </div>
          </div>
        </section>

        {/* ARTÍCULOS MÁS VENDIDOS (RF-E3) */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
          <div className="flex justify-between items-center border-b border-gray-100 pb-2">
            <div>
              <h2 className="text-base font-bold text-gray-900">{UI.stats.topItems}</h2>
              <p className="text-xs text-gray-500">{UI.stats.topItemsSubtitle}</p>
            </div>
          </div>

          {topItems.length === 0 ? (
            <p className="text-center py-6 text-gray-400 text-xs">{UI.stats.noSales}</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {displayedTopItems.map((item, idx) => (
                <div key={item.itemId} className="py-2.5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                    <span className="w-5 text-center font-bold text-gray-400 text-xs">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}º`}
                    </span>
                    <span className="font-semibold text-gray-900 truncate">
                      {item.name}
                    </span>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="font-bold text-gray-900 text-sm block">
                      {item.unitsSold} ud{item.unitsSold > 1 ? 's' : ''}
                    </span>
                    <span className="text-[11px] text-gray-400 font-medium">
                      {formatCents(item.totalNetCents)}
                    </span>
                  </div>
                </div>
              ))}

              {topItems.length > 10 && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => setShowAllTopItems(!showAllTopItems)}
                    className="text-xs font-bold text-brand-600 hover:text-brand-700 py-1"
                  >
                    {showAllTopItems ? UI.stats.viewTop10 : UI.stats.viewAllTop(topItems.length)}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* INGRESOS Y UNIDADES POR CATEGORÍA (RF-E4) */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
          <div className="border-b border-gray-100 pb-2">
            <h2 className="text-base font-bold text-gray-900">{UI.stats.byCategory}</h2>
            <p className="text-xs text-gray-500">{UI.stats.byCategorySubtitle}</p>
          </div>

          {categoryChartData.length === 0 ? (
            <p className="text-center py-6 text-gray-400 text-xs">{UI.stats.noSales}</p>
          ) : (
            <>
              {/* Gráfica de barras Recharts */}
              <div className="w-full h-48 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(val) => [`${Number(val ?? 0)} €`, UI.stats.revenue]}
                    />
                    <Bar dataKey="euros" radius={[6, 6, 0, 0]}>
                      {categoryChartData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Tabla detallada por categoría */}
              <div className="divide-y divide-gray-100 pt-2">
                {categoryMetrics.map((cat) => (
                  <div key={cat.categoryId} className="py-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-800">{cat.categoryName}</span>
                    <div className="text-right">
                      <span className="font-bold text-gray-900">{formatCents(cat.totalNetCents)}</span>
                      <span className="text-gray-400 ml-2">({cat.unitsSold} uds · {cat.percentageOfRevenue}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* VENTAS POR HORA (RF-E5) */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
          <div className="border-b border-gray-100 pb-2">
            <h2 className="text-base font-bold text-gray-900">{UI.stats.byHour}</h2>
            <p className="text-xs text-gray-500">{UI.stats.byHourSubtitle}</p>
          </div>

          {summary.salesCount === 0 ? (
            <p className="text-center py-6 text-gray-400 text-xs">{UI.stats.noSales}</p>
          ) : (
            <div className="w-full h-44 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(val, name) => [
                      name === 'euros' ? `${Number(val ?? 0)} €` : Number(val ?? 0),
                      name === 'euros' ? UI.stats.revenue : UI.stats.sales,
                    ]}
                  />
                  <Bar dataKey="sales" name={UI.stats.sales} fill="#ea580c" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* VENTAS RECIENTES (RF-E6) */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
          <div className="border-b border-gray-100 pb-2">
            <h2 className="text-base font-bold text-gray-900">{UI.stats.recentSales}</h2>
            <p className="text-xs text-gray-500">{UI.stats.recentSalesSubtitle}</p>
          </div>

          {recentSales.length === 0 ? (
            <p className="text-center py-6 text-gray-400 text-xs">{UI.stats.noSales}</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentSales.map((sale) => (
                <button
                  key={sale.id}
                  type="button"
                  onClick={() => {
                    setSelectedSale(sale)
                    setShowVoidConfirm(false)
                    setVoidError(null)
                  }}
                  className="w-full py-2.5 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <span className="text-xs font-semibold text-gray-800">
                      {formatDateTime(sale.createdAt)}
                    </span>
                    <span className="text-[11px] text-gray-400 block">
                      {sale.lines.reduce((s, l) => s + l.quantity, 0)} artículos
                    </span>
                  </div>
                  <span className="text-sm font-bold text-brand-700">
                    {formatCents(sale.totalCents)} →
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ALERTAS: ARTÍCULOS SIN VENTAS Y STOCK CRÍTICO (RF-E7, Decisión 5) */}
        <section className="space-y-4">
          {/* Stock crítico (RF-E7, C1) */}
          {criticalStockItems.length > 0 && (
            <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-amber-900 text-sm">
                <span>⚠️</span>
                <span>{UI.stats.criticalStockTitle(lowStockThreshold, criticalStockItems.length)}</span>
              </div>
              <div className="divide-y divide-amber-200/50 text-xs">
                {criticalStockItems.map((item) => {
                  const level = classifyStockLevel(item.stock, lowStockThreshold)
                  const badgeClass =
                    level === 'low'
                      ? 'bg-amber-200 text-amber-900 border border-amber-300'
                      : level === 'zero'
                      ? 'bg-gray-200 text-gray-800 border border-gray-300'
                      : 'bg-red-100 text-red-800 border border-red-300'
                  const badgeText =
                    level === 'low'
                      ? item.stock === 1
                        ? `${UI.sale.lastUnit} (1)`
                        : UI.sale.lowStockBadge(item.stock)
                      : level === 'zero'
                      ? `${UI.sale.outOfStock} (0)`
                      : UI.sale.negativeStockBadge(item.stock)

                  return (
                    <div key={item.id} className="py-2 flex items-center justify-between">
                      <span className="font-semibold text-gray-900">{item.name}</span>
                      <span className={`font-bold px-2 py-0.5 rounded text-[11px] ${badgeClass}`}>
                        {badgeText}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Sin ventas en el periodo */}
          {itemsWithoutSales.length > 0 && (
            <div className="p-4 bg-white border border-gray-200 rounded-2xl shadow-sm space-y-2">
              <h3 className="font-bold text-gray-800 text-sm">
                {UI.stats.withoutSalesTitle(itemsWithoutSales.length)}
              </h3>
              <div className="divide-y divide-gray-100 text-xs max-h-48 overflow-y-auto">
                {itemsWithoutSales.map((item) => (
                  <div key={item.id} className="py-2 flex items-center justify-between">
                    <span className="text-gray-700">{item.name}</span>
                    <span className="text-gray-400">{UI.sale.stockLabel(item.stock)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* MODAL DETALLE DE VENTA RECIENTE (RF-E6) */}
      <Modal
        title={selectedSale ? UI.stats.saleDetailTitle : ''}
        isOpen={Boolean(selectedSale)}
        onClose={() => {
          setSelectedSale(null)
          setVoidError(null)
        }}
      >
        {selectedSale && (
          <div className="space-y-4 text-left">
            {voidError && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-medium"
              >
                {voidError}
              </div>
            )}
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">{UI.stats.dateTimeLabel}</span>
                <span className="font-semibold">{formatDateTime(selectedSale.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{UI.stats.totalChargedLabel}</span>
                <span className="font-black text-brand-700 text-sm">{formatCents(selectedSale.totalCents)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-gray-700">{UI.stats.itemsTitle}</h4>
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl bg-white text-xs">
                {selectedSale.lines.map((l, i) => (
                  <div key={i} className="p-2.5 flex justify-between">
                    <span>{l.quantity} × {l.nameSnapshot}</span>
                    <span className="font-bold">{formatCents(l.lineNetCents)}</span>
                  </div>
                ))}
              </div>
            </div>

            {selectedSale.status === 'active' && (
              <div>
                {showVoidConfirm ? (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-2">
                    <p className="text-xs text-red-800 font-semibold">{UI.settings.voidSaleConfirm}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleVoidSale}
                        disabled={isVoiding}
                        className="flex-1 py-2 bg-red-600 text-white rounded-lg text-xs font-bold min-h-10"
                      >
                        {isVoiding ? UI.common.loading : UI.stats.confirmVoidYes}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowVoidConfirm(false)}
                        className="flex-1 py-2 bg-gray-200 text-gray-800 rounded-lg text-xs font-semibold min-h-10"
                      >
                        {UI.common.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowVoidConfirm(true)}
                    className="w-full min-h-12 border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 rounded-xl text-xs font-bold"
                  >
                    {UI.settings.voidSale}
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setSelectedSale(null)}
              className="w-full min-h-12 bg-gray-100 text-gray-700 rounded-xl text-xs font-semibold"
            >
              {UI.common.close}
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
