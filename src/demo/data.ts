import { draftPlan, newGroup } from '../model/plans'
import { SEED_CURRICULA } from '../model/seed-curricula'
import type { CalendarDay, CollectionPath, Collections, Leg, Participant, Place, Reminder, Settings, StayPeriod, Student, Transaction, Trip, WeekPlan } from '../model/types'
import { DEFAULT_SETTINGS } from '../model/settings'
import { addDays } from '../basis/datum'

// Demomodus: verzonnen voorbeelddata om de app te laten zien. Routes langs openbare plaatsen in de BVI en Kroatië
// (namen en coördinaten zoals op elke kaart), verzonnen boten, alleen verzonnen voornamen en verzonnen bedragen per
// periode (salaris, fooi, uitgaven). Periodes van elke soort: werk, training, plezier, reis, thuis en vrij. De datums
// schuiven mee met vandaag, zodat er altijd een lopende trip is.

const T = '2026-01-01T00:00:00.000Z'
const base = { updatedAt: T, deletedAt: null }

interface Stop {
  name: string
  lat: number
  lon: number
  country: string
}

const BVI: Record<string, Stop> = {
  nanny: { name: 'Nanny Cay', lat: 18.3985, lon: -64.6355, country: 'BVI' },
  bight: { name: 'The Bight', lat: 18.3175, lon: -64.6165, country: 'BVI' },
  cooper: { name: 'Cooper Island', lat: 18.3855, lon: -64.5135, country: 'BVI' },
  spanish: { name: 'Spanish Town', lat: 18.4475, lon: -64.4355, country: 'BVI' },
  anegada: { name: 'Anegada', lat: 18.7225, lon: -64.3875, country: 'BVI' },
  jost: { name: 'Great Harbour', lat: 18.4435, lon: -64.7515, country: 'BVI' },
  cane: { name: 'Cane Garden Bay', lat: 18.4275, lon: -64.6615, country: 'BVI' },
}

const CRO: Record<string, Stop> = {
  split: { name: 'Split', lat: 43.5035, lon: 16.4295, country: 'Croatia' },
  milna: { name: 'Milna', lat: 43.3265, lon: 16.4485, country: 'Croatia' },
  hvar: { name: 'Hvar', lat: 43.1715, lon: 16.4405, country: 'Croatia' },
  vis: { name: 'Vis', lat: 43.0615, lon: 16.1835, country: 'Croatia' },
  komiza: { name: 'Komiža', lat: 43.0435, lon: 16.0915, country: 'Croatia' },
  stari: { name: 'Stari Grad', lat: 43.1845, lon: 16.5965, country: 'Croatia' },
  maslinica: { name: 'Maslinica', lat: 43.3985, lon: 16.2075, country: 'Croatia' },
}

type Hop = [from: Stop, to: Stop, nm: number, wind: string]

function legsOf(tripId: string, boat: string, role: Leg['role'], start: string, hops: Hop[], tidal = false): Leg[] {
  return hops.map(([from, to, nm, wind], i) => ({
    id: `demo-leg-${tripId}-${i}`,
    tripId,
    date: addDays(start, i),
    fromPlace: from.name,
    fromCountry: from.country,
    toPlace: to.name,
    toCountry: to.country,
    role,
    boat,
    windBft: wind,
    nmInland: 0,
    nmSea: tidal ? 0 : nm,
    nmTidal: tidal ? nm : 0,
    nightHours: nm > 25 ? 2 : 0,
    dateEstimated: false,
    source: 'manual' as const,
    ...base,
  }))
}

const FIRST_NAMES = ['Emma', 'Liam', 'Sofia', 'Noah', 'Mia', 'Lucas', 'Ava', 'Finn']

export type DemoData = { [P in CollectionPath]?: Collections[P][] }

