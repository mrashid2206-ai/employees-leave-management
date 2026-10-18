// Regenerate the PNG app icons from public/icon.svg:  node scripts/generate-icons.mjs
//
// Why PNGs at all: the manifest used to list only the SVG, and several Android launchers
// and every iOS version ignore SVG app icons, so "Add to Home Screen" fell back to a
// screenshot or a letter tile. Rendering through Playwright's headless Chromium (already a
// dev dependency for e2e) avoids adding an image library just for this.
//
// Outputs (all in public/):
//   icon-192.png, icon-512.png       purpose "any": the SVG as drawn, transparent corners
//   icon-maskable-512.png            purpose "maskable": full-bleed background with the
//                                    artwork inside the 80% safe circle, so a launcher's
//                                    circle/squircle mask never clips the lettering
//   apple-touch-icon.png (180)       iOS fills transparency with black and rounds the
//                                    corners itself, so it gets a full-bleed square too
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const root = process.cwd()
const svg = await readFile(path.join(root, 'public', 'icon.svg'), 'utf8')
const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
const BRAND = '#1976D2' // the SVG's own background, so the padding is seamless

const variants = [
  { file: 'icon-192.png', size: 192, fullBleed: false, scale: 1 },
  { file: 'icon-512.png', size: 512, fullBleed: false, scale: 1 },
  // 0.72 leaves the text comfortably inside the maskable safe zone (a centred circle of
  // 80% diameter); the corners of the artwork's rounded square may be masked, which is fine.
  { file: 'icon-maskable-512.png', size: 512, fullBleed: true, scale: 0.72 },
  { file: 'apple-touch-icon.png', size: 180, fullBleed: true, scale: 0.9 },
]

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const v of variants) {
    await page.setViewportSize({ width: v.size, height: v.size })
    const inner = Math.round(v.size * v.scale)
    await page.setContent(`<!doctype html>
      <html><body style="margin:0">
        <div id="icon" style="width:${v.size}px;height:${v.size}px;display:flex;align-items:center;justify-content:center;background:${v.fullBleed ? BRAND : 'transparent'}">
          <img src="${svgUrl}" width="${inner}" height="${inner}" style="display:block">
        </div>
      </body></html>`)
    await page.waitForFunction(() => document.querySelector('img')?.complete)
    await page.locator('#icon').screenshot({ path: path.join(root, 'public', v.file), omitBackground: true })
    console.log(`wrote public/${v.file} (${v.size}x${v.size})`)
  }
} finally {
  await browser.close()
}
