# SPEC — App de gestión de mesa de mercadillo

> Documento de especificación. Es la **fuente de verdad** del proyecto. Si algo no está aquí o es ambiguo, el agente debe preguntar o anotar la suposición en `DECISIONS.md`, no inventar.

## 1. Resumen

App para **una sola persona** que gestiona una **pequeña mesa en un mercadillo** (pendientes, llaveros, láminas, etc.). Funciona **en un móvil o tablet Android**, **sin conexión**, y guarda los datos **en local**. Una copia de seguridad/sincronización **manual** se guarda en el **Google Drive** del usuario, de modo que si el dispositivo se queda sin batería se pueda continuar en otro.

Es un proyecto **para aprender**: se prefiere código claro, simple y bien explicado antes que soluciones sofisticadas.

### Objetivos
1. Registrar ventas rápido (2–3 toques por venta).
2. Mantener el inventario siempre actualizado.
3. Ver estadísticas de lo vendido y del dinero generado.
4. Poder corregir errores (stock mal registrado, venta equivocada).
5. No perder datos: guardado local en cada movimiento + copia en Drive.

### Restricciones
- **Todo gratuito**: sin servicios de pago, sin backend propio, sin cuentas de pago.
- **Solo Android** (Chrome). No hace falta soportar iOS.
- **Offline-first**: ninguna función de venta/inventario/estadísticas puede depender de internet. Solo la sincronización con Drive lo necesita.
- **Un usuario, un dispositivo a la vez.**

## 2. Stack técnico (decidido)

| Capa | Elección |
|---|---|
| Tipo de app | **PWA** instalable en Android (Chrome) |
| Build | **Vite** + **React** + **TypeScript** (modo estricto) |
| Estilos | **Tailwind CSS** |
| Datos locales | **IndexedDB** mediante **Dexie** |
| Gráficas | **Recharts** |
| PWA / offline | **vite-plugin-pwa** (`registerType: 'prompt'`) |
| Tests | **Vitest** (+ React Testing Library para lo esencial) |
| Drive | **Google Identity Services** (OAuth en navegador) + **Drive API v3** vía `fetch`, scope `drive.file` |
| Hosting | **GitHub Pages** o **Cloudflare Pages** (gratuitos, HTTPS) |
| Identificadores | `crypto.randomUUID()` |

Notas:
- Si se publica en GitHub Pages, configurar `base` de Vite con el nombre del repositorio.
- Más adelante, el mismo código podría empaquetarse como APK con Capacitor. **No es objetivo ahora.**

## 3. Reglas generales de datos

- **Dinero en céntimos enteros** (`number` entero). Nunca `float` para importes. Se muestra formateado en euros (`es-ES`).
- Importes habituales: números redondos, como mucho con 50 céntimos. Los campos de importe usan `step` de 0,50 €, pero el sistema **debe** soportar cualquier céntimo (por el reparto de descuentos).
- Fechas en **ISO 8601** (UTC) como `string`.
- IDs: UUID v4 como `string`.
- Las ventas y los ajustes **no se borran**: se anulan (ver reglas). Los artículos **no se borran** si tienen historial: se **archivan**.
- La base de datos y el archivo JSON de copia llevan `schemaVersion` (entero, empieza en 1).

## 4. Modelo de datos

