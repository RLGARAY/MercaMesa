# DECISIONS.md — Decisiones y suposiciones del proyecto MercaMesa

> Cada entrada recoge: fecha, decisión tomada, motivo y alternativa descartada.
> Ref: instrucciones del agente, sección "Fuente de verdad".

---

## Fase 0 — Esqueleto

### 2026-10-16 — Imágenes: data URL en el registro Item

**Decisión:** Guardar `imageThumb` como data URL JPEG directamente en el campo del objeto `Item` en IndexedDB, tal como especifica el SPEC.

**Motivo:** Máxima simplicidad. No requiere un object store separado ni lógica adicional.

**Riesgo anotado:** Con 200 artículos y fotos de ~40 KB cada una, el objeto Item puede pesar hasta 8 MB en total. Si se detecta degradación de rendimiento al listar artículos (p. ej. lag > 100 ms), se puede migrar a un object store separado `itemImages` con `itemId` como clave, cargando las imágenes bajo demanda.

**Alternativa descartada:** Object store separado `itemImages` (más eficiente pero más complejo en Fase 0).

---

### 2026-10-16 — Carrito persistente en localStorage

**Decisión:** El estado del carrito se guarda en `localStorage` (en lugar de `sessionStorage` que menciona el SPEC como opción).

**Motivo:** El usuario confirmó que quiere que el carrito sobreviva a cerrar y reabrir el navegador, no solo a recargar la página. `localStorage` persiste indefinidamente hasta que se borra explícitamente.

**Alternativa descartada:** `sessionStorage` (solo persiste en la sesión del navegador; el SPEC lo menciona como "deseable, no obligatorio").

---

### 2026-10-16 — Campo de descuento sin step

**Decisión:** El input del campo de descuento es un número libre sin restricción de `step`.

**Motivo:** El usuario prefiere flexibilidad total para introducir cualquier valor. El SPEC mencionaba `step` de 0,50 € para precios, pero el usuario ha confirmado que prefiere un campo libre.

**Alternativa descartada:** `step="0.50"` (restrictivo, impide valores como 1,25 €).

**Nota:** Los precios de artículos también usarán input libre (sin step). La validación de que el importe es un entero de céntimos la hace `parseCentsFromString()`.

---

### 2026-10-16 — "Corregir inventario" = ajuste manual (RF-C1), no reparación automática

**Decisión:** La función `verifyStockConsistency()` (RF-C10) es una herramienta de diagnóstico técnico que comprueba la consistencia matemática interna (`stock = suma(ajustes) − suma(ventas activas)`). El flujo de "corrección" para el usuario es RF-C1: pantalla de ajuste manual de stock donde el usuario introduce el valor real. No hay reparación automática.

**Motivo:** El stock es físico. Solo el usuario sabe cuántas unidades tiene realmente. Cualquier "reparación automática" sería inventada por la app, no basada en la realidad.

**Alternativa descartada:** Auto-corrección que calcula el delta y crea un ajuste automático (frágil, confuso para el usuario).

---

### 2026-10-16 — Indicador de stock: solo "Última unidad" (stock = 1)

**Decisión:** Mostrar chip "Última unidad" solo cuando `stock === 1`. Sin umbral configurable. Stock ≤ 0 muestra aviso diferente (sin stock / stock negativo).

**Motivo:** El usuario prefirió esta opción más simple y clara frente al umbral configurable de 2 unidades que sugería el SPEC (sección 14).

**Cambio respecto al SPEC:** RF-E7 menciona "poco stock (≤ 2, valor configurable)". Esta decisión simplifica a un solo umbral fijo (= 1) y elimina la configurabilidad.

**Alternativa descartada:** Umbral configurable en Ajustes (más complejo, más casos de prueba).

---

### 2026-10-16 — Navegación: estado local en App.tsx (sin react-router)

**Decisión:** La navegación entre las 3 pestañas se gestiona con `useState` en `App.tsx`. No se usa `react-router` ni ninguna librería de enrutamiento.

**Motivo:** La app tiene exactamente 3 vistas principales y no necesita URLs navegables (es una PWA en modo standalone). Un `useState` es más simple, más fácil de entender y sin dependencias extra.

**Alternativa descartada:** `react-router-dom` (añade complejidad y dependencia innecesaria para 3 vistas).

**Fuera de alcance (ideas para el futuro):** Si se añaden subvistas con navegación hacia atrás (p. ej. detalle de venta), se podría adoptar `react-router` o un sistema de navegación más elaborado.

---

