import type { LabelKind, OsmLabel } from '../model/osm'

// Namen op de kaart (OpenStreetMap, scripts/build-osm.mjs): steden, dorpen, eilanden, eilandjes, baaien, marina's,
// havens en ankerplekken. Elk label heeft een zoom vanaf waar het verschijnt (`z`, groot eerder dan klein), zodat er bij
// het inzoomen steeds meer namen bijkomen. Labels overlappen elkaar en de eigen plaatsen nooit: het belangrijkste
// krijgt eerst een plek (lagere zoom, dan de volgorde van de soorten), de rest valt weg tot er ruimte is.

/** Vanaf welke zoom een soort verschijnt als het label zelf geen zoom heeft (kaartdata van vóór de soorten). */
export const KIND_ZOOM: Record<LabelKind, number> = { stad: 10, plaats: 10, eiland: 10, dorp: 12, baai: 12, marina: 12, haven: 12, ankerplek: 13, eilandje: 13 }

/** Bij gelijke zoom: wat het belangrijkst is eerst. `plaats` is de oude naam van `stad`. */
const ORDER: readonly LabelKind[] = ['stad', 'plaats', 'eiland', 'dorp', 'baai', 'marina', 'haven', 'ankerplek', 'eilandje']

/** Soorten met een teken op het punt en de naam ernaast; de andere staan gecentreerd op het punt. */
export const POINT_KINDS: ReadonlySet<LabelKind> = new Set(['marina', 'haven', 'ankerplek'])

/** Lettergrootte per soort (zelfde als in app.css), voor de breedte van het label. */
const FONT: Record<LabelKind, number> = { stad: 13, plaats: 13, eiland: 12, dorp: 11, baai: 11.5, marina: 11, haven: 11, ankerplek: 10.5, eilandje: 10.5 }

export const MAX_LABELS = 80

export function labelZoom(label: OsmLabel): number {
  return typeof label.z === 'number' ? label.z : (KIND_ZOOM[label.k] ?? 13)
}

/** Alle labels in volgorde van belangrijkheid (één keer per geladen bestand). */
export function rankLabels(all: readonly OsmLabel[]): OsmLabel[] {
  const rank = (k: LabelKind) => {
    const i = ORDER.indexOf(k)
    return i === -1 ? ORDER.length : i
  }
  return all
    .filter((l) => (ORDER as readonly string[]).includes(l.k))
    .map((l, i) => ({ l, i }))
    .sort((a, b) => labelZoom(a.l) - labelZoom(b.l) || rank(a.l.k) - rank(b.l.k) || a.i - b.i)
    .map(({ l }) => l)
}

export interface ShownLabel extends OsmLabel {
  x: number
  y: number
}

type Box = [number, number, number, number]

/** Het vak dat een label op het scherm inneemt (geschat uit het aantal tekens en de lettergrootte). */
export function labelBox(label: OsmLabel, x: number, y: number): Box {
  const font = FONT[label.k] ?? 11
  const width = label.n.length * font * (label.k === 'stad' || label.k === 'plaats' ? 0.62 : 0.56)
  if (POINT_KINDS.has(label.k)) return [x - 6, y - font + 1, x + 8 + width + 2, y + 6]
  return [x - width / 2 - 2, y - font, x + width / 2 + 2, y + 3]
}

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

/**
 * Welke labels bij deze zoom op het scherm komen: alleen labels vanaf hun zoom, binnen het beeld, zonder overlap met
 * elkaar of met de vakken die al bezet zijn (eigen plaatsen, stops). `ranked` staat al in volgorde van belangrijkheid.
 */
export function placeLabels(ranked: readonly OsmLabel[], zoom: number, toScreen: (p: { lat: number; lon: number }) => { x: number; y: number }, size: { w: number; h: number }, taken: readonly Box[] = []): ShownLabel[] {
  const boxes: Box[] = [...taken]
  const out: ShownLabel[] = []
  for (const label of ranked) {
    if (labelZoom(label) > zoom) break
    const s = toScreen(label)
    if (s.x < 0 || s.y < 12 || s.x > size.w || s.y > size.h - 4) continue
    const box = labelBox(label, s.x, s.y)
    if (box[0] < 0 || box[2] > size.w) continue
    if (boxes.some((b) => overlaps(box, b))) continue
    boxes.push(box)
    out.push({ ...label, x: s.x, y: s.y })
    if (out.length >= MAX_LABELS) break
  }
  return out
}