/** Alle databestanden voor de demo, met vandaag als ankerpunt. */
export function demoData(today: string): DemoData {
  const bviStart = addDays(today, -3)
  const croStart = addDays(today, -60)
  const pastBvi = addDays(today, -120)
  const nextStart = addDays(today, 14)
  const friendsStart = addDays(today, -14)

  const participants: Participant[] = FIRST_NAMES.slice(0, 6).map((firstName, i) => ({
    id: `demo-p-${i}`,
    firstName,
    level: i < 3 ? 'beginner' : 'gemiddeld',
    curriculumId: i < 3 ? 'seed-asa-101' : 'seed-asa-103',
    country: ['NL', 'UK', 'US', 'DE', 'US', 'CA'][i]!,
  }))

  const trips: Trip[] = [
    {
      id: 'demo-trip-bvi',
      name: 'BVI',
      kind: 'werk',
      type: 'training-geven',
      startDate: bviStart,
      endDate: addDays(bviStart, 6),
      boat: 'Blue Heron',
      boatModel: 'Lagoon 42',
      boatLengthFt: 42,
      boatKind: 'catamaran',
      base: BVI.nanny!.name,
      charter: 'Demo Charters',
      area: 'BVI',
      organisation: 'sailing-virgins',
      participants,
      salary: { amount: 1600, currency: 'USD', status: 'verwacht', source: 'eigen' },
      checks: { 'seed-veiligheid': ['seed-veiligheid-1', 'seed-veiligheid-2', 'seed-veiligheid-3'], 'seed-check-in': ['seed-check-in-1'] },
      ...base,
    },
    {
      id: 'demo-trip-cro',
      name: 'Croatia',
      kind: 'werk',
      type: 'skipper-charter',
      startDate: croStart,
      endDate: addDays(croStart, 6),
      boat: 'Morning Star',
      boatModel: 'Bavaria 46',
      boatLengthFt: 46,
      boatKind: 'eenromp',
      base: CRO.split!.name,
      charter: 'Demo Yachting',
      area: 'Dalmatia',
      organisation: 'yacht-week',
      salary: { amount: 1400, currency: 'EUR', status: 'ontvangen', source: 'eigen', transactionId: 'salaris:demo-trip-cro' },
      review: { quotes: ['Best week of the summer', 'Calm, clear and fun'], score: 9.4, rating: 9, lesson: 'Reef early before the afternoon breeze.' },
      closedAt: addDays(croStart, 7),
      ...base,
    },
    {
      id: 'demo-trip-bvi-old',
      name: 'Day Skipper course',
      kind: 'training',
      type: 'zelf-trainen',
      startDate: pastBvi,
      endDate: addDays(pastBvi, 4),
      boat: 'Sandpiper',
      boatModel: 'Beneteau Oceanis 40',
      boatLengthFt: 40,
      boatKind: 'eenromp',
      base: BVI.nanny!.name,
      area: 'BVI',
      organisation: 'eigen',
      closedAt: addDays(pastBvi, 5),
      ...base,
    },
    {
      id: 'demo-trip-next',
      name: 'BVI',
      kind: 'werk',
      type: 'training-geven',
      startDate: nextStart,
      endDate: addDays(nextStart, 6),
      boat: 'Blue Heron',
      boatModel: 'Lagoon 42',
      boatLengthFt: 42,
      boatKind: 'catamaran',
      base: BVI.nanny!.name,
      area: 'BVI',
      organisation: 'sailing-virgins',
      salary: { amount: 1600, currency: 'USD', status: 'verwacht', source: 'eigen' },
      ...base,
    },
    {
      id: 'demo-trip-friends',
      name: 'Sailing with friends',
      kind: 'plezier',
      type: 'zelf-cruisen',
      startDate: friendsStart,
      endDate: addDays(friendsStart, 2),
      boat: 'Sea Breeze',
      boatModel: 'Dufour 390',
      boatLengthFt: 39,
      boatKind: 'eenromp',
      base: BVI.nanny!.name,
      charter: 'Demo Charters',
      area: 'BVI',
      ...base,
    },
  ]

  const b = BVI
  const c = CRO
  const legs: Leg[] = [
    ...legsOf('demo-trip-bvi', 'Blue Heron', 'instructeur', bviStart, [
      [b.nanny!, b.bight!, 7, '3-4'],
      [b.bight!, b.cooper!, 9, '4'],
      [b.cooper!, b.spanish!, 7, '4-5'],
    ]),
    ...legsOf('demo-trip-cro', 'Morning Star', 'schipper', croStart, [
      [c.split!, c.milna!, 11, '2-3'],
      [c.milna!, c.hvar!, 16, '3'],
      [c.hvar!, c.vis!, 21, '4'],
      [c.vis!, c.komiza!, 8, '3'],
      [c.komiza!, c.stari!, 31, '4-5'],
      [c.stari!, c.maslinica!, 24, '3'],
      [c.maslinica!, c.split!, 13, '2'],
    ]),
    ...legsOf('demo-trip-friends', 'Sea Breeze', 'schipper', friendsStart, [
      [b.nanny!, b.cane!, 9, '3'],
      [b.cane!, b.jost!, 6, '3-4'],
      [b.jost!, b.nanny!, 8, '4'],
    ]),
    ...legsOf('demo-trip-bvi-old', 'Sandpiper', 'trainee', pastBvi, [
      [b.nanny!, b.jost!, 9, '4'],
      [b.jost!, b.anegada!, 27, '4-5'],
      [b.anegada!, b.spanish!, 15, '5'],
      [b.spanish!, b.cane!, 16, '4'],
      [b.cane!, b.nanny!, 9, '3'],
    ]),
  ]

  const places: Place[] = [...Object.values(BVI), ...Object.values(CRO)].map((s, i) => ({ id: `demo-place-${i}`, name: s.name, lat: s.lat, lon: s.lon, country: s.country, ...base }))

  // Studenten van de lopende trip (zelfde id als de deelnemer), met wat voortgang.
  const students: Student[] = participants.map((p, i) => {
    const course = SEED_CURRICULA.find((cu) => cu.id === p.curriculumId)!
    const topics = course.groups.flatMap((g) => g.topics)
    const progress: Student['progress'] = {}
    topics.slice(0, 4 + i * 2).forEach((topic, j) => {
      progress[topic.id] = { status: j % 3 === 0 ? 'beheerst' : 'geoefend', updatedAt: T }
    })
    return { id: p.id, firstName: p.firstName, curriculumId: p.curriculumId!, level: p.level!, progress, startedAt: bviStart, weekId: 'demo-trip-bvi', ...base }
  })

  const groupA = { ...newGroup('Group A', 'seed-asa-101', 'beginner'), id: 'demo-group-a', studentIds: students.slice(0, 3).map((s) => s.id) }
  const groupB = { ...newGroup('Group B', 'seed-asa-103', 'gemiddeld'), id: 'demo-group-b', studentIds: students.slice(3).map((s) => s.id) }
  const plan: WeekPlan = {
    ...draftPlan({ title: 'BVI · ASA 101 and 103', startDate: bviStart, dayCount: 7, tripId: 'demo-trip-bvi', groups: [groupA, groupB] }, SEED_CURRICULA, 'en'),
    id: 'demo-plan',
    ...base,
  }

  // Periodemodel: reis, thuis en vrij zijn periodes aan land (docs/PERIODEMODEL.md).
  const stays: StayPeriod[] = [
    { id: 'demo-stay-thuis-1', kind: 'thuis', startDate: addDays(pastBvi, 5), endDate: addDays(croStart, -2), ...base },
    { id: 'demo-stay-reis-cro', kind: 'reis', startDate: addDays(croStart, -1), endDate: addDays(croStart, -1), travel: { from: 'Amsterdam', to: 'Split', by: 'vliegtuig' }, ...base },
    { id: 'demo-stay-reis-cro-terug', kind: 'reis', startDate: addDays(croStart, 7), endDate: addDays(croStart, 7), travel: { from: 'Split', to: 'Amsterdam', by: 'vliegtuig' }, ...base },
    { id: 'demo-stay-thuis-2', kind: 'thuis', startDate: addDays(croStart, 8), endDate: addDays(friendsStart, -2), ...base },
    { id: 'demo-stay-reis-bvi', kind: 'reis', startDate: addDays(friendsStart, -1), endDate: addDays(friendsStart, -1), travel: { from: 'Amsterdam', to: 'Tortola', by: 'vliegtuig' }, ...base },
    { id: 'demo-stay-vrij-bvi', kind: 'vrij', name: 'Tortola', startDate: addDays(friendsStart, 3), endDate: addDays(bviStart, -1), ...base },
    { id: 'demo-stay-vrij', kind: 'vrij', startDate: addDays(today, 8), endDate: addDays(today, 8), ...base },
    { id: 'demo-stay-reis', kind: 'reis', startDate: addDays(nextStart, -2), endDate: addDays(nextStart, -2), travel: { from: 'Amsterdam', to: 'Tortola', by: 'vliegtuig' }, ...base },
  ]

  // Geld per periode (verzonnen bedragen): salaris en fooi bij werk, cursusgeld bij de training, uitgaven bij plezier,
  // reis, thuis en vrij. Vandaag toont nooit bedragen; elders pas na "Toon bedragen".
  const money = (id: string, date: string, tripId: string, kind: Transaction['kind'], amount: number, currency: Transaction['currency'], extra: Partial<Transaction> = {}): Transaction => ({
    id: `demo-tx-${id}`,
    date,
    kind,
    amount,
    currency,
    source: 'overig',
    tripId,
    ...extra,
    ...base,
  })
  const transactions: Transaction[] = [
    money('cursus', pastBvi, 'demo-trip-bvi-old', 'investering', 1450, 'EUR', { category: 'opleiding', note: 'Day Skipper course' }),
    money('cursus-eten', addDays(pastBvi, 2), 'demo-trip-bvi-old', 'kosten', 85, 'USD', { category: 'eten', note: 'Groceries' }),
    money('thuis-1', addDays(pastBvi, 20), 'demo-stay-thuis-1', 'kosten', 64, 'EUR', { category: 'eten', note: 'Groceries' }),
    money('vlucht-cro', addDays(croStart, -1), 'demo-trip-cro', 'kosten', 180, 'EUR', { category: 'vervoer', note: 'Flight to Split' }),
    { ...money('salaris-cro', addDays(croStart, 10), 'demo-trip-cro', 'loon', 1400, 'EUR', { source: 'yacht-week' }), id: 'salaris:demo-trip-cro' },
    money('fooi-cro', addDays(croStart, 6), 'demo-trip-cro', 'fooi', 650, 'EUR', { source: 'yacht-week', tipFrom: { kind: 'groep' }, tipVia: 'contant' }),
    money('cro-eten', addDays(croStart, 3), 'demo-trip-cro', 'kosten', 42, 'EUR', { category: 'eten', note: 'Lunch ashore' }),
    money('vlucht-terug', addDays(croStart, 7), 'demo-stay-reis-cro-terug', 'kosten', 160, 'EUR', { category: 'vervoer', note: 'Flight home' }),
    money('thuis-2', addDays(croStart, 20), 'demo-stay-thuis-2', 'kosten', 55, 'EUR', { category: 'eten', note: 'Groceries' }),
    money('uitrusting', addDays(croStart, 25), 'demo-stay-thuis-2', 'investering', 240, 'EUR', { category: 'uitrusting', note: 'Foul-weather jacket' }),
    money('vlucht-bvi', addDays(friendsStart, -1), 'demo-trip-friends', 'kosten', 690, 'EUR', { category: 'vervoer', note: 'Flight to Tortola' }),
    money('vrienden-eten', friendsStart, 'demo-trip-friends', 'kosten', 120, 'USD', { category: 'eten', note: 'Provisioning' }),
    money('vrienden-boei', addDays(friendsStart, 1), 'demo-trip-friends', 'kosten', 35, 'USD', { category: 'verblijf', note: 'Mooring ball' }),
    money('vrij-bvi', addDays(friendsStart, 4), 'demo-stay-vrij-bvi', 'kosten', 75, 'USD', { category: 'verblijf', note: 'Guesthouse' }),
    money('fooi-bvi', addDays(bviStart, 2), 'demo-trip-bvi', 'fooi', 120, 'USD', { source: 'sailing-virgins', tipFrom: { kind: 'personen', participantIds: ['demo-p-0', 'demo-p-3'] }, tipVia: 'contant' }),
    money('bvi-eten', addDays(bviStart, 1), 'demo-trip-bvi', 'kosten', 28, 'USD', { category: 'eten', note: 'Ice and snacks' }),
  ]
  const calendar: CalendarDay[] = []

  const reminders: Reminder[] = [
    { id: 'demo-rem-1', title: 'Renew first aid certificate', date: addDays(today, 40), kind: 'vervalt', doneAt: null, ...base },
    { id: 'demo-rem-2', title: 'Book flight to Tortola', date: addDays(today, 6), kind: 'deadline', doneAt: null, ...base },
  ]

  const settings: Settings = { ...DEFAULT_SETTINGS, lastBoat: 'Blue Heron', lastRole: 'instructeur', activeWeekId: 'demo-trip-bvi', periodsMigratedAt: T, ...base }

  return {
    'trips.json.enc': trips,
    'legs.json.enc': legs,
    'places.json.enc': places,
    'students.json.enc': students,
    'plans.json.enc': [plan],
    'calendar.json.enc': calendar,
    'periods.json.enc': stays,
    'transactions.json.enc': transactions,
    'reminders.json.enc': reminders,
    'settings.json.enc': [settings],
  }
}
