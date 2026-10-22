import { useState, useEffect, useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, META_KEY } from '@/db/db'
import { getLocalMeta, formatLastSyncRelative } from '@/services/drive/driveSyncService'
import type { Meta } from '@/types'

/**
 * useSyncInfo — Hook reactivo para consultar y formatear el estado de sincronización con Google Drive (RF-C9, C4).
 * Reutiliza `useLiveQuery` sobre `db.meta` para que cualquier actualización desde Ajustes
 * refresque automáticamente la cabecera de la aplicación sin eventos manuales.
 */
export function useSyncInfo() {
  const liveMeta = useLiveQuery(() => db.meta.get(META_KEY), [])
  const [manualMeta, setManualMeta] = useState<Meta | null>(null)
  const [, setTick] = useState(0)

  const refreshSyncInfo = useCallback(async () => {
    try {
      const current = await getLocalMeta()
      setManualMeta(current)
      setTick((t) => t + 1)
    } catch {
      // Ignorar errores en entorno sin db
    }
  }, [])

  useEffect(() => {
    // Actualizar el texto relativo cada 30 segundos
    const timer = setInterval(() => {
      setTick((t) => t + 1)
    }, 30000)

    return () => clearInterval(timer)
  }, [])

  const meta: Meta | null = liveMeta ?? manualMeta
  const formattedRelative = formatLastSyncRelative(meta?.lastSyncedAt)

  return {
    meta,
    lastSyncedAt: meta?.lastSyncedAt,
    lastSyncedRevision: meta?.lastSyncedRevision ?? 0,
    formattedRelative,
    refreshSyncInfo,
  }
}
