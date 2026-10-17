/**
 * auth.ts — Autenticación con Google Identity Services (GIS) en navegador.
 *
 * Ref: SPEC.md sección 7.
 * Sin backend, flujo de token en navegador (OAuth 2.0 Token Client).
 * El Client ID se lee de la variable de entorno VITE_GOOGLE_CLIENT_ID.
 */

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (tokenResponse: { access_token?: string; error?: string }) => void
            error_callback?: (error: unknown) => void
          }) => {
            requestAccessToken: (options?: { prompt?: string }) => void
          }
        }
      }
    }
  }
}

export function getGoogleClientId(): string {
  const envId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim()
  if (!envId || envId === 'TU_CLIENT_ID_AQUI.apps.googleusercontent.com') {
    return ''
  }
  return envId
}

export function hasGoogleClientId(): boolean {
  return Boolean(getGoogleClientId())
}

/**
 * Carga el script de Google Identity Services de forma dinámica si no está presente.
 */
export async function loadGsiScript(): Promise<void> {
  if (typeof window === 'undefined') return
  if (window.google?.accounts?.oauth2) return

  const SCRIPT_ID = 'google-gsi-client-script'
  const existing = document.getElementById(SCRIPT_ID)
  if (existing) {
    // Si ya existe la etiqueta, esperar a que termine de cargar
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar Google Identity Services')))
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('No se pudo cargar Google Identity Services. Comprueba tu conexión a internet.'))
    document.head.appendChild(script)
  })
}

/**
 * Solicita un Access Token de Google OAuth al usuario mediante ventana emergente.
 */
export async function requestGoogleAccessToken(overrideClientId?: string): Promise<string> {
  const clientId = overrideClientId || getGoogleClientId()

  if (!clientId) {
    throw new Error(
      'Falta configurar el Client ID de Google. Añade VITE_GOOGLE_CLIENT_ID en tu archivo .env (consulta el README).',
    )
  }

  await loadGsiScript()

  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services no está disponible en este navegador.')
  }

  return new Promise((resolve, reject) => {
    const tokenClient = window.google!.accounts!.oauth2!.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (response) => {
        if (response.error) {
          reject(new Error(`Error de autenticación con Google: ${response.error}`))
          return
        }
        if (!response.access_token) {
          reject(new Error('No se recibió el token de acceso de Google.'))
          return
        }
        resolve(response.access_token)
      },
      error_callback: (err) => {
        reject(new Error(`Fallo al solicitar token a Google: ${String(err)}`))
      },
    })

    tokenClient.requestAccessToken({ prompt: '' })
  })
}
