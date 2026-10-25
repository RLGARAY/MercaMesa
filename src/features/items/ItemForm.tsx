import { useState, useRef, useEffect, type FormEvent } from 'react'
import type { Category, Item, ID } from '@/types'
import { UI } from '@/i18n'
import { formatCents, formatCentsToEurosInput } from '@/domain/money'
import {
  validateItemName,
  validateAndParsePriceString,
  validateAndParseStockString,
} from '@/domain/validation'
import { createItem, updateItem, archiveItem, restoreItem } from '@/services/itemService'
import { createCategory } from '@/services/categoryService'
import { resizeImageToThumb } from '@/utils/imageResize'

interface ItemFormProps {
  /** Si se proporciona, es modo edición. Si no, es modo alta. */
  item?: Item | null
  categories: Category[]
  onSuccess: (item?: Item) => void
  onCancel: () => void
  onCategoryCreated?: (newCategory: Category) => void
}

export default function ItemForm({
  item,
  categories,
  onSuccess,
  onCancel,
  onCategoryCreated,
}: ItemFormProps) {
  const isEditing = Boolean(item)

  // Estados del formulario
  const [name, setName] = useState(item?.name ?? '')
  const [categoryId, setCategoryId] = useState<ID>(
    item?.categoryId ?? categories[0]?.id ?? '',
  )
  const [priceStr, setPriceStr] = useState(
    item ? formatCentsToEurosInput(item.priceCents) : '',
  )
  const [stockStr, setStockStr] = useState(
    item ? String(item.stock) : '0',
  )
  const [imageThumb, setImageThumb] = useState<string | null | undefined>(
    item?.imageThumb,
  )
  const [imageProcessing, setImageProcessing] = useState(false)

  // Creación rápida de categoría
  const [showNewCatInput, setShowNewCatInput] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [catError, setCatError] = useState<string | null>(null)

  // Errores de validación
  const [errors, setErrors] = useState<{
    name?: string
    price?: string
    stock?: string
    general?: string
  }>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Si no había categoría seleccionada pero llegan categorías, seleccionar la primera
  useEffect(() => {
    if (!categoryId && categories.length > 0) {
      setCategoryId(categories[0]!.id)
    }
  }, [categoryId, categories])

  // Manejo de imagen
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setImageProcessing(true)
      const thumb = await resizeImageToThumb(file)
      setImageThumb(thumb)
    } catch {
      setErrors(prev => ({ ...prev, general: UI.items.errors.imageProcess }))
    } finally {
      setImageProcessing(false)
      // Limpiar input file para permitir seleccionar la misma imagen de nuevo si se desea
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Creación rápida de categoría inline
  const handleCreateCategory = async () => {
    setCatError(null)
    const trimmed = newCatName.trim()
    if (!trimmed) {
      setCatError(UI.items.errors.emptyCategoryName)
      return
    }

    try {
      const newCat = await createCategory(trimmed)
      onCategoryCreated?.(newCat)
      setCategoryId(newCat.id)
      setNewCatName('')
      setShowNewCatInput(false)
    } catch (err) {
      setCatError(err instanceof Error ? err.message : UI.items.errors.createCategoryError)
    }
  }

  // Guardar (crear o editar)
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrors({})

    // Validar nombre
    const nameErr = validateItemName(name)
    // Validar precio
    const priceRes = validateAndParsePriceString(priceStr)
    // Validar stock (solo obligatorio en alta)
    const stockRes = !isEditing ? validateAndParseStockString(stockStr) : null

    const newErrors: typeof errors = {}
    if (nameErr) newErrors.name = nameErr
    if (priceRes.error) newErrors.price = priceRes.error
    if (stockRes && stockRes.error) newErrors.stock = stockRes.error
    if (!categoryId) newErrors.general = UI.items.errors.selectCategoryRequired

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    try {
      setIsSubmitting(true)
      if (isEditing && item) {
        // RF-A4: Edición de artículo
        const updatePayload: Parameters<typeof updateItem>[1] = {
          name,
          categoryId,
          priceCents: priceRes.cents!,
        }
        if (imageThumb === null) {
          updatePayload.imageThumb = null
        } else if (typeof imageThumb === 'string') {
          updatePayload.imageThumb = imageThumb
        }

        await updateItem(item.id, updatePayload)
        onSuccess()
      } else {
        // RF-A1..RF-A3: Alta de nuevo artículo con ajuste de stock si aplica
        const createPayload: Parameters<typeof createItem>[0] = {
          name,
          categoryId,
          priceCents: priceRes.cents!,
          stockInitial: stockRes!.stock!,
        }
        if (typeof imageThumb === 'string') {
          createPayload.imageThumb = imageThumb
        }

        const created = await createItem(createPayload)
        onSuccess(created)
      }
    } catch (err) {
      setErrors({
        general: err instanceof Error ? err.message : UI.errors.generic,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Archivar / Restaurar (RF-A4, RN-8)
  const handleToggleArchive = async () => {
    if (!item) return
    try {
      setIsSubmitting(true)
      if (item.archived) {
        await restoreItem(item.id)
      } else {
        await archiveItem(item.id)
      }
      onSuccess()
    } catch (err) {
      setErrors({ general: err instanceof Error ? err.message : UI.errors.generic })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Preview de precio en céntimos formateado
  const parsedPricePreview = validateAndParsePriceString(priceStr).cents

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
      {errors.general && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm" role="alert">
          {errors.general}
        </div>
      )}

      {/* Foto / Imagen (RF-A2) */}
      <div className="flex items-center gap-4">
        <div className="relative w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
          {imageThumb ? (
            <img
              src={imageThumb}
              alt={UI.items.imagePreviewAlt}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-3xl text-gray-400" aria-hidden="true">📷</span>
          )}
          {imageProcessing && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-xs">
              {UI.common.loading}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="hidden"
            id="item-image-input"
          />
          <label
            htmlFor="item-image-input"
            className="inline-flex items-center justify-center px-4 py-2 min-h-12 border border-gray-300 rounded-lg bg-white text-sm font-medium text-gray-700 active:bg-gray-50 cursor-pointer shadow-sm"
          >
            {imageThumb ? UI.items.changePhoto : UI.items.image}
          </label>
          {imageThumb && (
            <button
              type="button"
              onClick={() => setImageThumb(null)}
              className="text-xs text-red-600 hover:text-red-700 min-h-[44px] px-2.5 py-2 inline-flex items-center rounded-lg hover:bg-red-50 text-left font-medium transition-colors"
            >
              {UI.items.removePhoto}
            </button>
          )}
          <span className="text-xs text-gray-500">{UI.items.photoHelp}</span>
        </div>
      </div>

      {/* Nombre (RF-A1) */}
      <div>
        <label htmlFor="item-name" className="block text-sm font-medium text-gray-700 mb-1">
          {UI.items.name} *
        </label>
        <input
          id="item-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={UI.items.namePlaceholder}
          className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          required
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
      </div>

      {/* Categoría (RF-A1, RN-9) */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="item-category" className="block text-sm font-medium text-gray-700">
            {UI.items.category} *
          </label>
          <button
            type="button"
            onClick={() => setShowNewCatInput(!showNewCatInput)}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 px-2.5 py-2 min-h-[44px] inline-flex items-center rounded-lg hover:bg-brand-50 transition-colors"
          >
            {showNewCatInput ? UI.common.cancel : UI.items.newCategory}
          </button>
        </div>

        {showNewCatInput ? (
          <div className="flex flex-col gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex gap-2">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder={UI.items.createCategoryPrompt}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm min-h-[44px]"
              />
              <button
                type="button"
                onClick={handleCreateCategory}
                className="px-3.5 py-2 bg-brand-600 text-white text-sm font-medium rounded-md active:bg-brand-700 min-h-[44px] min-w-[44px]"
              >
                {UI.common.add}
              </button>
            </div>
            {catError && <p className="text-xs text-red-600">{catError}</p>}
          </div>
        ) : (
          <select
            id="item-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base bg-white focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            required
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.archived ? `(${UI.items.archived})` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Precio de venta en euros (RF-A1, RF-A5) */}
      <div>
        <label htmlFor="item-price" className="block text-sm font-medium text-gray-700 mb-1">
          {UI.items.price} *
        </label>
        <div className="relative">
          <input
            id="item-price"
            type="text"
            inputMode="decimal"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            placeholder={UI.items.pricePlaceholder}
            className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-brand-500 focus:border-brand-500 pr-20"
            required
          />
          {parsedPricePreview !== null && (
            <span className="absolute right-3 top-3.5 text-xs font-semibold text-gray-400 pointer-events-none">
              {formatCents(parsedPricePreview)}
            </span>
          )}
        </div>
        {errors.price && <p className="mt-1 text-xs text-red-600">{errors.price}</p>}
      </div>

      {/* Stock (RF-A1, RF-A3) */}
      <div>
        <label htmlFor="item-stock" className="block text-sm font-medium text-gray-700 mb-1">
          {isEditing ? UI.items.currentStock : `${UI.items.stockInitial} *`}
        </label>
        {isEditing ? (
          <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
            <span>
              {UI.items.currentUnitsLabel} <strong className="text-gray-900">{item?.stock}</strong>
            </span>
            <span className="text-xs text-gray-400">
              {UI.items.correctedInSettingsHint}
            </span>
          </div>
        ) : (
          <>
            <input
              id="item-stock"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={stockStr}
              onChange={(e) => setStockStr(e.target.value)}
              className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              required
            />
            {errors.stock && <p className="mt-1 text-xs text-red-600">{errors.stock}</p>}
          </>
        )}
      </div>

      {/* Botones de acción */}
      <div className="flex flex-col gap-2 pt-2">
        <button
          type="submit"
          disabled={isSubmitting || imageProcessing}
          className="w-full min-h-12 flex items-center justify-center px-4 py-3 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold rounded-xl shadow transition-colors disabled:opacity-50"
        >
          {isSubmitting ? UI.common.loading : UI.items.save}
        </button>

        {isEditing && (
          <button
            type="button"
            onClick={handleToggleArchive}
            disabled={isSubmitting}
            className={`w-full min-h-12 flex items-center justify-center px-4 py-3 border font-medium rounded-xl transition-colors ${
              item?.archived
                ? 'border-green-600 text-green-700 bg-green-50 active:bg-green-100'
                : 'border-red-300 text-red-600 bg-red-50 hover:bg-red-100 active:bg-red-200'
            }`}
          >
            {item?.archived ? UI.items.restore : UI.items.archive}
          </button>
        )}

        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="w-full min-h-12 flex items-center justify-center px-4 py-3 text-gray-600 hover:text-gray-800 font-medium rounded-xl"
        >
          {UI.common.cancel}
        </button>
      </div>
    </form>
  )
}