```ts
type ID = string;           // UUID
type Cents = number;        // entero, céntimos de euro

interface Category {
  id: ID;
  name: string;             // "Pendientes", "Llaveros", "Láminas"...
  sortOrder: number;
  archived: boolean;
}

interface Item {
  id: ID;
  name: string;
  categoryId: ID;
  priceCents: Cents;        // precio de venta unitario
  stock: number;            // entero >= 0 en condiciones normales (ver RN-3)
  imageThumb?: string;      // data URL JPEG, máx. 256 px lado mayor, calidad ~0.7
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SaleLine {
  itemId: ID;
  nameSnapshot: string;       // nombre en el momento de la venta
  categoryIdSnapshot: ID;     // categoría en el momento de la venta
  unitPriceCents: Cents;      // precio de lista en el momento de la venta
  quantity: number;           // entero >= 1
  lineListCents: Cents;       // unitPriceCents * quantity
  lineDiscountCents: Cents;   // parte del descuento asignada a esta línea
  lineNetCents: Cents;        // lineListCents - lineDiscountCents
}

interface Sale {
  id: ID;
  createdAt: string;
  lines: SaleLine[];
  subtotalCents: Cents;       // suma de lineListCents
  discountCents: Cents;       // 0 si no hay descuento
  totalCents: Cents;          // subtotalCents - discountCents (lo realmente cobrado)
  status: 'active' | 'voided';
  voidedAt?: string;
  voidReason?: 'undo' | 'manual';
}

interface StockAdjustment {
  id: ID;
  createdAt: string;
  itemId: ID;
  delta: number;              // entero, puede ser negativo
  reason: 'initial' | 'restock' | 'correction' | 'loss' | 'other';
  note?: string;
}

interface Meta {              // una sola fila (clave primaria fija 'main')
  id: 'main';
  schemaVersion: number;
  deviceId: ID;               // identifica esta instalación
  lastSyncedRevision: number; // última revisión de Drive conocida
  lastSyncedAt?: string;
  driveFileId?: string;
  lowStockThreshold?: number; // preferencia local del dispositivo para aviso de poco stock (por defecto 2)
  saleSort?: 'name-asc' | 'name-desc' | 'stock-asc' | 'stock-desc'; // preferencia local de orden en pantalla de venta (por defecto 'name-asc')
  hideOutOfStock?: boolean;   // preferencia local para ocultar artículos sin stock en pantalla de venta (por defecto false)
  saleViewMode?: 'list' | 'grid'; // preferencia local de modo de vista en pantalla de venta (por defecto 'list')
}
```

Tablas Dexie: `items`, `categories`, `sales`, `adjustments`, `meta`, `localBackups`.
Índices recomendados: `sales.createdAt`, `sales.status`, `adjustments.itemId`, `items.categoryId`.

### Invariante de consistencia
Para cada artículo:
`stock = suma(adjustments.delta) − suma(quantity de líneas en ventas con status 'active')`

Todas las operaciones que cambian stock (crear artículo, cobrar venta, anular venta, ajuste) se hacen en **una única transacción Dexie** junto con el registro correspondiente. Debe existir una función `verifyStockConsistency()` y un botón en Ajustes que la ejecute y ofrezca reparar.

## 5. Reglas de negocio

- **RN-1 Carrito.** El carrito es **estado de la pantalla de venta** (no se persiste en la base de datos hasta que se cobra). Si la app se cierra con el carrito abierto, se puede restaurar desde `sessionStorage`/estado local (deseable, no obligatorio).
- **RN-2 Cobrar.** Al cobrar se crea una `Sale` activa con sus líneas (snapshots de nombre, categoría y precio), se descuenta el stock de cada artículo y se vacía el carrito. Todo en una transacción.
- **RN-3 Stock insuficiente.** Si la cantidad en el carrito supera el stock, la app **avisa pero permite continuar** (el usuario puede haber olvidado reponer). El stock puede quedar negativo; los artículos con stock ≤ 0 se marcan visualmente y la pantalla de Corrección los destaca.
- **RN-4 Descuento.** Es un descuento **sobre el total del ticket**, opcional. Se introduce de una de estas formas: (a) **precio final**, (b) **importe de descuento en €**, (c) **porcentaje**. Siempre se normaliza a `discountCents`.
  - Restricción: `0 ≤ discountCents ≤ subtotalCents`.
  - Sin check de oferta marcado, `discountCents = 0`.
- **RN-5 Reparto del descuento entre líneas** (para estadísticas por artículo y categoría):
  1. Peso de cada línea = `lineListCents / subtotalCents`.
  2. Parte exacta = `discountCents * lineListCents / subtotalCents`.
  3. Se asigna la parte entera (floor) a cada línea.
  4. El resto de céntimos (`discountCents − suma(floors)`) se reparte de 1 en 1 a las líneas con **mayor parte decimal descartada**; en empate, por orden de línea.
  5. Invariantes: `suma(lineDiscountCents) = discountCents`; `0 ≤ lineDiscountCents ≤ lineListCents`; `suma(lineNetCents) = totalCents`.
  - Si `subtotalCents = 0`, todos los descuentos son 0.
