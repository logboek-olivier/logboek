// Alle datatypen. Elk record heeft id (UUIDv4), updatedAt (ISO) en deletedAt (ISO of null, tombstone).

export interface SyncRecord {
  id: string
  updatedAt: string
  deletedAt: string | null
}

export type Role = 'schipper' | 'co-schipper' | 'bemanningslid' | 'trainee' | 'instructeur'

export const ROLES: readonly Role[] = ['schipper', 'co-schipper', 'bemanningslid', 'trainee', 'instructeur']


// Een tocht is ook een week (release 2+). Alle weekvelden zijn optioneel: oudere en geïmporteerde tochten hebben
// alleen een naam; type en datums worden dan afgeleid (src/model/weeks.ts) tot Olivier de week bewerkt.

export type WeekType = 'training-geven' | 'skipper-charter' | 'zelf-cruisen' | 'zelf-trainen' | 'delivery' | 'overig'
export const WEEK_TYPES: readonly WeekType[] = ['training-geven', 'skipper-charter', 'zelf-cruisen', 'zelf-trainen', 'delivery', 'overig']
export type Organisation = 'sailing-virgins' | 'yacht-week' | 'eigen' | 'overig'
export const ORGANISATIONS: readonly Organisation[] = ['sailing-virgins', 'yacht-week', 'eigen', 'overig']

/** Deelnemer van een week: alleen voornaam, eventueel niveau en cursus (beveiligingsregel 14). */
export interface Participant {
  id: string
  firstName: string
  level?: StudentLevel
  curriculumId?: string
}

export interface WeekReview {
  /** Reviewscore zoals de organisatie die geeft, bijvoorbeeld 9,4. */
  score?: number
  /** Citaten uit reviews; Engelstalige citaten blijven Engels. */
  quotes: string[]
}

export interface Trip extends SyncRecord {
  name: string
  type?: WeekType
  /** jjjj-mm-dd */
  startDate?: string
  /** jjjj-mm-dd, inclusief; standaard startDate + 6 dagen. */
  endDate?: string
  boat?: string
  area?: string
  organisation?: Organisation
  participants?: Participant[]
  note?: string
  review?: WeekReview
  /** jjjj-mm-dd waarop de week is afgerond. */
  closedAt?: string
}

export interface Leg extends SyncRecord {
  tripId: string
  /** jjjj-mm-dd */
  date: string
  fromPlace: string
  fromCountry: string
  toPlace: string
  toCountry: string
  role: Role
  boat: string
  skipperName?: string
  coSkipperName?: string
  /** Tekst, bijvoorbeeld "2-3". */
  windBft?: string
  nmInland: number
  nmSea: number
  nmTidal: number
  nightHours: number
  notes?: string
  dateEstimated: boolean
  source: 'import' | 'manual'
}

export type TransactionKind = 'fooi' | 'loon' | 'kosten' | 'investering'
export type TransactionSource = 'yacht-week' | 'sailing-virgins' | 'delivery' | 'overig'
export type Currency = 'EUR' | 'USD' | 'GBP' | 'HRK' | 'CHF' | 'SEK' | 'DKK' | 'NOK'

export const CURRENCIES: readonly Currency[] = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'DKK', 'NOK', 'HRK']
export const TRANSACTION_SOURCES: readonly TransactionSource[] = ['yacht-week', 'sailing-virgins', 'delivery', 'overig']

export interface Transaction extends SyncRecord {
  /** jjjj-mm-dd */
  date: string
  kind: TransactionKind
  /** Altijd positief; de richting volgt uit kind. */
  amount: number
  currency: Currency
  /** Bij EUR gelijk aan amount; bij andere valuta leeg tot de koersen-Action bestaat. */
  amountEur?: number
  source: TransactionSource
  /** Automatisch gezet als de datum binnen een tocht valt. */
  tripId?: string
  note?: string
}

export type AddTab = 'fooi' | 'kosten' | 'dag'
export type Water = 'zee' | 'getij' | 'binnen'

export interface Settings extends SyncRecord {
  id: 'settings'
  lastBoat: string
  lastRole: Role
  lastCurrency: Currency
  lastSource: TransactionSource
  lastTripId?: string
  // Optionele velden (release 1): oudere data zonder deze velden blijft geldig; oudere apps laten ze staan.
  lastIncomeKind?: 'fooi' | 'loon'
  lastCostKind?: 'kosten' | 'investering'
  lastWater?: Water
  /** Jaardoel in nm voor de kaart op Vandaag; standaard 2.500. */
  yearGoalNm?: number
  /** De lopende week ("Nieuwe week starten" maakt een week actief; afronden maakt hem weer leeg). */
  activeWeekId?: string | null
}

