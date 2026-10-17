/**
 * Textos de interfaz de usuario en español.
 * RNF-5: todos los textos visibles al usuario se centralizan aquí
 * para facilitar cambios y posible traducción futura.
 *
 * Convención: objeto plano agrupado por pantalla/funcionalidad.
 */

export const UI = {
  // Navegación inferior
  nav: {
    sale: 'Venta',
    stats: 'Estadísticas',
    settings: 'Ajustes',
  },

  // Pantalla de Venta (Fase 2)
  sale: {
    title: 'Venta',
    allCategories: 'Todas',
    cartEmpty: 'El carrito está vacío',
    cartBar: (count: number, total: string) => `${count} art. · ${total}`,
    checkOut: 'Cobrar',
    clearCart: 'Vaciar carrito',
    clearCartConfirm: '¿Vaciar el carrito?',
    undo: 'Deshacer',
    discount: 'Oferta / descuento',
    discountMode: {
      finalPrice: 'Precio final',
      euros: 'Descuento €',
      percent: 'Descuento %',
    },
    subtotal: 'Subtotal',
    total: 'Total a cobrar',
    lastUnit: 'Última unidad',
    outOfStock: 'Sin stock',
    stockWarning: 'Cantidad supera el stock disponible',
  },

  // Artículos (Fase 1)
  items: {
    newItem: 'Nuevo artículo',
    editItem: 'Editar artículo',
    name: 'Nombre',
    category: 'Categoría',
    price: 'Precio de venta (€)',
    stockInitial: 'Stock inicial',
    currentStock: 'Stock actual',
    image: 'Foto',
    photoHelp: 'Cámara o galería (máx 256px)',
    removePhoto: 'Quitar foto',
    changePhoto: 'Cambiar foto',
    save: 'Guardar',
    archive: 'Archivar artículo',
    restore: 'Restaurar artículo',
    archived: 'Archivado',
    namePlaceholder: 'Ej: Pendientes flor',
    newCategory: '+ Nueva categoría…',
    createCategoryPrompt: 'Nombre de la nueva categoría:',
    noItemsYet: 'Aún no hay artículos',
    noItemsHelp: 'Pulsa el botón + para añadir tu primer artículo.',
    edit: 'Editar',
  },

  // Estadísticas (Fase 4)
  stats: {
    title: 'Estadísticas',
    today: 'Hoy',
    last7: 'Últimos 7 días',
    all: 'Todo',
    custom: 'Rango',
    revenue: 'Ingresos',
    sales: 'Ventas',
    avgTicket: 'Ticket medio',
    units: 'Unidades',
    totalDiscount: 'Descuentos',
    topItems: 'Más vendidos',
    byCategory: 'Por categoría',
    byHour: 'Por hora',
    recentSales: 'Ventas recientes',
    noSales: 'Sin ventas en este periodo',
    noStock: 'Sin ventas · Stock bajo',
  },

  // Ajustes / Corrección (Fase 3)
  settings: {
    title: 'Ajustes',
    inventory: 'Corregir inventario',
    salesHistory: 'Ventas',
    catalog: 'Catálogo',
    categoriesTitle: 'Categorías',
    newCategoryBtn: '+ Añadir categoría',
    renameCategoryPrompt: 'Nuevo nombre para la categoría:',
    archiveCategoryConfirm: '¿Archivar esta categoría? (no debe tener artículos activos)',
    archivedItemsTitle: 'Artículos archivados',
    noArchivedItems: 'No hay artículos archivados',
    moveUp: 'Subir',
    moveDown: 'Bajar',
    activeItemsCount: (count: number) => `${count} art. activos`,
    data: 'Datos y sincronización',
    export: 'Exportar copia',
    import: 'Importar copia',
    driveUpload: 'Actualizar a Drive',
    driveRestore: 'Restaurar desde Drive',
    lastSync: 'Última sincronización',
    neverSynced: 'Nunca sincronizado',
    checkConsistency: 'Comprobar consistencia del inventario',
    dangerZone: 'Zona de peligro',
    deleteAll: 'Borrar todos los datos',
    deleteAllConfirm: '¿Borrar TODOS los datos? Esta acción no se puede deshacer.',
    deleteAllConfirm2: 'Escribe BORRAR para confirmar',
    localBackupsTitle: 'Copias locales de seguridad',
    localBackupsDesc: 'Instantáneas automáticas guardadas antes de importar o resetear (máximo 3).',
    restoreBackup: 'Restaurar',
    restoreBackupConfirm: '¿Restaurar esta copia de seguridad? Se sustituirán los datos actuales.',
    exportSuccess: 'Copia de seguridad descargada correctamente.',
    importSuccess: 'Copia de seguridad importada con éxito.',
    resetSuccess: 'Todos los datos locales han sido restablecidos.',
    driveUploadSuccess: 'Copia subida a Google Drive con éxito.',
    driveRestoreSuccess: 'Datos restaurados desde Google Drive.',
    driveConflictTitle: 'Conflicto con Google Drive',
    driveConflictDesc: 'Google Drive contiene datos más recientes que este dispositivo.',
    driveReplaceRemote: 'Reemplazar datos de Drive',
    driveRestoreFirst: 'Restaurar primero desde Drive',
    voidSale: 'Anular venta',
    voidSaleConfirm: '¿Anular esta venta? El stock se devolverá.',
    adjustStock: 'Ajustar stock',
    adjustReason: {
      restock: 'Reposición',
      correction: 'Corrección',
      loss: 'Pérdida / merma',
      other: 'Otro',
    },
  },

  // Errores y estados
  errors: {
    generic: 'Algo ha ido mal. Inténtalo de nuevo.',
    dbError: 'Error al acceder a los datos locales.',
    driveError: 'Error al conectar con Google Drive.',
    importInvalid: 'El archivo no tiene el formato correcto.',
    importVersionNewer: 'El archivo es de una versión más nueva. Actualiza la app.',
    stockNegative: 'Aviso: el stock quedará en negativo.',
  },

  // General
  common: {
    confirm: 'Confirmar',
    cancel: 'Cancelar',
    save: 'Guardar',
    close: 'Cerrar',
    delete: 'Eliminar',
    yes: 'Sí',
    no: 'No',
    loading: 'Cargando…',
    empty: 'Sin datos',
    add: 'Añadir',
    remove: 'Quitar',
    search: 'Buscar',
  },
} as const
