import { describe, it, expect } from 'vitest'
import type { Item } from '@/types'
import {
  normalizeForSearch,
  filterAndSortItems,
  countHiddenOutOfStockItems,
  parseSaleSort,
  parseHideOutOfStock,
  parseSaleViewMode,
  isValidSaleSort,
  isValidSaleViewMode,
  DEFAULT_SALE_SORT,
  DEFAULT_SALE_VIEW_MODE,
  getItemInitial,
  getItemPlaceholderToneIndex,
} from '@/domain/saleFilter'

function makeItem(overrides: Partial<Item> & Pick<Item, 'id' | 'name'>): Item {
  return {
    id: overrides.id,
    name: overrides.name,
    categoryId: overrides.categoryId ?? 'cat-1',
    priceCents: overrides.priceCents ?? 500,
    stock: overrides.stock ?? 5,
    archived: overrides.archived ?? false,
    createdAt: overrides.createdAt ?? '2026-10-20T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-10-20T10:00:00.000Z',
    ...(overrides.imageThumb !== undefined ? { imageThumb: overrides.imageThumb } : {}),
  }
}

describe('normalizeForSearch (dominio puro)', () => {
  it('elimina acentos, diacríticos y convierte a minúsculas', () => {
    expect(normalizeForSearch('Árbol de la vida')).toBe('arbol de la vida')
    expect(normalizeForSearch('LÁMINA Pingüino')).toBe('lamina pinguino')
    expect(normalizeForSearch('Corazón Único')).toBe('corazon unico')
  })

  it('ignora espacios al principio y al final y devuelve cadena vacía si solo hay espacios', () => {
    expect(normalizeForSearch('   pendientes aro   ')).toBe('pendientes aro')
    expect(normalizeForSearch('     ')).toBe('')
    expect(normalizeForSearch('')).toBe('')
  })
})

describe('parseSaleSort y parseHideOutOfStock', () => {
  it('usa Nombre A → Z ("name-asc") por defecto cuando no hay valor o es inválido', () => {
    expect(DEFAULT_SALE_SORT).toBe('name-asc')
    expect(parseSaleSort(undefined)).toBe('name-asc')
    expect(parseSaleSort(null)).toBe('name-asc')
    expect(parseSaleSort('')).toBe('name-asc')
    expect(parseSaleSort('invalid-sort')).toBe('name-asc')
    expect(parseSaleSort(123)).toBe('name-asc')
    expect(isValidSaleSort('invalid-sort')).toBe(false)
  })

  it('reconoce las 4 opciones válidas de ordenación', () => {
    expect(parseSaleSort('name-asc')).toBe('name-asc')
    expect(parseSaleSort('name-desc')).toBe('name-desc')
    expect(parseSaleSort('stock-asc')).toBe('stock-asc')
    expect(parseSaleSort('stock-desc')).toBe('stock-desc')
  })

  it('usa false por defecto para hideOutOfStock salvo que sea estrictamente true', () => {
    expect(parseHideOutOfStock(undefined)).toBe(false)
    expect(parseHideOutOfStock(false)).toBe(false)
    expect(parseHideOutOfStock('true')).toBe(false)
    expect(parseHideOutOfStock(true)).toBe(true)
  })

  it('usa "list" por defecto para saleViewMode cuando no hay valor o es inválido, y reconoce "list" y "grid"', () => {
    expect(DEFAULT_SALE_VIEW_MODE).toBe('list')
    expect(parseSaleViewMode(undefined)).toBe('list')
    expect(parseSaleViewMode(null)).toBe('list')
    expect(parseSaleViewMode('')).toBe('list')
    expect(parseSaleViewMode('invalid-mode')).toBe('list')
    expect(parseSaleViewMode(123)).toBe('list')
    expect(isValidSaleViewMode('invalid-mode')).toBe(false)
    expect(isValidSaleViewMode('list')).toBe(true)
    expect(isValidSaleViewMode('grid')).toBe(true)
    expect(parseSaleViewMode('list')).toBe('list')
    expect(parseSaleViewMode('grid')).toBe('grid')
  })

  it('calcula la inicial en mayúscula y el índice de color del marcador sin imagen', () => {
    expect(getItemInitial('  pendientes aro ')).toBe('P')
    expect(getItemInitial('árbol de la vida')).toBe('Á')
    expect(getItemInitial('   ')).toBe('?')
    const idx = getItemPlaceholderToneIndex('cat-1:Pendientes', 6)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(6)
    expect(getItemPlaceholderToneIndex('cat-1:Pendientes', 6)).toBe(idx)
  })
})

