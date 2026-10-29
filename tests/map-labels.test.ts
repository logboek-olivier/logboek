import { describe, expect, it } from 'vitest'
import { labelBox, labelText, labelZoom, MAX_LABELS, placeLabels, rankLabels } from '../src/components/map-labels'
import type { OsmLabel } from '../src/model/osm'
// @ts-expect-error: Node-script zonder typen
import { buildLabels, labelKind, labelZoom as buildZoom, sizeKm } from '../scripts/osm-lib.mjs'

// Namen op de kaart: soort en zoom uit de OSM-tags (bouwscript), belangrijkste eerst, meer namen bij verder inzoomen,
// nooit overlap. Verzonnen namen en punten.

const SIZE = { w: 330, h: 420 }
// Een eenvoudige projectie: 1 graad = 1000 px bij zoom 10, tweemaal zoveel per zoomstap.
const projector =
  (zoom: number, cx = 165, cy = 210) =>
  (p: { lat: number; lon: number }) => ({ x: cx + (p.lon - 10) * 1000 * 2 ** (zoom - 10), y: cy - (p.lat - 40) * 1000 * 2 ** (zoom - 10) })
const label = (n: string, k: OsmLabel['k'], lat: number, lon: number, z?: number): OsmLabel => ({ n, k, lat, lon, ...(z !== undefined ? { z } : {}) })

describe('soort en zoom (bouwscript)', () => {
  it('soorten uit de tags', () => {
    expect(labelKind({ place: 'city' })).toBe('stad')
    expect(labelKind({ place: 'town' })).toBe('stad')
    expect(labelKind({ place: 'village' })).toBe('dorp')
    expect(labelKind({ place: 'island' })).toBe('eiland')
    expect(labelKind({ place: 'islet' })).toBe('eilandje')
    expect(labelKind({ natural: 'bay' })).toBe('baai')
    expect(labelKind({ leisure: 'marina' })).toBe('marina')
    expect(labelKind({ 'seamark:type': 'anchorage' })).toBe('ankerplek')
    expect(labelKind({ harbour: 'yes' })).toBe('haven')
    expect(labelKind({ 'seamark:type': 'harbour' })).toBe('haven')
    expect(labelKind({ amenity: 'cafe' })).toBeNull()
  })

  it('grote steden, eilanden en baaien verschijnen eerder dan kleine', () => {
    expect(buildZoom('stad', { place: 'city', population: '300000' }, null)).toBeLessThan(buildZoom('stad', { place: 'town' }, null))
    expect(buildZoom('eiland', {}, 40)).toBeLessThan(buildZoom('eiland', {}, 2))
    expect([buildZoom('eiland', {}, 19), buildZoom('eiland', {}, 2.5), buildZoom('eiland', {}, 1)]).toEqual([8, 11, 12])
    expect(buildZoom('baai', {}, 16)).toBeLessThan(buildZoom('baai', {}, 1))
    expect(buildZoom('dorp', {}, null)).toBeGreaterThan(buildZoom('stad', { place: 'town' }, null))
    expect(buildZoom('ankerplek', {}, null)).toBe(13)
    expect(sizeKm({ minlat: 40, maxlat: 40.1, minlon: 10, maxlon: 10 })).toBeCloseTo(11.06, 1)
    expect(sizeKm(undefined)).toBeNull()
  })

  it('labels uit de Overpass-uitvoer: middelpunt uit center, grootte uit de tweede uitvoer met bounds; dubbelen weg', () => {
    const elements = [
      { type: 'relation', id: 1, center: { lat: 40.5, lon: 10.5 }, tags: { place: 'island', name: 'Nepeiland' } },
      { type: 'node', id: 2, lat: 40.1, lon: 10.1, tags: { natural: 'bay', name: 'Nepbaai' } },
      { type: 'node', id: 3, lat: 40.1, lon: 10.1, tags: { natural: 'bay', name: 'Nepbaai' } },
      { type: 'node', id: 4, lat: 40.2, lon: 10.2, tags: { place: 'city', name: 'Nepstad', population: '400000' } },
      { type: 'node', id: 5, lat: 40.3, lon: 10.3, tags: { 'seamark:type': 'anchorage', name: 'Nepanker' } },
      { type: 'node', id: 6, lat: 40.3, lon: 10.3, tags: { place: 'village' } },
      { type: 'relation', id: 1, bounds: { minlat: 40, maxlat: 41, minlon: 10, maxlon: 11 }, tags: { place: 'island', name: 'Nepeiland' } },
    ]
    const out = buildLabels(elements, (tags: { name?: string }) => tags.name ?? '') as OsmLabel[]
    expect(out.map((l) => [l.n, l.k, l.z])).toEqual([
      ['Nepstad', 'stad', 7],
      ['Nepeiland', 'eiland', 8],
      ['Nepbaai', 'baai', 12],
      ['Nepanker', 'ankerplek', 13],
    ])
    expect(out[1]).toEqual({ n: 'Nepeiland', k: 'eiland', lat: 40.5, lon: 10.5, z: 8 })
  })
})

