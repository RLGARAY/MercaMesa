import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db, initDB, META_KEY } from '@/db/db'
import { createItem } from '@/services/itemService'
import { getActiveCategories } from '@/services/categoryService'
import { CART_STORAGE_KEY } from '@/services/backupService'
import SalePage from '@/features/sale/SalePage'

describe('SalePage — Buscador, orden e interruptor de sin stock (RF-V2)', () => {
  let categoryId: string

  beforeEach(async () => {
    localStorage.removeItem(CART_STORAGE_KEY)
    await db.items.clear()
    await db.categories.clear()
    await db.sales.clear()
    await db.adjustments.clear()
    await db.meta.clear()
    await initDB(db)

    const cats = await getActiveCategories(db)
    categoryId = cats[0]!.id

    // Insertar artículos en orden NO alfabético para comprobar el orden por defecto
    await createItem(
      {
        name: 'Zorro de madera',
        categoryId,
        priceCents: 1200,
        stockInitial: 5,
      },
      db,
    )
    await createItem(
      {
        name: 'Llavero 10',
        categoryId,
        priceCents: 600,
        stockInitial: 0, // Sin stock
      },
      db,
    )
    await createItem(
      {
        name: 'Árbol de la vida',
        categoryId,
        priceCents: 1500,
        stockInitial: 2,
      },
      db,
    )
    await createItem(
      {
        name: 'Llavero 2',
        categoryId,
        priceCents: 600,
        stockInitial: 8,
      },
      db,
    )
  })

  it('sin preferencia guardada (o con un valor inválido), la lista aparece ordenada por Nombre A → Z', async () => {
    const { unmount } = render(<SalePage />)

    await waitFor(() => {
      expect(screen.getByText('Árbol de la vida')).toBeInTheDocument()
    })

    const getRenderedNames = () =>
      screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)

    // Orden natural A → Z por defecto ("Árbol de la vida", "Llavero 2", "Llavero 10", "Zorro de madera")
    expect(getRenderedNames()).toEqual([
      'Árbol de la vida',
      'Llavero 2',
      'Llavero 10',
      'Zorro de madera',
    ])

    unmount()

    // Guardar un valor inválido en meta y comprobar que se usa Nombre A → Z
    await db.meta.update(META_KEY, {
      saleSort: 'valor-invalido' as unknown as 'name-asc',
    })

    render(<SalePage />)
    await waitFor(() => {
      expect(screen.getByText('Árbol de la vida')).toBeInTheDocument()
    })

    const sortSelect = screen.getByLabelText('Ordenar artículos') as HTMLSelectElement
    expect(sortSelect.value).toBe('name-asc')
    expect(getRenderedNames()).toEqual([
      'Árbol de la vida',
      'Llavero 2',
      'Llavero 10',
      'Zorro de madera',
    ])
  })

  it('escribir en el buscador filtra la lista (sin distinguir acentos ni mayúsculas) y permite limpiar cuando no hay resultados', async () => {
    render(<SalePage />)

    await waitFor(() => {
      expect(screen.getByText('Árbol de la vida')).toBeInTheDocument()
    })

    const searchInput = screen.getByLabelText('Buscar artículo por nombre')

    // Buscar "arbol" sin tilde debe encontrar "Árbol de la vida"
    fireEvent.change(searchInput, { target: { value: '  arbol ' } })

    expect(screen.getByText('Árbol de la vida')).toBeInTheDocument()
    expect(screen.queryByText('Zorro de madera')).not.toBeInTheDocument()
    expect(screen.queryByText('Llavero 2')).not.toBeInTheDocument()

    // Búsqueda sin resultados muestra mensaje claro y botón para limpiar
    fireEvent.change(searchInput, { target: { value: ' inexistente ' } })

    expect(
      screen.getByText('Ningún artículo coincide con «inexistente»'),
    ).toBeInTheDocument()

    const clearBtn = screen.getByRole('button', { name: 'Limpiar búsqueda' })
    fireEvent.click(clearBtn)

    expect((searchInput as HTMLInputElement).value).toBe('')
    expect(screen.getByText('Árbol de la vida')).toBeInTheDocument()
    expect(screen.getByText('Zorro de madera')).toBeInTheDocument()
  })

  it('el interruptor oculta y vuelve a mostrar los artículos sin stock, salvo los que ya están en el carrito', async () => {
    render(<SalePage />)

    await waitFor(() => {
      expect(screen.getByText('Llavero 10')).toBeInTheDocument()
    })

    const toggleBtn = screen.getByRole('button', {
      name: 'Ocultar artículos sin stock de la lista de venta',
    })
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false')
    expect(toggleBtn).toHaveTextContent('Sin stock: visibles')

    // Activar ocultar sin stock: "Llavero 10" (stock 0) se oculta
    fireEvent.click(toggleBtn)

    await waitFor(() => {
      expect(toggleBtn).toHaveAttribute('aria-pressed', 'true')
    })
    expect(toggleBtn).toHaveTextContent('Sin stock: ocultos')
    expect(screen.queryByText('Llavero 10')).not.toBeInTheDocument()
    expect(screen.getByText('1 artículo sin stock oculto')).toBeInTheDocument()

    // Volver a pulsar el interruptor: se vuelve a mostrar "Llavero 10"
    fireEvent.click(toggleBtn)

    await waitFor(() => {
      expect(toggleBtn).toHaveAttribute('aria-pressed', 'false')
    })
    expect(screen.getByText('Llavero 10')).toBeInTheDocument()
    expect(screen.queryByText('1 artículo sin stock oculto')).not.toBeInTheDocument()

    // Añadir "Llavero 10" (stock 0) al carrito y volver a activar ocultar sin stock:
    // NO debe ocultarse porque está en el carrito
    const addOutOfStockBtn = screen.getByRole('button', { name: 'Añadir 1 Llavero 10' })
    fireEvent.click(addOutOfStockBtn)

    fireEvent.click(toggleBtn)
    await waitFor(() => {
      expect(toggleBtn).toHaveAttribute('aria-pressed', 'true')
    })
    // Sigue visible en la lista principal de artículos (heading h3) porque está en el carrito
    expect(
      screen.getByRole('heading', { level: 3, name: 'Llavero 10' }),
    ).toBeInTheDocument()
  })

  it('recupera las preferencias de orden y de sin stock tras desmontar y volver a montar la pantalla', async () => {
    const { unmount } = render(<SalePage />)

    await waitFor(() => {
      expect(screen.getByText('Árbol de la vida')).toBeInTheDocument()
    })

    const sortSelect = screen.getByLabelText('Ordenar artículos') as HTMLSelectElement
    const toggleBtn = screen.getByRole('button', {
      name: 'Ocultar artículos sin stock de la lista de venta',
    })

    // Cambiar orden a "Stock: de más a menos" y activar "Sin stock: ocultos"
    fireEvent.change(sortSelect, { target: { value: 'stock-desc' } })
    fireEvent.click(toggleBtn)

    await waitFor(async () => {
      const savedMeta = await db.meta.get(META_KEY)
      expect(savedMeta?.saleSort).toBe('stock-desc')
      expect(savedMeta?.hideOutOfStock).toBe(true)
    })

    unmount()

    // Remontar la pantalla en una nueva sesión simulada
    render(<SalePage />)

    await waitFor(() => {
      expect(screen.getByText('Llavero 2')).toBeInTheDocument()
      expect(
        (screen.getByLabelText('Ordenar artículos') as HTMLSelectElement).value,
      ).toBe('stock-desc')
    })

    const remountedToggle = screen.getByRole('button', {
      name: 'Ocultar artículos sin stock de la lista de venta',
    })
    expect(remountedToggle).toHaveAttribute('aria-pressed', 'true')
    expect(remountedToggle).toHaveTextContent('Sin stock: ocultos')

    // "Llavero 10" (stock 0) sigue oculto y el resto aparece ordenado de más stock a menos (8, 5, 2)
    const namesAfterRemount = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(namesAfterRemount).toEqual([
      'Llavero 2',        // stock 8
      'Zorro de madera',  // stock 5
      'Árbol de la vida', // stock 2
    ])
  })
})
