import '@/index.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'
import ErrorBoundary from '@/components/ErrorBoundary'
import { initDB } from '@/db/db'

async function main() {
  // Inicializar la base de datos antes de montar React
  // Si falla, mostramos un error básico (no podemos usar la app sin IndexedDB)
  try {
    await initDB()
  } catch (err) {
    document.body.innerHTML = `
      <div style="padding:2rem;font-family:sans-serif;color:#dc2626">
        <h1>Error al iniciar la aplicación</h1>
        <p>No se pudo acceder al almacenamiento local (IndexedDB).</p>
        <p>Asegúrate de que el navegador no está en modo incógnito y tiene permisos de almacenamiento.</p>
        <pre style="font-size:0.8rem;color:#6b7280">${String(err)}</pre>
      </div>
    `
    return
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

void main()
