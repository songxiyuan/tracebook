import { downloadText } from '../export'

/**
 * Diagram export. Two entry shapes feed one pipeline:
 *  - the sequence renderer hands us its live <svg> (styles are inlined so the
 *    exported file is self-contained);
 *  - the flow renderer hands us a pre-built standalone SVG string (Vue Flow
 *    draws nodes as HTML, so it cannot be serialized directly — see flow-to-svg).
 * Both then export to SVG (verbatim) or PNG (rasterized via canvas).
 */
const STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
  'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor',
]

/** Clone an SVG and bake computed styles onto each element so it renders standalone. */
export function inlineSvgString(source: SVGSVGElement): string {
  const clone = source.cloneNode(true) as SVGSVGElement
  const sourceNodes = source.querySelectorAll('*')
  const cloneNodes = clone.querySelectorAll('*')
  for (let i = 0; i < sourceNodes.length; i += 1) {
    const computed = getComputedStyle(sourceNodes[i] as Element)
    const target = cloneNodes[i] as SVGElement
    let style = ''
    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop)
      if (value) style += `${prop}:${value};`
    }
    if (style) target.setAttribute('style', style)
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`
}

export function downloadSvg(filename: string, svg: string) {
  downloadText(filename, svg, 'image/svg+xml')
}

/** Rasterize an SVG string to a PNG blob via an offscreen canvas. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context unavailable')
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel') || '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))), 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to rasterize SVG'))
    image.src = url
  })
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
