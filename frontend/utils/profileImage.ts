/**
 * Reduce una imagen elegida por el usuario a un JPEG pequeño, listo para guardar
 * dentro del perfil.
 *
 * Los perfiles viven en `localStorage`, que tiene unos pocos megas para todo. Una foto
 * de móvil tal cual pesa más que eso ella sola, así que la portada del perfil se
 * guarda ya reducida: ancha (es una franja), pero de pocos cientos de kilobytes.
 *
 * `resizeImage` de `Library.tsx` hace lo mismo para el avatar, pero está fijada a un
 * cuadrado de 128 px y no se exporta; esta es su hermana para imágenes anchas.
 */
export function resizeToJpeg(file: File, maxWidth = 960, maxHeight = 400, quality = 0.82): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => {
      const source = reader.result;
      if (typeof source !== 'string') {
        reject(new Error('No se pudo leer la imagen.'));
        return;
      }
      const image = new Image();
      image.onerror = () => reject(new Error('El fichero no es una imagen válida.'));
      image.onload = () => {
        // Una imagen más alta que la franja se recorta al centro: la portada se pinta
        // con `cover`, así que lo que sobra por arriba y por abajo no se iba a ver.
        const ratio = maxWidth / maxHeight;
        const sw = image.width;
        let sh = image.height;
        let sy = 0;
        if (sw / sh < ratio) {
          sh = Math.max(1, Math.round(sw / ratio));
          sy = Math.round((image.height - sh) / 2);
        }
        const width = Math.max(1, Math.min(maxWidth, sw));
        const height = Math.max(1, Math.round((width * sh) / sw));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('No se pudo preparar la imagen.'));
          return;
        }
        context.drawImage(image, 0, sy, sw, sh, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      image.src = source;
    };
    reader.readAsDataURL(file);
  });
}
