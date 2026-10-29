import { describe, expect, it } from 'vitest'
import { anchorOf, clampView, flingOffset, FLING_MAX, FLING_TAU, gestureView, MAX_ZOOM, MIN_ZOOM, scaleOf, tapSlop, velocity, worldAt, zoomAround, type MapView, type Point } from '../src/components/map-view'

// Kaart soepel: het wereldpunt onder de vingers blijft op zijn plek, zonder opgetelde fouten; grenzen aan zoom en
// kaartgebied; lichte uitloop. Pure functies, geen DOM.

const SIZE = { w: 330, h: 420 }
const START: MapView = { x: 0.3245, y: 0.4561, zoom: 10 }

/** Waar wereldpunt w op het scherm staat in beeld v. */
function screenOf(v: MapView, w: Point): Point {
  const s = scaleOf(v.zoom)
  return { x: (w.x - v.x) * s + SIZE.w / 2, y: (w.y - v.y) * s + SIZE.h / 2 }
}

function near(a: Point, b: Point, margin = 1e-6) {
  expect(Math.abs(a.x - b.x)).toBeLessThan(margin)
  expect(Math.abs(a.y - b.y)).toBeLessThan(margin)
}

describe('knijpen', () => {
  it('het wereldpunt onder het midden blijft onder het midden, ook na veel kleine stappen', () => {
    const a0 = { x: 120, y: 200 }
    const b0 = { x: 180, y: 260 }
    const anchor = anchorOf(START, SIZE, [a0, b0])
    const mid0 = { x: 150, y: 230 }
    const world = worldAt(START, SIZE, mid0)
    let v = START
    for (let i = 1; i <= 200; i++) {
      const k = 1 + i / 100
      v = gestureView(anchor, SIZE, [
        { x: 150 - 30 * k, y: 230 - 30 * k },
        { x: 150 + 30 * k, y: 230 + 30 * k },
      ])
    }
    expect(v.zoom).toBeCloseTo(10 + Math.log2(3), 10)
    near(screenOf(v, world), mid0)
  })

  it('knijpen en tegelijk schuiven: het punt volgt het midden', () => {
    const anchor = anchorOf(START, SIZE, [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ])
    const world = worldAt(START, SIZE, { x: 150, y: 100 })
    const v = gestureView(anchor, SIZE, [
      { x: 140, y: 180 },
      { x: 190, y: 180 },
    ])
    expect(v.zoom).toBeCloseTo(9, 10)
    near(screenOf(v, world), { x: 165, y: 180 })
  })

  it('één vinger schuift precies met de vinger mee', () => {
    const anchor = anchorOf(START, SIZE, [{ x: 50, y: 60 }])
    const world = worldAt(START, SIZE, { x: 50, y: 60 })
    const v = gestureView(anchor, SIZE, [{ x: 140, y: 10 }])
    expect(v.zoom).toBe(10)
    near(screenOf(v, world), { x: 140, y: 10 })
  })
})

describe('grenzen', () => {
  it('zoom tussen 2 en 16, ook bij knijpen; het punt onder het midden blijft dan toch staan', () => {
    const anchor = anchorOf({ ...START, zoom: 15 }, SIZE, [
      { x: 160, y: 200 },
      { x: 170, y: 200 },
    ])
    const world = worldAt({ ...START, zoom: 15 }, SIZE, { x: 165, y: 200 })
    const v = gestureView(anchor, SIZE, [
      { x: 0, y: 200 },
      { x: 330, y: 200 },
    ])
    expect(v.zoom).toBe(MAX_ZOOM)
    near(screenOf(v, world), { x: 165, y: 200 })
    expect(zoomAround(START, SIZE, { x: 10, y: 10 }, -40).zoom).toBe(MIN_ZOOM)
  })

  it('niet voorbij de rand van de kaart: de wereld vult altijd het beeld', () => {
    const left = clampView({ x: -0.2, y: 0.5, zoom: 4 }, SIZE)
    expect(left.x).toBeCloseTo(SIZE.w / 2 / scaleOf(4), 12)
    const bottom = clampView({ x: 0.5, y: 1.4, zoom: 4 }, SIZE)
    expect(bottom.y).toBeCloseTo(1 - SIZE.h / 2 / scaleOf(4), 12)
    // Een wereld smaller dan het beeld (op deze maat kan dat niet bij zoom ≥ 2, wel bij een breed scherm): in het midden.
    expect(clampView({ x: 0.1, y: 0.9, zoom: 2 }, { w: 2000, h: 2000 })).toEqual({ x: 0.5, y: 0.5, zoom: 2 })
    // Binnen de grenzen verandert er niets.
    expect(clampView(START, SIZE)).toEqual(START)
  })

  it('zoomen rond een punt houdt dat punt vast', () => {
    const p = { x: 40, y: 300 }
    const world = worldAt(START, SIZE, p)
    near(screenOf(zoomAround(START, SIZE, p, 11.5), world), p)
  })
})

describe('tik, schuiven en uitloop', () => {
  it('snelheid uit de laatste 100 ms; stilhouden voor het loslaten geeft geen uitloop', () => {
    const samples = [
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 0, t: 900 },
      { x: 30, y: 5, t: 950 },
      { x: 70, y: 15, t: 990 },
    ]
    const v = velocity(samples, 1000)
    expect(v.x).toBeCloseTo(60 / 90, 6)
    expect(v.y).toBeCloseTo(15 / 90, 6)
    expect(FLING_MAX * FLING_TAU).toBeLessThanOrEqual(300)
    expect(velocity(samples, 1200)).toEqual({ x: 0, y: 0 })
    // Begrensd: een uitschieter schiet de kaart niet weg.
    expect(velocity([{ x: 0, y: 0, t: 0 }, { x: 900, y: 0, t: 10 }], 10).x).toBe(FLING_MAX)
  })

  it('de uitloop is licht en stopt: hoogstens snelheid × tijdconstante', () => {
    const v = { x: 1, y: -0.5 }
    expect(flingOffset(v, 0)).toEqual({ x: 0, y: -0 })
    const end = flingOffset(v, 10_000)
    expect(end.x).toBeCloseTo(FLING_TAU, 3)
    expect(end.y).toBeCloseTo(-FLING_TAU / 2, 3)
    expect(flingOffset(v, 250).x).toBeLessThan(end.x)
  })

  it('tikdrempel: een vinger mag wat meer bewegen dan een muis', () => {
    expect(tapSlop('touch')).toBeGreaterThan(tapSlop('mouse'))
  })
})
