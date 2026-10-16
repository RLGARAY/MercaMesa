import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import type { Category, Item, ID } from '@/types'
import { UI } from '@/i18n'
import { formatCents } from '@/domain/money'
import {
  createCategory,
  renameCategory,
  archiveCategory,
  restoreCategory,
  reorderCategories,
} from '@/services/categoryService'
import { restoreItem } from '@/services/itemService'
import Modal from '@/components/Modal'

export default function CatalogSection() {
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [newCatName, setNewCatName] = useState('')
  const [isAddCatModalOpen, setIsAddCatModalOpen] = useState(false)
  const [showArchivedCategories, setShowArchivedCategories] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)

  const allCategories = useLiveQuery(
    () => db.categories.orderBy('sortOrder').toArray(),
    [],
  )

  const archivedItems = useLiveQuery(
    () => db.items.filter(i => i.archived).toArray(),
    [],
  )

  const activeItems = useLiveQuery(
    () => db.items.filter(i => !i.archived).toArray(),
    [],
  )

  const activeCategories = allCategories?.filter(c => !c.archived) ?? []
  const archivedCategories = allCategories?.filter(c => c.archived) ?? []

  const countActiveItemsForCategory = (catId: ID): number => {
    return activeItems?.filter(i => i.categoryId === catId).length ?? 0
  }

  const handleCreateCategory = async () => {
    setCategoryError(null)
    const trimmed = newCatName.trim()
    if (!trimmed) return

    try {
      await createCategory(trimmed)
      setNewCatName('')
      setIsAddCatModalOpen(false)
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : UI.errors.generic)
    }
  }

  const handleRenameCategory = async () => {
    if (!editingCategory) return
    setCategoryError(null)
    const trimmed = newCatName.trim()
    if (!trimmed) return

    try {
      await renameCategory(editingCategory.id, trimmed)
      setEditingCategory(null)
      setNewCatName('')
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : UI.errors.generic)
    }
  }

  const handleArchiveCategory = async (cat: Category) => {
    setCategoryError(null)
    try {
      await archiveCategory(cat.id)
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : UI.errors.generic)
    }
  }

  const handleRestoreCategory = async (catId: ID) => {
    setCategoryError(null)
    try {
      await restoreCategory(catId)
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : UI.errors.generic)
    }
  }

  const handleMoveCategory = async (index: number, direction: 'up' | 'down') => {
    if (!activeCategories) return
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= activeCategories.length) return

    const newOrder = [...activeCategories]
    const temp = newOrder[index]!
    newOrder[index] = newOrder[targetIndex]!
    newOrder[targetIndex] = temp

    await reorderCategories(newOrder.map(c => c.id))
  }

  const handleRestoreItem = async (item: Item) => {
    try {
      await restoreItem(item.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : UI.errors.generic)
    }
  }

  return (
    <div className="space-y-6">
      {categoryError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center justify-between" role="alert">
          <span>{categoryError}</span>
          <button
            type="button"
            onClick={() => setCategoryError(null)}
            className="text-red-500 font-bold ml-2 p-1"
            aria-label="Cerrar aviso"
          >
            ✕
          </button>
        </div>
      )}

      {/* SECCIÓN: CATEGORÍAS (RF-C4) */}
      <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm text-left">
        <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-2">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{UI.settings.categoriesTitle}</h2>
            <p className="text-xs text-gray-500">Crea, renombra o cambia el orden en la pantalla de venta</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setNewCatName('')
              setCategoryError(null)
              setIsAddCatModalOpen(true)
            }}
            className="px-3 py-1.5 bg-brand-50 text-brand-700 hover:bg-brand-100 active:bg-brand-200 font-semibold text-xs rounded-lg transition-colors min-h-12 flex items-center"
          >
            {UI.settings.newCategoryBtn}
          </button>
        </div>

        {/* Lista de categorías activas */}
        <div className="divide-y divide-gray-100">
          {activeCategories.map((cat, idx) => {
            const itemCount = countActiveItemsForCategory(cat.id)
            return (
              <div
                key={cat.id}
                className="py-3 flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-gray-800 text-sm block truncate">
                    {cat.name}
                  </span>
                  <span className="text-xs text-gray-400">
                    {UI.settings.activeItemsCount(itemCount)}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => handleMoveCategory(idx, 'up')}
                    aria-label={`${UI.settings.moveUp} ${cat.name}`}
                    className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-20 rounded-lg active:bg-gray-100"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={idx === activeCategories.length - 1}
                    onClick={() => handleMoveCategory(idx, 'down')}
                    aria-label={`${UI.settings.moveDown} ${cat.name}`}
                    className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-20 rounded-lg active:bg-gray-100"
                  >
                    ↓
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingCategory(cat)
                      setNewCatName(cat.name)
                      setCategoryError(null)
                    }}
                    aria-label={`Renombrar ${cat.name}`}
                    className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-brand-600 rounded-lg active:bg-gray-100"
                  >
                    ✏️
                  </button>

                  <button
                    type="button"
                    onClick={() => handleArchiveCategory(cat)}
                    aria-label={`Archivar ${cat.name}`}
                    title={itemCount > 0 ? 'No se puede archivar con artículos activos' : undefined}
                    className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-red-600 rounded-lg active:bg-gray-100 text-xs font-semibold"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Categorías archivadas */}
        {archivedCategories.length > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setShowArchivedCategories(!showArchivedCategories)}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700 py-1"
            >
              {showArchivedCategories ? 'Ocultar archivadas' : `Ver categorías archivadas (${archivedCategories.length})`}
            </button>

            {showArchivedCategories && (
              <div className="mt-2 divide-y divide-gray-100 bg-gray-50 rounded-xl p-2">
                {archivedCategories.map((c) => (
                  <div key={c.id} className="py-2 px-2 flex items-center justify-between text-xs">
                    <span className="text-gray-500 line-through">{c.name}</span>
                    <button
                      type="button"
                      onClick={() => handleRestoreCategory(c.id)}
                      className="text-brand-600 hover:text-brand-700 font-semibold px-2 py-1 min-h-8"
                    >
                      {UI.items.restore}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* SECCIÓN: ARTÍCULOS ARCHIVADOS (RF-C5) */}
      <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm text-left">
        <h2 className="text-lg font-bold text-gray-900 mb-1">{UI.settings.archivedItemsTitle}</h2>
        <p className="text-xs text-gray-500 mb-3">Artículos retirados que mantienen su historial</p>

        {!archivedItems || archivedItems.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">{UI.settings.noArchivedItems}</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {archivedItems.map((item) => (
              <div key={item.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-gray-700 text-sm truncate">{item.name}</h3>
                  <span className="text-xs text-gray-400">{formatCents(item.priceCents)} · Stock: {item.stock}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestoreItem(item)}
                  className="px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 active:bg-green-200 text-xs font-semibold rounded-lg min-h-12 flex items-center transition-colors"
                >
                  {UI.items.restore}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Modal Añadir Categoría */}
      <Modal
        title={UI.settings.newCategoryBtn}
        isOpen={isAddCatModalOpen}
        onClose={() => setIsAddCatModalOpen(false)}
      >
        <div className="flex flex-col gap-4 text-left">
          <div>
            <label htmlFor="new-cat-input" className="block text-sm font-medium text-gray-700 mb-1">
              Nombre de la categoría
            </label>
            <input
              id="new-cat-input"
              type="text"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Ej: Cerámica"
              className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={handleCreateCategory}
            className="w-full min-h-12 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold rounded-xl"
          >
            {UI.common.confirm}
          </button>
        </div>
      </Modal>

      {/* Modal Renombrar Categoría */}
      <Modal
        title="Renombrar categoría"
        isOpen={Boolean(editingCategory)}
        onClose={() => setEditingCategory(null)}
      >
        <div className="flex flex-col gap-4 text-left">
          <div>
            <label htmlFor="rename-cat-input" className="block text-sm font-medium text-gray-700 mb-1">
              {UI.settings.renameCategoryPrompt}
            </label>
            <input
              id="rename-cat-input"
              type="text"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={handleRenameCategory}
            className="w-full min-h-12 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold rounded-xl"
          >
            {UI.common.save}
          </button>
        </div>
      </Modal>
    </div>
  )
}