// Training (release 2). Bond-onafhankelijk: ASA, RYA, CWO of een eigen cursus.

export type CurriculumBody = 'ASA' | 'RYA' | 'CWO' | 'eigen'
export const CURRICULUM_BODIES: readonly CurriculumBody[] = ['ASA', 'RYA', 'CWO', 'eigen']
export type TopicKind = 'theorie' | 'praktijk'

/** Tekst in beide talen; een lege vertaling valt terug op de andere taal. */
export interface LocalizedText {
  nl: string
  en: string
}

export interface Topic {
  id: string
  title: LocalizedText
  kind: TopicKind
  /** Examenkritisch: komt bovenaan zolang een student het nog niet geoefend heeft. */
  examCritical: boolean
}

export interface TopicGroup {
  id: string
  title: LocalizedText
  topics: Topic[]
}

export interface Curriculum extends SyncRecord {
  body: CurriculumBody
  /** Bijvoorbeeld "101" of "Day Skipper". */
  courseCode: string
  name: LocalizedText
  groups: TopicGroup[]
  /** seed: meegeleverd door de app (ook na bewerken); eigen: door Olivier gemaakt of geïmporteerd. */
  source: 'seed' | 'eigen'
}

// Studenten (release 2). Alleen voornaam, cursus, niveau, voortgang en examenuitslag (beveiligingsregel 14).

export type StudentLevel = 'beginner' | 'gemiddeld' | 'gevorderd'
export const STUDENT_LEVELS: readonly StudentLevel[] = ['beginner', 'gemiddeld', 'gevorderd']
export type TopicStatus = 'nieuw' | 'geoefend' | 'beheerst'

export interface TopicProgress {
  status: TopicStatus
  updatedAt: string
}

export interface StudentExam {
  /** jjjj-mm-dd */
  date: string
  passed: boolean
  note?: string
}

export interface Student extends SyncRecord {
  firstName: string
  curriculumId: string
  level: StudentLevel
  /** Per onderwerp-id; een onderwerp zonder regel staat op "nieuw". */
  progress: Record<string, TopicProgress>
  exam?: StudentExam
  note?: string
  /** jjjj-mm-dd waarop de student begon; bepaalt de week in het overzicht. */
  startedAt?: string
  /** jjjj-mm-dd; gearchiveerde studenten staan apart en zijn te wissen. */
  archivedAt?: string | null
}

// Weekplanning (release 2). Groepen verwijzen naar studenten via id; namen staan alleen in students.json.enc.

export type DaySlot = 'ochtend' | 'middag' | 'avond'
export const DAY_SLOTS: readonly DaySlot[] = ['ochtend', 'middag', 'avond']

export interface PlanGroup {
  id: string
  /** Bijvoorbeeld "Groep A" of de bootnaam; geen studentnamen nodig. */
  name: string
  curriculumId: string
  level: StudentLevel
  studentIds: string[]
}

export interface PlanBlock {
  /** Vast id per blok, zodat een blok te verplaatsen is naar een andere dag of een ander dagdeel. */
  id: string
  slot: DaySlot
  groupIds: string[]
  topicIds: string[]
  location?: string
  note?: string
}

export interface PlanDay {
  /** jjjj-mm-dd */
  date: string
  blocks: PlanBlock[]
}

export interface WeekPlan extends SyncRecord {
  title: string
  /** jjjj-mm-dd */
  startDate: string
  dayCount: number
  tripId?: string
  groups: PlanGroup[]
  days: PlanDay[]
}

/** Versleutelde bestanden in logboek-data en hun recordtype. */
export interface Collections {
  'trips.json.enc': Trip
  'legs.json.enc': Leg
  'transactions.json.enc': Transaction
  'settings.json.enc': Settings
  'curricula.json.enc': Curriculum
  'students.json.enc': Student
  'plans.json.enc': WeekPlan
}

export type CollectionPath = keyof Collections

export const COLLECTION_PATHS: readonly CollectionPath[] = [
  'trips.json.enc',
  'legs.json.enc',
  'transactions.json.enc',
  'settings.json.enc',
  'curricula.json.enc',
  'students.json.enc',
  'plans.json.enc',
]

export function newId(): string {
  return crypto.randomUUID()
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** Datum van vandaag als jjjj-mm-dd in lokale tijd. */
export function todayIso(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
