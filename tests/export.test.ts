import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { setLang } from '../src/i18n'
import { exportFileName, exportFiles, exportZip, toCsv, windText } from '../src/model/export'
import type { RatesFile } from '../src/model/rates'
import type { Leg, Place, Transaction, Trip } from '../src/model/types'

// Exporteren naar Excel: leesbare CSV's in één zip, opmaak per taal, formule-injectie onschadelijk, verwijderde records
// en deelnemers niet in de export. Alles verzonnen.

const T = '2026-10-01T00:00:00.000Z'
const trip: Trip = {
  id: 'trip-1',
  name: 'Nepweek Een',
  type: 'skipper-charter',
  organisation: 'yacht-week',
  startDate: '2026-06-01',
  endDate: '2026-06-07',
  boat: 'Nepboot',
  boatModel: 'Nepmodel 42',
  boatLengthFt: 42,
  boatKind: 'eenromp',
  base: 'Nephaven',
  area: 'Nepgebied',
  participants: [{ id: 'p1', firstName: 'Geheimenaam' }],
  updatedAt: T,
  deletedAt: null,
}
const leg = (id: string, extra: Partial<Leg> = {}): Leg => ({
  id,
  tripId: 'trip-1',
  date: '2026-06-02',
  fromPlace: 'Nephaven',
  fromCountry: 'Nepland',
  toPlace: 'Nepbaai',
  toCountry: 'Nepland',
  role: 'schipper',
  boat: 'Nepboot',
  nmInland: 0,
  nmSea: 12.5,
  nmTidal: 0,
  nightHours: 0,
  dateEstimated: false,
  source: 'manual',
  updatedAt: T,
  deletedAt: null,
  ...extra,
})
const place: Place = { id: 'pl-1', name: 'Nepbaai', lat: 18.31, lon: -64.71, updatedAt: T, deletedAt: null }
const tx = (id: string, extra: Partial<Transaction>): Transaction => ({ id, date: '2026-06-03', kind: 'fooi', amount: 100, currency: 'EUR', source: 'yacht-week', tripId: 'trip-1', updatedAt: T, deletedAt: null, ...extra })

const data = {
  trips: [trip, { ...trip, id: 'weg', name: 'Verwijderde trip', deletedAt: T }],
  legs: [leg('l1', { notes: '=HYPERLINK("http://nep")' }), leg('l2', { date: '2026-06-03', nmSea: 7, notes: 'Wind; regen, "veel"' }), leg('l3', { deletedAt: T, notes: 'Verwijderd' })],
  places: [place],
  transactions: [tx('t1', { tipFrom: { kind: 'personen', participantIds: ['p1'] } }), tx('t2', { kind: 'kosten', amount: 40.5, note: '+31 diesel' })],
  rates: null,
}

describe('CSV', () => {
  it('Nederlands: ; en decimale komma; Engels: , en punt; aanhalingstekens waar nodig', () => {
    expect(toCsv(['a', 'b'], [[1.5, 'x;y']], 'nl')).toBe('a;b\r\n1,5;"x;y"\r\n')
    expect(toCsv(['a', 'b'], [[1.5, 'x,y']], 'en')).toBe('a,b\r\n1.5,"x,y"\r\n')
    expect(toCsv(['a'], [['zei "ja"']], 'nl')).toBe('a\r\n"zei ""ja"""\r\n')
    expect(toCsv(['a'], [[null], [undefined]], 'nl')).toBe('a\r\n\r\n\r\n')
  })

  it('tekst die Excel als formule zou lezen, krijgt een apostrof', () => {
    for (const evil of ['=1+1', '+31', '-2', '@SUM(A1)', ' =1+1', '\u00a0=1', '＝1+1', '＋31']) expect(toCsv(['a'], [[evil]], 'en')).toBe(`a\r\n'${evil}\r\n`)
    expect(toCsv(['a'], [['\tx']], 'en')).toBe(`a\r\n'\tx\r\n`)
    expect(toCsv(['a'], [['\rx']], 'en')).toBe(`a\r\n"'\rx"\r\n`)
    expect(toCsv(['a'], [['regel 1\nregel 2']], 'nl')).toBe('a\r\n"regel 1\nregel 2"\r\n')
    // Getallen blijven getallen, ook negatieve.
    expect(toCsv(['a'], [[-2]], 'en')).toBe('a\r\n-2\r\n')
    expect(toCsv(['a'], [[-64.71]], 'nl')).toBe('a\r\n-64,71\r\n')
  })

  it('wind als bereik met een gedachtestreepje (Excel maakt van "2-3" anders een datum)', () => {
    expect(windText('2-3')).toBe('2–3')
    expect(windText('4 / 5')).toBe('4–5')
    expect(windText('5')).toBe('5')
    expect(windText('NW 4')).toBe('NW 4')
    expect(windText(undefined)).toBeUndefined()
  })
})

