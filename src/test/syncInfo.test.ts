import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSyncInfo } from '@/hooks/useSyncInfo'
import { db, SCHEMA_VERSION, META_KEY } from '@/db/db'

describe('useSyncInfo (RF-C9, C4)', () => {
  beforeEach(async () => {
    await db.meta.clear()
    await db.meta.put({
      id: META_KEY,
      schemaVersion: SCHEMA_VERSION,
      deviceId: 'dev-1',
      lastSyncedRevision: 0,
    })
  })

  afterEach(async () => {
    await db.meta.clear()
  })

  it('inicia con "Nunca sincronizado" cuando no hay lastSyncedAt', async () => {
    let resultRef!: { current: ReturnType<typeof useSyncInfo> }
    await act(async () => {
      const { result } = renderHook(() => useSyncInfo())
      resultRef = result
    })

    expect(resultRef.current.formattedRelative).toBe('Nunca sincronizado')
    expect(resultRef.current.lastSyncedRevision).toBe(0)
  })

  it('refleja la última sincronización al actualizar el registro meta', async () => {
    let resultRef!: { current: ReturnType<typeof useSyncInfo> }
    await act(async () => {
      const { result } = renderHook(() => useSyncInfo())
      resultRef = result
    })

    const nowIso = new Date().toISOString()
    await db.meta.update(META_KEY, {
      lastSyncedRevision: 3,
      lastSyncedAt: nowIso,
    })

    await act(async () => {
      await resultRef.current.refreshSyncInfo()
    })

    expect(resultRef.current.lastSyncedRevision).toBe(3)
    expect(resultRef.current.formattedRelative).toBe('Hace unos segundos')
  })

  it('actualiza automáticamente la cabecera al cambiar meta en la base de datos sin llamar a refreshSyncInfo en esa instancia (C4)', async () => {
    const { result } = renderHook(() => useSyncInfo())

    await waitFor(() => {
      expect(result.current.lastSyncedRevision).toBe(0)
    })

    const nowIso = new Date().toISOString()
    await act(async () => {
      await db.meta.update(META_KEY, {
        lastSyncedRevision: 5,
        lastSyncedAt: nowIso,
      })
    })

    await waitFor(
      () => {
        expect(result.current.lastSyncedRevision).toBe(5)
        expect(result.current.formattedRelative).toBe('Hace unos segundos')
      },
      { timeout: 400 },
    )
  })
})
