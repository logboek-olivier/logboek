import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test'
import { mockGithub } from './helpers/fake-github'
import { collectConsoleErrors, createNewLogbook } from './helpers/logbook'

// Kaart soepel (ronde 2, PR 2): echte touchgebaren via het Chrome DevTools-protocol op 360 px. Knijpen houdt het punt
// onder het midden van de vingers op zijn plek (ook als de vingers tegelijk schuiven), één vinger schuift met de vinger
// mee, loslaten na snel vegen loopt licht uit, dubbeltik zoomt in rond het tikpunt (zonder een punt te zetten), een tik
// zet een punt, zoomen stopt bij de grenzen, en de pagina scrolt niet mee. Marge: enkele pixels.

test.use({ viewport: { width: 360, height: 800 }, geolocation: { latitude: 17.9, longitude: -62.85 }, permissions: ['geolocation'] })

interface Pt {
  x: number
  y: number
}

const MARGIN = 3

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: readonly Pt[]) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id, radiusX: 2, radiusY: 2, force: 1 })) })
}

/** Twee vingers van a0/b0 naar a1/b1 in stappen, dan los. */
async function pinch(cdp: CDPSession, a0: Pt, b0: Pt, a1: Pt, b1: Pt, steps = 12) {
  await touch(cdp, 'touchStart', [a0, b0])
  for (let i = 1; i <= steps; i++) {
    const k = i / steps
    const lerp = (p: Pt, q: Pt) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k })
    await touch(cdp, 'touchMove', [lerp(a0, a1), lerp(b0, b1)])
  }
  await touch(cdp, 'touchEnd', [])
}

/** Eén vinger van p naar q; `hold` ms stilhouden voor het loslaten (geen uitloop). */
async function drag(page: Page, cdp: CDPSession, p: Pt, q: Pt, steps: number, hold: number) {
  await touch(cdp, 'touchStart', [p])
  for (let i = 1; i <= steps; i++) await touch(cdp, 'touchMove', [{ x: p.x + ((q.x - p.x) * i) / steps, y: p.y + ((q.y - p.y) * i) / steps }])
  if (hold) await page.waitForTimeout(hold)
  await touch(cdp, 'touchEnd', [])
}

async function tap(cdp: CDPSession, p: Pt) {
  await touch(cdp, 'touchStart', [p])
  await touch(cdp, 'touchEnd', [])
}

