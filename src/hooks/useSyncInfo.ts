import { useState, useEffect, useCallback } from 'react'
import { getLocalMeta, formatLastSyncRelative } from '@/services/drive/driveSyncService'
import type { Meta } from '@/types'

/**
 * useSyncInfo — Hook para consultar y formatear el estado de sincronización con Google Drive (RF-C9).
 */
export function useSyncInfo() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [relativeText, setRelativeText] = useState<string>('Nunca sincronizado')

  const refreshSyncInfo = useCallback(async () => {
    try {
      const current = await getLocalMeta()
      setMeta(current)
      setRelativeText(formatLastSyncRelative(current.lastSyncedAt))
    } catch {
      // Ignorar errores en entorno sin db
    }
  }, [])

  useEffect(() => {
    refreshSyncInfo()

    // Actualizar el texto relativo cada 30 segundos
    const timer = setInterval(() => {
      setMeta((prev) => {
        if (prev) {
          setRelativeText(formatLastSyncRelative(prev.lastSyncedAt))
        }
        return prev
      })
    }, 30000)

    return () => clearInterval(timer)
  }, [refreshSyncInfo])

  return {
    meta,
    lastSyncedAt: meta?.lastSyncedAt,
    lastSyncedRevision: meta?.lastSyncedRevision ?? 0,
    formattedRelative: relativeText,
    refreshSyncInfo,
  }
}
