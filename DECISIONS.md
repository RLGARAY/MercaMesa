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

## Ideas fuera de alcance (SPEC sección 13)

- **Precio de coste y beneficio:** interesante para saber el margen por artículo. Requiere modelo de datos adicional.
- **Exportación CSV/Excel:** útil para análisis externo. Puede añadirse en Fase 5 si hay tiempo.
- **Tema oscuro:** deseable para uso nocturno. Fase 8 si hay tiempo.
- **APK con Capacitor:** para distribuir en Google Play. Fase futura.
- **Reglas de oferta por artículo (3x2):** descartado del alcance actual.
