/**
 * Tipos centrales del dominio — fuente de verdad del modelo de datos.
 * Ref: SPEC.md sección 4.
 */

/** UUID v4 generado con crypto.randomUUID() */
export type ID = string

/**
 * Importe monetario en céntimos enteros de euro.
 * NUNCA usar float para importes. Ref: SPEC sección 3.
 */
export type Cents = number

export interface Category {
  id: ID
  name: string
  sortOrder: number
  archived: boolean
}

export interface Item {
  id: ID
  name: string
  categoryId: ID
  priceCents: Cents
  stock: number           // entero >= 0 en condiciones normales (RN-3: puede ser negativo)
  imageThumb?: string     // data URL JPEG, máx. 256 px lado mayor, calidad ~0.7
  archived: boolean
  createdAt: string       // ISO 8601 UTC
  updatedAt: string       // ISO 8601 UTC
}

export interface SaleLine {
  itemId: ID
  nameSnapshot: string      // nombre del artículo en el momento de la venta (RN-7)
  categoryIdSnapshot: ID    // categoría en el momento de la venta
  unitPriceCents: Cents     // precio de lista en el momento de la venta
  quantity: number          // entero >= 1
  lineListCents: Cents      // unitPriceCents * quantity
  lineDiscountCents: Cents  // parte del descuento asignada a esta línea (RN-5)
  lineNetCents: Cents       // lineListCents - lineDiscountCents
}

export interface Sale {
  id: ID
  createdAt: string         // ISO 8601 UTC
  lines: SaleLine[]
  subtotalCents: Cents      // suma de lineListCents
  discountCents: Cents      // 0 si no hay descuento
  totalCents: Cents         // subtotalCents - discountCents (lo realmente cobrado)
  status: 'active' | 'voided'
  voidedAt?: string         // ISO 8601 UTC, solo si status === 'voided'
  voidReason?: 'undo' | 'manual' // Motivo de anulación (retrocompatible: ausente = 'manual')
}

export interface StockAdjustment {
  id: ID
  createdAt: string         // ISO 8601 UTC
  itemId: ID
  delta: number             // entero, puede ser negativo
  reason: 'initial' | 'restock' | 'correction' | 'loss' | 'other'
  note?: string
}

/** Una sola fila en la tabla meta (clave fija 'main') — configuración y estado de sincronización */
export interface Meta {
  id: 'main'
  schemaVersion: number
  deviceId: ID              // identifica esta instalación
  lastSyncedRevision: number // última revisión de Drive conocida
  lastSyncedAt?: string     // ISO 8601 UTC
  driveFileId?: string      // ID del archivo en Google Drive
  lowStockThreshold?: number // Umbral local de aviso de poco stock (por defecto 2, RF-E7)
  saleSort?: 'name-asc' | 'name-desc' | 'stock-asc' | 'stock-desc' // Preferencia local de orden en venta
  hideOutOfStock?: boolean  // Preferencia local para ocultar artículos sin stock en venta
}

/** Copia de seguridad local guardada antes de importar/restaurar (SPEC sección 7) */
export interface LocalBackup {
  id: ID
  createdAt: string         // ISO 8601 UTC
  schemaVersion: number
  data: string              // JSON serializado de toda la base de datos
  reason: 'before-import' | 'before-restore' | 'before-migration' | 'before-reset'
}
