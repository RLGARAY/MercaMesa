/**
 * driveClient.ts — Interfaz y cliente para la Google Drive API v3.
 *
 * Ref: SPEC.md sección 7.
 * Scope: drive.file (la app solo tiene acceso a los archivos que ella misma creó).
 */

import type { BackupPayload } from '@/services/backupService'

export interface RemoteFileMeta {
  fileId: string
  revision: number
  modifiedTime?: string
}

export interface DriveClient {
  /**
   * Obtiene los metadatos del archivo 'mercadillo-datos.json' en Drive si existe.
   */
  getFileMetadata(): Promise<RemoteFileMeta | null>

  /**
   * Sube el payload a Google Drive con su número de revisión.
   * Si ya existe fileId, actualiza (PATCH). Si no, crea un archivo nuevo (POST).
   */
  uploadFile(
    payload: BackupPayload,
    revision: number,
    existingFileId?: string,
  ): Promise<RemoteFileMeta>

  /**
   * Descarga el contenido completo en texto JSON del archivo en Drive.
   */
  downloadFile(fileId: string): Promise<string>
}

const DRIVE_FILE_NAME = 'mercadillo-datos.json'

/**
 * Cliente real que realiza peticiones HTTP a la Google Drive API v3
 * utilizando el Access Token OAuth 2.0 obtenido en el navegador.
 */
export class GoogleDriveClient implements DriveClient {
  private accessToken: string

  constructor(accessToken: string) {
    this.accessToken = accessToken
  }

  private get headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.accessToken}`,
    }
  }

  async getFileMetadata(): Promise<RemoteFileMeta | null> {
    const q = encodeURIComponent(`name = '${DRIVE_FILE_NAME}' and trashed = false`)
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,appProperties,modifiedTime)&pageSize=1`

    const res = await fetch(url, { headers: this.headers })
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Sesión de Google caducada. Vuelve a iniciar sesión.')
      }
      throw new Error(`Error al consultar Google Drive (${res.status})`)
    }

    const data = (await res.json()) as {
      files?: Array<{
        id: string
        name: string
        modifiedTime?: string
        appProperties?: Record<string, string>
      }>
    }

    if (!data.files || data.files.length === 0) {
      return null
    }

    const file = data.files[0]!
    const revStr = file.appProperties?.revision
    const revision = revStr ? parseInt(revStr, 10) : 1

    return {
      fileId: file.id,
      revision: Number.isNaN(revision) ? 1 : revision,
      ...(file.modifiedTime ? { modifiedTime: file.modifiedTime } : {}),
    }
  }

  async uploadFile(
    payload: BackupPayload,
    revision: number,
    existingFileId?: string,
  ): Promise<RemoteFileMeta> {
    const isUpdate = Boolean(existingFileId)
    const jsonContent = JSON.stringify(payload, null, 2)
    const metadata = isUpdate
      ? {
          name: DRIVE_FILE_NAME,
          appProperties: {
            revision: String(revision),
          },
        }
      : {
          name: DRIVE_FILE_NAME,
          mimeType: 'application/json',
          appProperties: {
            revision: String(revision),
          },
        }

    const boundary = '-------314159265358979323846'
    const delimiter = `\r\n--${boundary}\r\n`
    const closeDelimiter = `\r\n--${boundary}--`

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      jsonContent +
      closeDelimiter

    const url = isUpdate
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,appProperties,modifiedTime`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,appProperties,modifiedTime'

    const method = isUpdate ? 'PATCH' : 'POST'

    const res = await fetch(url, {
      method,
      headers: {
        ...this.headers,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    })

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Sesión de Google caducada. Vuelve a iniciar sesión.')
      }
      throw new Error(`Error al subir datos a Google Drive (${res.status})`)
    }

    const data = (await res.json()) as {
      id: string
      modifiedTime?: string
      appProperties?: Record<string, string>
    }

    return {
      fileId: data.id,
      revision,
      ...(data.modifiedTime ? { modifiedTime: data.modifiedTime } : {}),
    }
  }

  async downloadFile(fileId: string): Promise<string> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    const res = await fetch(url, { headers: this.headers })

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Sesión de Google caducada. Vuelve a iniciar sesión.')
      }
      throw new Error(`Error al descargar archivo de Google Drive (${res.status})`)
    }

    return await res.text()
  }
}
