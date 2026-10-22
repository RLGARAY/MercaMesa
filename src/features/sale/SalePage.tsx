import { useState, useEffect, useRef, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, META_KEY } from '@/db/db'
import type { Item, Sale, ID } from '@/types'
import { UI } from '@/i18n'
import { formatCents } from '@/domain/money'
import { classifyStockLevel, DEFAULT_LOW_STOCK_THRESHOLD } from '@/domain/stats'
import { voidSale } from '@/services/saleService'
import Modal from '@/components/Modal'
import ItemForm from '@/features/items/ItemForm'
import CartDrawer from '@/features/sale/CartDrawer'
import { useCart } from '@/features/sale/useCart'

export default function SalePage() {
  const [selectedCategoryId, setSelectedCategoryId] = useState<ID | 'ALL'>('ALL')
  const [isItemModalOpen, setIsItemModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [isCartModalOpen, setIsCartModalOpen] = useState(false)

  // Toast de confirmación con Deshacer (RF-V6)
  const [lastSale, setLastSale] = useState<Sale | null>(null)
  const [undoToastMessage, setUndoToastMessage] = useState<string | null>(null)
  const undoTimeoutRef = useRef<number | null>(null)

  // Consultas reactivas a IndexedDB con useLiveQuery
  const categories = useLiveQuery(
    () => db.categories.orderBy('sortOrder').filter(c => !c.archived).toArray(),
    [],
  )

  const items = useLiveQuery(
    () => db.items.filter(item => !item.archived).toArray(),
    [],
  )

  const meta = useLiveQuery(
    () => db.meta.get(META_KEY),
    [],
  )
  const lowStockThreshold = meta?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD

  // Carrito persistente en localStorage purgado contra artículos activos (Decisión 2, RN-1, C2 #7)
  const {
    cartLines,
    totalItemsCount,
    getQuantity,
    addToCart,
    removeFromCart,
    clearCart,
  } = useCart(items)

  // Filtro de artículos por categoría
  const filteredItems = useMemo(() => {
    if (!items) return []
    if (selectedCategoryId === 'ALL') return items
    return items.filter(item => item.categoryId === selectedCategoryId)
  }, [items, selectedCategoryId])

  // Subtotal del carrito
  const cartSubtotalCents = useMemo(() => {
    return cartLines.reduce((sum, line) => sum + line.item.priceCents * line.quantity, 0)
  }, [cartLines])

  // Limpiar temporizador al desmontar
  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) window.clearTimeout(undoTimeoutRef.current)
    }
  }, [])

  // Al cobrar con éxito (RF-V6)
  const handleCheckoutSuccess = (sale: Sale) => {
    clearCart()
    setIsCartModalOpen(false)
    setLastSale(sale)
    setUndoToastMessage(`Cobrado ${formatCents(sale.totalCents)}`)

    if (undoTimeoutRef.current) window.clearTimeout(undoTimeoutRef.current)
    undoTimeoutRef.current = window.setTimeout(() => {
      setLastSale(null)
      setUndoToastMessage(null)
    }, 7000)
  }

  // Deshacer venta recién creada (RF-V6 / RN-6 / A4)
  const handleUndo = async () => {
    if (!lastSale) return
    try {
      await voidSale(lastSale.id, 'undo')
      setLastSale(null)
      setUndoToastMessage('Venta deshecha y stock devuelto')
      if (undoTimeoutRef.current) window.clearTimeout(undoTimeoutRef.current)
      undoTimeoutRef.current = window.setTimeout(() => {
        setUndoToastMessage(null)
      }, 3000)
    } catch (err) {
      alert(err instanceof Error ? err.message : UI.errors.generic)
    }
  }

  const getCategoryName = (catId: ID): string => {
    return categories?.find(c => c.id === catId)?.name ?? ''
  }

  const handleOpenCreate = () => {
    setEditingItem(null)
    setIsItemModalOpen(true)
  }

  const handleOpenEdit = (item: Item) => {
    setEditingItem(item)
    setIsItemModalOpen(true)
  }

  const handleCloseItemModal = () => {
    setIsItemModalOpen(false)
    setEditingItem(null)
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 relative overflow-hidden">
      {/* Toast de confirmación con botón Deshacer (RF-V6) */}
      {undoToastMessage && (
        <div
          className="fixed top-3 left-4 right-4 z-50 flex items-center justify-between p-3.5 bg-gray-900 text-white rounded-xl shadow-2xl animate-in fade-in slide-in-from-top duration-200"
          role="status"
        >
          <span className="text-sm font-medium">{undoToastMessage}</span>
          {lastSale && (
            <button
              type="button"
              onClick={handleUndo}
              className="ml-3 px-3 py-1.5 bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white rounded-lg text-xs font-bold transition-colors min-h-8"
            >
              {UI.sale.undo}
            </button>
          )}
        </div>
      )}

      {/* Contenedor responsivo: divide en columnas en tablet horizontal (RNF-4) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Columna Principal: Catálogo de artículos */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Cabecera superior fija */}
          <header className="bg-white border-b border-gray-200 px-4 py-3 shadow-sm shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-xl font-bold text-gray-900">{UI.nav.sale}</h1>
              <button
                type="button"
                onClick={handleOpenCreate}
                aria-label={UI.items.newItem}
                className="inline-flex items-center gap-1 px-3 py-2 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors min-h-[48px]"
              >
                <span className="text-lg" aria-hidden="true">+</span>
                <span>{UI.items.newItem}</span>
              </button>
            </div>

            {/* Chips de filtro por categoría (RF-V2) */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="tablist" aria-label="Filtrar por categoría">
              <button
                type="button"
                role="tab"
                aria-selected={selectedCategoryId === 'ALL'}
                onClick={() => setSelectedCategoryId('ALL')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors min-h-[36px] ${
                  selectedCategoryId === 'ALL'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {UI.sale.allCategories}
              </button>
              {categories?.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedCategoryId === cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors min-h-[36px] ${
                    selectedCategoryId === cat.id
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </header>

          {/* Lista de artículos en filas (RF-V1, RF-V3) */}
          <div className={`flex-1 overflow-y-auto p-4 space-y-3 ${totalItemsCount > 0 ? 'pb-24 lg:pb-6' : 'pb-6'}`}>
            {!items ? (
              <div className="text-center py-12 text-gray-400">{UI.common.loading}</div>
            ) : filteredItems?.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <span className="text-5xl mb-3" aria-hidden="true">🏷️</span>
                {selectedCategoryId !== 'ALL' && (items?.length ?? 0) > 0 ? (
                  <>
                    <p className="text-base font-semibold text-gray-700 mb-1">
                      No hay artículos en esta categoría
                    </p>
                    <p className="text-sm text-gray-500 mb-4 max-w-xs">
                      Puedes ver todos los artículos del catálogo o añadir uno nuevo a esta categoría.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedCategoryId('ALL')}
                        className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs rounded-xl min-h-[48px] transition-colors"
                      >
                        Ver todas las categorías
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenCreate}
                        className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs rounded-xl min-h-[48px] shadow-sm transition-colors"
                      >
                        + Añadir a esta categoría
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-base font-semibold text-gray-700 mb-1">
                      {UI.items.noItemsYet}
                    </p>
                    <p className="text-sm text-gray-500 mb-4 max-w-xs">
                      {UI.items.noItemsHelp}
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenCreate}
                      className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-xl shadow min-h-[48px] active:bg-brand-800"
                    >
                      {UI.items.newItem}
                    </button>
                  </>
                )}
              </div>
            ) : (
              filteredItems?.map((item) => {
                const qty = getQuantity(item.id)
                const stockLevel = classifyStockLevel(item.stock, lowStockThreshold)
                const exceedsStock = qty > item.stock // RF-V8, RN-3

                return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between p-3 bg-white rounded-xl border transition-all ${
                      qty > 0
                        ? 'border-brand-400 ring-1 ring-brand-300 shadow-sm'
                        : 'border-gray-200 shadow-sm'
                    }`}
                  >
                    {/* Imagen + Datos */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-14 h-14 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center shrink-0 border border-gray-100">
                        {item.imageThumb ? (
                          <img
                            src={item.imageThumb}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-xl text-gray-400" aria-hidden="true">🖼️</span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-semibold text-gray-900 truncate text-sm sm:text-base">
                            {item.name}
                          </h3>
                          {/* Botón rápido editar */}
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(item)}
                            aria-label={`Editar ${item.name}`}
                            className="text-gray-400 hover:text-gray-600 p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-3.5 h-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                              />
                            </svg>
                          </button>
                        </div>

                        <p className="text-xs text-gray-500 truncate">
                          {getCategoryName(item.categoryId)}
                        </p>

                        <div className="flex items-center flex-wrap gap-1.5 mt-1">
                          <span className="font-bold text-brand-700 text-sm">
                            {formatCents(item.priceCents)}
                          </span>

                          {/* Chips de stock (RF-E7, C1: colores y textos distintos para bajo, cero y negativo) */}
                          {stockLevel === 'low' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                              {item.stock === 1 ? `${UI.sale.lastUnit} (1)` : `Poco stock (${item.stock})`}
                            </span>
                          )}
                          {stockLevel === 'zero' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-200 text-gray-800 border border-gray-300">
                              {UI.sale.outOfStock} (0)
                            </span>
                          )}
                          {stockLevel === 'negative' && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 border border-red-300">
                              Stock negativo ({item.stock})
                            </span>
                          )}
                          {stockLevel === 'ok' && (
                            <span className="text-xs text-gray-400">
                              Stock: {item.stock}
                            </span>
                          )}

                          {/* Aviso si la cantidad en carrito supera el stock (RF-V8, RN-3) */}
                          {exceedsStock && (
                            <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                              {UI.sale.stockWarning}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Controles táctiles − / + grandes (RF-V1, RF-V3, RNF-1) */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.id)}
                        disabled={qty === 0}
                        aria-label={`${UI.common.remove} 1 ${item.name}`}
                        className={`w-12 h-12 flex items-center justify-center rounded-xl font-bold text-xl transition-colors ${
                          qty > 0
                            ? 'bg-gray-100 text-gray-800 hover:bg-gray-200 active:bg-gray-300'
                            : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                        }`}
                      >
                        −
                      </button>

                      <div className="w-8 flex items-center justify-center font-bold text-base text-gray-900">
                        {qty > 0 ? (
                          <span className="text-brand-600 font-extrabold">{qty}</span>
                        ) : (
                          <span className="text-gray-300">0</span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => addToCart(item.id)}
                        aria-label={`${UI.common.add} 1 ${item.name}`}
                        className="w-12 h-12 flex items-center justify-center bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white rounded-xl font-bold text-xl shadow-sm transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Columna Derecha: Carrito en paralelo para Tablet / Pantalla grande (RNF-4) */}
        <aside
          className="hidden lg:flex w-96 flex-col border-l border-gray-200 bg-white h-full overflow-y-auto p-4 shrink-0 shadow-sm"
          aria-label="Carrito de compra en paralelo"
        >
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>🛒</span>
              <span>{UI.sale.cart}</span>
            </h2>
            {totalItemsCount > 0 && (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-brand-100 text-brand-800">
                {totalItemsCount} {totalItemsCount === 1 ? 'artículo' : 'artículos'}
              </span>
            )}
          </div>
          <CartDrawer
            lines={cartLines}
            onAddToCart={addToCart}
            onRemoveFromCart={removeFromCart}
            onClearCart={clearCart}
            onCheckoutSuccess={handleCheckoutSuccess}
          />
        </aside>
      </div>

      {/* BARRA DE CARRITO FLOTANTE (Solo en móvil vertical, RF-V4, RNF-4) */}
      {totalItemsCount > 0 && (
        <div className="lg:hidden fixed bottom-14 left-0 right-0 p-3 z-30 pointer-events-none">
          <button
            type="button"
            onClick={() => setIsCartModalOpen(true)}
            aria-label={`Ver carrito: ${totalItemsCount} artículos por ${formatCents(cartSubtotalCents)}`}
            className="w-full max-w-md mx-auto min-h-14 bg-gray-900 hover:bg-black active:scale-[0.99] text-white p-4 rounded-2xl shadow-2xl flex items-center justify-between pointer-events-auto transition-transform"
          >
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-600 text-white font-bold text-xs">
                {totalItemsCount}
              </span>
              <span className="font-semibold text-sm">
                Ver carrito
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-brand-300">
                {formatCents(cartSubtotalCents)}
              </span>
              <span className="text-gray-400" aria-hidden="true">→</span>
            </div>
          </button>
        </div>
      )}

      {/* Modal / Resumen del Carrito para móvil (RF-V5, RF-V6, RF-V7) */}
      <Modal
        title="Carrito de compra"
        isOpen={isCartModalOpen}
        onClose={() => setIsCartModalOpen(false)}
      >
        <CartDrawer
          lines={cartLines}
          onClose={() => setIsCartModalOpen(false)}
          onAddToCart={addToCart}
          onRemoveFromCart={removeFromCart}
          onClearCart={clearCart}
          onCheckoutSuccess={handleCheckoutSuccess}
        />
      </Modal>

      {/* Modal para Crear / Editar Artículo */}
      <Modal
        title={editingItem ? UI.items.editItem : UI.items.newItem}
        isOpen={isItemModalOpen}
        onClose={handleCloseItemModal}
      >
        <ItemForm
          item={editingItem}
          categories={categories ?? []}
          onSuccess={handleCloseItemModal}
          onCancel={handleCloseItemModal}
        />
      </Modal>
    </div>
  )
}
