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
  /** Oliviers eigen cijfer voor de trip (1–10). */
  rating?: number
  /** Eén zin: wat leerde ik. */
  lesson?: string
}

export type BoatKind = 'catamaran' | 'eenromp' | 'motor' | 'overig'
export const BOAT_KINDS: readonly BoatKind[] = ['catamaran', 'eenromp', 'motor', 'overig']

/** Geplande etappe van een trip (uit een route-sjabloon of "Herhaal vorige trip"); dag 0 = startdatum. */
export interface PlannedLeg {
  day: number
  from: string
  to: string
  /** Afstand van deze etappe in het sjabloon; het voorstel uit de historie gaat voor. */
  nm?: number
}

export interface Trip extends SyncRecord {
  name: string
  type?: WeekType
  /** jjjj-mm-dd */
  startDate?: string
  /** jjjj-mm-dd, inclusief; standaard startDate + 6 dagen. Een trip kan elke lengte hebben. */
  endDate?: string
  /** Naam van de boot. */
  boat?: string
  /** Merk en model, bijvoorbeeld "Lagoon 42". */
  boatModel?: string
  /** Lengte over alles in voet (zoals in charter- en RYA-logboeken); de app toont ook meters. */
  boatLengthFt?: number
  boatKind?: BoatKind
  /** Thuishaven of basis van de boot, bijvoorbeeld "Nanny Cay"; vult het startpunt van de eerste dag voor. */
  base?: string
  /** Charterbedrijf of eigenaar. */
  charter?: string
  area?: string
  organisation?: Organisation
  participants?: Participant[]
  note?: string
  review?: WeekReview
  /** jjjj-mm-dd waarop de week is afgerond. */
  closedAt?: string
  /** Geplande etappes; Vandaag biedt "Zoals gepland" voor de etappe van vandaag. */
  route?: PlannedLeg[]
  /** Afgevinkte punten van de vaste checklists: per checklist-id de id's van de afgevinkte punten. */
  checks?: Record<string, string[]>
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

/** Inkomsten: fooi, loon (of dagtarief), bonus (of provisie), terugbetaling van onkosten, overig; uitgaven: kosten, investering. */
export type TransactionKind = 'fooi' | 'loon' | 'bonus' | 'terugbetaling' | 'overig-inkomen' | 'kosten' | 'investering'
export const INCOME_KIND_LIST = ['fooi', 'loon', 'bonus', 'terugbetaling', 'overig-inkomen'] as const
export type IncomeKind = (typeof INCOME_KIND_LIST)[number]
export type TransactionSource = 'yacht-week' | 'sailing-virgins' | 'delivery' | 'overig'
export type Currency = 'EUR' | 'USD' | 'GBP' | 'HRK' | 'CHF' | 'SEK' | 'DKK' | 'NOK' | 'XCD'

export const CURRENCIES: readonly Currency[] = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'DKK', 'NOK', 'XCD', 'HRK']
export const TRANSACTION_SOURCES: readonly TransactionSource[] = ['yacht-week', 'sailing-virgins', 'delivery', 'overig']

export interface Transaction extends SyncRecord {
  /** jjjj-mm-dd */
  date: string
  kind: TransactionKind
  /** Altijd positief; de richting volgt uit kind. */
  amount: number
  currency: Currency
  /** Bij EUR gelijk aan amount; bij andere valuta amount / rate zodra de koers van de datum definitief bekend is. */
  amountEur?: number
  /** Gebruikte ECB-koers (valuta per 1 EUR) en de datum daarvan (transactiedatum of de werkdag ervoor). */
  rate?: number
  rateDate?: string
  /** Werkelijk ontvangen eurobedrag, optioneel; gaat voor de omrekening. */
  receivedEur?: number
  source: TransactionSource
  /** De trip; bij inkomsten gekozen (standaard de trip van de datum), bij uitgaven automatisch op datum. */
  tripId?: string
  note?: string
}

export type AddTab = 'dag' | 'inkomsten' | 'uitgave'
export type Water = 'zee' | 'getij' | 'binnen'