describe('export', () => {
  it('zes bestanden met de juiste regels; verwijderde records en deelnemers niet', () => {
    setLang('nl', false)
    const files = exportFiles(data, 'nl')
    expect(files.map((f) => [f.name, f.rows])).toEqual([
      ['trips.csv', 1],
      ['dagen.csv', 2],
      ['boten.csv', 1],
      ['plaatsen.csv', 2],
      ['inkomsten.csv', 1],
      ['uitgaven.csv', 1],
    ])
    const all = files.map((f) => f.csv).join('\n')
    expect(all).not.toMatch(/Verwijder|Geheimenaam|p1/)
    const days = files[1]!.csv.split('\r\n')
    expect(days[0]).toBe('Datum;Trip;Van (plaats);Van (land);Naar (plaats);Naar (land);Rol;Boot;Schipper/trainer;Co-schipper;Wind (bft);Binnenwater;Zee;Zee (getijnavigatie);Totaal nm;Nacht-uren;Bijzonderheden;Datum geschat')
    expect(days[1]).toContain(`;12,5;0;12,5;0;"'=HYPERLINK(""http://nep"")";nee`)
    expect(days[2]).toContain('"Wind; regen, ""veel"""')
    expect(files[0]!.csv).toContain('Nepweek Een;Skipper charter')
    expect(files[5]!.csv).toContain("40,5;EUR;40,5;;;nee;")
    expect(files[5]!.csv).toContain("'+31 diesel")
  })

  it('elke regel heeft evenveel kolommen als de kopregel', () => {
    for (const lang of ['nl', 'en'] as const) {
      for (const f of exportFiles(data, lang)) {
        const sep = lang === 'nl' ? ';' : ','
        const count = (line: string) => line.replace(/"(?:[^"]|"")*"/g, '').split(sep).length
        const [head, ...rows] = f.csv.trimEnd().split('\r\n')
        for (const row of rows) expect(count(row), `${f.name}: ${row}`).toBe(count(head!))
      }
    }
  })

  it('reviewcitaten, tripnotities, salaris en verwijderde trips niet; een dag van een verwijderde trip zonder tripnaam', () => {
    const more = {
      ...data,
      trips: [{ ...trip, note: 'Geheime notitie', review: { quotes: ['Geheim citaat'] }, salary: { amount: 999, currency: 'EUR' as const, status: 'verwacht' as const, source: 'eigen' as const } }, { ...trip, id: 'weg', name: 'Weg trip', deletedAt: T }],
      legs: [...data.legs, leg('l9', { tripId: 'weg', toPlace: 'Zonderpin' })],
    }
    const all = exportFiles(more, 'nl')
    const text = all.map((f) => f.csv).join('\n')
    expect(text).not.toMatch(/Geheim|999|Weg trip/)
    expect(all[1]!.csv).toContain('2026-06-02;;Nephaven')
    // Een plaats zonder punt: lege breedte en lengte.
    expect(all[3]!.csv).toContain('Zonderpin;Nepland;;;1')
  })

  it('een trip zonder datums of dagen en een record zonder datum laten de export niet vastlopen', () => {
    const bare = { trips: [{ id: 'kaal', name: 'Kale trip', updatedAt: T, deletedAt: null }], legs: [{ ...leg('x'), date: undefined as unknown as string }], places: [], transactions: [], rates: null }
    const files = exportFiles(bare, 'en')
    expect(files[0]!.csv).toContain('Kale trip')
    expect(files[1]!.rows).toBe(1)
  })

  it('bedragen in een andere valuta: ontvangen euro, opgeslagen koers, ECB-koers en voorlopig', () => {
    const rates: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2026-06-01', '2026-06-02'], rates: { USD: [1.1, 1.25] } }
    const money = {
      ...data,
      transactions: [
        tx('ontvangen', { currency: 'USD', amount: 110, receivedEur: 95 }),
        tx('opgeslagen', { currency: 'USD', amount: 110, amountEur: 100, rate: 1.1, rateDate: '2026-06-01' }),
        tx('ecb', { currency: 'USD', amount: 125, date: '2026-06-02' }),
        tx('voorlopig', { currency: 'USD', amount: 125, date: '2026-07-01' }),
        tx('onbekend', { currency: 'GBP', amount: 10 }),
      ],
      rates,
    }
    const income = exportFiles(money, 'en')[4]!.csv.split('\r\n')
    expect(income.find((l) => l.includes(',110,USD,95,'))).toContain(',,,no,')
    expect(income.find((l) => l.includes(',110,USD,100,'))).toContain(',1.1,2026-06-01,no,')
    expect(income.find((l) => l.startsWith('2026-06-02') && l.includes(',125,USD,'))).toContain(',100,1.25,2026-06-02,no,')
    expect(income.find((l) => l.startsWith('2026-07-01'))).toContain(',100,1.25,2026-06-02,yes,')
    // Geen eurowaarde bekend: euro, koers en voorlopig leeg.
    expect(income.find((l) => l.includes(',10,GBP,'))).toContain(',10,GBP,,,,,')
  })

  it('één zip met UTF-8-BOM per bestand; de bestandsnaam met datum', () => {
    const zip = unzipSync(exportZip(exportFiles(data, 'en')))
    expect(Object.keys(zip).sort()).toEqual(['boats.csv', 'days.csv', 'expenses.csv', 'income.csv', 'places.csv', 'trips.csv'])
    expect([...zip['days.csv']!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = strFromU8(zip['days.csv']!)
    expect(text).toContain('Date,Trip,From (place)')
    expect(exportFileName('2026-10-29')).toBe('logboek-export-2026-10-29.zip')
  })
})
