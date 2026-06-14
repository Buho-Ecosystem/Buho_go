// Einundzwanzig meetup pin.
//
// Renders the square Einundzwanzig logo onto a white disc with a Bitcoin-orange
// ring, rasterized to a MapLibre image so meetups render in a symbol layer (and
// stay crisp / clusterable) just like the merchant pins. The white disc + orange
// ring read on any basemap and set a meetup apart from the orange-filled
// merchant discs.
//
// The logo lives in public/ and is loaded as a same-origin <img> via the
// base-aware URL, so the canvas stays untainted and getImageData() works. We
// don't fetch() it (CapacitorHttp patches fetch; <img> loads natively).

const LOGO_URL = (import.meta.env.BASE_URL || '/') + 'Einundzwanzig/einundzwanzig-square.svg'

/**
 * Build the meetup pin as a MapLibre-ready image.
 * @param {number} size square pin size in px (rendered at pixelRatio 2)
 * @returns {Promise<{width:number,height:number,data:Uint8Array}>}
 */
export function loadEinundzwanzigPinImage(size = 72) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        const r = size / 2 - 6

        // White disc with a soft drop shadow.
        ctx.shadowColor = 'rgba(0,0,0,0.22)'
        ctx.shadowBlur = 6
        ctx.shadowOffsetY = 2
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.shadowOffsetY = 0

        // Bitcoin-orange ring — the Einundzwanzig brand accent.
        ctx.lineWidth = 5
        ctx.strokeStyle = '#F7931A'
        ctx.stroke()

        // Logo centred at ~62% of the disc.
        const g = size * 0.62
        ctx.drawImage(img, (size - g) / 2, (size - g) / 2, g, g)

        resolve({
          width: size,
          height: size,
          data: new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer),
        })
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('Einundzwanzig pin failed to load'))
    img.src = LOGO_URL
  })
}
