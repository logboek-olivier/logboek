import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { berichtMarkeren, berichtStandaardZetten, berichtVeldZetten, sjabloonOpslaan, sjabloonVerwijderen } from '../src/domain/berichten'
import {
  effectiveTemplates,
  fillTemplate,
  messageKinds,
  messageReminders,
  messageValues,
  SEED_TEMPLATES,
  templatesFor,
  textForDisplay,
  textForStorage,
  TOKENS,
} from '../src/model/messages'
import { SCHEMA_VERSION } from '../src/model/schema'
import { currentSettings } from '../src/model/settings'
import type { MessageTemplate, Place, Trip } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { decodeRecords } from '../src/storage/sync'
import { FakeGithub } from './helpers/fake-github'
import { put, putMany } from './helpers/schrijf'

// Berichtengenerator (src/model/messages.ts): sjablonen invullen, ontbrekende velden, de keuze van het sjabloon, de
// standaard per organisatie en de herinnering. Alle namen en plaatsen zijn verzonnen.

const T = '2026-11-01T10:00:00.000Z'
const TOKEN = 'github_pat_BERICHTEN_0123456789abcdefghijklmnopqrstuvwxy'
let masterKey: CryptoKey
let counter = 0
beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function device() {
  return Store.open(await openLogboekDb(`logboek-berichten-${++counter}`), masterKey, new GithubClient(TOKEN, new FakeGithub().fetch))
}

const TRIP: Trip = {
  id: 'nep-trip',
  name: 'YW #7 · Nepgebied',
  kind: 'werk',
  type: 'skipper-charter',
  organisation: 'yacht-week',
  startDate: '2026-11-14',
  endDate: '2026-11-21',
  boat: 'Nepster',
  boatModel: 'Nepcat 45',
  boatKind: 'catamaran',
  base: 'Nephaven',
  participants: [
    { id: 'p1', firstName: 'Nick', tag: 'B', country: 'VS' },
    { id: 'p2', firstName: 'Anna', role: 'gast' },
    { id: 'p3', firstName: 'Olli', role: 'schipper' },
  ],
  messageFields: { meetingPlace: 'Nepmarina', meetingTime: '16:00', checkIn: '17:00', checkOut: '09:00' },
  updatedAt: T,
  deletedAt: null,
}
const PLACES: Place[] = [{ id: 'pl', name: 'Nepmarina', lat: 43.5, lon: 16.25, updatedAt: T, deletedAt: null }]
const CTX = { legs: [], places: PLACES, settings: {} }
const ALL = TOKENS.map((t) => `{${t}}`).join('|')

describe('invullen', () => {
  it('vult elk invulveld uit de trip, de boot en de plaatsen; de verzamelplaats krijgt een kaartlink', () => {
    const filled = fillTemplate({ text: ALL }, messageValues(TRIP, CTX, 'en'))
    expect(filled.missing).toEqual([])
    expect(filled.text).toBe(
      'Nick and Anna|Nepster|catamaran|Nepcat 45|Nepmarina (https://maps.google.com/?q=43.50000,16.25000)|16:00|Saturday, 14 November 2026|Saturday, 21 November 2026|17:00|09:00|Nephaven|Olli|Yacht Week|7',
    )
    // In het Nederlands: Nederlandse datums, "en" en "eenromp"/"catamaran" in die taal.
    const nl = fillTemplate({ text: '{guests} · {startDate} · {boatType}' }, messageValues(TRIP, CTX, 'nl'))
    expect(nl.text).toBe('Nick en Anna · zaterdag 14 november 2026 · catamaran')
  })

  it('voornamen alleen als voornaam: geen kenmerk, land of tweede woord, en nooit de schipper als gast', () => {
    const trip: Trip = { ...TRIP, participants: [{ id: 'a', firstName: 'Nick Nep', tag: 'B', country: 'VS' }, { id: 'b', firstName: 'Olli', role: 'schipper' }] }
    expect(messageValues(trip, CTX, 'en').guests).toBe('Nick')
  })

  it('een ontbrekend veld blokkeert delen: geen tekst, het veld gemarkeerd, nooit {veld} letterlijk', () => {
    const trip: Trip = { ...TRIP, messageFields: {} }
    const filled = fillTemplate(SEED_TEMPLATES[0]!, messageValues(trip, CTX, 'en'))
    expect(filled.text).toBeNull()
    expect(filled.missing).toEqual(['meetingPlace', 'meetingTime', 'checkIn', 'checkOut'])
    expect(filled.parts.some((p) => 'missing' in p && p.missing === 'meetingPlace')).toBe(true)
    for (const part of filled.parts) if ('text' in part) expect(part.text).not.toMatch(/\{[a-zA-Z ]+\}/)
  })

  it('de meegeleverde voorbeelden zijn volledig in te vullen', () => {
    for (const seed of SEED_TEMPLATES) {
      const filled = fillTemplate(seed, messageValues(TRIP, CTX, seed.lang))
      expect(filled.missing, seed.id).toEqual([])
      expect(filled.text, seed.id).not.toContain('{')
    }
  })

  it('invulvelden als naam in beeld (beide talen) worden sleutels bij opslaan, en terug', () => {
    const stored = textForStorage('Hoi {voornamen gasten}, see you at {Meeting point}. {onbekend} blijft.')
    expect(stored).toBe('Hoi {guests}, see you at {meetingPlace}. {onbekend} blijft.')
    expect(textForDisplay(stored, 'nl')).toBe('Hoi {voornamen gasten}, see you at {verzamelplaats}. {onbekend} blijft.')
  })
})

