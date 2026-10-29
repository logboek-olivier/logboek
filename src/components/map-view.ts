// Kaartbeeld en gebaren als pure functies (getest in tests/map-view.test.ts), los van React en de SVG.
// Het beeld is een middelpunt in wereldcoördinaten (Mercator, 0..1) plus een zoom; 256 · 2^zoom pixels per wereld.
// Elk gebaar onthoudt bij het begin welk wereldpunt onder de vinger (of het midden tussen twee vingers) ligt, en
// rekent het beeld steeds opnieuw uit vanaf dat begin: geen opgetelde afrondingen, dus geen verspringen of wegschieten.

export interface MapView {
  x: number
  y: number
  zoom: number
}

export interface Size {
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export const MIN_ZOOM = 2
export const MAX_ZOOM = 16

export function scaleOf(zoom: number): number {
  return 256 * 2 ** zoom
}

/** Het wereldpunt onder schermpunt p. */
export function worldAt(view: MapView, size: Size, p: Point): Point {
  const s = scaleOf(view.zoom)
  return { x: view.x + (p.x - size.w / 2) / s, y: view.y + (p.y - size.h / 2) / s }
}

/** Het beeld met deze zoom waarin wereldpunt `world` precies onder schermpunt p ligt. */
export function viewWith(world: Point, p: Point, zoom: number, size: Size): MapView {
  const s = scaleOf(zoom)
  return { zoom, x: world.x - (p.x - size.w / 2) / s, y: world.y - (p.y - size.h / 2) / s }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Binnen de grenzen: zoom tussen MIN_ZOOM en MAX_ZOOM, en het middelpunt zo dat de wereld het beeld vult (is de
 * wereld smaller dan het beeld, dan in het midden). Verder dan de rand van de kaart schuiven kan dus niet.
 */
export function clampView(view: MapView, size: Size): MapView {
  const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM)
  const s = scaleOf(zoom)
  const halfW = size.w / 2 / s
  const halfH = size.h / 2 / s
  return {
    zoom,
    x: halfW >= 0.5 ? 0.5 : clamp(view.x, halfW, 1 - halfW),
    y: halfH >= 0.5 ? 0.5 : clamp(view.y, halfH, 1 - halfH),
  }
}

/** Inzoomen rond schermpunt p: het wereldpunt onder p blijft waar het is (behalve aan de rand van de kaart). */
export function zoomAround(view: MapView, size: Size, p: Point, zoom: number): MapView {
  return clampView(viewWith(worldAt(view, size, p), p, clamp(zoom, MIN_ZOOM, MAX_ZOOM), size), size)
}

/** Begin van een gebaar met één of twee vingers: het wereldpunt onder het midden, de afstand en de zoom. */
export interface Anchor {
  world: Point
  zoom: number
  /** Afstand tussen twee vingers bij het begin; 0 bij één vinger. */
  dist: number
}

export function midpoint(points: readonly Point[]): Point {
  if (points.length === 1) return points[0]!
  const [a, b] = points as [Point, Point]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function spread(points: readonly Point[]): number {
  if (points.length < 2) return 0
  const [a, b] = points as [Point, Point]
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function anchorOf(view: MapView, size: Size, points: readonly Point[]): Anchor {
  return { world: worldAt(view, size, midpoint(points)), zoom: view.zoom, dist: spread(points) }
}

/**
 * Het beeld bij de huidige vingers: met twee vingers zoomt de afstand en schuift het midden tegelijk (het wereldpunt
 * dat bij het begin onder het midden lag, blijft onder het midden); met één vinger schuift het beeld met de vinger mee.
 */
export function gestureView(anchor: Anchor, size: Size, points: readonly Point[]): MapView {
  const zoom = anchor.dist > 0 && points.length >= 2 ? anchor.zoom + Math.log2(Math.max(1, spread(points)) / anchor.dist) : anchor.zoom
  return clampView(viewWith(anchor.world, midpoint(points), clamp(zoom, MIN_ZOOM, MAX_ZOOM), size), size)
}

/** Een vingerpositie met tijd, voor de uitloop na het schuiven. */
export interface Sample extends Point {
  t: number
}

/** Snelheid in pixels per milliseconde uit de laatste 100 ms van het schuiven; stilhouden voor het loslaten = 0. */
export function velocity(samples: readonly Sample[], now: number): Point {
  const recent = samples.filter((s) => now - s.t <= 100)
  if (recent.length < 2) return { x: 0, y: 0 }
  const first = recent[0]!
  const last = recent.at(-1)!
  const dt = last.t - first.t
  if (dt <= 0 || now - last.t > 50) return { x: 0, y: 0 }
  return { x: clamp((last.x - first.x) / dt, -FLING_MAX, FLING_MAX), y: clamp((last.y - first.y) / dt, -FLING_MAX, FLING_MAX) }
}

/** Tijdconstante van de uitloop: na 0,2 s is twee derde van de snelheid weg (licht, niet glijden). */
export const FLING_TAU = 200
/** Hoogste snelheid (px/ms) voor de uitloop: hoogstens 300 px na, hoe hard er ook geveegd wordt. */
export const FLING_MAX = 1.5
/** Onder deze snelheid (px/ms) geen uitloop. */
export const FLING_MIN = 0.25

/** Afstand die de uitloop nog aflegt na dt milliseconden, bij beginsnelheid v. */
export function flingOffset(v: Point, dt: number): Point {
  const f = FLING_TAU * (1 - Math.exp(-dt / FLING_TAU))
  return { x: v.x * f, y: v.y * f }
}

/** Een tik verschuift hoogstens zoveel pixels (vinger) of muispixels; meer is schuiven. */
export function tapSlop(pointerType: string): number {
  return pointerType === 'mouse' ? 4 : 10
}

/** Dubbeltik: de tweede tik binnen deze tijd en afstand van de eerste. */
export const DOUBLE_TAP_MS = 300
export const DOUBLE_TAP_PX = 30
