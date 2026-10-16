import { describe, it, expect } from 'vitest'
import {
  calculateDiscountCents,
  distributeDiscount,
  type LineForDiscount,
} from '@/domain/discount'

describe('calculateDiscountCents (RN-4)', () => {
  const subtotal = 1000 // 10,00 €

  it('devuelve 0 si enabled es false', () => {
    const res = calculateDiscountCents(subtotal, {
      enabled: false,
      mode: 'euros',
      value: 200,
    })
    expect(res).toBe(0)
  })

  it('devuelve 0 si subtotal es 0', () => {
    const res = calculateDiscountCents(0, {
      enabled: true,
      mode: 'euros',
      value: 100,
    })
    expect(res).toBe(0)
  })

  describe('modo finalPrice', () => {
    it('calcula discountCents = subtotal - finalPrice', () => {
      // Subtotal 10€, quiero cobrar 8€ -> descuento 2€
      const res = calculateDiscountCents(1000, {
        enabled: true,
        mode: 'finalPrice',
        value: 800,
      })
      expect(res).toBe(200)
    })

    it('permite precio final 0 (descuento total)', () => {
      const res = calculateDiscountCents(1000, {
        enabled: true,
        mode: 'finalPrice',
        value: 0,
      })
      expect(res).toBe(1000)
    })

    it('falla si el precio final es mayor que el subtotal', () => {
      expect(() =>
        calculateDiscountCents(1000, {
          enabled: true,
          mode: 'finalPrice',
          value: 1200,
        }),
      ).toThrow('El precio final no puede ser mayor que el subtotal')
    })

    it('falla si el precio final es negativo', () => {
      expect(() =>
        calculateDiscountCents(1000, {
          enabled: true,
          mode: 'finalPrice',
          value: -50,
        }),
      ).toThrow('El precio final no puede ser negativo')
    })
  })

  describe('modo euros', () => {
    it('toma la cantidad directa en céntimos', () => {
      const res = calculateDiscountCents(1500, {
        enabled: true,
        mode: 'euros',
        value: 250,
      })
      expect(res).toBe(250)
    })

    it('falla si supera el subtotal', () => {
      expect(() =>
        calculateDiscountCents(1000, {
          enabled: true,
          mode: 'euros',
          value: 1001,
        }),
      ).toThrow('El descuento no puede superar el subtotal')
    })

    it('falla si es negativo', () => {
      expect(() =>
        calculateDiscountCents(1000, {
          enabled: true,
          mode: 'euros',
          value: -1,
        }),
      ).toThrow('El descuento no puede ser negativo')
    })
  })

  describe('modo percent', () => {
    it('calcula porcentaje y redondea céntimos', () => {
      // 10% de 15,50 € (1550) = 155
      expect(
        calculateDiscountCents(1550, {
          enabled: true,
          mode: 'percent',
          value: 10,
        }),
      ).toBe(155)

      // 15% de 33,33 € (3333) = 499.95 -> 500
      expect(
        calculateDiscountCents(3333, {
          enabled: true,
          mode: 'percent',
          value: 15,
        }),
      ).toBe(500)
    })

    it('falla si el porcentaje es menor a 0 o mayor a 100', () => {
      expect(() =>
        calculateDiscountCents(1000, {
          enabled: true,
          mode: 'percent',
          value: -5,
        }),
      ).toThrow('El porcentaje debe estar entre 0% y 100%')

      expect(() =>
        calculateDiscountCents(1000, {
          enabled: true,
          mode: 'percent',
          value: 105,
        }),
      ).toThrow('El porcentaje debe estar entre 0% y 100%')
    })
  })
})