- **RN-6 Anular venta.** Cambia `status` a `'voided'`, guarda `voidedAt`, registra `voidReason` (`'manual'` cuando se anula desde el historial o `'undo'` cuando se deshace recién cobrada; registros antiguos sin el campo se tratan como `'manual'`) y **devuelve el stock** de sus líneas, en una transacción. Las anuladas con `'undo'` se ocultan del historial por defecto salvo que se active el interruptor "Mostrar deshechas". Una venta anulada **no cuenta** en estadísticas. No se puede editar una venta: para corregirla se anula y se registra otra.
- **RN-7 Editar artículo.** Cambiar nombre, precio o categoría **no modifica** ventas pasadas (usan snapshots).
- **RN-8 Archivar artículo.** Un artículo archivado desaparece de la pantalla de venta y de las listas por defecto, pero mantiene su historial. Se puede restaurar.
- **RN-9 Categorías.** Un artículo siempre tiene categoría. Existen categorías iniciales editables ("Pendientes", "Llaveros", "Láminas"). No se puede borrar una categoría con artículos activos; se puede archivar.

## 6. Requisitos funcionales por pantalla

La app tiene **navegación inferior con 3 pestañas**: **Venta**, **Estadísticas**, **Ajustes/Corrección**.

### 6.1 Pestaña Venta (pantalla principal)

- **RF-V1** Catálogo de artículos activos en dos modos de visualización alternables que comparten el mismo estado y manejadores del carrito:
  - **Vista lista** (por defecto): artículos en **filas** con imagen (miniatura), nombre, categoría, botón de edición rápida, precio, stock actual y botones **− / +** grandes con el número de unidades en el carrito entre ellos.
  - **Vista expositor**: cuadrícula responsiva (`CSS Grid` con `repeat(auto-fill, minmax(140px, 1fr))`) de **tarjetas cuadradas** (`aspect-ratio: 1 / 1`, priorizando el alto táctil ≥ 48 px de los botones si el ancho es muy estrecho). Cada tarjeta (`role="group"` con el nombre del artículo) muestra: (1) la imagen ocupando la mayor parte (`object-fit: cover`, `loading="lazy"`, `decoding="async"`) o un marcador atractivo con la inicial sobre un color derivado de categoría/nombre cuando no hay foto; (2) superpuestos sobre la imagen con fondo oscuro semitransparente de alto contraste, el **nombre** (máximo 2 líneas con elipsis) y una etiqueta con el **precio**; (3) estados visuales accesibles (con icono/texto además de color) para artículo en carrito (borde y cantidad resaltada), agotado (`stock ≤ 0`, imagen atenuada y etiqueta "Agotado" + aviso RN-3 si se añade al carrito) y stock bajo (marca discreta según `lowStockThreshold`); y (4) una **franja inferior** con únicamente los botones **− y +** (`min-h-[48px]`, ocupando todo el ancho con separación suficiente y `aria-label` "Quitar/Añadir una unidad de X") y la cantidad entre ambos. Tocar la imagen o el resto de la tarjeta fuera de los botones no añade nada al carrito.
