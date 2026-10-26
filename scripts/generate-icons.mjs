// Genereert de PNG-iconen uit public/icon.svg met de Chromium van Playwright. Geen extra afhankelijkheid.
// Gebruik: node scripts/generate-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8')
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  // Maskable: het beeldmerk in de veilige zone (80%) op een effen achtergrond.
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size })
  const inner = t.maskable ? Math.round(t.size * 0.8) : t.size
  const offset = Math.round((t.size - inner) / 2)
  await page.setContent(
    `<html><body style="margin:0;background:${t.maskable ? '#1d4e89' : 'transparent'}">` +
      `<img src="${dataUrl}" style="position:absolute;left:${offset}px;top:${offset}px;width:${inner}px;height:${inner}px"></body></html>`,
  )
  const png = await page.screenshot({ type: 'png', omitBackground: !t.maskable, clip: { x: 0, y: 0, width: t.size, height: t.size } })
  writeFileSync(new URL(`../public/${t.file}`, import.meta.url), png)
  console.log(`${t.file} ${png.length} bytes`)
}
await browser.close()
