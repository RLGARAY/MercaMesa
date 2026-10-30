import { memo } from 'react'
import type { ID, Item } from '@/types'
import { UI } from '@/i18n'
import { formatCents } from '@/domain/money'

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
  onAdd,
  onRemove,
  deferRendering = false,
}: ItemCardProps) {
  const inCart = quantity > 0

  return (
    <div
      className={`aspect-square flex flex-col bg-white rounded-2xl overflow-clip transition-all ${
        deferRendering ? 'sale-card-deferred' : ''
      } ${
        inCart
          ? 'border-2 border-brand-500 ring-2 ring-brand-300 shadow-md'
          : 'border border-gray-200 shadow-sm'
      }`}
    >
      {/* Zona superior: Imagen del artículo con nombre y precio superpuestos */}
      <div className="relative flex-1 min-h-[88px] w-full overflow-clip bg-gray-100">
        {item.imageThumb ? (
          <img
            src={item.imageThumb}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover select-none pointer-events-none"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center bg-gray-200 text-gray-600 font-bold text-2xl select-none"
            aria-hidden="true"
          >
            {item.name.trim().charAt(0).toUpperCase() || '?'}
          </div>
        )}

        {/* Etiqueta de precio en esquina superior derecha con fondo semitransparente de alto contraste */}
        <div className="absolute top-1.5 right-1.5 z-10 pointer-events-none">
          <span className="inline-block px-2 py-0.5 rounded-lg bg-gray-950/85 text-white font-extrabold text-xs tracking-tight border border-white/15 shadow-sm">
            {formatCents(item.priceCents)}
          </span>
        </div>

        {/* Superposición inferior semitransparente legible sobre fotos claras y oscuras */}
        <div className="absolute inset-x-0 bottom-0 bg-gray-950/80 px-2.5 py-1.5 pointer-events-none">
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
          className={`flex-1 h-12 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl font-bold text-xl transition-colors ${
            inCart
              ? 'bg-gray-100 text-gray-900 hover:bg-gray-200 active:bg-gray-300'
              : 'bg-gray-50 text-gray-300 cursor-not-allowed'
          }`}
        >
          −
        </button>

        <div className="min-w-[1.75rem] px-1 flex items-center justify-center font-bold text-sm sm:text-base text-gray-900 select-none">
          {inCart ? (
            <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-md bg-brand-100 text-brand-900 border border-brand-400 font-extrabold">
              {quantity}
            </span>
          ) : (
            <span className="text-gray-400">0</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onAdd(item.id)}
          aria-label={UI.sale.addUnitAria(item.name)}
          className="flex-1 h-12 min-h-[48px] min-w-[48px] flex items-center justify-center bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white rounded-xl font-bold text-xl shadow-sm transition-colors"
        >
          +
        </button>
      </div>
    </div>
  )
}

const ItemCard = memo(ItemCardComponent)
export default ItemCard
