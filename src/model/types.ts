// Alle datatypen. Elk record heeft id (UUIDv4), updatedAt (ISO) en deletedAt (ISO of null, tombstone).

export interface SyncRecord {
  id: string
  updatedAt: string
  deletedAt: string | null
}

export type Role = 'schipper' | 'co-schipper' | 'bemanningslid' | 'trainee' | 'instructeur'

export const ROLES: readonly Role[] = ['schipper', 'co-schipper', 'bemanningslid', 'trainee', 'instructeur']


export interface Trip extends SyncRecord {
  name: string
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

/** Versleutelde bestanden in logboek-data en hun recordtype. */
export interface Collections {
  'trips.json.enc': Trip
  'legs.json.enc': Leg
  'transactions.json.enc': Transaction
  'settings.json.enc': Settings
  'curricula.json.enc': Curriculum
}

export type CollectionPath = keyof Collections

export const COLLECTION_PATHS: readonly CollectionPath[] = [
  'trips.json.enc',
  'legs.json.enc',
  'transactions.json.enc',
  'settings.json.enc',
  'curricula.json.enc',
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
