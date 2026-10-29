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
/** Langere namen worden afgekort met een beletselteken, anders passen ze nergens op een telefoonscherm. */
export const MAX_LABEL_CHARS = 22

export function labelText(label: OsmLabel): string {
  return label.n.length > MAX_LABEL_CHARS ? `${label.n.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}…` : label.n
}

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

type Box = [number, number, number, number]

export interface ShownLabel extends OsmLabel {
  /** Het punt op het scherm. */
  x: number
  y: number
  /** De getoonde naam (lange namen afgekort). */
  text: string
  /** Waar de tekst staat en hoe hij uitlijnt (naast het teken, of erboven of eronder als het midden bezet is). */
  tx: number
  ty: number
  anchor: 'start' | 'middle' | 'end'
  box: Box
}

interface Placement {
  tx: number
  ty: number
  anchor: ShownLabel['anchor']
  box: Box
}

/**
 * Plekken voor de tekst, in volgorde van voorkeur, met het vak dat de tekst dan inneemt (geschat uit het aantal tekens
 * en de lettergrootte). Een teken (marina, haven, ankerplek): de naam rechts, anders links. Een vlak of plaats: op het
 * punt, anders erboven of eronder.
 */
export function placements(label: OsmLabel, x: number, y: number): Placement[] {
  const font = FONT[label.k] ?? 11
  const width = labelText(label).length * font * (label.k === 'stad' || label.k === 'plaats' ? 0.62 : 0.56)
  if (POINT_KINDS.has(label.k)) {
    const mark: Box = [x - 6, y - 6, x + 6, y + 6]
    return [
      { tx: x + 8, ty: y + 4, anchor: 'start', box: [mark[0], y - font + 1, x + 8 + width + 2, y + 6] },
      { tx: x - 8, ty: y + 4, anchor: 'end', box: [x - 8 - width - 2, y - font + 1, mark[2], y + 6] },
    ]
  }
  const at = (ty: number): Placement => ({ tx: x, ty, anchor: 'middle', box: [x - width / 2 - 2, ty - font, x + width / 2 + 2, ty + 3] })
  return [at(y), at(y - font - 6), at(y + font + 5)]
}

/** Het vak van een label op zijn eerste plek (voor tests en de oude aanroepen). */
export function labelBox(label: OsmLabel, x: number, y: number): Box {
  return placements(label, x, y)[0]!.box
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
    const spot = placements(label, s.x, s.y).find(({ box }) => box[0] >= 0 && box[2] <= size.w && box[1] >= 0 && box[3] <= size.h && !boxes.some((b) => overlaps(box, b)))
    if (!spot) continue
    boxes.push(spot.box)
    out.push({ ...label, x: s.x, y: s.y, text: labelText(label), ...spot })
    if (out.length >= MAX_LABELS) break
  }
  return out
}
