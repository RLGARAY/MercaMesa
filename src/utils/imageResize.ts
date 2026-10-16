/**
 * imageResize.ts — Redimensionado de imágenes en cliente.
 *
 * Ref: RF-A2. Convierte el archivo de imagen seleccionado por el usuario
 * a un data URL JPEG de máximo 256 px (lado mayor) y calidad ~0.7.
 * El resultado se guarda en Item.imageThumb.
 *
 * Por qué en cliente: evita subir imágenes grandes al servidor (no tenemos)
 * y IndexedDB funciona bien con data URLs de ~30-60 KB.
 */

/** Lado máximo en píxeles del thumbnail. Ref: SPEC sección 4. */
const MAX_SIDE_PX = 256

/** Calidad JPEG para el thumbnail. Ref: SPEC sección 4. */
const JPEG_QUALITY = 0.7

/**
 * Redimensiona un archivo de imagen a un thumbnail JPEG y lo devuelve
 * como data URL.
 *
 * @param file - Archivo de imagen del input file del usuario
 * @returns Promise con el data URL JPEG listo para guardar en imageThumb
 */
export async function resizeImageToThumb(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // createObjectURL crea una URL temporal en memoria para leer el archivo
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      // Calcular el nuevo tamaño manteniendo la proporción
      let w = img.width
      let h = img.height

      if (w > h) {
        // Imagen apaisada: el lado largo es el ancho
        if (w > MAX_SIDE_PX) {
          h = Math.round((h * MAX_SIDE_PX) / w)
          w = MAX_SIDE_PX
        }
      } else {
        // Imagen vertical o cuadrada: el lado largo es el alto
        if (h > MAX_SIDE_PX) {
          w = Math.round((w * MAX_SIDE_PX) / h)
          h = MAX_SIDE_PX
        }
      }

      // Dibujar en canvas y exportar como JPEG
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('No se pudo crear el contexto del canvas'))
        return
      }

      ctx.drawImage(img, 0, 0, w, h)

      // Liberar la URL temporal antes de resolver
      URL.revokeObjectURL(objectUrl)

      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('No se pudo cargar la imagen'))
    }

    img.src = objectUrl
  })
}
