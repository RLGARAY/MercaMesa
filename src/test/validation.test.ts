import { describe, it, expect } from 'vitest'
import {
  validateItemName,
  validateItemPriceCents,
  validateAndParsePriceString,
  validateItemStock,
  validateAndParseStockString,
  validateCategoryName,
} from '@/domain/validation'

describe('validateItemName', () => {
  it('permite nombres válidos', () => {
    expect(validateItemName('Pendientes de aro')).toBeNull()
  })

  it('rechaza nombres vacíos o solo espacios', () => {
    expect(validateItemName('')).toBe('El nombre es obligatorio')
    expect(validateItemName('   ')).toBe('El nombre es obligatorio')
  })

  it('rechaza nombres de más de 100 caracteres', () => {
    const longName = 'a'.repeat(101)
    expect(validateItemName(longName)).toBe('El nombre no puede superar 100 caracteres')
  })
})

describe('validateItemPriceCents', () => {
  it('permite importes enteros > 0', () => {
    expect(validateItemPriceCents(1)).toBeNull()
    expect(validateItemPriceCents(150)).toBeNull()
    expect(validateItemPriceCents(5000)).toBeNull()
  })

  it('rechaza 0 o negativos', () => {
    expect(validateItemPriceCents(0)).toBe('El precio debe ser mayor que 0')
    expect(validateItemPriceCents(-100)).toBe('El precio debe ser mayor que 0')
  })

  it('rechaza valores no enteros', () => {
    expect(validateItemPriceCents(10.5)).toBe('El precio debe ser un número entero de céntimos')
  })
})

describe('validateAndParsePriceString', () => {
  it('parsea correctamente strings en euros a céntimos', () => {
    expect(validateAndParsePriceString('1,50')).toEqual({ cents: 150, error: null })
    expect(validateAndParsePriceString('2.00')).toEqual({ cents: 200, error: null })
    expect(validateAndParsePriceString('0.5')).toEqual({ cents: 50, error: null })
  })

  it('rechaza strings inválidos o precios <= 0', () => {
    expect(validateAndParsePriceString('abc').error).not.toBeNull()
    expect(validateAndParsePriceString('0').error).toBe('El precio debe ser mayor que 0')
    expect(validateAndParsePriceString('-2').error).toBe('El precio debe ser mayor que 0')
  })
})

describe('validateItemStock', () => {
  it('permite enteros >= 0', () => {
    expect(validateItemStock(0)).toBeNull()
    expect(validateItemStock(10)).toBeNull()
  })

  it('rechaza stock negativo', () => {
    expect(validateItemStock(-1)).toBe('El stock inicial no puede ser negativo')
  })

  it('rechaza no enteros', () => {
    expect(validateItemStock(2.5)).toBe('El stock debe ser un número entero')
  })
})

describe('validateAndParseStockString', () => {
  it('parsea enteros >= 0', () => {
    expect(validateAndParseStockString('5')).toEqual({ stock: 5, error: null })
    expect(validateAndParseStockString('0')).toEqual({ stock: 0, error: null })
  })

  it('rechaza cadenas vacías o no numéricas o negativas', () => {
    expect(validateAndParseStockString('').error).toBe('El stock es obligatorio')
    expect(validateAndParseStockString('abc').error).toBe('Introduce un número entero válido')
    expect(validateAndParseStockString('-3').error).toBe('El stock inicial no puede ser negativo')
  })
})

describe('validateCategoryName', () => {
  it('permite nombres válidos', () => {
    expect(validateCategoryName('Llaveros')).toBeNull()
  })

  it('rechaza nombres vacíos o mayores a 50 caracteres', () => {
    expect(validateCategoryName('')).toBe('El nombre de la categoría es obligatorio')
    expect(validateCategoryName('   ')).toBe('El nombre de la categoría es obligatorio')
    expect(validateCategoryName('c'.repeat(51))).toBe('El nombre no puede superar 50 caracteres')
  })
})
