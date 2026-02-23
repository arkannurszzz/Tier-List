/**
 * Resize an image file and convert to JPEG (max 1024×1024, quality 0.85).
 * - Drastically reduces base64 size (4 MB photo → ~100 KB)
 * - White-fill background handles transparent PNGs
 * - All failures surface as rejected Promises (never hangs)
 */
export function resizeImage(file: File): Promise<string>
export function resizeImage(blob: Blob, name?: string): Promise<string>
export function resizeImage(input: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => reject(new Error('File read failed'))

    reader.onload = (e) => {
      const img = new Image()

      img.onerror = () => reject(new Error('Image decode failed'))

      img.onload = () => {
        try {
          const MAX = 1024
          let { width, height } = img
          if (width > MAX || height > MAX) {
            if (width >= height) { height = Math.round((height / width) * MAX); width = MAX }
            else { width = Math.round((width / height) * MAX); height = MAX }
          }

          const canvas = document.createElement('canvas')
          canvas.width  = width
          canvas.height = height

          const ctx = canvas.getContext('2d')
          if (!ctx) { reject(new Error('Canvas unavailable')); return }

          // White fill so transparent areas don't become black in JPEG
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, width, height)
          ctx.drawImage(img, 0, 0, width, height)

          resolve(canvas.toDataURL('image/jpeg', 0.85))
        } catch (err) {
          reject(err)
        }
      }

      img.src = e.target!.result as string
    }

    reader.readAsDataURL(input)
  })
}
