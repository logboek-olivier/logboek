import { distanceToCountryNm } from './countries'
import { loadLabels, loadOsmIndex, type LabelKind, type OsmArea, type OsmLabel } from './osm'
import { editDistance, greatCircleNm, placeKey } from './places'
import type { Place } from './types'

// Pin-assistent (Meer → Plaatsen → Plaatsen zonder pin): een voorstel voor de pin uit de namen op de offline kaart
// (OpenStreetMap-namen van eilanden, havens en plaatsen in de vier vaargebieden). Eerst dezelfde naam (zonder
// hoofdletters, accenten en spaties), anders een kleine spelvariant. Bij meer kandidaten wint de dichtstbijzijnde bij
// plaatsen van dezelfde dagen, dan die in het land van de plaats, dan een plaats of haven boven een eiland. Alleen een
// voorstel: Olivier bevestigt met één tik, en de pinregels (ver van het land) gelden gewoon.

export interface PinCandidate {
  label: OsmLabel
  areaId: string
}

export interface PinSuggestion extends PinCandidate {
  area: OsmArea
}

const KIND_ORDER: LabelKind[] = ['plaats', 'haven', 'dorp', 'eiland', 'eilandje']

/** Mag `labelKey` een spelvariant van `key` zijn? Eén letter vanaf vijf letters, twee vanaf tien. */
function close(key: string, labelKey: string): boolean {
  if (key.length < 5) return false
  const max = key.length >= 10 ? 2 : 1
  return editDistance(key, labelKey, max) <= max
}

/** De beste kandidaat voor een naam, of null. Puur, zodat het zonder kaartdata te testen is. */
export function bestCandidate(name: string, candidates: readonly PinCandidate[], neighbours: readonly Place[], country: string): PinCandidate | null {
  const key = placeKey(name)
  if (!key) return null
  const exact = candidates.filter((c) => placeKey(c.label.n) === key)
  const pool = exact.length > 0 ? exact : candidates.filter((c) => close(key, placeKey(c.label.n)))
  if (pool.length === 0) return null
  const score = (c: PinCandidate): [number, number, number] => {
    const near = neighbours.length > 0 ? Math.min(...neighbours.map((n) => greatCircleNm(n, c.label))) : Infinity
    const land = country ? (distanceToCountryNm(country, c.label) ?? Infinity) : Infinity
    return [near, land, KIND_ORDER.indexOf(c.label.k)]
  }
  return [...pool].sort((a, b) => {
    const [na, la, ka] = score(a)
    const [nb, lb, kb] = score(b)
    return na - nb || la - lb || ka - kb || a.label.n.localeCompare(b.label.n)
  })[0]!
}

let all: Promise<{ areas: OsmArea[]; candidates: PinCandidate[] }> | null = null

/** Alle namen uit de vaargebieden (één keer geladen, daarna offline). */
function loadAll(): Promise<{ areas: OsmArea[]; candidates: PinCandidate[] }> {
  all ??= (async () => {
    const index = await loadOsmIndex()
    if (!index) return { areas: [], candidates: [] }
    const lists = await Promise.all(index.areas.map(async (a) => (await loadLabels(a)).map((label) => ({ label, areaId: a.id }))))
    return { areas: index.areas, candidates: lists.flat() }
  })()
  void all.then((r) => {
    if (r.candidates.length === 0) all = null
  })
  return all
}

/** Voorstel voor een plaats zonder pin; null als de naam niet op de offline kaart staat (of zonder kaartdata). */
export async function suggestPin(name: string, neighbours: readonly Place[], country: string): Promise<PinSuggestion | null> {
  const { areas, candidates } = await loadAll()
  const best = bestCandidate(name, candidates, neighbours, country)
  const area = best ? areas.find((a) => a.id === best.areaId) : undefined
  return best && area ? { ...best, area } : null
}
