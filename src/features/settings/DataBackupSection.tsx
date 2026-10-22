import { useState, useEffect, useRef } from 'react'
import { UI } from '@/i18n'
import Modal from '@/components/Modal'
import {
  downloadBackupFile,
  parseAndValidateBackup,
  importBackupPayload,
  getLocalBackups,
  restoreLocalBackup,
  resetAllData,
  BackupQuotaError,
  type BackupPayload,
  type StockInconsistency,
} from '@/services/backupService'
import { repairStockInconsistencies } from '@/services/itemService'
import { checkStoragePersistence } from '@/utils/pwaUtils'
import { GoogleDriveClient } from '@/services/drive/driveClient'
import { requestGoogleAccessToken, hasGoogleClientId } from '@/services/drive/auth'
import {
  uploadToDrive,
  fetchDriveRestorePreview,
  applyDriveRestore,
  type DriveRestorePreview,
} from '@/services/drive/driveSyncService'
import { useSyncInfo } from '@/hooks/useSyncInfo'
import type { LocalBackup } from '@/types'

export default function DataBackupSection() {
  const [localBackups, setLocalBackups] = useState<LocalBackup[]>([])
  const [loading, setLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isStoragePersisted, setIsStoragePersisted] = useState<boolean | null>(null)

  // Información reactiva de sincronización con Google Drive
  const { lastSyncedRevision, formattedRelative, refreshSyncInfo } = useSyncInfo()

  // Estado para modal de importación desde archivo
  const [pendingPayload, setPendingPayload] = useState<BackupPayload | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Estado para modal de restauración de copia local
  const [backupToRestore, setBackupToRestore] = useState<LocalBackup | null>(null)

  // Estado para conflicto de revisión en Drive
  const [conflictData, setConflictData] = useState<{
    remoteRevision: number
    localRevision: number
    remoteFileId: string
  } | null>(null)

  // Estado para previsualización de restauración desde Drive
  const [driveRestorePreview, setDriveRestorePreview] = useState<DriveRestorePreview | null>(null)

  // Estado para modal de borrado total (zona de peligro)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('')

  // Estado para discrepancias de stock detectadas tras importar o restaurar (A2)
  const [postImportInconsistencies, setPostImportInconsistencies] = useState<StockInconsistency[]>([])

  // Estado para confirmación cuando localBackups falla por falta de espacio/cuota (E4)
  const [quotaErrorState, setQuotaErrorState] = useState<{
    message: string
    retryWithoutBackup: () => Promise<void>
  } | null>(null)

  const loadBackups = async () => {
    try {
      const list = await getLocalBackups()
      setLocalBackups(list)
    } catch {
      // Ignorar error al cargar historial
    }
  }

  useEffect(() => {
    loadBackups()
    checkStoragePersistence().then(setIsStoragePersisted)
  }, [])

  // Auto-ocultar mensaje de estado a los 5 segundos
  useEffect(() => {
    if (!statusMessage) return
    const timer = setTimeout(() => setStatusMessage(null), 5000)
    return () => clearTimeout(timer)
  }, [statusMessage])

  // 1. Exportar a archivo local
  const handleExport = async () => {
    try {
      setLoading(true)
      const fileName = await downloadBackupFile()
      setStatusMessage({
        type: 'success',
        text: `${UI.settings.exportSuccess} (${fileName})`,
      })
    } catch {
      setStatusMessage({
        type: 'error',
        text: UI.errors.generic,
      })
    } finally {
      setLoading(false)
    }
  }

  // 2. Selección de archivo JSON para importar
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      const result = parseAndValidateBackup(content)

      if (!result.valid) {
        setStatusMessage({
          type: 'error',
          text: result.error,
        })
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }

      setPendingPayload(result.payload)
    }

    reader.onerror = () => {
      setStatusMessage({
        type: 'error',
        text: UI.errors.importInvalid,
      })
      if (fileInputRef.current) fileInputRef.current.value = ''
    }

    reader.readAsText(file)
  }

  // Confirmar importación desde archivo local
  const handleConfirmImport = async (skipPreBackup = false) => {
    if (!pendingPayload) return
    try {
      setLoading(true)
      const summary = await importBackupPayload(pendingPayload, undefined, { skipPreBackup })
      setPendingPayload(null)
      setQuotaErrorState(null)
      setPostImportInconsistencies(summary.inconsistencies)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await loadBackups()
      await refreshSyncInfo()
      setStatusMessage({
        type: 'success',
        text: UI.settings.importSuccess,
      })
    } catch (err) {
      if (err instanceof BackupQuotaError && !skipPreBackup) {
        setQuotaErrorState({
          message: err.message,
          retryWithoutBackup: () => handleConfirmImport(true),
        })
        return
      }
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : UI.errors.generic,
      })
    } finally {
      setLoading(false)
    }
  }

  // 3. Confirmar restauración de copia local
  const handleConfirmRestore = async (skipPreBackup = false) => {
    if (!backupToRestore) return
    try {
      setLoading(true)
      const summary = await restoreLocalBackup(backupToRestore.id, undefined, { skipPreBackup })
      setBackupToRestore(null)
      setQuotaErrorState(null)
      setPostImportInconsistencies(summary.inconsistencies)
      await loadBackups()
      await refreshSyncInfo()
      setStatusMessage({
        type: 'success',
        text: UI.settings.importSuccess,
      })
    } catch (err) {
      if (err instanceof BackupQuotaError && !skipPreBackup) {
        setQuotaErrorState({
          message: err.message,
          retryWithoutBackup: () => handleConfirmRestore(true),
        })
        return
      }
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : UI.errors.generic,
      })
    } finally {
      setLoading(false)
    }
  }

  // 4. Sincronización con Google Drive: Subir datos (RF-C8)
  const handleDriveUpload = async (forceOverwrite = false) => {
    try {
      if (!hasGoogleClientId()) {
        setStatusMessage({
          type: 'error',
          text: 'Falta configurar VITE_GOOGLE_CLIENT_ID en el archivo .env (ver README).',
        })
        return
      }

      setLoading(true)
      const token = await requestGoogleAccessToken()
      const client = new GoogleDriveClient(token)
      const result = await uploadToDrive(client, { forceOverwrite })

      if (result.outcome === 'conflict') {
        setConflictData({
          remoteRevision: result.remoteRevision,
          localRevision: result.localRevision,
          remoteFileId: result.remoteFileId,
        })
        return
      }

      setConflictData(null)
      await refreshSyncInfo()
      setStatusMessage({
        type: 'success',
        text: `${UI.settings.driveUploadSuccess} (Revisión ${result.revision})`,
      })
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : UI.errors.driveError,
      })
    } finally {
      setLoading(false)
    }
  }

  // Sincronización con Google Drive: Previsualizar restauración (RF-C8)
  const handleDriveRestorePreview = async () => {
    try {
      if (!hasGoogleClientId()) {
        setStatusMessage({
          type: 'error',
          text: 'Falta configurar VITE_GOOGLE_CLIENT_ID en el archivo .env (ver README).',
        })
        return
      }

      setLoading(true)
      const token = await requestGoogleAccessToken()
      const client = new GoogleDriveClient(token)
      const preview = await fetchDriveRestorePreview(client)
      setDriveRestorePreview(preview)
      setConflictData(null)
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : UI.errors.driveError,
      })
    } finally {
      setLoading(false)
    }
  }

  // Sincronización con Google Drive: Confirmar restauración
  const handleConfirmDriveRestore = async (skipPreBackup = false) => {
    if (!driveRestorePreview) return
    try {
      setLoading(true)
      const summary = await applyDriveRestore(driveRestorePreview, undefined, { skipPreBackup })
      setDriveRestorePreview(null)
      setQuotaErrorState(null)
      setPostImportInconsistencies(summary.inconsistencies)
      await refreshSyncInfo()
      await loadBackups()
      setStatusMessage({
        type: 'success',
        text: UI.settings.driveRestoreSuccess,
      })
    } catch (err) {
      if (err instanceof BackupQuotaError && !skipPreBackup) {
        setQuotaErrorState({
          message: err.message,
          retryWithoutBackup: () => handleConfirmDriveRestore(true),
        })
        return
      }
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : UI.errors.generic,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleRepairPostImport = async () => {
    try {
      setLoading(true)
      await repairStockInconsistencies()
      setPostImportInconsistencies([])
      setStatusMessage({
        type: 'success',
        text: 'Discrepancias de inventario reparadas correctamente.',
      })
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : UI.errors.generic,
      })
    } finally {
      setLoading(false)
    }
  }

  // 5. Confirmar reseteo total (zona de peligro RF-C11)
  const handleConfirmDeleteAll = async (skipPreBackup = false) => {
    if (deleteConfirmationText.trim().toUpperCase() !== 'BORRAR') return
    try {
      setLoading(true)
      await resetAllData(undefined, { skipPreBackup })
      setShowDeleteModal(false)
      setQuotaErrorState(null)
      setDeleteConfirmationText('')
      await loadBackups()
      await refreshSyncInfo()
      setStatusMessage({
        type: 'success',
        text: UI.settings.resetSuccess,
      })
    } catch (err) {
      if (err instanceof BackupQuotaError && !skipPreBackup) {
        setQuotaErrorState({
          message: err.message,
          retryWithoutBackup: () => handleConfirmDeleteAll(true),
        })
        return
      }
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : UI.errors.generic,
      })
    } finally {
      setLoading(false)
    }
  }

  const getReasonLabel = (reason: LocalBackup['reason']) => {
    switch (reason) {
      case 'before-import':
        return 'Antes de importar archivo'
      case 'before-restore':
        return 'Antes de restaurar copia'
      case 'before-reset':
        return 'Antes de borrar datos'
      case 'before-migration':
        return 'Antes de migrar esquema'
      default:
        return reason
    }
  }

  return (
    <div className="space-y-6 text-left">
      {/* Mensaje de alerta / estado */}
      {statusMessage && (
        <div
          role="alert"
          className={`p-3.5 rounded-xl border text-sm font-medium transition-all ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {statusMessage.type === 'success' ? '✅ ' : '⚠️ '}
          {statusMessage.text}
        </div>
      )}

      {/* Informe de discrepancias de stock tras importar/restaurar con botón explícito (A2) */}
      {postImportInconsistencies.length > 0 && (
        <div
          role="alert"
          className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs space-y-3"
        >
          <div className="font-bold text-amber-800">
            ⚠️ Se han detectado {postImportInconsistencies.length} discrepancia(s) de stock en los datos importados:
          </div>
          <div className="divide-y divide-amber-200/60">
            {postImportInconsistencies.map(({ item, expected, actual }) => (
              <div key={item.id} className="py-1.5 flex items-center justify-between">
                <span className="font-semibold text-gray-900">{item.name}</span>
                <span className="text-[11px] text-gray-700">
                  Esperado: <strong>{expected}</strong> · En archivo: <strong>{actual}</strong>
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleRepairPostImport}
              disabled={loading}
              className="flex-1 min-h-12 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl px-3 py-2 transition-colors disabled:opacity-50"
            >
              Reparar discrepancias
            </button>
            <button
              type="button"
              onClick={() => setPostImportInconsistencies([])}
              disabled={loading}
              className="min-h-12 px-3 py-2 border border-amber-300 text-amber-900 font-semibold rounded-xl hover:bg-amber-100 transition-colors"
            >
              Ignorar por ahora
            </button>
          </div>
        </div>
      )}

      {/* Bloque principal: Copias y Google Drive */}
      <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">{UI.settings.data}</h2>
          <p className="text-xs text-gray-500 mt-1">
            Exporta copias locales en tu dispositivo o sincroniza tu puesto con Google Drive.
          </p>
        </div>

        {/* Input de archivo oculto */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".json,application/json"
          className="hidden"
          aria-label="Seleccionar archivo JSON para importar"
        />

        {/* Botones de archivo local (RF-C6, RF-C7) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleExport}
            disabled={loading}
            className="flex items-center justify-center gap-2 p-3.5 bg-brand-50 hover:bg-brand-100 text-brand-800 border border-brand-200 rounded-xl font-semibold text-sm transition-colors min-h-[48px] active:scale-[0.99] disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-lg">📁</span>
            <span>{UI.settings.export} (JSON)</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="flex items-center justify-center gap-2 p-3.5 bg-gray-50 hover:bg-gray-100 text-gray-800 border border-gray-300 rounded-xl font-semibold text-sm transition-colors min-h-[48px] active:scale-[0.99] disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-lg">📥</span>
            <span>{UI.settings.import} (JSON)</span>
          </button>
        </div>

        {/* Bloque Google Drive (SPEC sección 7, RF-C8, RF-C9) */}
        <div className="p-4 bg-sky-50/70 border border-sky-200 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-xl">☁️</span>
              <div>
                <h3 className="text-sm font-bold text-sky-950">Google Drive</h3>
                <p className="text-[11px] text-sky-700">
                  {UI.settings.lastSync}: <strong>{formattedRelative}</strong>
                  {lastSyncedRevision > 0 && ` (Revisión ${lastSyncedRevision})`}
                </p>
              </div>
            </div>
            {!hasGoogleClientId() && (
              <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                Sin configurar
              </span>
            )}
          </div>

          {!hasGoogleClientId() && (
            <p className="text-xs text-amber-900 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
              ℹ️ Para sincronizar con Drive, añade <code>VITE_GOOGLE_CLIENT_ID</code> en tu archivo <code>.env</code>. Consulta el README para los pasos en Google Cloud.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => handleDriveUpload(false)}
              disabled={loading}
              className="flex items-center justify-center gap-2 p-3 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl text-xs transition-colors min-h-[48px] shadow-sm disabled:opacity-50"
            >
              <span>☁️ {UI.settings.driveUpload}</span>
            </button>

            <button
              type="button"
              onClick={handleDriveRestorePreview}
              disabled={loading}
              className="flex items-center justify-center gap-2 p-3 bg-white hover:bg-sky-50 text-sky-800 border border-sky-300 font-semibold rounded-xl text-xs transition-colors min-h-[48px] shadow-sm disabled:opacity-50"
            >
              <span>📥 {UI.settings.driveRestore}</span>
            </button>
          </div>
        </div>

        {/* Estado Almacenamiento Persistente (SPEC sección 8) */}
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-700 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-sm">💾</span>
            <div>
              <span className="font-semibold">Almacenamiento persistente:</span>{' '}
              {isStoragePersisted
                ? 'Activo (protegido contra borrado automático del navegador)'
                : 'Estándar'}
            </div>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              isStoragePersisted
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-gray-200 text-gray-700'
            }`}
          >
            {isStoragePersisted ? 'Garantizado' : 'Básico'}
          </span>
        </div>
      </div>

      {/* Bloque: Copias locales de seguridad (localBackups) */}
      <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">{UI.settings.localBackupsTitle}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{UI.settings.localBackupsDesc}</p>
        </div>

        {localBackups.length === 0 ? (
          <p className="text-xs text-gray-400 italic py-2">
            Aún no hay copias de seguridad automáticas registradas.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100" role="list">
            {localBackups.map((b) => (
              <li key={b.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-gray-800 truncate">
                    {new Date(b.createdAt).toLocaleString('es-ES', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {getReasonLabel(b.reason)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setBackupToRestore(b)}
                  disabled={loading}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition-colors min-h-[36px] shrink-0"
                >
                  {UI.settings.restoreBackup}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Bloque: Zona de Peligro (RF-C11) */}
      <div className="p-4 bg-rose-50/50 rounded-2xl border border-rose-200 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-bold text-rose-900 flex items-center gap-1.5">
            <span aria-hidden="true">⚠️</span>
            <span>{UI.settings.dangerZone}</span>
          </h3>
          <p className="text-xs text-rose-700 mt-1">
            Borra todos los artículos, ventas e historial local. Se guardará una copia previa de seguridad automática antes de proceder.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setDeleteConfirmationText('')
            setShowDeleteModal(true)
          }}
          disabled={loading}
          className="w-full py-3 px-4 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-xs transition-colors min-h-[48px] shadow-sm active:scale-[0.99] disabled:opacity-50"
        >
          🗑️ {UI.settings.deleteAll}
        </button>
      </div>

      {/* Modal: Confirmar Importación desde archivo (RF-C7) */}
      <Modal
        title="Confirmar importación de datos"
        isOpen={Boolean(pendingPayload)}
        onClose={() => {
          setPendingPayload(null)
          if (fileInputRef.current) fileInputRef.current.value = ''
        }}
      >
        {pendingPayload && (
          <div className="p-4 space-y-4 text-left">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              ⚠️ <strong>Atención:</strong> Esta acción sustituirá todos los datos locales actuales. Antes de reemplazar, se guardará una copia de seguridad en las copias locales.
            </div>

            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 text-xs space-y-1.5 text-gray-700">
              <div className="font-semibold text-gray-900 pb-1 border-b border-gray-200">
                Resumen del archivo a importar:
              </div>
              <div>📅 <strong>Fecha exportación:</strong> {new Date(pendingPayload.exportedAt).toLocaleString('es-ES')}</div>
              <div>🏷️ <strong>Categorías:</strong> {pendingPayload.categories.length}</div>
              <div>📦 <strong>Artículos:</strong> {pendingPayload.items.length}</div>
              <div>🧾 <strong>Ventas registradas:</strong> {pendingPayload.sales.length}</div>
              <div>🔧 <strong>Ajustes de inventario:</strong> {pendingPayload.adjustments.length}</div>
              <div>🔢 <strong>Versión de esquema:</strong> v{pendingPayload.schemaVersion}</div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setPendingPayload(null)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
                disabled={loading}
                className="flex-1 py-3 px-4 border border-gray-300 rounded-xl text-gray-700 font-semibold text-xs hover:bg-gray-50 min-h-[48px]"
              >
                {UI.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => handleConfirmImport(false)}
                disabled={loading}
                className="flex-1 py-3 px-4 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl text-xs min-h-[48px]"
              >
                {loading ? UI.common.loading : 'Sustituir datos locales'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Confirmar Restauración de copia local */}
      <Modal
        title="Restaurar copia de seguridad"
        isOpen={Boolean(backupToRestore)}
        onClose={() => setBackupToRestore(null)}
      >
        {backupToRestore && (
          <div className="p-4 space-y-4 text-left">
            <p className="text-xs text-gray-600">
              {UI.settings.restoreBackupConfirm}
            </p>

            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 text-xs space-y-1 text-gray-700">
              <div>📅 <strong>Fecha de la copia:</strong> {new Date(backupToRestore.createdAt).toLocaleString('es-ES')}</div>
              <div>📋 <strong>Motivo:</strong> {getReasonLabel(backupToRestore.reason)}</div>
            </div>

            <p className="text-[11px] text-gray-500">
              Se creará automáticamente una nueva copia antes de restaurar, para que nunca pierdas datos.
            </p>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBackupToRestore(null)}
                disabled={loading}
                className="flex-1 py-3 px-4 border border-gray-300 rounded-xl text-gray-700 font-semibold text-xs hover:bg-gray-50 min-h-[48px]"
              >
                {UI.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => handleConfirmRestore(false)}
                disabled={loading}
                className="flex-1 py-3 px-4 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl text-xs min-h-[48px]"
              >
                {loading ? UI.common.loading : UI.settings.restoreBackup}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Conflicto con Google Drive (SPEC sección 7) */}
      <Modal
        title={UI.settings.driveConflictTitle}
        isOpen={Boolean(conflictData)}
        onClose={() => setConflictData(null)}
      >
        {conflictData && (
          <div className="p-4 space-y-4 text-left">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1.5">
              <p className="font-bold">⚠️ {UI.settings.driveConflictDesc}</p>
              <p>
                Los datos en Google Drive fueron actualizados desde otro dispositivo (Revisión{' '}
                <strong>{conflictData.remoteRevision}</strong>), mientras que este dispositivo tiene la Revisión{' '}
                <strong>{conflictData.localRevision}</strong>.
              </p>
              <p>Elige cómo deseas proceder:</p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={handleDriveRestorePreview}
                disabled={loading}
                className="w-full py-3 px-4 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl text-xs min-h-[48px]"
              >
                📥 {UI.settings.driveRestoreFirst} (Recomendado)
              </button>

              <button
                type="button"
                onClick={() => handleDriveUpload(true)}
                disabled={loading}
                className="w-full py-3 px-4 border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 font-semibold rounded-xl text-xs min-h-[48px]"
              >
                ⚠️ {UI.settings.driveReplaceRemote}
              </button>

              <button
                type="button"
                onClick={() => setConflictData(null)}
                disabled={loading}
                className="w-full py-2.5 px-4 text-gray-500 font-medium text-xs hover:text-gray-700 min-h-[40px]"
              >
                {UI.common.cancel}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Confirmar Restauración desde Google Drive (SPEC sección 7) */}
      <Modal
        title="Restaurar desde Google Drive"
        isOpen={Boolean(driveRestorePreview)}
        onClose={() => setDriveRestorePreview(null)}
      >
        {driveRestorePreview && (
          <div className="p-4 space-y-4 text-left">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              ⚠️ <strong>Atención:</strong> Esta acción sustituirá todos los datos locales actuales por la copia de Google Drive. Antes de reemplazar, se guardará automáticamente una copia en el historial local.
            </div>

            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 text-xs space-y-1.5 text-gray-700">
              <div className="font-semibold text-gray-900 pb-1 border-b border-gray-200">
                Resumen de la copia en Drive:
              </div>
              <div>📅 <strong>Fecha exportación:</strong> {new Date(driveRestorePreview.payload.exportedAt).toLocaleString('es-ES')}</div>
              <div>🔢 <strong>Revisión remota:</strong> Rev. {driveRestorePreview.remoteMeta.revision}</div>
              <div>🏷️ <strong>Categorías:</strong> {driveRestorePreview.summary.categoriesCount}</div>
              <div>📦 <strong>Artículos:</strong> {driveRestorePreview.summary.itemsCount}</div>
              <div>🧾 <strong>Ventas registradas:</strong> {driveRestorePreview.summary.salesCount}</div>
              <div>🔧 <strong>Ajustes de inventario:</strong> {driveRestorePreview.summary.adjustmentsCount}</div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDriveRestorePreview(null)}
                disabled={loading}
                className="flex-1 py-3 px-4 border border-gray-300 rounded-xl text-gray-700 font-semibold text-xs hover:bg-gray-50 min-h-[48px]"
              >
                {UI.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDriveRestore(false)}
                disabled={loading}
                className="flex-1 py-3 px-4 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl text-xs min-h-[48px]"
              >
                {loading ? UI.common.loading : 'Restaurar datos'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Doble Confirmación Borrar Todo (RF-C11) */}
      <Modal
        title="Zona de peligro: Borrar todo"
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false)
          setDeleteConfirmationText('')
        }}
      >
        <div className="p-4 space-y-4 text-left">
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
            ⚠️ <strong>{UI.settings.deleteAllConfirm}</strong> Se eliminarán todos los artículos, ventas y ajustes. Se recrearán las categorías iniciales.
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirm-delete-input" className="block text-xs font-semibold text-gray-800">
              {UI.settings.deleteAllConfirm2}:
            </label>
            <input
              id="confirm-delete-input"
              type="text"
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              placeholder="BORRAR"
              autoFocus
              className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500 min-h-[48px]"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowDeleteModal(false)
                setDeleteConfirmationText('')
              }}
              disabled={loading}
              className="flex-1 py-3 px-4 border border-gray-300 rounded-xl text-gray-700 font-semibold text-xs hover:bg-gray-50 min-h-[48px]"
            >
              {UI.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => handleConfirmDeleteAll(false)}
              disabled={loading || deleteConfirmationText.trim().toUpperCase() !== 'BORRAR'}
              className="flex-1 py-3 px-4 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white font-semibold rounded-xl text-xs transition-colors min-h-[48px]"
            >
              {loading ? UI.common.loading : 'Borrar definitivamente'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Falta de espacio en localBackups (E4) */}
      <Modal
        title="Espacio de almacenamiento agotado"
        isOpen={Boolean(quotaErrorState)}
        onClose={() => setQuotaErrorState(null)}
      >
        {quotaErrorState && (
          <div className="p-4 space-y-4 text-left">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1.5">
              <p className="font-bold">⚠️ {quotaErrorState.message}</p>
              <p>
                Te recomendamos exportar primero tus datos a un archivo JSON. Si decides continuar ahora, la operación se realizará sin guardar la copia previa automática en el dispositivo.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setQuotaErrorState(null)}
                disabled={loading}
                className="flex-1 py-3 px-4 border border-gray-300 rounded-xl text-gray-700 font-semibold text-xs hover:bg-gray-50 min-h-[48px]"
              >
                {UI.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => quotaErrorState.retryWithoutBackup()}
                disabled={loading}
                className="flex-1 py-3 px-4 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl text-xs min-h-[48px]"
              >
                {loading ? UI.common.loading : 'Continuar sin copia previa'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