describe('labels plaatsen', () => {
  const all = rankLabels([
    label('Nepdorp', 'dorp', 40.02, 10.02),
    label('Nepstad', 'stad', 40, 10, 8),
    label('Nepbaai', 'baai', 40.05, 9.95, 12),
    label('Nepeiland', 'eiland', 40.06, 10.06, 10),
    label('Oude plaats', 'plaats', 39.95, 10.05),
    label('Nepmarina', 'marina', 39.93, 9.95, 12),
  ])

  it('belangrijkste eerst; oude kaartdata zonder zoom krijgt de zoom van de soort', () => {
    // Gelijke zoom: stad, eiland, dorp, baai, marina.
    expect(all.map((l) => l.n)).toEqual(['Nepstad', 'Oude plaats', 'Nepeiland', 'Nepdorp', 'Nepbaai', 'Nepmarina'])
    expect(labelZoom(label('x', 'dorp', 0, 0))).toBe(12)
    expect(labelZoom(label('x', 'plaats', 0, 0))).toBe(10)
  })

  it('hoe verder ingezoomd, hoe meer namen', () => {
    const counts = [8, 10, 12, 14].map((z) => placeLabels(all, z, projector(z, 2000, 2000), { w: 4000, h: 4000 }).length)
    expect(counts).toEqual([1, 3, 6, 6])
  })

  it('nooit overlap, ook niet met bezette vakken; de belangrijkste wint', () => {
    const crowd = rankLabels(Array.from({ length: 300 }, (_, i) => label(`Nepnaam ${i}`, i % 2 ? 'dorp' : 'eiland', 40 + ((i * 37) % 100) / 4000, 10 + ((i * 53) % 100) / 4000, 10 + (i % 3))))
    const taken: [number, number, number, number][] = [[150, 190, 190, 230]]
    const shown = placeLabels(crowd, 13, projector(13), SIZE, taken)
    expect(shown.length).toBeGreaterThan(5)
    expect(shown.length).toBeLessThanOrEqual(MAX_LABELS)
    const boxes = shown.map((l) => l.box)
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i]!
      expect(a[0] < taken[0]![2] && taken[0]![0] < a[2] && a[1] < taken[0]![3] && taken[0]![1] < a[3]).toBe(false)
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j]!
        expect(a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]).toBe(false)
      }
    }
    // Twee namen op dezelfde plek: de belangrijkste op het punt, de andere erboven.
    const pair = rankLabels([label('Klein', 'eilandje', 40, 10, 13), label('Groot', 'eiland', 40, 10, 9)])
    const both = placeLabels(pair, 14, projector(14), SIZE)
    expect(both.map((l) => [l.n, l.ty < l.y])).toEqual([
      ['Groot', false],
      ['Klein', true],
    ])
    // Een marina met de rechterkant bezet: de naam links van het teken.
    const marina = rankLabels([label('Nepmarina', 'marina', 40, 10, 12)])
    const left = placeLabels(marina, 13, projector(13), SIZE, [[175, 190, 260, 230]])
    expect(left).toHaveLength(1)
    expect(left[0]!.anchor).toBe('end')
    expect(left[0]!.box[2]).toBeLessThanOrEqual(171)
    expect(labelBox(marina[0]!, 100, 100)[0]).toBe(94)
  })

  it('lange namen afgekort, zodat ze passen', () => {
    expect(labelText(label('Jachthaven De Leeuwenbrug — Noorderhaven', 'marina', 0, 0))).toBe('Jachthaven De Leeuwen…')
    expect(labelText(label('Uvala Zvončac', 'baai', 0, 0))).toBe('Uvala Zvončac')
    const shown = placeLabels(rankLabels([label('Jachthaven De Leeuwenbrug — Noorderhaven', 'marina', 40, 10.002, 12)]), 13, projector(13), SIZE)
    expect(shown.map((l) => l.text)).toEqual(['Jachthaven De Leeuwen…'])
  })

  it('niet buiten het beeld', () => {
    const edge = rankLabels([label('Een heel lange nepnaam aan de rand', 'stad', 40, 9.84, 8)])
    expect(placeLabels(edge, 10, projector(10), SIZE)).toEqual([])
  })
})
