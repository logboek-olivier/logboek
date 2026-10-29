import { addDays } from '../model/money'
import { draftPlan, newGroup } from '../model/plans'
import { SEED_CURRICULA } from '../model/seed-curricula'
import type { CalendarDay, CollectionPath, Collections, Leg, Participant, Place, Reminder, Settings, Student, Trip, WeekPlan } from '../model/types'
import { DEFAULT_SETTINGS } from '../model/settings'

// Demomodus: verzonnen voorbeelddata om de app te laten zien. Routes langs openbare plaatsen in de BVI en Kroatië
// (namen en coördinaten zoals op elke kaart), verzonnen boten, alleen verzonnen voornamen, geen bedragen (geen
// transacties). De datums schuiven mee met vandaag, zodat er altijd een lopende trip is.

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
      checks: { 'seed-veiligheid': ['seed-veiligheid-1', 'seed-veiligheid-2', 'seed-veiligheid-3'], 'seed-check-in': ['seed-check-in-1'] },
      ...base,
    },
    {
      id: 'demo-trip-cro',
      name: 'Croatia',
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
      review: { quotes: ['Best week of the summer', 'Calm, clear and fun'], score: 9.4, rating: 9, lesson: 'Reef early before the afternoon breeze.' },
      closedAt: addDays(croStart, 7),
      ...base,
    },
    {
      id: 'demo-trip-bvi-old',
      name: 'BVI',
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

  const calendar: CalendarDay[] = [
    { id: `dag:${addDays(nextStart, -2)}`, date: addDays(nextStart, -2), type: 'reis', travel: { from: 'Amsterdam', to: 'Tortola' }, ...base },
    { id: `dag:${addDays(today, 8)}`, date: addDays(today, 8), type: 'rust', ...base },
  ]

  const reminders: Reminder[] = [
    { id: 'demo-rem-1', title: 'Renew first aid certificate', date: addDays(today, 40), kind: 'vervalt', doneAt: null, ...base },
    { id: 'demo-rem-2', title: 'Book flight to Tortola', date: addDays(today, 6), kind: 'deadline', doneAt: null, ...base },
  ]

  const settings: Settings = { ...DEFAULT_SETTINGS, lastBoat: 'Blue Heron', lastRole: 'instructeur', activeWeekId: 'demo-trip-bvi', ...base }

  return {
    'trips.json.enc': trips,
    'legs.json.enc': legs,
    'places.json.enc': places,
    'students.json.enc': students,
    'plans.json.enc': [plan],
    'calendar.json.enc': calendar,
    'reminders.json.enc': reminders,
    'settings.json.enc': [settings],
  }
}
