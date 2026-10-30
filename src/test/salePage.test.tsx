import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

  describe('Modo de vista lista / expositor (RF-V1, RF-V2)', () => {
    it('sin preferencia guardada (o con un valor inválido), se muestra la vista lista por defecto', async () => {
      const { unmount } = render(<SalePage />)

      await waitFor(() => {
        expect(screen.getByText('Árbol de la vida')).toBeInTheDocument()
      })

      const viewToggleBtn = screen.getByRole('button', {
        name: 'Alternar entre vista lista y vista expositor',
      })
      expect(viewToggleBtn).toHaveAttribute('aria-pressed', 'false')
      expect(viewToggleBtn).toHaveTextContent('Vista lista')
      expect(screen.getByTestId('sale-items-list')).toBeInTheDocument()
      expect(screen.queryByTestId('sale-items-grid')).not.toBeInTheDocument()

      unmount()

      // Guardar un valor inválido en meta y comprobar que se usa la vista lista por defecto
      await db.meta.update(META_KEY, {
        saleViewMode: 'modo-invalido' as unknown as 'list',
      })

      render(<SalePage />)
      await waitFor(() => {
        expect(screen.getByText('Árbol de la vida')).toBeInTheDocument()
      })

      const remountedBtn = screen.getByRole('button', {
        name: 'Alternar entre vista lista y vista expositor',
      })
      expect(remountedBtn).toHaveAttribute('aria-pressed', 'false')
      expect(remountedBtn).toHaveTextContent('Vista lista')
      expect(screen.getByTestId('sale-items-list')).toBeInTheDocument()
    })

    it('el botón de alternancia cambia entre vista lista y vista expositor y recuerda el modo tras remontar', async () => {
      const { unmount } = render(<SalePage />)

      await waitFor(() => {
        expect(screen.getByText('Árbol de la vida')).toBeInTheDocument()
      })

      const viewToggleBtn = screen.getByRole('button', {
        name: 'Alternar entre vista lista y vista expositor',
      })
      expect(viewToggleBtn).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByTestId('sale-items-list')).toBeInTheDocument()

      // Cambiar a vista expositor
      fireEvent.click(viewToggleBtn)

      await waitFor(async () => {
        expect(viewToggleBtn).toHaveAttribute('aria-pressed', 'true')
        expect(viewToggleBtn).toHaveTextContent('Vista expositor')
        expect(screen.getByTestId('sale-items-grid')).toBeInTheDocument()
        const savedMeta = await db.meta.get(META_KEY)
        expect(savedMeta?.saleViewMode).toBe('grid')
      })

      unmount()

      // Remontar la pantalla y comprobar que recupera la vista expositor
      render(<SalePage />)

      await waitFor(() => {
        expect(screen.getByTestId('sale-items-grid')).toBeInTheDocument()
      })

      const remountedBtn = screen.getByRole('button', {
        name: 'Alternar entre vista lista y vista expositor',
      })
      expect(remountedBtn).toHaveAttribute('aria-pressed', 'true')
      expect(remountedBtn).toHaveTextContent('Vista expositor')

      // Volver a pulsar cambia a vista lista
      fireEvent.click(remountedBtn)
      await waitFor(() => {
        expect(remountedBtn).toHaveAttribute('aria-pressed', 'false')
        expect(screen.getByTestId('sale-items-list')).toBeInTheDocument()
      })
    })

    it('en vista expositor, pulsar + y − modifica el carrito igual que en la lista, y tocar fuera de los botones no añade nada', async () => {
      render(<SalePage />)

      await waitFor(() => {
        expect(screen.getByText('Zorro de madera')).toBeInTheDocument()
      })

      const viewToggleBtn = screen.getByRole('button', {
        name: 'Alternar entre vista lista y vista expositor',
      })
      fireEvent.click(viewToggleBtn)

      await waitFor(() => {
        expect(screen.getByTestId('sale-items-grid')).toBeInTheDocument()
      })

      const card = screen.getByRole('group', { name: 'Zorro de madera' })
      expect(card).toHaveAttribute('data-in-cart', 'false')
      expect(within(card).getByTestId('card-cart-quantity')).toHaveTextContent('0')

      // Tocar la tarjeta, el título o el marcador fuera de los botones NO añade nada al carrito
      fireEvent.click(card)
      fireEvent.click(within(card).getByRole('heading', { level: 3, name: 'Zorro de madera' }))
      fireEvent.click(within(card).getByTestId('item-image-placeholder'))

      expect(within(card).getByTestId('card-cart-quantity')).toHaveTextContent('0')
      expect(card).toHaveAttribute('data-in-cart', 'false')

      // Pulsar + añade al carrito
      const addBtn = within(card).getByRole('button', {
        name: 'Añadir una unidad de Zorro de madera',
      })
      const removeBtn = within(card).getByRole('button', {
        name: 'Quitar una unidad de Zorro de madera',
      })
      expect(removeBtn).toBeDisabled()

      fireEvent.click(addBtn)
      expect(within(card).getByTestId('card-cart-quantity')).toHaveTextContent('1')
      expect(card).toHaveAttribute('data-in-cart', 'true')
      expect(removeBtn).not.toBeDisabled()

      fireEvent.click(addBtn)
      expect(within(card).getByTestId('card-cart-quantity')).toHaveTextContent('2')

      // Cambiar a vista lista conserva el carrito intacto
      fireEvent.click(viewToggleBtn)
      await waitFor(() => {
        expect(screen.getByTestId('sale-items-list')).toBeInTheDocument()
      })

      // Volver a vista expositor y pulsar − reduce la cantidad
      fireEvent.click(viewToggleBtn)
      const cardAgain = await screen.findByRole('group', { name: 'Zorro de madera' })
      const removeBtnAgain = within(cardAgain).getByRole('button', {
        name: 'Quitar una unidad de Zorro de madera',
      })
      fireEvent.click(removeBtnAgain)
      expect(within(cardAgain).getByTestId('card-cart-quantity')).toHaveTextContent('1')

      fireEvent.click(removeBtnAgain)
      expect(within(cardAgain).getByTestId('card-cart-quantity')).toHaveTextContent('0')
      expect(cardAgain).toHaveAttribute('data-in-cart', 'false')
    })

    it('los filtros, la búsqueda y el orden se aplican igual en ambas vistas y se conservan al alternar', async () => {
      render(<SalePage />)

      await waitFor(() => {
        expect(screen.getByText('Árbol de la vida')).toBeInTheDocument()
      })

      const searchInput = screen.getByLabelText('Buscar artículo por nombre')
      const sortSelect = screen.getByLabelText('Ordenar artículos')
      const hideOutOfStockBtn = screen.getByRole('button', {
        name: 'Ocultar artículos sin stock de la lista de venta',
      })
      const viewToggleBtn = screen.getByRole('button', {
        name: 'Alternar entre vista lista y vista expositor',
      })

      // Aplicar búsqueda "llavero", orden Z -> A y ocultar sin stock en vista lista
      fireEvent.change(searchInput, { target: { value: 'llavero' } })
      fireEvent.change(sortSelect, { target: { value: 'name-desc' } })

      const listNamesBeforeOutToggle = screen
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
      expect(listNamesBeforeOutToggle).toEqual(['Llavero 10', 'Llavero 2'])

      // Cambiar a vista expositor: conserva búsqueda y orden exactamente igual
      fireEvent.click(viewToggleBtn)
      await waitFor(() => {
        expect(screen.getByTestId('sale-items-grid')).toBeInTheDocument()
      })
      expect((searchInput as HTMLInputElement).value).toBe('llavero')
      const gridNamesBeforeOutToggle = screen
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
      expect(gridNamesBeforeOutToggle).toEqual(['Llavero 10', 'Llavero 2'])

      // Activar ocultar sin stock en vista expositor: oculta "Llavero 10" igual que en la lista
      fireEvent.click(hideOutOfStockBtn)
      await waitFor(() => {
        expect(hideOutOfStockBtn).toHaveAttribute('aria-pressed', 'true')
      })
      expect(
        screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
      ).toEqual(['Llavero 2'])
    })

    it('muestra el marcador con inicial cuando no hay imagen, la etiqueta Agotado cuando stock <= 0 y aviso RN-3 al superar stock', async () => {
      await createItem(
        {
          name: 'Collar con foto',
          categoryId,
          priceCents: 1000,
          stockInitial: 3,
          imageThumb: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        },
        db,
      )

      render(<SalePage />)

      const viewToggleBtn = await screen.findByRole('button', {
        name: 'Alternar entre vista lista y vista expositor',
      })
      fireEvent.click(viewToggleBtn)

      await waitFor(() => {
        expect(screen.getByTestId('sale-items-grid')).toBeInTheDocument()
      })

      // 1. Artículo sin imagen muestra el marcador con la inicial "Á"
      const cardNoImage = screen.getByRole('group', { name: 'Árbol de la vida' })
      const placeholder = within(cardNoImage).getByTestId('item-image-placeholder')
      expect(placeholder).toHaveTextContent('Á')
      // Además tiene stock 2 (<= umbral por defecto 2), por lo que muestra la marca discreta de stock bajo
      expect(within(cardNoImage).getByTestId('low-stock-badge')).toBeInTheDocument()

      // 2. Artículo con imagen muestra <img> con loading="lazy" y decoding="async"
      const cardWithImage = screen.getByRole('group', { name: 'Collar con foto' })
      const img = within(cardWithImage).getByRole('img', { name: 'Collar con foto' })
      expect(img).toHaveAttribute('loading', 'lazy')
      expect(img).toHaveAttribute('decoding', 'async')
      expect(within(cardWithImage).queryByTestId('item-image-placeholder')).not.toBeInTheDocument()

      // 3. Artículo agotado ("Llavero 10", stock 0) muestra la etiqueta "Agotado" y permite añadirse con aviso RN-3
      const cardOutOfStock = screen.getByRole('group', { name: 'Llavero 10' })
      expect(within(cardOutOfStock).getByTestId('out-of-stock-badge')).toHaveTextContent('Agotado')

      const addOutBtn = within(cardOutOfStock).getByRole('button', {
        name: 'Añadir una unidad de Llavero 10',
      })
      fireEvent.click(addOutBtn)
      expect(
        within(cardOutOfStock).getByText('Cantidad supera el stock disponible'),
      ).toBeInTheDocument()
    })
  })
})
