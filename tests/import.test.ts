import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ImportError, parseCsv, parseDate, parseMileageCsv, parseNumber } from '../src/import/mileage-csv'
import { lastTrip, nmInYear, summarize, summarizeTrips, totalNm, tripForDate } from '../src/model/derive'
import type { Leg } from '../src/model/types'

// Fixtures zijn gegenereerd met verzonnen plaatsen en getallen.

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const NOW = '2026-10-25T00:00:00.000Z'

describe('import mijlenregistratie', () => {
  const result = parseMileageCsv(fixture('mijlen-nep.csv'), NOW)

  it('leest tochten, dagen en totalen die met de samenvattingsregels overeenkomen', () => {
    expect(result.summary).toEqual({
      days: 8,
      trips: 3,
      nm: 240,
      nmByRole: { schipper: 70, 'co-schipper': 110, bemanningslid: 45, trainee: 15, instructeur: 0 },
      nmByWater: { inland: 35, sea: 95, tidal: 110 },
      nightHours: 12,
    })
    expect(result.trips.map((t) => t.name)).toEqual(['Oefentocht noord', 'Nepboot Twee juni 2024', 'Cursus binnenwater'])
  })

  it('neemt een lege datum over van de vorige rij met dateEstimated', () => {
    const [first, second, third] = result.legs
    expect(first?.date).toBe('2024-05-03')
    expect(first?.dateEstimated).toBe(false)
    expect(second?.date).toBe('2024-05-03')
    expect(second?.dateEstimated).toBe(true)
    expect(second?.notes).toBe('Lange dag')
    expect(third?.date).toBe('2024-05-04')
    expect(first?.notes).toBeUndefined()
  })

  it('leest jjjj-mm-dd, namen, wind en nachturen en zet source op import', () => {
    const trainee = result.legs.find((l) => l.role === 'trainee')
    expect(trainee).toMatchObject({
      date: '2024-07-20',
      boat: 'Nepboot Drie',
      skipperName: 'Trainer Nep',
      windBft: '2',
      nmInland: 15,
      nightHours: 0,
      source: 'import',
    })
    const crew = result.legs.find((l) => l.role === 'bemanningslid')
    expect(crew?.coSkipperName).toBe('Nep Co')
    expect(crew?.nightHours).toBe(2)
    expect(result.legs.find((l) => l.toPlace === 'Westeiland')?.windBft).toBeUndefined()
    expect(result.legs.every((l) => l.tripId && l.updatedAt === NOW && l.deletedAt === null)).toBe(true)
  })

  it('leest ook een export met BOM, komma, d/m/jj, " nm", " bft", aanhalingstekens en een lege rij onder de kopregel', () => {
    const r = parseMileageCsv(String.fromCharCode(0xfeff) + fixture('mijlen-nep-komma.csv'), NOW)
    expect(r.summary.days).toBe(2)
    expect(r.summary.trips).toBe(1)
    expect(r.summary.nm).toBe(10)
    expect(r.trips[0]?.name).toBe('Nepboot Vier augustus 2023')
    expect(r.legs[0]).toMatchObject({ date: '2023-08-05', toPlace: 'Haven, Oost', windBft: '2', nmInland: 6 })
    expect(r.legs[1]).toMatchObject({ dateEstimated: true, windBft: '3-4', notes: 'Terug, met wind' })
  })

  it('corrigeert een onmogelijke dag met een melding en markeert de datum als geschat', () => {
    const typo = fixture('mijlen-nep.csv').replace('11-06-2024;Oosteiland', '31-06-2024;Oosteiland')
    const r = parseMileageCsv(typo, NOW)
    expect(r.warnings).toEqual(['Rij 12: dag bestaat niet in die maand; laatste dag van de maand genomen (geschat)'])
    const leg = r.legs.find((l) => l.fromPlace === 'Oosteiland')
    expect(leg).toMatchObject({ date: '2024-06-30', dateEstimated: true })
    expect(result.warnings).toEqual([])
  })

  it('stopt bij een onbekende rol met het rijnummer', () => {
    const broken = fixture('mijlen-nep.csv').replace('Co-schipper;Nepboot Twee;Kapitein Nep;;5', 'Kapitein;Nepboot Twee;Kapitein Nep;;5')
    expect(() => parseMileageCsv(broken, NOW)).toThrow(ImportError)
    expect(() => parseMileageCsv(broken, NOW)).toThrow('Rij 11: rol niet herkend (kolom Rol). Toegestaan: Schipper, Co-schipper, Bemanningslid, Trainee, Instructeur.')
    // Geen celinhoud in meldingen (beveiligingsregel 9).
    expect(() => parseMileageCsv(broken, NOW)).not.toThrow('Kapitein')
  })

  it('weigert een bestand zonder kopregel, zonder dagen of met een onleesbaar getal', () => {
    expect(() => parseMileageCsv('a;b;c\n1;2;3', NOW)).toThrow('Kopregel niet gevonden: geen rij die begint met "Datum"')
    const header = fixture('mijlen-nep.csv').split('\n').slice(0, 6).join('\n')
    expect(() => parseMileageCsv(header, NOW)).toThrow('Geen dagen gevonden')
    const badNumber = fixture('mijlen-nep.csv').replace(';3-4;12;;;12;;Oefentocht', ';3-4;twaalf;;;12;;Oefentocht')
    expect(() => parseMileageCsv(badNumber, NOW)).toThrow('Rij 7: getal niet herkend in kolom Binnenwater.')
  })

  it('leest datums en getallen in alle toegestane vormen', () => {
    expect(parseDate('12-8-2021')).toEqual({ date: '2021-08-12', clamped: false })
    expect(parseDate('12/8/21').date).toBe('2021-08-12')
    expect(parseDate('2021-08-12').date).toBe('2021-08-12')
    expect(parseDate('01.02.2022').date).toBe('2022-02-01')
    // Tikfout in Excel: dag bestaat niet in die maand → laatste dag van de maand, gemarkeerd.
    expect(parseDate('31-06-2024')).toEqual({ date: '2024-06-30', clamped: true })
    expect(parseDate('30-02-2023')).toEqual({ date: '2023-02-28', clamped: true })
    expect(parseDate('29-02-2024')).toEqual({ date: '2024-02-29', clamped: false })
    expect(() => parseDate('32-01-2024')).toThrow('bestaat niet')
    expect(() => parseDate('12-13-2024')).toThrow('bestaat niet')
    expect(() => parseDate('gisteren')).toThrow('niet herkend')
    expect(parseNumber('')).toBe(0)
    expect(parseNumber('12 nm')).toBe(12)
    expect(parseNumber('12,5')).toBe(12.5)
    expect(parseNumber('4 uur')).toBe(4)
    expect(() => parseNumber('-3')).toThrow('niet herkend')
  })

  it('leest CSV met aanhalingstekens en Windows-regeleinden', () => {
    expect(parseCsv('a;"b;c";"d""e"\r\n1;;3')).toEqual([
      ['a', 'b;c', 'd"e'],
      ['1', '', '3'],
    ])
    expect(parseCsv('Datum,x\n"regel\nbreuk",2')).toEqual([
      ['Datum', 'x'],
      ['regel\nbreuk', '2'],
    ])
  })
})

