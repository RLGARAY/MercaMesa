# MercaMesa

Aplicación web instalable (PWA) para gestionar una pequeña mesa en un mercadillo.
Funciona **sin conexión** en Android Chrome y guarda los datos en local.

> **Proyecto educativo:** el código prioriza la claridad y la simplicidad.

## Stack

| Capa | Tecnología |
|---|---|
| Build | Vite 6 + React 18 + TypeScript 5 (strict) |
| Estilos | Tailwind CSS 3 |
| Datos | IndexedDB via Dexie 4 |
| Gráficas | Recharts 2 |
| PWA/Offline | vite-plugin-pwa |
| Tests | Vitest 3 + React Testing Library |
| Sincronización | Google Drive API v3 (Fase 7) |

## Arranque rápido

### Requisitos
- Node.js 20 o superior
- npm 10 o superior

### Instalación

```bash
# 1. Clona o descarga el repositorio
git clone <url-del-repo>
cd mercamesa

# 2. Instala las dependencias
npm install

# 3. Copia el archivo de variables de entorno
#    (el Client ID de Google solo es necesario para la sincronización con Drive, Fase 7)
cp .env.example .env

# 4. Arranca el servidor de desarrollo
npm run dev
```

La app estará disponible en `http://localhost:5173`.

### Comandos disponibles

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo con hot reload |
| `npm run build` | Compilación para producción |
| `npm run preview` | Previsualizar la build de producción |
| `npm test` | Ejecutar tests (una vez) |
| `npm run test:watch` | Tests en modo watch |
| `npm run test:coverage` | Tests con informe de cobertura |
| `npm run typecheck` | Verificar tipos TypeScript sin compilar |

## Estructura del proyecto

```
src/
├── types.ts          # Tipos del dominio (fuente de verdad del modelo)
├── i18n.ts           # Textos de interfaz en español (RNF-5)
├── main.tsx          # Punto de entrada
├── App.tsx           # Shell + navegación inferior
├── index.css         # Estilos globales
├── db/
│   └── db.ts         # Esquema Dexie, migraciones, initDB()
├── domain/           # Lógica de negocio pura (sin React ni Dexie)
│   ├── money.ts      # Formateo y parseo de céntimos
│   ├── discount.ts   # Modos de descuento + reparto (Fase 2)
│   ├── stats.ts      # Cálculos de estadísticas (Fase 4)
│   └── validation.ts # Validaciones reutilizables (Fase 1)
├── services/         # Casos de uso con transacciones Dexie
│   └── drive/        # Cliente de Google Drive (Fase 7)
├── features/
│   ├── sale/         # Pantalla de Venta (Fase 2)
│   ├── items/        # Alta/edición de artículos (Fase 1)
│   ├── stats/        # Pantalla de Estadísticas (Fase 4)
│   └── settings/     # Ajustes / Corrección (Fase 3)
├── components/       # Componentes compartidos
└── test/             # Setup de tests y tests de dominio
```

## Configuración de Google Drive (Fase 7)

> Esta sección se completa en la Fase 7. Por ahora, el campo `VITE_GOOGLE_CLIENT_ID`
> en tu archivo `.env` puede dejarse como está.

Pasos para obtener el Client ID (resumido):
1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un proyecto nuevo o usa uno existente
3. Activa la API de Google Drive
4. Ve a "APIs y servicios → Credenciales → Crear credencial → ID de cliente OAuth 2.0"
5. Tipo: **Aplicación web**
6. Añade los orígenes autorizados: `http://localhost:5173` (desarrollo) y tu URL de producción
7. Copia el Client ID y pégalo en `.env` como `VITE_GOOGLE_CLIENT_ID=...`

## Fases de desarrollo

| Fase | Estado | Descripción |
|---|---|---|
| 0 | ✅ Completada | Esqueleto: proyecto, navegación, esquema DB, money.ts |
| 1 | ✅ Completada | Artículos y categorías (CRUD con imagen y ajuste de stock) |
| 2 | ✅ Completada | Venta con carrito, descuento (3 modos), cobro y deshacer |
| 3 | ✅ Completada | Corrección de stock, historial de ajustes, ventas y anulación |
| 4 | ✅ Completada | Estadísticas con Recharts, selector de periodo y rankings |
| 5 | ⏳ Pendiente | Exportar/importar y copias locales |
| 6 | ⏳ Pendiente | PWA y offline completo |
| 7 | ⏳ Pendiente | Sincronización con Google Drive |
| 8 | ⏳ Pendiente | Pulido y accesibilidad |

## Reglas de datos importantes

- **Dinero siempre en céntimos** (`number` entero). Nunca `float` para importes.
- **Stock puede ser negativo** con aviso (el usuario puede haber olvidado reponer).
- **Las ventas no se borran**: se anulan. Los artículos no se borran: se archivan.
- Todas las operaciones de escritura son **transacciones atómicas** (no quedan datos a medias).

## Licencia

Proyecto personal / educativo.
