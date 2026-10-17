import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSyncInfo } from '@/hooks/useSyncInfo'
import { db } from '@/db/db'

describe('useSyncInfo (RF-C9)', () => {
  beforeEach(async () => {
    await db.meta.clear()
    await db.meta.add({
      schemaVersion: 1,
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
    await db.meta.update(1, {
      lastSyncedRevision: 3,
      lastSyncedAt: nowIso,
    })

    await act(async () => {
      await resultRef.current.refreshSyncInfo()
    })

    expect(resultRef.current.lastSyncedRevision).toBe(3)
    expect(resultRef.current.formattedRelative).toBe('Hace unos segundos')
  })
})