- **RF-V2** **Barra de herramientas de filtrado, orden y vista** en la parte superior:
  - **Buscador por nombre** (requisito): coincidencia parcial en cualquier parte del nombre, sin distinguir mayúsculas ni acentos (`normalize('NFD')` eliminando diacríticos) e ignorando espacios al principio y al final, con botón para borrar el texto y estado vacío claro cuando no hay resultados. El texto de búsqueda no se guarda entre sesiones.
  - **Chips de categoría** con scroll horizontal (con opción "Todas").
  - **Selector compacto de orden**: *Nombre A → Z* (`'name-asc'`, valor por defecto), *Nombre Z → A* (`'name-desc'`), *Stock: de menos a más* (`'stock-asc'`) y *Stock: de más a menos* (`'stock-desc'`). Comparación en español sin distinguir mayúsculas ni acentos y con orden numérico natural (`localeCompare('es', { sensitivity: 'base', numeric: true })`), desempatando por *Nombre A → Z* cuando coincide el stock. Se recuerda entre sesiones como preferencia local del dispositivo (`meta.saleSort`, excluida de copias de seguridad y Drive).
  - **Interruptor de artículos sin stock**: muestra todos por defecto (`false`) y, al activarse (`true`), oculta los artículos con `stock ≤ 0` **salvo los que ya estén en el carrito** (para que el usuario pueda seguir restando unidades), mostrando una indicación discreta del nº de artículos sin stock ocultos. Expone su estado mediante icono, texto ("Sin stock: visibles / ocultos"), `aria-pressed` y `aria-label`, y se recuerda como preferencia local del dispositivo (`meta.hideOutOfStock`).
  - **Botón de alternancia Vista lista / Vista expositor**: botón compacto (`≥ 44–48 px`) junto al selector de orden y al interruptor de sin stock que alterna entre `'list'` (**Vista lista**, valor por defecto si no existe o es inválido) y `'grid'` (**Vista expositor**). Indica el modo activo con icono diferenciador (lista / cuadrícula), texto visible, `aria-label` descriptiva y `aria-pressed`. Se recuerda entre sesiones como preferencia local del dispositivo (`meta.saleViewMode`, excluida de copias de seguridad y Drive).
  - **Reglas de combinación**: ambas vistas muestran exactamente la misma lista calculada mediante la función pura `filterAndSortItems` en `src/domain` aplicando en este orden: (1) excluir artículos archivados, (2) filtro por categoría, (3) buscador por nombre, (4) filtro de ocultar sin stock (con excepción de artículos en el carrito), y (5) orden elegido. Cambiar de vista, filtros u orden nunca modifica el carrito, la búsqueda ni el stock.
- **RF-V3** El botón **+** añade una unidad al **carrito**; **−** la quita (mínimo 0). **No** modifica el stock hasta cobrar.
- **RF-V4** **Barra de carrito** fija abajo: nº de artículos y **subtotal**. Al tocarla se abre el **resumen del carrito**.
- **RF-V5** Resumen del carrito: líneas (nombre, cantidad, importe), subtotal, check **"Oferta / descuento"**.
  - Al marcar el check aparece un campo con selector de modo: **Precio final** (por defecto) / **Descuento €** / **Descuento %**.
  - Se muestra en vivo: descuento aplicado y **total a cobrar**.
  - Validaciones según RN-4 con mensaje claro.
- **RF-V6** Botón **"Cobrar"**: aplica RN-2, muestra confirmación breve (toast con el total y botón **"Deshacer"** durante unos segundos, que equivale a anular la venta recién creada con `voidReason: 'undo'`, ocultándola por defecto en el historial salvo que se marque "Mostrar deshechas") y limpia el carrito.
- **RF-V7** Botón **"Vaciar carrito"** con confirmación.
- **RF-V8** Aviso visual cuando el stock del artículo es 0 o la cantidad en carrito lo supera (RN-3).
- **RF-V9** Acceso rápido a **"Nuevo artículo"** (botón flotante o en el menú) que abre el formulario de alta.

### 6.2 Alta y edición de artículo

- **RF-A1** Campos: nombre (obligatorio), categoría (obligatoria, con opción de crear una nueva en el momento), precio de venta (obligatorio, > 0), **stock inicial** (entero ≥ 0), imagen (opcional).
- **RF-A2** Imagen desde **cámara o galería** (`<input type="file" accept="image/*" capture>` o selector). Se **redimensiona en cliente** a un máximo de 256 px y se guarda como JPEG comprimido (`imageThumb`).
- **RF-A3** Al crear con stock inicial > 0 se registra un `StockAdjustment` con `reason: 'initial'`.
- **RF-A4** Edición de nombre, precio, categoría e imagen. Archivar/restaurar.
- **RF-A5** Validaciones: nombre no vacío, precio entero en céntimos, stock entero.

### 6.3 Pestaña Estadísticas