describe('filterAndSortItems (reglas de combinación 1..5)', () => {
  describe('Ordenación alfabética y numérica natural en español', () => {
    it('ordena A → Z por defecto sin distinguir mayúsculas ni acentos y con orden numérico natural ("Llavero 2" antes de "Llavero 10")', () => {
      const items = [
        makeItem({ id: '1', name: 'Llavero 10' }),
        makeItem({ id: '2', name: 'llavero 2' }),
        makeItem({ id: '3', name: 'Árbol de la vida' }),
        makeItem({ id: '4', name: 'arandela' }),
        makeItem({ id: '5', name: 'Broche sol' }),
      ]

      const sortedDefault = filterAndSortItems(items)
      expect(sortedDefault.map(i => i.name)).toEqual([
        'arandela',
        'Árbol de la vida',
        'Broche sol',
        'llavero 2',
        'Llavero 10',
      ])

      const sortedInvalid = filterAndSortItems(items, { sort: 'orden-antiguo-inexistente' })
      expect(sortedInvalid.map(i => i.name)).toEqual([
        'arandela',
        'Árbol de la vida',
        'Broche sol',
        'llavero 2',
        'Llavero 10',
      ])
    })

    it('ordena Z → A respetando acentos, mayúsculas y números naturales', () => {
      const items = [
        makeItem({ id: '1', name: 'Llavero 2' }),
        makeItem({ id: '2', name: 'Llavero 10' }),
        makeItem({ id: '3', name: 'Árbol de la vida' }),
        makeItem({ id: '4', name: 'Zorro' }),
      ]

      const sortedDesc = filterAndSortItems(items, { sort: 'name-desc' })
      expect(sortedDesc.map(i => i.name)).toEqual([
        'Zorro',
        'Llavero 10',
        'Llavero 2',
        'Árbol de la vida',
      ])
    })

    it('ordena por stock (de menos a más y de más a menos) con desempate por Nombre A → Z', () => {
      const items = [
        makeItem({ id: '1', name: 'Pendiente Luna', stock: 3 }),
        makeItem({ id: '2', name: 'Árbol de la vida', stock: 3 }),
        makeItem({ id: '3', name: 'Collar Estrella', stock: 0 }),
        makeItem({ id: '4', name: 'Anillo Cobre', stock: -1 }),
        makeItem({ id: '5', name: 'Broche Gato', stock: 3 }),
        makeItem({ id: '6', name: 'Lámina Bosque', stock: 8 }),
      ]

      const asc = filterAndSortItems(items, { sort: 'stock-asc' })
      expect(asc.map(i => `${i.name} (${i.stock})`)).toEqual([
        'Anillo Cobre (-1)',
        'Collar Estrella (0)',
        'Árbol de la vida (3)',
        'Broche Gato (3)',
        'Pendiente Luna (3)',
        'Lámina Bosque (8)',
      ])

      const desc = filterAndSortItems(items, { sort: 'stock-desc' })
      expect(desc.map(i => `${i.name} (${i.stock})`)).toEqual([
        'Lámina Bosque (8)',
        'Árbol de la vida (3)',
        'Broche Gato (3)',
        'Pendiente Luna (3)',
        'Collar Estrella (0)',
        'Anillo Cobre (-1)',
      ])
    })
  })

  describe('Buscador por nombre', () => {
    const catalog = [
      makeItem({ id: '1', name: 'Árbol de la vida' }),
      makeItem({ id: '2', name: 'Pendientes Corazón' }),
      makeItem({ id: '3', name: 'Llavero Pingüino' }),
      makeItem({ id: '4', name: 'Lámina Acuarela' }),
    ]

    it('encuentra coincidencias parciales sin distinguir mayúsculas ni acentos', () => {
      expect(filterAndSortItems(catalog, { query: 'arbol' }).map(i => i.id)).toEqual(['1'])
      expect(filterAndSortItems(catalog, { query: 'ÁRBOL' }).map(i => i.id)).toEqual(['1'])
      expect(filterAndSortItems(catalog, { query: 'vida' }).map(i => i.id)).toEqual(['1'])
      expect(filterAndSortItems(catalog, { query: 'corazon' }).map(i => i.id)).toEqual(['2'])
      expect(filterAndSortItems(catalog, { query: 'pinguino' }).map(i => i.id)).toEqual(['3'])
    })

    it('ignora espacios al principio y al final, y no filtra si la búsqueda está vacía o solo tiene espacios', () => {
      expect(filterAndSortItems(catalog, { query: '   arbol   ' }).map(i => i.id)).toEqual(['1'])
      expect(filterAndSortItems(catalog, { query: '' })).toHaveLength(4)
      expect(filterAndSortItems(catalog, { query: '    ' })).toHaveLength(4)
    })

    it('devuelve lista vacía cuando ningún artículo coincide', () => {
      expect(filterAndSortItems(catalog, { query: 'dinosaurio' })).toEqual([])
    })
  })

  describe('Filtro de ocultar sin stock y excepción del carrito', () => {
    const items = [
      makeItem({ id: 'ok-1', name: 'Collar Sol', stock: 4 }),
      makeItem({ id: 'zero-1', name: 'Pendiente Agotado', stock: 0 }),
      makeItem({ id: 'neg-1', name: 'Llavero Negativo', stock: -2 }),
      makeItem({ id: 'zero-cart', name: 'Anillo en Carrito', stock: 0 }),
      makeItem({ id: 'neg-cart', name: 'Broche Negativo en Carrito', stock: -1 }),
    ]

    it('muestra todos los artículos activos por defecto (hideOutOfStock = false)', () => {
      const result = filterAndSortItems(items, { hideOutOfStock: false })
      expect(result).toHaveLength(5)
      expect(countHiddenOutOfStockItems(items, { hideOutOfStock: false })).toBe(0)
    })

    it('oculta artículos con stock 0 y stock negativo cuando hideOutOfStock = true', () => {
      const result = filterAndSortItems(items, { hideOutOfStock: true })
      expect(result.map(i => i.id)).toEqual(['ok-1'])
      expect(countHiddenOutOfStockItems(items, { hideOutOfStock: true })).toBe(4)
    })

    it('NUNCA oculta un artículo que ya está en el carrito aunque su stock sea 0 o negativo', () => {
      const result = filterAndSortItems(items, {
        hideOutOfStock: true,
        cartItemIds: ['zero-cart', 'neg-cart'],
      })

      expect(result.map(i => i.id)).toEqual(['zero-cart', 'neg-cart', 'ok-1'])
      // Solo quedan ocultos los 2 artículos sin stock que NO están en el carrito
      expect(countHiddenOutOfStockItems(items, {
        hideOutOfStock: true,
        cartItemIds: ['zero-cart', 'neg-cart'],
      })).toBe(2)
    })
  })

  describe('Combinación completa (archivados + categoría + búsqueda + sin stock + carrito + orden)', () => {
    it('aplica los 5 pasos en orden sin mutar la entrada', () => {
      const items: Item[] = [
        makeItem({ id: 'arch', name: 'Llavero Archivado', categoryId: 'cat-llaveros', stock: 10, archived: true }),
        makeItem({ id: 'other-cat', name: 'Llavero de otra cat', categoryId: 'cat-pendientes', stock: 5 }),
        makeItem({ id: 'no-match', name: 'Pulsera Roja', categoryId: 'cat-llaveros', stock: 5 }),
        makeItem({ id: 'out-1', name: 'Llavero Árbol Agotado', categoryId: 'cat-llaveros', stock: 0 }),
        makeItem({ id: 'out-cart', name: 'Llavero Árbol en Carrito', categoryId: 'cat-llaveros', stock: -1 }),
        makeItem({ id: 'in-10', name: 'Llavero Árbol 10', categoryId: 'cat-llaveros', stock: 2 }),
        makeItem({ id: 'in-2', name: 'Llavero arbol 2', categoryId: 'cat-llaveros', stock: 2 }),
        makeItem({ id: 'in-high', name: 'Llavero Árbol Grande', categoryId: 'cat-llaveros', stock: 7 }),
      ]
      const snapshot = JSON.stringify(items)

      const options = {
        categoryId: 'cat-llaveros',
        query: '  ÁRBOL ',
        hideOutOfStock: true,
        cartItemIds: ['out-cart'],
        sort: 'stock-asc' as const,
      }

      const result = filterAndSortItems(items, options)
      expect(result.map(i => i.id)).toEqual([
        'out-cart', // stock -1 (visible porque está en el carrito)
        'in-2',     // stock 2 ("Llavero arbol 2" antes que "Llavero Árbol 10")
        'in-10',    // stock 2
        'in-high',  // stock 7
      ])

      // Solo 'out-1' fue ocultado por el filtro de sin stock (dentro de la categoría y búsqueda)
      expect(countHiddenOutOfStockItems(items, options)).toBe(1)

      // No muta el array original
      expect(JSON.stringify(items)).toBe(snapshot)
    })
  })
})