### 2026-10-16 — Iconos: SVG inline en Fase 0 (sin librería de iconos)

**Decisión:** Los iconos de la barra de navegación son SVGs inline en el componente. No se instala ninguna librería de iconos.

**Motivo:** Evitar dependencias innecesarias en Fase 0. En Fase 8 (pulido) se puede evaluar si hace falta una librería.

**Alternativa descartada:** `lucide-react` o `heroicons` (populares y mantenidas, pero innecesarias ahora).

---

### 2026-10-16 — recharts actualizado a v3

**Decisión:** Se instala `recharts@^3.0.0` en lugar de la v2 del plan inicial.

**Motivo:** recharts v2.x está deprecated en npm. Como no se usa hasta Fase 4, el cambio es sin riesgo y evita acumular deuda técnica desde el principio.

**Alternativa descartada:** Mantener v2 (funcional pero deprecated).

---

### 2026-10-16 — parseCentsFromString: validación con regex antes de parseFloat

**Decisión:** Se añade validación `/^-?\d+(\.\d+)?$/` antes de `parseFloat`.

**Motivo:** `parseFloat('1.50€')` devuelve `1.5` ignorando el `€` — silencioso e incorrecto. La regex garantiza que solo se aceptan strings que son exclusivamente un número.

**Aprendizaje:** `parseCentsFromString('1.005')` devuelve `100` (no `101`) por la imprecisión de IEEE 754: `1.005 * 100 = 100.4999...`. Para importes reales (máximo 2 decimales en euros) esto no es problema práctico. El test se corrigió para documentar el comportamiento real.

---

## Fase 1 — Artículos y categorías

### 2026-10-16 — Reactividad con dexie-react-hooks (useLiveQuery)

**Decisión:** Utilizar el hook oficial `useLiveQuery` de `dexie-react-hooks` para consultar IndexedDB en los componentes React (`SalePage`, `SettingsPage`).

**Motivo:** Sincroniza automáticamente la UI cada vez que se produce una mutación en IndexedDB (creación, edición, archivado) sin necesidad de recrear listeners manuales ni gestionar estados duplicados. Es la solución estándar y minimalista recomendada por el creador de Dexie.

**Alternativa descartada:** Estado de React local sincronizado a mano con `useEffect` tras cada llamada a servicio (propenso a desincronizaciones si múltiples pantallas o llamadas tocan la BD).

---

### 2026-10-16 — Redimensionado de imagen en Canvas del cliente (RF-A2)

**Decisión:** Procesar el archivo seleccionado por el usuario en el navegador mediante un elemento `<canvas>` invisible que escala proporcionalmente el lado mayor a un máximo de 256 px y exporta como data URL JPEG con calidad 0.7.

**Motivo:** Se cumple fielmente el requisito RF-A2 sin ninguna librería pesada externa de procesamiento de imágenes. Las imágenes quedan con un peso reducido (~20-40 KB) para ser almacenadas directamente en IndexedDB.

---

### 2026-10-16 — Creación rápida de categoría inline (RF-A1)

**Decisión:** En el selector de categorías del formulario de artículos se incluye un botón "+ Nueva categoría..." que despliega un campo de texto inline para crear y asignar una categoría inmediatamente sin salir del formulario.

**Motivo:** Agiliza el alta de artículos en el mercadillo si el vendedor se da cuenta de que no tiene creada la categoría adecuada.

---

## Fase 2 — Venta con carrito y descuento

### 2026-10-16 — Algoritmo de reparto de descuento por el método del mayor resto (RN-5)

**Decisión:** Implementar `distributeDiscount` en `src/domain/discount.ts` siguiendo estrictamente el método Hamilton-Hare:
1. Asignar `floor(exact)` a cada línea.
2. Calcular los céntimos restantes `discountCents - suma(floors)`.
3. Ordenar por mayor parte decimal descartada y asignar +1 céntimo.
4. En caso de empate decimal, desempate por orden original de la línea de venta.

**Invariantes garantizados por tests (incluyendo property-based con 100 ejecuciones aleatorias):**
- `suma(lineDiscountCents) === discountCents`
- `0 <= lineDiscountCents <= lineListCents`
- `suma(lineNetCents) === totalCents`

---

### 2026-10-16 — Deshacer cobro mediante anulación atómica temporal (RF-V6, RN-6)

**Decisión:** Al pulsar "Cobrar", se limpia el carrito inmediatamente y se presenta un toast flotante con la confirmación del total y el botón "Deshacer" durante 7 segundos. Si se pulsa "Deshacer", se ejecuta `voidSale(saleId)` devolviendo el stock de forma atómica en Dexie. Si transcurren los 7 segundos, la venta permanece activa definitivamente.