describe('keuze van het sjabloon', () => {
  const tpl = (id: string, extra: Partial<MessageTemplate>): MessageTemplate => ({ id, kind: 'introductie', lang: 'en', text: id, updatedAt: T, deletedAt: null, ...extra })
  const templates = [
    tpl('algemeen', {}),
    tpl('yw', { organisation: 'yacht-week' }),
    tpl('charter', { tripType: 'skipper-charter' }),
    tpl('yw-charter', { organisation: 'yacht-week', tripType: 'skipper-charter' }),
    tpl('sv', { organisation: 'sailing-virgins' }),
    tpl('yw-nl', { organisation: 'yacht-week', lang: 'nl' }),
  ]
  it('organisatie én soort trip, dan organisatie, dan soort trip, dan de algemene terugval', () => {
    expect(templatesFor(templates, 'introductie', 'yacht-week', 'skipper-charter').map((x) => x.id)).toEqual(['yw-charter'])
    expect(templatesFor(templates, 'introductie', 'yacht-week', 'delivery').map((x) => x.id)).toEqual(['yw', 'yw-nl'])
    expect(templatesFor(templates, 'introductie', 'org:nep', 'skipper-charter').map((x) => x.id)).toEqual(['charter'])
    expect(templatesFor(templates, 'introductie', 'org:nep', 'delivery').map((x) => x.id)).toEqual(['algemeen'])
    expect(templatesFor(templates, 'afsluiting', 'yacht-week', 'skipper-charter')).toEqual([])
  })

  it('eigen soorten komen bij introductie en afsluiting', () => {
    const own = tpl('eigen', { kind: 'eigen:x', kindName: 'Herinnering dag voor vertrek' })
    expect(messageKinds([...SEED_TEMPLATES, own]).map((k) => k.kind)).toEqual(['introductie', 'afsluiting', 'eigen:x'])
  })
})

