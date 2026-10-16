import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import type { Item, ID } from '@/types'
import { UI } from '@/i18n'
import { formatCents } from '@/domain/money'
import Modal from '@/components/Modal'
import ItemForm from '@/features/items/ItemForm'

export default function SalePage() {
  const [selectedCategoryId, setSelectedCategoryId] = useState<ID | 'ALL'>('ALL')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)

  // Consultas reactivas a IndexedDB con useLiveQuery
  const categories = useLiveQuery(
    () => db.categories.orderBy('sortOrder').filter(c => !c.archived).toArray(),
    [],
  )

  const items = useLiveQuery(
    () => db.items.filter(item => !item.archived).toArray(),
    [],
  )

  // Filtro de artículos por categoría
  const filteredItems = items?.filter(item => {
    if (selectedCategoryId === 'ALL') return true
    return item.categoryId === selectedCategoryId
  })

  // Obtener nombre de la categoría
  const getCategoryName = (catId: ID): string => {
    return categories?.find(c => c.id === catId)?.name ?? ''
  }

  const handleOpenCreate = () => {
    setEditingItem(null)
    setIsModalOpen(true)
  }

  const handleOpenEdit = (item: Item) => {
    setEditingItem(item)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingItem(null)
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Cabecera superior fija */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold text-gray-900">{UI.nav.sale}</h1>
          <button
            type="button"
            onClick={handleOpenCreate}
            aria-label={UI.items.newItem}
            className="inline-flex items-center gap-1 px-3 py-2 bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors min-h-12"
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
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors min-h-8 ${
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
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors min-h-8 ${
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

      {/* Lista de artículos (RF-V1) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!items ? (
          <div className="text-center py-12 text-gray-400">{UI.common.loading}</div>
        ) : filteredItems?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <span className="text-5xl mb-3" aria-hidden="true">🏷️</span>
            <p className="text-base font-semibold text-gray-700 mb-1">
              {UI.items.noItemsYet}
            </p>
            <p className="text-sm text-gray-500 mb-4 max-w-xs">
              {UI.items.noItemsHelp}
            </p>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="px-4 py-2.5 bg-brand-600 text-white font-medium rounded-lg shadow min-h-12 active:bg-brand-700"
            >
              {UI.items.newItem}
            </button>
          </div>
        ) : (
          filteredItems?.map((item) => {
            const isLastUnit = item.stock === 1
            const isOutOfStock = item.stock === 0
            const isNegativeStock = item.stock < 0

            return (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 bg-white rounded-xl border border-gray-200 shadow-sm"
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
                    <h3 className="font-semibold text-gray-900 truncate text-sm sm:text-base">
                      {item.name}
                    </h3>
                    <p className="text-xs text-gray-500 truncate">
                      {getCategoryName(item.categoryId)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-bold text-brand-700 text-sm">
                        {formatCents(item.priceCents)}
                      </span>

                      {/* Chips de estado de stock (Decisión 5: Última unidad con stock = 1) */}
                      {isLastUnit && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800">
                          {UI.sale.lastUnit}
                        </span>
                      )}
                      {isOutOfStock && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600">
                          {UI.sale.outOfStock}
                        </span>
                      )}
                      {isNegativeStock && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-700">
                          Stock: {item.stock}
                        </span>
                      )}
                      {!isLastUnit && !isOutOfStock && !isNegativeStock && (
                        <span className="text-xs text-gray-400">
                          Stock: {item.stock}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Botón de editar (RF-A4) */}
                <button
                  type="button"
                  onClick={() => handleOpenEdit(item)}
                  aria-label={`Editar ${item.name}`}
                  className="p-2 text-gray-400 hover:text-gray-600 active:bg-gray-100 rounded-lg min-h-12 min-w-12 flex items-center justify-center transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-5 h-5"
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
            )
          })
        )}
      </div>

      {/* Modal para Crear / Editar Artículo */}
      <Modal
        title={editingItem ? UI.items.editItem : UI.items.newItem}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
      >
        <ItemForm
          item={editingItem}
          categories={categories ?? []}
          onSuccess={handleCloseModal}
          onCancel={handleCloseModal}
        />
      </Modal>
    </div>
  )
}