**Motivo:** Evita bloqueos en la mesa del mercadillo ante toques accidentales y permite corregir un cobro erróneo al instante sin tener que ir a la pestaña de Ajustes.

---

## Fase 3 — Corrección y anulación

### 2026-10-16 — Corrección de stock con modo absoluto y relativo (RF-C1)

**Decisión:** En el formulario de ajuste de stock de la pestaña Ajustes se ofrecen dos métodos:
- **Fijar valor exacto:** el usuario introduce el recuento físico real (ej: 8 piezas) y el sistema calcula automáticamente el `delta = nuevoStock - stockActual`.
- **Sumar / Restar:** el usuario introduce un número positivo o negativo (ej: `+5` por reposición o `-2` por merma).

Ambos métodos registran siempre un `StockAdjustment` con motivo obligatorio (`restock`, `correction`, `loss`, `other`), nota opcional y actualizan el stock del artículo en una única transacción atómica Dexie.

---

### 2026-10-16 — Subsecciones en la pantalla de Ajustes

**Decisión:** Dividir la pantalla de Ajustes en 4 secciones navegables mediante chips horizontales:
1. **Inventario:** stock actual, botón de ajuste e historial de movimientos por artículo (RF-C1, RF-C2).
2. **Ventas:** lista de ventas con filtros de fecha/estado, modal de detalle con snapshots inmutables y botón de anular (RF-C3, RN-6).
3. **Catálogo:** gestión de categorías y artículos archivados (RF-C4, RF-C5).
4. **Datos / Test:** diagnóstico de consistencia matemática del stock (RF-C10) y placeholders de sincronización.

**Motivo:** En pantallas móviles, agrupar las herramientas por contexto evita el scroll interminable y hace la app intuitiva para usar en el mercadillo.

---

## Fase 4 — Estadísticas

### 2026-10-16 — Gráficas interactivas con Recharts (RF-E4, RF-E5)

**Decisión:** Utilizar `recharts@3` con `ResponsiveContainer` para las gráficas de ingresos por categoría (`BarChart` horizontal/vertical con paleta de colores de marca) y distribución de ventas por hora del día (`8:00` a `22:00`).

**Motivo:** Recharts es la librería elegida en el SPEC sección 2. Permite tooltips formateados en euros y renderizado SVG responsivo fluido en pantallas de móvil y tablet Android.

---

### 2026-10-16 — Exclusión estricta de ventas anuladas en el dominio (RF-E8)

**Decisión:** En `src/domain/stats.ts`, la función `filterSalesByPeriod` y todas las funciones de cálculo filtran obligatoriamente `sale.status === 'active'`. Las ventas con `status === 'voided'` quedan excluidas del total cobrado, número de ventas, ticket medio, rankings y gráficas por categoría y hora.

---

## Fase 5 — Exportar/importar y copias locales

### 2026-10-16 — Estructura estándar de BackupPayload y validación estricta (RF-C6, RF-C7, SPEC secciones 7 y 8)

**Decisión:** El payload JSON exportado e importado sigue el formato exacto del SPEC:
`{ schemaVersion, revision, exportedAt, deviceId, categories, items, sales, adjustments }`.
Al importar, la función `validateBackupPayload`:
1. Comprueba la integridad del JSON y que todas las colecciones requeridas sean arrays.
2. Si `schemaVersion` del archivo > versión que entiende la app: rechaza la importación con mensaje claro al usuario ("El archivo es de una versión más nueva. Actualiza la app.").
3. Si es válido, muestra un modal de resumen (nº de categorías, artículos, ventas y ajustes) solicitando confirmación antes de aplicar cambios.

---

### 2026-10-16 — Retención máxima de 3 copias en localBackups y prevención de pérdida de datos (SPEC sección 7)

**Decisión:** Antes de cualquier operación destructiva (importar archivo, restaurar snapshot local o vaciar datos), se guarda automáticamente un snapshot del estado completo en la tabla `localBackups` con su motivo (`before-import`, `before-restore`, `before-migration`).
Se conservan estrictamente las **3 copias más recientes**, purgando automáticamente las más antiguas para proteger la cuota de IndexedDB.
El usuario puede revisar y restaurar cualquiera de estas copias desde la sección "Datos / Test".

---

### 2026-10-16 — Zona de peligro: doble confirmación tipográfica (RF-C11)