export interface Settings extends SyncRecord {
  id: 'settings'
  lastBoat: string
  lastRole: Role
  lastCurrency: Currency
  lastSource: TransactionSource
  lastTripId?: string
  // Optionele velden (release 1): oudere data zonder deze velden blijft geldig; oudere apps laten ze staan.
  lastIncomeKind?: IncomeKind
  lastCostKind?: 'kosten' | 'investering'
  lastWater?: Water
  /** Jaardoel in nm voor de kaart op Vandaag; standaard 2.500. */
  yearGoalNm?: number
  /** De lopende week ("Nieuwe week starten" maakt een week actief; afronden maakt hem weer leeg). */
  activeWeekId?: string | null
  /** Boten (naam|model) die Olivier na een import bevestigd of overgeslagen heeft; die vraagt de app niet opnieuw. */
  boatsChecked?: string[]
  /** Herinnering in het agenda-bestand van een termijn: zoveel dagen vooraf (standaard 7). */
  reminderAlarmDays?: number
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
  /** De week (tocht) waar de student bij hoort. Ontbreekt bij oudere studenten: dan de week waarin startedAt valt. */
  weekId?: string
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
  /** Onderwerpen van het blok (bij thema's: alle onderwerpen van die thema's). */
  topicIds: string[]
  /** Thema's: onderdelen (groepen) van de cursus. Een planning met thema's toont die in plaats van losse onderwerpen. */
  themeIds?: string[]
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

/** Een plaats met een punt op de kaart (places.json.enc); dagen verwijzen er via de naam naar. */
export interface Place extends SyncRecord {
  name: string
  lat: number
  lon: number
  country?: string
}

/** Deadline (iets wat vóór een datum moet gebeuren) of vervaldatum (iets wat dan verloopt). */
export type ReminderKind = 'deadline' | 'vervalt'
export const REMINDER_KINDS: readonly ReminderKind[] = ['deadline', 'vervalt']

/** Terugkerende termijn: afronden zet de datum een maand of een jaar verder. */
export type ReminderRepeat = 'maandelijks' | 'jaarlijks'
export const REMINDER_REPEATS: readonly ReminderRepeat[] = ['maandelijks', 'jaarlijks']

/** Termijn: bijvoorbeeld "Vliegticket boeken" (deadline) of "Pinpas" (vervalt). */
export interface Reminder extends SyncRecord {
  title: string
  /** jjjj-mm-dd */
  date: string
  kind: ReminderKind
  /** jjjj-mm-dd waarop afgerond, of null. */
  doneAt: string | null
  note?: string
  repeat?: ReminderRepeat
}

/** Vaste checklist (safety briefing, check-in, check-out, paklijst); per trip af te vinken, als sjabloon te bewerken. */
export interface ChecklistItem {
  id: string
  text: LocalizedText
}

export interface Checklist extends SyncRecord {
  title: LocalizedText
  items: ChecklistItem[]
  /** Bij welke soorten trip de lijst in Deze trip staat; leeg of ontbrekend = bij elke trip. */
  tripTypes?: WeekType[]
  /** seed: meegeleverd (ook na bewerken); eigen: door Olivier gemaakt. */
  source: 'seed' | 'eigen'
}

/** Dagsoort in de agenda. optie = onder voorbehoud (gestreept). */
export type DayType = 'werk' | 'rust' | 'reis' | 'thuis' | 'beschikbaar' | 'optie'
export const DAY_TYPES: readonly DayType[] = ['werk', 'rust', 'reis', 'thuis', 'beschikbaar', 'optie']

export interface DayTravel {
  from: string
  to: string
  /** Vluchtnummer of korte omschrijving. */
  flight?: string
}

/**
 * Een dag die Olivier zelf heeft ingesteld (calendar.json.enc). Alle andere dagen worden afgeleid uit trips en dagen
 * (src/model/calendar.ts). id = `dag:<datum>`, zodat twee apparaten dezelfde dag samenvoegen (laatste updatedAt wint);
 * terug naar automatisch = tombstone.
 */
export interface CalendarDay extends SyncRecord {
  date: string
  type: DayType
  location?: string
  travel?: DayTravel
  /** Boot op deze dag, als die afwijkt van de boot van de trip. */
  boat?: string
  note?: string
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
  'places.json.enc': Place
  'reminders.json.enc': Reminder
  'checklists.json.enc': Checklist
  'calendar.json.enc': CalendarDay
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
  'places.json.enc',
  'reminders.json.enc',
  'checklists.json.enc',
  'calendar.json.enc',
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