describe('opslaan via opdrachten', () => {
  it('sjabloon opslaan en verwijderen; een meegeleverd sjabloon houdt zijn id en verdwijnt met een tombstone zonder tekst', async () => {
    const s = await device()
    const { result: id } = await sjabloonOpslaan(s, null, { kind: 'introductie', lang: 'nl', organisation: 'sailing-virgins', text: 'Hoi {voornamen gasten}' })
    expect(s.list('templates.json.enc').find((x) => x.id === id)).toMatchObject({ lang: 'nl', organisation: 'sailing-virgins', text: 'Hoi {guests}' })
    await sjabloonOpslaan(s, 'seed-introductie-en', { kind: 'introductie', lang: 'en', text: 'Hi {guests}' })
    expect(effectiveTemplates(s.get('templates.json.enc')).find((x) => x.id === 'seed-introductie-en')?.text).toBe('Hi {guests}')
    const undo = await sjabloonVerwijderen(s, 'seed-afsluiting-en')
    expect(effectiveTemplates(s.get('templates.json.enc')).map((x) => x.id)).not.toContain('seed-afsluiting-en')
    expect(s.get('templates.json.enc').find((x) => x.id === 'seed-afsluiting-en')).toMatchObject({ text: '', deletedAt: expect.any(String) })
    await undo()
    expect(effectiveTemplates(s.get('templates.json.enc')).map((x) => x.id)).toContain('seed-afsluiting-en')
  })

  it('standaard per organisatie, per trip te overschrijven; de laatst gebruikte waarde wordt de standaard voor de volgende trip', async () => {
    const s = await device()
    await putMany(s, 'trips.json.enc', [{ ...TRIP, messageFields: undefined }, { ...TRIP, id: 'nep-trip-2', messageFields: undefined, startDate: '2026-11-28', endDate: '2026-12-05' }])
    await berichtStandaardZetten(s, 'yacht-week', { meetingPlace: 'Nepmarina A', meetingTime: '16:00', introDaysBefore: 4 })
    const ctx = () => ({ legs: [], places: [], settings: currentSettings(s.list('settings.json.enc')) })
    const trip = (id: string) => s.list('trips.json.enc').find((x) => x.id === id)!
    expect(messageValues(trip('nep-trip'), ctx(), 'en')).toMatchObject({ meetingPlace: 'Nepmarina A', meetingTime: '16:00' })
    // Per trip overschrijven: deze trip Nepmarina B; dat wordt ook de standaard voor de volgende trip.
    await berichtVeldZetten(s, 'nep-trip', 'meetingPlace', 'Nepmarina B')
    expect(trip('nep-trip').messageFields).toEqual({ meetingPlace: 'Nepmarina B' })
    expect(currentSettings(s.list('settings.json.enc')).messageDefaults?.['yacht-week']).toMatchObject({ meetingPlace: 'Nepmarina B', meetingTime: '16:00', introDaysBefore: 4 })
    expect(messageValues(trip('nep-trip-2'), ctx(), 'en').meetingPlace).toBe('Nepmarina B')
    // Een eigen waarde blijft staan als de standaard later verandert.
    await berichtVeldZetten(s, 'nep-trip-2', 'meetingPlace', 'Nepmarina C')
    expect(messageValues(trip('nep-trip'), ctx(), 'en').meetingPlace).toBe('Nepmarina B')
  })

  it('verstuurd bewaart alleen de status en de datum: nergens de tekst van het bericht', async () => {
    const s = await device()
    await put(s, 'trips.json.enc', TRIP)
    const text = fillTemplate(SEED_TEMPLATES[0]!, messageValues(TRIP, CTX, 'en')).text!
    await berichtMarkeren(s, TRIP.id, 'introductie', 'verstuurd', '2026-11-10')
    expect(s.list('trips.json.enc')[0]!.messages).toEqual({ introductie: { status: 'verstuurd', date: '2026-11-10' } })
    const everything = JSON.stringify(Object.fromEntries(['trips.json.enc', 'settings.json.enc', 'templates.json.enc', 'history.json.enc'].map((p) => [p, s.list(p as 'trips.json.enc')])))
    expect(everything).not.toContain(text.slice(0, 40))
    expect(everything).not.toContain('Welcome aboard')
  })
})

describe('herinnering op Vandaag', () => {
  const trips = [TRIP]
  it('introductie vanaf X dagen vóór de start (standaard 3, per organisatie in te stellen), afsluiting op de laatste dag', () => {
    expect(messageReminders(trips, [], {}, '2026-11-10')).toEqual([])
    expect(messageReminders(trips, [], {}, '2026-11-11').map((r) => r.kind)).toEqual(['introductie'])
    expect(messageReminders(trips, [], {}, '2026-11-14').map((r) => r.kind)).toEqual(['introductie'])
    expect(messageReminders(trips, [], {}, '2026-11-15')).toEqual([])
    expect(messageReminders(trips, [], { messageDefaults: { 'yacht-week': { introDaysBefore: 5 } } }, '2026-11-09').map((r) => r.kind)).toEqual(['introductie'])
    expect(messageReminders(trips, [], {}, '2026-11-20')).toEqual([])
    expect(messageReminders(trips, [], {}, '2026-11-21').map((r) => r.kind)).toEqual(['afsluiting'])
  })

  it('weg na Verstuurd of Niet nodig, en nooit bij een trip die geen werk is', () => {
    const sent: Trip = { ...TRIP, messages: { introductie: { status: 'verstuurd', date: '2026-11-12' }, afsluiting: { status: 'niet-nodig', date: '2026-11-21' } } }
    expect(messageReminders([sent], [], {}, '2026-11-12')).toEqual([])
    expect(messageReminders([sent], [], {}, '2026-11-21')).toEqual([])
    expect(messageReminders([{ ...TRIP, kind: 'plezier', type: 'zelf-cruisen', organisation: undefined }], [], {}, '2026-11-12')).toEqual([])
  })
})

describe('schemaversie 8', () => {
  it('leest trips en instellingen van versie 7 ongewijzigd in (zonder berichtvelden)', () => {
    const v7 = (records: readonly unknown[]) => new TextEncoder().encode(JSON.stringify({ format: 'logboek-collection', schemaVersion: 7, minWriterVersion: 13, records }))
    const old = { ...TRIP, messageFields: undefined }
    delete (old as Partial<Trip>).messageFields
    expect(decodeRecords('trips.json.enc', v7([old]))).toEqual([old])
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(8)
  })
})