**Decisión:** El borrado total de datos locales requiere un modal en dos pasos que exige al usuario escribir exactamente la palabra "BORRAR" en mayúsculas para activar el botón rojo de borrado definitivo.
Al ejecutarse: guarda copia de seguridad en `localBackups`, limpia las tablas de negocio, vacía el carrito en `localStorage` y vuelve a inicializar las 3 categorías por defecto (RN-9).

---

## Fase 6 — PWA y offline

### 2026-10-17 — Actualización protegida con guardia de venta activa (SPEC sección 8)

**Decisión:** Se configura `vite-plugin-pwa` con `registerType: 'prompt'`. Cuando el Service Worker detecta una versión nueva (`needRefresh`), muestra un aviso accesible superior con botón "Actualizar" y opción "Más tarde".
Al pulsar "Actualizar", la utilidad `isSaleCartActive()` inspecciona el carrito persistido. Si contiene artículos activos, se intercepta la recarga y se abre un modal de advertencia que informa al usuario para evitar pérdidas involuntarias durante un cobro en la mesa del mercadillo.

---

### 2026-10-17 — Iconos canónicos y compatibilidad Android (maskable)

**Decisión:** Se incorporan los iconos PNG requeridos por el estándar PWA en Android Chrome:
- `icon-192.png` y `icon-512.png` con `purpose: 'any'`
- `icon-512-maskable.png` con `purpose: 'maskable'` (fondo `#f97316` a sangre para soportar recortes circulares de Android sin bordes blancos)
- `apple-touch-icon.png` y `favicon.png` para navegadores adicionales.

---

### 2026-10-17 — Indicador no intrusivo de conectividad offline (RNF-3) y persistencia de storage

**Decisión:** Se monitoriza la conectividad en tiempo real mediante `useNetworkStatus()`. Al pasar a modo sin conexión, se muestra una barra superior discreta indicando que la app continúa operativa al 100% en local.
Asimismo, en la pestaña "Datos / Test" se refleja el estado de `navigator.storage.persisted()` para asegurar al usuario que sus datos no serán purgados por falta de espacio en el dispositivo.

---

## Fase 7 — Sincronización con Google Drive

### 2026-10-17 — Aislamiento del cliente tras la interfaz DriveClient (SPEC sección 7)

**Decisión:** El cliente HTTP de Google Drive se aísla completamente tras la interfaz `DriveClient`.
`GoogleDriveClient` implementa las llamadas REST v3 multipart (`POST`, `PATCH`, `GET alt=media`) con scope `drive.file` usando el token obtenido en navegador con Google Identity Services (`initTokenClient`).
Para los tests automatizados, se utiliza `InMemoryDriveClient`, permitiendo verificar todo el flujo de sincronización, actualización de metadatos y resolución de conflictos sin conexión ni credenciales reales.

---

### 2026-10-17 — Resolución de conflicto de revisión (RF-C8, SPEC sección 7)

**Decisión:** Al pulsar "Actualizar a Drive", se lee el metadato `appProperties.revision` del archivo remoto. Si `remoteRevision > localRevision`:
- Se intercepta la operación y se muestra el modal de conflicto.
- El usuario puede:
  1. **Cancelar:** no se altera ningún dato.
  2. **Reemplazar datos de Drive:** fuerza la subida calculando `revision = max(remoteRevision, localRevision) + 1`.
  3. **Restaurar primero desde Drive:** descarga la copia de Drive, muestra el resumen previo y la sustituye en local (guardando antes una copia de seguridad en `localBackups`).

---

### 2026-10-17 — Indicador reactivo de última sincronización en cabecera y ajustes (RF-C9)

**Decisión:** Se centraliza el estado de sincronización en el hook `useSyncInfo()`, que lee `meta.lastSyncedAt` y `lastSyncedRevision` de IndexedDB y actualiza periódicamente el texto relativo en español ("Nunca sincronizado", "Hace unos segundos", "Hace 5 min", "Ayer").
El indicador se muestra de forma permanente en la cabecera compacta de `App.tsx` y en el panel de Google Drive de Ajustes.

---

## Ideas fuera de alcance (SPEC sección 13)

- **Precio de coste y beneficio:** interesante para saber el margen por artículo. Requiere modelo de datos adicional.
- **Exportación CSV/Excel:** útil para análisis externo. Puede añadirse en Fase 5 si hay tiempo.
- **Tema oscuro:** deseable para uso nocturno. Fase 8 si hay tiempo.
- **APK con Capacitor:** para distribuir en Google Play. Fase futura.
- **Reglas de oferta por artículo (3x2):** descartado del alcance actual.