- **RF-E1** **Selector de periodo**: Hoy / Últimos 7 días / Todo / Rango personalizado (fecha inicio–fin). Por defecto: Hoy.
- **RF-E2** Tarjetas resumen: **dinero cobrado** (suma de `totalCents` de ventas activas), **nº de ventas**, **ticket medio**, **unidades vendidas**, **descuento total concedido**.
- **RF-E3** **Artículos más vendidos**: ranking por unidades (con importe neto generado). Mostrar top 10 con opción de ver todos.
- **RF-E4** **Ingresos y unidades por categoría** (gráfica de barras o tarta + tabla). Usa `lineNetCents`.
- **RF-E5** **Ventas por hora** (gráfica de barras) dentro del periodo, para ver las horas fuertes.
- **RF-E6** Lista de **ventas recientes** con hora, total y nº de artículos, que permite abrir el detalle (y anularla desde Corrección o desde el propio detalle con confirmación).
- **RF-E7** Artículos **sin ventas** en el periodo y artículos con **poco stock** (≤ 2, valor configurable).
- **RF-E8** Todas las cifras excluyen ventas anuladas.

### 6.4 Pestaña Ajustes / Corrección

Dividida en secciones:

**Corregir inventario**
- **RF-C1** Lista de artículos (activos y archivados con filtro) con stock actual y control para **modificar stock**: el usuario puede (a) sumar/restar una cantidad o (b) fijar el stock a un valor. Se guarda como `StockAdjustment` con `delta` calculado y un motivo (`restock`, `correction`, `loss`, `other`) y nota opcional.
- **RF-C2** Historial de ajustes por artículo.

**Ventas**
- **RF-C3** Lista de ventas (más recientes primero) con filtro por día y por estado. Detalle de una venta y acción **Anular** con confirmación (RN-6).

**Catálogo**
- **RF-C4** Gestión de categorías: crear, renombrar, reordenar, archivar.
- **RF-C5** Acceso a artículos archivados para restaurarlos.

**Datos y sincronización**
- **RF-C6** **Exportar** copia completa a archivo JSON (descarga local).
- **RF-C7** **Importar** desde archivo JSON (con confirmación y copia de seguridad previa).
- **RF-C8** Botón **"Actualizar a Drive"** y botón **"Restaurar desde Drive"** (ver sección 7).
- **RF-C9** Indicador **"Última sincronización: hace X"** visible también en la cabecera de la app.
- **RF-C10** Botón **"Comprobar consistencia del inventario"** (`verifyStockConsistency`).
- **RF-C11** Zona de peligro: **borrar todos los datos locales** (doble confirmación).

## 7. Sincronización con Google Drive

**Principio:** los datos viven siempre en local. Drive es una **copia de seguridad / traspaso entre dispositivos**, controlada por el usuario con botones. No hay sincronización automática ni fusión de datos.

### Archivo en Drive
- Nombre: `mercadillo-datos.json`, creado por la app (scope `drive.file`: la app solo ve los archivos que ella creó).
- Contenido: `{ schemaVersion, revision, exportedAt, deviceId, categories, items, sales, adjustments }`.
- Metadato `appProperties.revision` en el archivo de Drive para consultar la revisión sin descargarlo entero.

### Autenticación
- Google Identity Services, flujo de **token en navegador** (`initTokenClient`). Se pide el token solo al pulsar un botón de Drive; no se guarda ningún secreto.
- El `Client ID` se configura en una variable de entorno de Vite (`VITE_GOOGLE_CLIENT_ID`). **No es un secreto**, pero no debe estar hardcodeado en varios sitios.
- Si falla el login o no hay conexión: mensaje claro y recordatorio de que existe **exportar a archivo**.

### Flujo "Actualizar a Drive"
1. Obtener token. Localizar `mercadillo-datos.json` (por `driveFileId` guardado o buscándolo por nombre).
2. Leer `appProperties.revision` del archivo remoto.
3. Si `remoteRevision > meta.lastSyncedRevision` → **aviso de conflicto**: "El Drive tiene datos más recientes que los de este dispositivo". Opciones: **Cancelar**, **Reemplazar Drive con los datos de este dispositivo**, **Restaurar primero desde Drive**.
4. Si no hay conflicto (o el usuario elige reemplazar): subir el JSON con `revision = remoteRevision + 1`, actualizar `appProperties.revision`, y guardar `meta.lastSyncedRevision`, `lastSyncedAt` y `driveFileId`.
5. Si el archivo no existe, crearlo con `revision = 1`.

