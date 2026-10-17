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
  type BackupPayload,
} from '@/services/backupService'
import { checkStoragePersistence } from '@/utils/pwaUtils'
import type { LocalBackup } from '@/types'

export default function DataBackupSection() {
  const [localBackups, setLocalBackups] = useState<LocalBackup[]>([])
  const [loading, setLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isStoragePersisted, setIsStoragePersisted] = useState<boolean | null>(null)

  // Estado para modal de importación
  const [pendingPayload, setPendingPayload] = useState<BackupPayload | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Estado para modal de restauración local
  const [backupToRestore, setBackupToRestore] = useState<LocalBackup | null>(null)

  // Estado para modal de borrado total (zona de peligro)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('')

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

  // 1. Exportar
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

  // 2. Selección de archivo para importar
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

      // Válido: abrir modal de confirmación con el resumen
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

  // Confirmar importación
  const handleConfirmImport = async () => {
    if (!pendingPayload) return
    try {
      setLoading(true)
      await importBackupPayload(pendingPayload)
      setPendingPayload(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await loadBackups()
      setStatusMessage({
        type: 'success',
        text: UI.settings.importSuccess,
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

  // 3. Confirmar restauración de copia local
  const handleConfirmRestore = async () => {
    if (!backupToRestore) return
    try {
      setLoading(true)
      await restoreLocalBackup(backupToRestore.id)
      setBackupToRestore(null)
      await loadBackups()
      setStatusMessage({
        type: 'success',
        text: UI.settings.importSuccess,
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

  // 4. Confirmar reseteo total
  const handleConfirmDeleteAll = async () => {
    if (deleteConfirmationText.trim().toUpperCase() !== 'BORRAR') return
    try {
      setLoading(true)
      await resetAllData()
      setShowDeleteModal(false)
      setDeleteConfirmationText('')
      await loadBackups()
      setStatusMessage({
        type: 'success',
        text: UI.settings.resetSuccess,
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

  const getReasonLabel = (reason: LocalBackup['reason']) => {
    switch (reason) {
      case 'before-import':
        return 'Antes de importar archivo'
      case 'before-restore':
        return 'Antes de restaurar copia'
      case 'before-migration':
        return 'Antes de borrar / migrar'
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

      {/* Bloque principal: Exportar e Importar JSON */}
      <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">{UI.settings.data}</h2>
          <p className="text-xs text-gray-500 mt-1">
            Guarda tus datos en un archivo JSON en tu dispositivo o recupera una copia anterior.
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Botón Exportar */}
          <button
            type="button"
            onClick={handleExport}
            disabled={loading}
            className="flex items-center justify-center gap-2 p-3.5 bg-brand-50 hover:bg-brand-100 text-brand-800 border border-brand-200 rounded-xl font-semibold text-sm transition-colors min-h-[48px] active:scale-[0.99] disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-lg">📁</span>
            <span>{UI.settings.export} (JSON)</span>
          </button>

          {/* Botón Importar */}
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

        {/* Info Google Drive */}
        <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
          <span className="text-base leading-none" aria-hidden="true">☁️</span>
          <div>
            <strong>Google Drive (Fase 7):</strong> Próximamente podrás sincronizar tus copias en la nube de Google Drive con un solo toque.
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

      {/* Modal: Confirmar Importación (RF-C7) */}
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
                onClick={handleConfirmImport}
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
                onClick={handleConfirmRestore}
                disabled={loading}
                className="flex-1 py-3 px-4 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl text-xs min-h-[48px]"
              >
                {loading ? UI.common.loading : UI.settings.restoreBackup}
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
              onClick={handleConfirmDeleteAll}
              disabled={loading || deleteConfirmationText.trim().toUpperCase() !== 'BORRAR'}
              className="flex-1 py-3 px-4 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white font-semibold rounded-xl text-xs transition-colors min-h-[48px]"
            >
              {loading ? UI.common.loading : 'Borrar definitivamente'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
