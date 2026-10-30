import { memo } from 'react'
import type { ID, Item } from '@/types'
import { UI } from '@/i18n'
import { formatCents } from '@/domain/money'
import { classifyStockLevel } from '@/domain/stats'
import { getItemInitial, getItemPlaceholderToneIndex } from '@/domain/saleFilter'

const PLACEHOLDER_PALETTE = [
  'bg-gradient-to-br from-orange-100 to-amber-200 text-orange-900',
  'bg-gradient-to-br from-rose-100 to-pink-200 text-rose-900',
  'bg-gradient-to-br from-emerald-100 to-teal-200 text-emerald-900',
  'bg-gradient-to-br from-sky-100 to-blue-200 text-sky-900',
  'bg-gradient-to-br from-violet-100 to-purple-200 text-violet-900',
  'bg-gradient-to-br from-amber-100 to-yellow-200 text-amber-900',
] as const

export interface ItemCardProps {
  item: Item
  quantity: number
  lowStockThreshold: number
  onAdd: (itemId: ID) => void
  onRemove: (itemId: ID) => void
  /** Si es true, difiere el renderizado fuera de la vista inicial (content-visibility: auto) */
  deferRendering?: boolean
}

function ItemCardComponent({
  item,
  quantity,
  lowStockThreshold,
  onAdd,
  onRemove,
  deferRendering = false,
}: ItemCardProps) {
  const inCart = quantity > 0
  const stockLevel = classifyStockLevel(item.stock, lowStockThreshold)
  const isOutOfStock = stockLevel === 'zero' || stockLevel === 'negative'
  const isLowStock = stockLevel === 'low'
  const exceedsStock = quantity > item.stock // RN-3, RF-V8

  const initial = getItemInitial(item.name)
  const toneIndex = getItemPlaceholderToneIndex(
    `${item.categoryId}:${item.name}`,
    PLACEHOLDER_PALETTE.length,
  )
  const placeholderClasses = PLACEHOLDER_PALETTE[toneIndex] ?? PLACEHOLDER_PALETTE[0]

  return (
    <div
      role="group"
      aria-label={item.name}
      data-in-cart={inCart ? 'true' : 'false'}
      className={`aspect-square flex flex-col bg-white rounded-2xl overflow-clip transition-all ${
        deferRendering ? 'sale-card-deferred' : ''
      } ${
        inCart
          ? 'border-2 border-brand-500 ring-2 ring-brand-300 shadow-md'
          : 'border border-gray-200 shadow-sm'
      }`}
    >
      {/* Zona superior: Imagen o marcador con superposición de estado, precio y nombre */}
      <div className="relative flex-1 min-h-[88px] w-full overflow-clip bg-gray-100">
        {item.imageThumb ? (
          <img
            src={item.imageThumb}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className={`w-full h-full object-cover select-none pointer-events-none transition-opacity ${
              isOutOfStock ? 'opacity-45 grayscale' : ''
            }`}
          />
        ) : (
          <div
            data-testid="item-image-placeholder"
            aria-hidden="true"
            className={`w-full h-full flex items-center justify-center select-none pointer-events-none ${placeholderClasses} ${
              isOutOfStock ? 'opacity-50 grayscale' : ''
            }`}
          >
            <span className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white/60 backdrop-blur-[1px] flex items-center justify-center font-black text-2xl sm:text-3xl shadow-inner">
              {initial}
            </span>
          </div>
        )}

        {/* Fila superior superpuesta: Estado de stock (izquierda) y etiqueta de precio (derecha) */}
        <div className="absolute top-1.5 inset-x-1.5 z-10 flex items-start justify-between gap-1 pointer-events-none">
          <div className="flex flex-col items-start gap-1 min-w-0">
            {isOutOfStock && (
              <span
                data-testid="out-of-stock-badge"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-gray-900/90 text-white font-bold text-[10px] leading-tight border border-white/25 shadow-sm"
              >
                <span aria-hidden="true">⊘</span>
                <span>{UI.sale.exhaustedBadge}</span>
              </span>
            )}
            {isLowStock && (
              <span
                data-testid="low-stock-badge"
                title={
                  item.stock === 1
                    ? `${UI.sale.lastUnit} (1)`
                    : UI.sale.lowStockBadge(item.stock)
                }
                aria-label={
                  item.stock === 1
                    ? `${UI.sale.lastUnit} (1)`
                    : UI.sale.lowStockBadge(item.stock)
                }
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-950/85 text-amber-200 font-bold text-[10px] leading-tight border border-amber-400/50 shadow-sm"
              >
                <span aria-hidden="true">⚠</span>
                <span>{item.stock}</span>
              </span>
            )}
          </div>

          <span className="inline-block px-2 py-0.5 rounded-lg bg-gray-950/85 text-white font-extrabold text-xs tracking-tight border border-white/15 shadow-sm shrink-0">
            {formatCents(item.priceCents)}
          </span>
        </div>

        {/* Superposición inferior semitransparente legible sobre fotos claras y oscuras */}
        <div className="absolute inset-x-0 bottom-0 bg-gray-950/80 px-2.5 py-1.5 pointer-events-none space-y-0.5">
          {exceedsStock && (
            <div className="text-[10px] font-bold text-amber-300 leading-tight flex items-center gap-1">
              <span aria-hidden="true">⚠</span>
              <span className="truncate">{UI.sale.stockWarning}</span>
            </div>
          )}
          <h3 className="sale-name-clamp font-semibold text-white text-xs sm:text-sm leading-snug break-words">
            {item.name}
          </h3>
        </div>
      </div>

      {/* Franja inferior interactiva: botones − y + de al menos 48 px de alto ocupando todo el ancho */}
      <div className="flex items-center justify-between gap-1.5 p-1.5 bg-white border-t border-gray-100 shrink-0">
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          disabled={quantity === 0}
          aria-label={UI.sale.removeUnitAria(item.name)}
          className={`flex-1 h-12 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl font-bold text-xl transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${
            inCart
              ? 'bg-gray-100 text-gray-900 hover:bg-gray-200 active:bg-gray-300'
              : 'bg-gray-50 text-gray-300 cursor-not-allowed'
          }`}
        >
          −
        </button>

        <div className="min-w-[1.75rem] px-1 flex items-center justify-center font-bold text-sm sm:text-base text-gray-900 select-none">
          {inCart ? (
            <span
              data-testid="card-cart-quantity"
              className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-md bg-brand-100 text-brand-900 border border-brand-400 font-extrabold"
            >
              {quantity}
            </span>
          ) : (
            <span data-testid="card-cart-quantity" className="text-gray-400">
              0
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onAdd(item.id)}
          aria-label={UI.sale.addUnitAria(item.name)}
          className="flex-1 h-12 min-h-[48px] min-w-[48px] flex items-center justify-center bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white rounded-xl font-bold text-xl shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          +
        </button>
      </div>
    </div>
  )
}

const ItemCard = memo(ItemCardComponent)
export default ItemCard