describe('afgeleiden', () => {
  const result = parseMileageCsv(fixture('mijlen-nep.csv'), NOW)

  it('berekent totaal nm per dag en negeert verwijderde dagen', () => {
    expect(totalNm({ nmInland: 1.5, nmSea: 2, nmTidal: 0.2 })).toBe(3.7)
    const legs: Leg[] = result.legs.map((l, i) => (i === 0 ? { ...l, deletedAt: NOW } : l))
    expect(summarize(legs).days).toBe(7)
    expect(summarize(legs).nm).toBe(228)
  })

  it('vat tochten samen, nieuwste eerst, met datums en boot', () => {
    const trips = summarizeTrips(result.trips, result.legs)
    expect(trips.map((t) => [t.trip.name, t.startDate, t.endDate, t.boat, t.nm, t.days])).toEqual([
      ['Cursus binnenwater', '2024-07-20', '2024-07-21', 'Nepboot Drie', 60, 2],
      ['Nepboot Twee juni 2024', '2024-06-10', '2024-06-12', 'Nepboot Twee', 110, 3],
      ['Oefentocht noord', '2024-05-03', '2024-05-04', 'Nepboot Een', 70, 3],
    ])
    expect(lastTrip(result.trips, result.legs)?.trip.name).toBe('Cursus binnenwater')
    expect(summarizeTrips([...result.trips, { id: 'leeg', name: 'Leeg', updatedAt: NOW, deletedAt: null }], result.legs)).toHaveLength(3)
  })

  it('vindt de tocht bij een datum en telt nm per kalenderjaar', () => {
    expect(tripForDate(result.trips, result.legs, '2024-06-11')?.name).toBe('Nepboot Twee juni 2024')
    expect(tripForDate(result.trips, result.legs, '2024-06-13')).toBeNull()
    expect(nmInYear(result.legs, 2024)).toBe(240)
    expect(nmInYear(result.legs, 2023)).toBe(0)
  })
})
