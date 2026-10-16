/**
 * discount.ts — Lógica pura de cálculo y reparto de descuentos.
 *
 * Ref: SPEC.md sección 5 (RN-4 y RN-5).
 * REGLA INNEGOCIABLE:
 *   - Lógica pura sin dependencias de React ni Dexie.
 *   - Todo el dinero en céntimos enteros (Cents).
 *
 * Modos de descuento:
 *   - 'finalPrice': El usuario indica el precio final total que quiere cobrar.
 *                   discountCents = subtotalCents - finalPriceCents
 *   - 'euros':      El usuario indica una cantidad fija en euros de descuento.
 *                   discountCents = discountEurosCents
 *   - 'percent':    El usuario indica un porcentaje de descuento (0 a 100).
 *                   discountCents = Math.round(subtotalCents * (percent / 100))
 */

import type { Cents } from '@/types'

export type DiscountMode = 'finalPrice' | 'euros' | 'percent'

export interface RawDiscountInput {
  enabled: boolean
  mode: DiscountMode
  /**
   * Valor numérico introducido por el usuario según el modo:
   * - En 'finalPrice': importe en céntimos que se cobrará
   * - En 'euros': importe en céntimos que se descuenta
   * - En 'percent': porcentaje (ej: 10 para 10%, 25.5 para 25.5%)
   */
  value: number
}

export interface LineForDiscount {
  id: string
  lineListCents: Cents
}

export interface DistributedLineDiscount {
  id: string
  lineListCents: Cents
  lineDiscountCents: Cents
  lineNetCents: Cents
}

/**
 * Normaliza cualquier entrada de descuento a un importe entero en céntimos.
 * Aplica las reglas de RN-4:
 *   - Si enabled es false, discountCents = 0.
 *   - Restricción: 0 <= discountCents <= subtotalCents.
 *
 * @throws {Error} Si el valor es inválido o excede el subtotal.
 */
export function calculateDiscountCents(
  subtotalCents: Cents,
  input: RawDiscountInput,
): Cents {
  if (!input.enabled || subtotalCents <= 0) {
    return 0
  }

  let calculated = 0

  switch (input.mode) {
    case 'finalPrice': {
      // Valor en céntimos de lo que se desea cobrar
      const finalPrice = Math.round(input.value)
      if (finalPrice < 0) {
        throw new Error('El precio final no puede ser negativo')
      }
      if (finalPrice > subtotalCents) {
        throw new Error('El precio final no puede ser mayor que el subtotal')
      }
      calculated = subtotalCents - finalPrice
      break
    }
    case 'euros': {
      // Cantidad fija de descuento en céntimos
      calculated = Math.round(input.value)
      if (calculated < 0) {
        throw new Error('El descuento no puede ser negativo')
      }
      if (calculated > subtotalCents) {
        throw new Error('El descuento no puede superar el subtotal')
      }
      break
    }
    case 'percent': {
      const pct = input.value
      if (pct < 0 || pct > 100) {
        throw new Error('El porcentaje debe estar entre 0% y 100%')
      }
      // Redondeo al céntimo más cercano
      calculated = Math.round((subtotalCents * pct) / 100)
      // Clamping por seguridad
      calculated = Math.min(Math.max(0, calculated), subtotalCents)
      break
    }
    default:
      throw new Error('Modo de descuento no reconocido')
  }

  return calculated
}

/**
 * RN-5: Reparto del descuento entre líneas de venta (método del mayor resto / Hamilton-Hare).
 *
 * Pasos especificados en SPEC sección 5:
 *   1. Peso de cada línea = lineListCents / subtotalCents.
 *   2. Parte exacta = discountCents * lineListCents / subtotalCents.
 *   3. Se asigna la parte entera (floor) a cada línea.
 *   4. El resto de céntimos (discountCents - suma(floors)) se reparte de 1 en 1
 *      a las líneas con MAYOR parte decimal descartada. En empate, por orden de línea (índice original).
 *   5. Invariantes estrictos:
 *      - suma(lineDiscountCents) === discountCents
 *      - 0 <= lineDiscountCents <= lineListCents
 *      - suma(lineNetCents) === totalCents
 *
 * Si subtotalCents === 0 o discountCents === 0, todos los lineDiscountCents son 0.
 */
export function distributeDiscount(
  lines: LineForDiscount[],
  discountCents: Cents,
  subtotalCents: Cents,
): DistributedLineDiscount[] {
  if (lines.length === 0) {
    return []
  }

  // Si no hay subtotal o no hay descuento, cada línea tiene descuento 0
  if (subtotalCents <= 0 || discountCents <= 0) {
    return lines.map(line => ({
      id: line.id,
      lineListCents: line.lineListCents,
      lineDiscountCents: 0,
      lineNetCents: line.lineListCents,
    }))
  }

  // 1 y 2. Calcular parte exacta y separar floor y resto decimal
  interface LineCalculation {
    index: number
    id: string
    lineListCents: Cents
    floorDiscount: Cents
    decimalRemainder: number
  }

  let sumFloors = 0

  const calculations: LineCalculation[] = lines.map((line, index) => {
    // Parte exacta: discountCents * line.lineListCents / subtotalCents
    const exact = (discountCents * line.lineListCents) / subtotalCents
    const floor = Math.floor(exact)
    const remainder = exact - floor
    sumFloors += floor

    return {
      index,
      id: line.id,
      lineListCents: line.lineListCents,
      floorDiscount: floor,
      decimalRemainder: remainder,
    }
  })

  // 4. Céntimos restantes por repartir
  let remainingCents = discountCents - sumFloors

  // Ordenar por mayor resto decimal; en empate, por índice original ascendente (orden de línea)
  const sorted = [...calculations].sort((a, b) => {
    if (b.decimalRemainder !== a.decimalRemainder) {
      return b.decimalRemainder - a.decimalRemainder
    }
    return a.index - b.index
  })

  // Asignar los céntimos restantes
  const extraCentsByIndex = new Map<number, number>()
  for (let i = 0; i < sorted.length && remainingCents > 0; i++) {
    const item = sorted[i]!
    extraCentsByIndex.set(item.index, 1)
    remainingCents--
  }

  // 5. Reconstruir las líneas en el orden original y calcular importes netos
  return calculations.map((c) => {
    const extra = extraCentsByIndex.get(c.index) ?? 0
    let lineDiscount = c.floorDiscount + extra

    // Invariante de seguridad: no descontar más que el propio importe de lista de la línea
    lineDiscount = Math.min(lineDiscount, c.lineListCents)
    lineDiscount = Math.max(0, lineDiscount)

    const lineNet = c.lineListCents - lineDiscount

    return {
      id: c.id,
      lineListCents: c.lineListCents,
      lineDiscountCents: lineDiscount,
      lineNetCents: lineNet,
    }
  })
}