describe('distributeDiscount (RN-5 - Reparto del mayor resto)', () => {
  it('reparto con descuento 0 no modifica ninguna línea', () => {
    const lines: LineForDiscount[] = [
      { id: '1', lineListCents: 500 },
      { id: '2', lineListCents: 300 },
    ]
    const res = distributeDiscount(lines, 0, 800)
    expect(res).toEqual([
      { id: '1', lineListCents: 500, lineDiscountCents: 0, lineNetCents: 500 },
      { id: '2', lineListCents: 300, lineDiscountCents: 0, lineNetCents: 300 },
    ])
  })

  it('reparto exacto sin restos decimales', () => {
    // 2 líneas de 5€ cada una (subtotal 10€) con 2€ de descuento -> 1€ a cada una
    const lines: LineForDiscount[] = [
      { id: '1', lineListCents: 500 },
      { id: '2', lineListCents: 500 },
    ]
    const res = distributeDiscount(lines, 200, 1000)
    expect(res[0]?.lineDiscountCents).toBe(100)
    expect(res[1]?.lineDiscountCents).toBe(100)
    expect(res[0]?.lineNetCents).toBe(400)
    expect(res[1]?.lineNetCents).toBe(400)
  })

  it('reparto con resto: se asigna al de mayor parte decimal descartada', () => {
    // Línea 1: 300 (37.5%), Línea 2: 500 (62.5%). Subtotal = 800.
    // Descuento = 100 céntimos (1€).
    // Exacto L1: 100 * 300 / 800 = 37.5 -> floor = 37, decimal = 0.5
    // Exacto L2: 100 * 500 / 800 = 62.5 -> floor = 62, decimal = 0.5
    // En empate decimal (0.5 vs 0.5), el SPEC indica: por orden de línea (L1 se lleva el céntimo extra).
    // Suma floors = 99. Restante = 1.
    // L1 recibe +1 -> 38. L2 recibe 62. Suma = 100.
    const lines: LineForDiscount[] = [
      { id: '1', lineListCents: 300 },
      { id: '2', lineListCents: 500 },
    ]
    const res = distributeDiscount(lines, 100, 800)
    expect(res[0]?.lineDiscountCents).toBe(38)
    expect(res[1]?.lineDiscountCents).toBe(62)
    expect(res[0]?.lineDiscountCents + res[1]?.lineDiscountCents).toBe(100)
  })

  it('reparto con 3 líneas con diferentes decimales', () => {
    // Línea 1: 1000 (50%), Línea 2: 600 (30%), Línea 3: 400 (20%). Subtotal = 2000.
    // Descuento = 105 céntimos.
    // L1: 105 * 1000 / 2000 = 52.5 -> floor 52, decimal 0.5
    // L2: 105 * 600 / 2000 = 31.5 -> floor 31, decimal 0.5
    // L3: 105 * 400 / 2000 = 21.0 -> floor 21, decimal 0.0
    // Suma floors = 104. Resta 1 céntimo.
    // Decimales: L1=0.5, L2=0.5, L3=0.0.
    // Entre L1 y L2 empatan a 0.5; por orden de línea, L1 se lleva el +1.
    const lines: LineForDiscount[] = [
      { id: '1', lineListCents: 1000 },
      { id: '2', lineListCents: 600 },
      { id: '3', lineListCents: 400 },
    ]
    const res = distributeDiscount(lines, 105, 2000)
    expect(res[0]?.lineDiscountCents).toBe(53)
    expect(res[1]?.lineDiscountCents).toBe(31)
    expect(res[2]?.lineDiscountCents).toBe(21)
    expect(res.reduce((s, l) => s + l.lineDiscountCents, 0)).toBe(105)
  })

  it('caso límite: descuento = subtotal (todo gratis)', () => {
    const lines: LineForDiscount[] = [
      { id: '1', lineListCents: 450 },
      { id: '2', lineListCents: 150 },
    ]
    const res = distributeDiscount(lines, 600, 600)
    expect(res[0]?.lineDiscountCents).toBe(450)
    expect(res[1]?.lineDiscountCents).toBe(150)
    expect(res[0]?.lineNetCents).toBe(0)
    expect(res[1]?.lineNetCents).toBe(0)
  })

  it('caso límite: 1 sola línea', () => {
    const lines: LineForDiscount[] = [{ id: '1', lineListCents: 1200 }]
    const res = distributeDiscount(lines, 300, 1200)
    expect(res[0]?.lineDiscountCents).toBe(300)
    expect(res[0]?.lineNetCents).toBe(900)
  })

  // PROPERTY-BASED TEST / GENERACIÓN ALEATORIA (Exigido en "NOTAS ESPECÍFICAS POR ÁREA")
  it('cumple estrictamente todos los invariantes con 100 casos aleatorios', () => {
    // Generador determinista simple con semilla
    let seed = 42
    const random = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }

    for (let testCase = 0; testCase < 100; testCase++) {
      const numLines = Math.floor(random() * 8) + 1 // 1 a 8 líneas
      const lines: LineForDiscount[] = []
      let subtotal = 0

      for (let i = 0; i < numLines; i++) {
        // Importes entre 1 céntimo y 5000 céntimos (50€)
        const price = Math.floor(random() * 5000) + 1
        lines.push({ id: `item-${i}`, lineListCents: price })
        subtotal += price
      }

      // Descuento entre 0 y subtotal
      const discount = Math.floor(random() * (subtotal + 1))
      const totalExpected = subtotal - discount

      const result = distributeDiscount(lines, discount, subtotal)

      // Invariante 1: suma(lineDiscountCents) === discountCents
      const sumLineDiscounts = result.reduce((s, l) => s + l.lineDiscountCents, 0)
      expect(sumLineDiscounts).toBe(discount)

      // Invariante 2: 0 <= lineDiscountCents <= lineListCents para toda línea
      for (const line of result) {
        expect(line.lineDiscountCents).toBeGreaterThanOrEqual(0)
        expect(line.lineDiscountCents).toBeLessThanOrEqual(line.lineListCents)
        expect(line.lineNetCents).toBe(line.lineListCents - line.lineDiscountCents)
      }

      // Invariante 3: suma(lineNetCents) === totalCents
      const sumLineNet = result.reduce((s, l) => s + l.lineNetCents, 0)
      expect(sumLineNet).toBe(totalExpected)
    }
  })
})
