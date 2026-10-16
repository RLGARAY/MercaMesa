import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MercaMesaDB, initDB } from '@/db/db'
import {
  getAllCategories,
  getActiveCategories,
  createCategory,
  renameCategory,
  archiveCategory,
  restoreCategory,
  reorderCategories,
} from '@/services/categoryService'
import { createItem } from '@/services/itemService'

describe('categoryService', () => {
  let testDb: MercaMesaDB

  beforeEach(async () => {
    testDb = new MercaMesaDB(`test-cat-${crypto.randomUUID()}`)
    await initDB(testDb)
  })

  afterEach(async () => {
    await testDb.delete()
  })

  it('initDB inicializa las 3 categorías por defecto (RN-9)', async () => {
    const cats = await getAllCategories(testDb)
    expect(cats).toHaveLength(3)
    expect(cats.map(c => c.name)).toEqual(['Pendientes', 'Llaveros', 'Láminas'])
    expect(cats.every(c => !c.archived)).toBe(true)
  })

  it('createCategory añade una categoría al final con sortOrder incremental', async () => {
    const nueva = await createCategory('Pegatinas', testDb)
    expect(nueva.name).toBe('Pegatinas')
    expect(nueva.sortOrder).toBe(3)
    expect(nueva.archived).toBe(false)

    const activas = await getActiveCategories(testDb)
    expect(activas).toHaveLength(4)
    expect(activas[3]?.name).toBe('Pegatinas')
  })

  it('createCategory lanza error con nombre inválido', async () => {
    await expect(createCategory('', testDb)).rejects.toThrow('El nombre de la categoría es obligatorio')
  })

  it('renameCategory actualiza el nombre', async () => {
    const cats = await getActiveCategories(testDb)
    const id = cats[0]!.id

    await renameCategory(id, 'Pendientes y Anillos', testDb)

    const updated = await testDb.categories.get(id)
    expect(updated?.name).toBe('Pendientes y Anillos')
  })

  it('archiveCategory falla si hay artículos activos en la categoría (RN-9)', async () => {
    const cats = await getActiveCategories(testDb)
    const catId = cats[0]!.id

    // Añadir artículo activo en esta categoría
    await createItem(
      {
        name: 'Pendiente luna',
        categoryId: catId,
        priceCents: 500,
        stockInitial: 3,
      },
      testDb,
    )

    await expect(archiveCategory(catId, testDb)).rejects.toThrow('No se puede archivar: la categoría tiene 1 artículo(s) activo(s)')
  })

  it('archiveCategory permite archivar si no hay artículos activos y restoreCategory la recupera', async () => {
    const cats = await getActiveCategories(testDb)
    const catId = cats[0]!.id

    await archiveCategory(catId, testDb)

    const activas = await getActiveCategories(testDb)
    expect(activas).toHaveLength(2)
    expect(activas.some(c => c.id === catId)).toBe(false)

    const todas = await getAllCategories(testDb)
    const archivada = todas.find(c => c.id === catId)
    expect(archivada?.archived).toBe(true)

    // Restaurar
    await restoreCategory(catId, testDb)
    const activasDespues = await getActiveCategories(testDb)
    expect(activasDespues).toHaveLength(3)
  })

  it('reorderCategories actualiza el sortOrder de las categorías', async () => {
    const cats = await getActiveCategories(testDb)
    const [c0, c1, c2] = cats

    // Invertir el orden
    await reorderCategories([c2!.id, c1!.id, c0!.id], testDb)

    const reordenadas = await getAllCategories(testDb)
    expect(reordenadas[0]?.id).toBe(c2!.id)
    expect(reordenadas[1]?.id).toBe(c1!.id)
    expect(reordenadas[2]?.id).toBe(c0!.id)
  })
})