async function centerOf(locator: Locator): Promise<Pt> {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function expectNear(actual: Pt, expected: Pt, margin = MARGIN) {
  expect(Math.abs(actual.x - expected.x), `x ${actual.x.toFixed(1)} ≈ ${expected.x.toFixed(1)}`).toBeLessThanOrEqual(margin)
  expect(Math.abs(actual.y - expected.y), `y ${actual.y.toFixed(1)} ≈ ${expected.y.toFixed(1)}`).toBeLessThanOrEqual(margin)
}

/** Waar een punt hoort na zoomen met factor k rond m, terwijl het midden naar m1 schuift. */
function scaled(p: Pt, m: Pt, k: number, m1: Pt = m): Pt {
  return { x: m1.x + (p.x - m.x) * k, y: m1.y + (p.y - m.y) * k }
}

test('kaart: knijpen houdt het punt onder de vingers op zijn plek, schuiven, uitloop, dubbeltik, tik, grenzen, pagina scrolt niet mee', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectConsoleErrors(page)
  await mockGithub(page)
  await createNewLogbook(page)
  const cdp = await page.context().newCDPSession(page)

  await page.getByRole('navigation').getByRole('button', { name: 'Toevoegen', exact: true }).click()
  await page.getByRole('button', { name: 'Naar op de kaart kiezen' }).click()
  const sheet = page.getByRole('dialog', { name: 'Naar: plaats op de kaart' })
  const canvas = sheet.locator('.sea-map-canvas')
  await expect(sheet.locator('.map-land').first()).toBeAttached({ timeout: 15_000 })
  // Een vast punt om te volgen: de huidige locatie (GPS) als gekozen punt.
  await sheet.getByRole('button', { name: 'Huidige locatie' }).click()
  const marker = sheet.locator('.map-marker circle').first()
  await expect(marker).toBeVisible()
  const box = (await canvas.boundingBox())!
  const zoom = async () => Number(await canvas.getAttribute('data-zoom'))
  const scrollTop = () => sheet.evaluate((el) => {
    let total = window.scrollY
    for (let n: Element | null = el; n; n = n.parentElement) total += n.scrollTop
    for (const n of el.querySelectorAll('*')) total += (n as HTMLElement).scrollTop
    return total
  })
  const scrolled = await scrollTop()

  // 1. Knijpen (uit elkaar, midden vast): het punt onder het midden blijft staan, de rest schaalt eromheen.
  let p = await centerOf(marker)
  let z = await zoom()
  const m: Pt = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.6 }
  await pinch(cdp, { x: m.x - 30, y: m.y }, { x: m.x + 30, y: m.y }, { x: m.x - 75, y: m.y }, { x: m.x + 75, y: m.y })
  expect(await zoom()).toBeCloseTo(z + Math.log2(2.5), 1)
  expectNear(await centerOf(marker), scaled(p, m, 2.5))

  // 2. Knijpen en tegelijk schuiven (samen), schuin: ook dan het punt onder het (verschoven) midden.
  p = await centerOf(marker)
  z = await zoom()
  const m0: Pt = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.45 }
  const m1: Pt = { x: m0.x - 25, y: m0.y + 35 }
  await pinch(cdp, { x: m0.x - 50, y: m0.y - 50 }, { x: m0.x + 50, y: m0.y + 50 }, { x: m1.x - 25, y: m1.y - 25 }, { x: m1.x + 25, y: m1.y + 25 })
  expect(await zoom()).toBeCloseTo(z - 1, 1)
  expectNear(await centerOf(marker), scaled(p, m0, 0.5, m1))

  // 3. Eén vinger schuift precies met de vinger mee; stilhouden voor het loslaten = geen uitloop.
  p = await centerOf(marker)
  const start: Pt = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 }
  await drag(page, cdp, start, { x: start.x + 60, y: start.y - 80 }, 15, 200)
  const afterDrag = await centerOf(marker)
  expectNear(afterDrag, { x: p.x + 60, y: p.y - 80 })
  await page.waitForTimeout(400)
  expectNear(await centerOf(marker), afterDrag, 1)
  // De pagina (en het blad) is niet meegescrold.
  expect(await scrollTop()).toBe(scrolled)

  // 4. Snel vegen: na het loslaten loopt de kaart licht uit en komt dan tot stilstand.
  await drag(page, cdp, { x: start.x - 60, y: start.y }, { x: start.x + 40, y: start.y }, 4, 0)
  const released = await centerOf(marker)
  await page.waitForTimeout(1_200)
  const settled = await centerOf(marker)
  expect(settled.x - released.x).toBeGreaterThan(10)
  expect(settled.x - released.x).toBeLessThanOrEqual(305)
  await page.waitForTimeout(300)
  expectNear(await centerOf(marker), settled, 1)
  expect(await scrollTop()).toBe(scrolled)

  // 5. Dubbeltik: inzoomen rond het tikpunt (factor 2), zonder het gekozen punt te verplaatsen.
  await sheet.getByRole('button', { name: 'Naar het gekozen punt' }).click()
  await page.waitForTimeout(100)
  p = await centerOf(marker)
  z = await zoom()
  const t: Pt = { x: p.x + 40, y: p.y + 30 }
  await tap(cdp, t)
  await page.waitForTimeout(80)
  await tap(cdp, t)
  await expect.poll(zoom).toBeCloseTo(z + 1, 1)
  await page.waitForTimeout(400)
  expectNear(await centerOf(marker), scaled(p, t, 2))

  // 6. Eén tik zet het punt op de plek van de tik.
  const pick: Pt = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 }
  await tap(cdp, pick)
  await expect.poll(async () => Math.hypot((await centerOf(marker)).x - pick.x, (await centerOf(marker)).y - pick.y)).toBeLessThanOrEqual(MARGIN)

  // 7. Grenzen: ver inzoomen stopt op 16, ver uitzoomen op 2; de kaart blijft het beeld vullen.
  const c: Pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  for (let i = 0; i < 4; i++) await pinch(cdp, { x: c.x - 10, y: c.y }, { x: c.x + 10, y: c.y }, { x: c.x - 150, y: c.y }, { x: c.x + 150, y: c.y }, 6)
  expect(await zoom()).toBe(16)
  for (let i = 0; i < 6; i++) await pinch(cdp, { x: c.x - 150, y: c.y }, { x: c.x + 150, y: c.y }, { x: c.x - 5, y: c.y }, { x: c.x + 5, y: c.y }, 6)
  expect(await zoom()).toBe(2)
  // Ver naar links vegen: verder dan de rand van de wereld gaat niet (er blijft land of zee in beeld, geen leegte).
  for (let i = 0; i < 3; i++) await drag(page, cdp, { x: c.x - 120, y: c.y }, { x: c.x + 120, y: c.y }, 8, 150)
  const edge = await canvas.evaluate((el) => {
    const svg = el.querySelector('svg')!
    const g = svg.querySelector('g[transform]')!.getAttribute('transform')!
    return Number(/translate\(([-\d.]+)/.exec(g)![1])
  })
  expect(edge).toBeLessThanOrEqual(0.5)
  expect(await scrollTop()).toBe(scrolled)

  await page.screenshot({ path: 'screenshots/trips/kaart-gebaren.png' })
  expect(errors).toEqual([])
})