### Flujo "Restaurar desde Drive"
1. Descargar y **validar** el JSON (esquema y `schemaVersion`).
2. Si `schemaVersion` remoto > versión que entiende la app → **rechazar** con mensaje ("actualiza la app").
3. Mostrar resumen (nº de artículos, ventas, fecha de exportación) y pedir confirmación: sustituirá los datos locales.
4. **Antes de sustituir**, guardar una copia automática del estado local en la tabla `localBackups` (conservar las últimas 3).
5. Sustituir en una transacción, migrar si hace falta, actualizar `meta`.

## 8. Versionado y actualizaciones de la app

- `schemaVersion` en Dexie (`db.version(n)`) y en el JSON. Cada cambio de esquema incluye **migración** (`upgrade`) y un test de migración con datos de la versión anterior.
- Al importar o restaurar un archivo de una versión anterior, se **migra** al esquema actual. De una versión posterior: se rechaza.
- PWA con `registerType: 'prompt'`: cuando hay versión nueva, mostrar aviso "Hay una versión nueva — Actualizar". **Nunca** recargar en mitad de una venta con carrito abierto sin avisar.
- Antes de ejecutar una migración, guardar copia en `localBackups`.
- Al arrancar, llamar a `navigator.storage.persist()` para pedir almacenamiento persistente.

## 9. Requisitos no funcionales

- **RNF-1 Usabilidad táctil:** objetivos táctiles ≥ 48 px, botones **− / +** grandes, uso con **una mano**, legible al **sol** (buen contraste, tema claro por defecto; tema oscuro opcional).
- **RNF-2 Velocidad:** una venta de 3 artículos debe poder registrarse en **≤ 3 toques de interacción principal** tras añadir los artículos (abrir carrito → cobrar). La lista debe ir fluida con **200 artículos**.
- **RNF-3 Offline:** tras la primera carga, la app arranca y funciona sin conexión (service worker con precache de la app).
- **RNF-4 Responsive:** vertical (móvil) y horizontal (tablet). En tablet, lista de artículos y carrito pueden mostrarse **en paralelo**.
- **RNF-5 Idioma:** español (`es-ES`). Textos en un único módulo (`i18n` simple o constantes) para facilitar cambios.
- **RNF-6 Accesibilidad básica:** etiquetas `aria-label` en botones de icono, foco visible, contraste AA.
- **RNF-7 Robustez:** ninguna operación de escritura deja datos a medias (transacciones). Errores de IndexedDB o de Drive se muestran de forma comprensible.
- **RNF-8 Privacidad:** los datos solo se envían a Drive del propio usuario. Sin analítica, sin terceros.
- **RNF-9 Mantenibilidad:** TypeScript estricto, lógica de negocio **separada de la interfaz** (ver estructura).

## 10. Estructura de proyecto sugerida

```
/
├─ SPEC.md
├─ DECISIONS.md          # decisiones y suposiciones tomadas durante el desarrollo
├─ README.md
├─ index.html
├─ vite.config.ts
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx            # shell + navegación inferior
│  ├─ db/                # Dexie: esquema, migraciones, acceso a datos
│  ├─ domain/            # lógica pura SIN React ni Dexie
│  │   ├─ money.ts       # formateo y parseo de céntimos
│  │   ├─ discount.ts    # normalizar modos de descuento + reparto RN-5
│  │   ├─ stats.ts       # cálculos de estadísticas a partir de ventas
│  │   └─ validation.ts
│  ├─ services/          # casos de uso con transacciones (cobrar, anular, ajustar, sync)
│  │   └─ drive/         # auth + cliente de Drive + lógica de sync
│  ├─ features/
│  │   ├─ sale/          # pantalla de venta + carrito
│  │   ├─ items/         # alta/edición de artículos
│  │   ├─ stats/
│  │   └─ settings/
│  ├─ components/        # componentes compartidos
│  └─ test/
└─ public/               # iconos PWA, manifest
```

## 11. Estrategia de tests

