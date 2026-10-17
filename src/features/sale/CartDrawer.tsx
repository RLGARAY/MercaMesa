import { useState, useMemo } from 'react'
import type { Item, Sale } from '@/types'
import { UI } from '@/i18n'
import { formatCents, parseCentsFromString, centsToEuros } from '@/domain/money'
import {
  calculateDiscountCents,
  type DiscountMode,
  type RawDiscountInput,
} from '@/domain/discount'
import { checkoutSale } from '@/services/saleService'

interface CartLine {
  item: Item
  quantity: number
}

interface CartDrawerProps {
  lines: CartLine[]
  onClose?: () => void
  onAddToCart: (itemId: string) => void
  onRemoveFromCart: (itemId: string) => void
  onClearCart: () => void
  onCheckoutSuccess: (sale: Sale) => void
}

export default function CartDrawer({
  lines,
  onClose,
  onAddToCart,
  onRemoveFromCart,
  onClearCart,
  onCheckoutSuccess,
}: CartDrawerProps) {
  // Estado del descuento (RN-4, RF-V5)
  const [discountEnabled, setDiscountEnabled] = useState(false)
  const [discountMode, setDiscountMode] = useState<DiscountMode>('finalPrice')
  const [discountValueStr, setDiscountValueStr] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Subtotal en céntimos
  const subtotalCents = useMemo(() => {
    return lines.reduce((sum, l) => sum + l.item.priceCents * l.quantity, 0)
  }, [lines])

  // Cálculo en vivo del descuento y validación (RN-4)
  const discountCalc = useMemo((): {
    discountCents: number
    totalCents: number
    error: string | null
    rawInput: RawDiscountInput
  } => {
    const rawInput: RawDiscountInput = {
      enabled: discountEnabled,
      mode: discountMode,
      value: 0,
    }

    if (!discountEnabled || subtotalCents <= 0) {
      return {
        discountCents: 0,
        totalCents: subtotalCents,
        error: null,
        rawInput,
      }
    }

    const trimmed = discountValueStr.trim()
    if (!trimmed) {
      return {
        discountCents: 0,
        totalCents: subtotalCents,
        error: 'Introduce un valor para el descuento',
        rawInput,
      }
    }

    try {
      if (discountMode === 'finalPrice') {
        const cents = parseCentsFromString(trimmed)
        if (cents === null) throw new Error('Introduce un precio final válido (ej: 5 o 4,50)')
        rawInput.value = cents
      } else if (discountMode === 'euros') {
        const cents = parseCentsFromString(trimmed)
        if (cents === null) throw new Error('Introduce un descuento válido en € (ej: 2 o 1,50)')
        rawInput.value = cents
      } else if (discountMode === 'percent') {
        const pct = parseFloat(trimmed.replace(',', '.'))
        if (isNaN(pct)) throw new Error('Introduce un porcentaje válido (ej: 10 o 25)')
        rawInput.value = pct
      }

      const discountCents = calculateDiscountCents(subtotalCents, rawInput)
      const totalCents = subtotalCents - discountCents

      return {
        discountCents,
        totalCents,
        error: null,
        rawInput,
      }
    } catch (err) {
      return {
        discountCents: 0,
        totalCents: subtotalCents,
        error: err instanceof Error ? err.message : 'Descuento no válido',
        rawInput,
      }
    }
  }, [discountEnabled, discountMode, discountValueStr, subtotalCents])

  // Al activar el check de oferta por primera vez, sugerimos el subtotal en modo finalPrice
  const handleToggleDiscount = (enabled: boolean) => {
    setDiscountEnabled(enabled)
    if (enabled && !discountValueStr) {
      if (discountMode === 'finalPrice') {
        setDiscountValueStr(String(centsToEuros(subtotalCents)))
      }
    }
  }

  // Cambiar modo de descuento
  const handleSelectMode = (mode: DiscountMode) => {
    setDiscountMode(mode)
    setDiscountValueStr('')
  }

  // Cobrar (RN-2)
  const handleCheckout = async () => {
    setSubmitError(null)
    if (lines.length === 0) return
    if (discountCalc.error) {
      setSubmitError(discountCalc.error)
      return
    }

    try {
      setIsSubmitting(true)
      const sale = await checkoutSale({
        items: lines,
        discount: discountCalc.rawInput,
      })
      onCheckoutSuccess(sale)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : UI.errors.generic)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full text-left">
      {submitError && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm" role="alert">
          {submitError}
        </div>
      )}

      {/* Lista de líneas del carrito */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100 max-h-[40vh] pr-1">
        {lines.length === 0 ? (
          <p className="text-center py-8 text-gray-400 text-sm">{UI.sale.cartEmpty}</p>
        ) : (
          lines.map(({ item, quantity }) => {
            const lineTotal = item.priceCents * quantity
            const exceedsStock = quantity > item.stock

            return (
              <div key={item.id} className="py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-gray-800 text-sm truncate">
                      {item.name}
                    </span>
                    {exceedsStock && (
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                        {UI.sale.stockWarning}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">
                    {formatCents(item.priceCents)} c/u
                  </span>
                </div>

                {/* Selector − / + de cantidad */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onRemoveFromCart(item.id)}
                    aria-label={`${UI.common.remove} 1 ${item.name}`}
                    className="w-12 h-12 min-w-[48px] min-h-[48px] flex items-center justify-center bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-800 rounded-xl font-bold text-xl transition-colors"
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-bold text-sm text-gray-900">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAddToCart(item.id)}
                    aria-label={`${UI.common.add} 1 ${item.name}`}
                    className="w-12 h-12 min-w-[48px] min-h-[48px] flex items-center justify-center bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-800 rounded-xl font-bold text-xl transition-colors"
                  >
                    +
                  </button>
                </div>

                <div className="w-16 text-right font-bold text-sm text-gray-900">
                  {formatCents(lineTotal)}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Bloque de Descuento (RF-V5, RN-4) */}
      <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={discountEnabled}
            onChange={(e) => handleToggleDiscount(e.target.checked)}
            className="w-5 h-5 text-brand-600 rounded border-gray-300 focus:ring-brand-500"
          />
          <span className="text-sm font-semibold text-gray-800">
            {UI.sale.discount}
          </span>
        </label>

        {discountEnabled && (
          <div className="p-3 bg-brand-50/60 rounded-xl border border-brand-100 space-y-2.5">
            {/* Selector de 3 modos (RF-V5) */}
            <div className="grid grid-cols-3 gap-1 bg-white p-1 rounded-lg border border-gray-200 text-xs font-semibold">
              <button
                type="button"
                onClick={() => handleSelectMode('finalPrice')}
                className={`py-1.5 rounded text-center transition-colors ${
                  discountMode === 'finalPrice'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {UI.sale.discountMode.finalPrice}
              </button>
              <button
                type="button"
                onClick={() => handleSelectMode('euros')}
                className={`py-1.5 rounded text-center transition-colors ${
                  discountMode === 'euros'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {UI.sale.discountMode.euros}
              </button>
              <button
                type="button"
                onClick={() => handleSelectMode('percent')}
                className={`py-1.5 rounded text-center transition-colors ${
                  discountMode === 'percent'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {UI.sale.discountMode.percent}
              </button>
            </div>

            {/* Input de descuento (Decisión 3: número libre sin step) */}
            <div>
              <input
                type="text"
                inputMode="decimal"
                value={discountValueStr}
                onChange={(e) => setDiscountValueStr(e.target.value)}
                placeholder={
                  discountMode === 'finalPrice'
                    ? `Ej: ${centsToEuros(subtotalCents)}`
                    : discountMode === 'euros'
                    ? 'Ej: 1,50'
                    : 'Ej: 10'
                }
                className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                autoFocus
              />
              {discountCalc.error && (
                <p className="mt-1 text-xs text-red-600 font-medium">
                  {discountCalc.error}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Resumen de totales */}
      <div className="mt-3 pt-3 border-t border-gray-200 space-y-1.5">
        <div className="flex justify-between text-sm text-gray-500">
          <span>{UI.sale.subtotal}</span>
          <span>{formatCents(subtotalCents)}</span>
        </div>

        {discountEnabled && discountCalc.discountCents > 0 && (
          <div className="flex justify-between text-sm text-green-700 font-medium">
            <span>Descuento aplicado</span>
            <span>-{formatCents(discountCalc.discountCents)}</span>
          </div>
        )}

        <div className="flex justify-between items-baseline pt-1">
          <span className="text-base font-bold text-gray-900">{UI.sale.total}</span>
          <span className="text-2xl font-black text-brand-700">
            {formatCents(discountCalc.totalCents)}
          </span>
        </div>
      </div>

      {/* Acciones principales: Cobrar y Vaciar */}
      <div className="mt-4 pt-2 flex flex-col gap-2">
        <button
          type="button"
          onClick={handleCheckout}
          disabled={isSubmitting || lines.length === 0 || Boolean(discountCalc.error)}
          className="w-full min-h-14 flex items-center justify-center px-4 py-3 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 text-white font-bold text-lg rounded-xl shadow-md transition-colors"
        >
          {isSubmitting
            ? UI.common.loading
            : `${UI.sale.checkOut} ${formatCents(discountCalc.totalCents)}`}
        </button>

        {showClearConfirm ? (
          <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-xl">
            <span className="text-xs text-red-700 flex-1 font-medium">
              {UI.sale.clearCartConfirm}
            </span>
            <button
              type="button"
              onClick={() => {
                onClearCart()
                setShowClearConfirm(false)
                onClose?.()
              }}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold active:bg-red-700 min-h-8"
            >
              {UI.common.yes}
            </button>
            <button
              type="button"
              onClick={() => setShowClearConfirm(false)}
              className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold active:bg-gray-300 min-h-8"
            >
              {UI.common.no}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="text-xs text-red-600 hover:text-red-700 font-semibold p-2 min-h-[44px]"
            >
              {UI.sale.clearCart}
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-gray-500 hover:text-gray-700 font-medium p-2 min-h-[44px]"
              >
                {UI.common.close}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