Prioridad **alta** (obligatorio):
- `domain/discount.ts`: modos de descuento (precio final, €, %), validación de límites y **reparto RN-5** con tests de propiedades (ejemplos y casos límite: una línea, descuento 0, descuento = subtotal, restos de céntimos, empates).
- `services`: cobrar (descuenta stock y crea venta), anular (devuelve stock), ajuste de stock; comprobar el **invariante** de la sección 4 tras secuencias de operaciones.
- `domain/stats.ts`: totales, rankings, por categoría, por hora; excluir ventas anuladas.
- Migraciones de esquema.
- Lógica de **conflicto de revisión** en sync (con el cliente de Drive **simulado**).

Prioridad **media:** formularios (validaciones) y flujo de carrito con React Testing Library.

Los tests deben ejecutarse con `npm test` y pasar antes de dar una fase por terminada.

## 12. Fases y criterios de aceptación

Cada fase se entrega **funcionando, probada y commiteada** antes de empezar la siguiente.

**Fase 0 — Esqueleto**
- Proyecto Vite + React + TS + Tailwind + Vitest + Dexie + navegación de 3 pestañas vacías, `money.ts` y esquema de datos con `schemaVersion`.
- ✅ `npm run dev`, `npm test` y `npm run build` funcionan. README con instrucciones.

**Fase 1 — Artículos y categorías**
- CRUD de categorías y artículos (con imagen redimensionada y stock inicial → ajuste `initial`).
- ✅ RF-A1…A5, RN-7, RN-8, RN-9 cumplidos; datos persisten al recargar.

**Fase 2 — Venta con carrito y descuento**
- Pantalla de venta (vista lista y vista expositor alternables), filtros, búsqueda, orden, carrito, descuento (3 modos), cobrar, deshacer, aviso de stock.
- ✅ RF-V1…V9, RN-1…RN-5; tests de `discount.ts`, `saleFilter.ts`, `SalePage` y de cobrar en verde.

**Fase 3 — Corrección y anulación**
- Pestaña Ajustes: corregir stock, historial de ajustes, lista/detalle/anulación de ventas, `verifyStockConsistency`.
- ✅ RF-C1…C5, C10, RN-6; invariante verificado en tests.

**Fase 4 — Estadísticas**
- Todas las métricas y gráficas con selector de periodo.
- ✅ RF-E1…E8; tests de `stats.ts`.

**Fase 5 — Exportar/importar y copias locales**
- JSON de exportación/importación con validación y migración; `localBackups`.
- ✅ RF-C6, C7, C11; round-trip exportar → importar produce datos idénticos (test).

**Fase 6 — PWA y offline**
- Manifest, iconos, service worker, aviso de nueva versión, `storage.persist()`.
- ✅ Instalable en Android Chrome; funciona en modo avión tras la primera carga; RNF-3.

**Fase 7 — Sincronización con Drive**
- Login, subir, restaurar, conflicto de revisión, indicador de última sincronización.
- ✅ RF-C8, C9; sección 7 cumplida; documentado en el README cómo crear el Client ID en Google Cloud.

**Fase 8 — Pulido**
- RNF-1, RNF-2, RNF-4, RNF-6; revisión de textos; tema; estados vacíos; manejo de errores.
- ✅ Revisión manual en móvil real o emulador, en vertical y horizontal.

## 13. Fuera de alcance (por ahora)

- Soporte para iOS, varios usuarios o varios dispositivos simultáneos.
- Sincronización automática o fusión de datos.
- Reglas de oferta por artículo ("3x2" automático).
- Precio de coste y beneficio, métodos de pago, impresión de tickets, códigos de barras.
- Empaquetado como APK, publicación en Google Play.

Posibles ampliaciones futuras: precio de coste y beneficio, exportación a hoja de cálculo/CSV, tema oscuro completo, APK con Capacitor.

## 14. Suposiciones a validar con el usuario

- El check "Oferta / descuento" se aplica siempre al **total del ticket**.
- Se permite stock negativo con aviso (RN-3).
- Umbral de "poco stock" por defecto = 2 unidades.
- Las categorías iniciales son Pendientes, Llaveros y Láminas, editables.
