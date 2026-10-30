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

/**
 * Deelnemer van een trip (student of gast, regel 14): alleen voornaam, optioneel land en optioneel kort kenmerk
 * (initiaal of bijnaam, geen achternaam), met niveau en cursus voor studenten. Geen contactgegevens.
 */
export interface Participant {
  id: string
  firstName: string
  level?: StudentLevel
  curriculumId?: string
  /** Land zoals Olivier het schrijft ("VS", "Duitsland"). */
  country?: string
  /** Kort kenmerk om dubbele voornamen uit elkaar te houden: initiaal of bijnaam. */
  tag?: string
  /**
   * Terugkerende gast: zelfde id als de deelnemer van een eerdere trip (na "ja" op "Is dit dezelfde persoon?"). Gelijk
   * aan het eigen id na "nee", zodat de vraag niet terugkomt. Ontbreekt = nog niet gevraagd.
   */
  guestId?: string
}

/** Van wie een fooi komt. Ontbreekt = onbekend (ook bij oudere fooien). */
export type TipFrom =
  | { kind: 'onbekend' }
  | { kind: 'groep' }
  /** Eén of meer deelnemers van de trip; `amounts` per persoon, zonder = samen gegeven. */
  | { kind: 'personen'; participantIds: string[]; amounts?: Record<string, number> }

/** Salaris van een trip: verwacht of ontvangen. */
export type SalaryStatus = 'verwacht' | 'ontvangen'
/** standaard: het standaardbedrag van de organisatie (Instellingen); eigen: zelf ingevuld of aangepast. */
export type SalarySource = 'standaard' | 'eigen'

/**
 * Olivier wordt per trip betaald. Een eigen bedrag en een ontvangen salaris worden nooit automatisch overschreven
 * (src/model/salary.ts).
 */
export interface TripSalary {
  amount: number
  currency: Currency
  status: SalaryStatus
  source: SalarySource
  /** Het inkomen dat bij "ontvangen" is gemaakt. */
  transactionId?: string
  /** jjjj-mm-dd: na "Nog niet" vraagt Vandaag pas vanaf deze datum opnieuw. */
  askAfter?: string
}

/** Standaardbedrag per organisatie (Instellingen → Salaris per organisatie). */
export interface SalaryDefault {
  amount: number
  currency: Currency
}

/**
 * Hoe een organisatie uitbetaalt (Instellingen → Salaris per organisatie): na elke trip, of maandelijks rond dag N
 * voor de trips van de vorige maand. Ontbreekt = na elke trip.
 */
export type PayoutRule = { kind: 'per-trip' } | { kind: 'maandelijks'; day: number }

/** Hoe een fooi binnenkwam: contant (staat in Contant tot hij gestort is) of op de bank. Ontbreekt = onbekend. */
export type TipVia = 'contant' | 'bank'

/** Soort losse uitgave (alleen bij kosten): vervoer, eten en drinken, overig. Ontbreekt = overig. */
export type CostCategory = 'vervoer' | 'eten' | 'overig'
export const COST_CATEGORIES: readonly CostCategory[] = ['vervoer', 'eten', 'overig']

/** Status van een declaratie: open (nog niet ingediend), ingediend, terugbetaald. */
export type ClaimStatus = 'open' | 'ingediend' | 'terugbetaald'

/**
 * Een declaratie (claims.json.enc): een uitgave die de organisatie terugbetaalt. Het bonnetje staat versleuteld in de
 * kluis (een document in documents/index.json.enc met zijn bestand), deze declaratie verwijst ernaar.
 */
export interface Claim extends SyncRecord {
  /** jjjj-mm-dd: datum van de uitgave. */
  date: string
  tripId?: string
  note?: string
  amount?: number
  currency?: Currency
  /** Het bonnetje in de kluis. */
  documentId?: string
  status: ClaimStatus
  /** jjjj-mm-dd */
  submittedAt?: string
  /** Terugbetaald: datum, bedrag en het inkomen (soort terugbetaling) bij Geld. */
  repaid?: { date: string; amount: number; currency: Currency; transactionId?: string }
}

/** Dagsoort voor de kosten per dag (thuis, reis, werk, rust); de andere dagsoorten tellen als thuis. */
export type CostDayType = 'thuis' | 'reis' | 'werk' | 'rust'
export const COST_DAY_TYPES: readonly CostDayType[] = ['thuis', 'reis', 'werk', 'rust']

/**
 * Een vaste last (fixedcosts.json.enc): naam en valuta, met het bedrag per maand vanaf een maand. Een wijziging geldt
 * "vanaf maand …", zodat oude maanden blijven kloppen; 0 = gestopt.
 */
export interface FixedCost extends SyncRecord {
  name: string
  currency: Currency
  /** Oudste eerst; `from` is jjjj-mm. */
  amounts: { from: string; amount: number }[]
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
  /**
   * De datums volgen de dagen (aangemaakt via Toevoegen → Dag): begin en eind schuiven mee als er dagen bijkomen of
   * weggaan. Stelt Olivier de datums zelf in, dan vervalt dit (src/model/trip-dates.ts).
   */
  datesFromDays?: boolean
  /** Salaris voor deze trip (bedrag, valuta, verwacht of ontvangen, standaard of eigen). */
  salary?: TripSalary
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
  /** Alleen bij een fooi: van wie. */
  tipFrom?: TipFrom
  /** Alleen bij een fooi: contant of op de bank (ontbreekt = onbekend, ook bij oudere fooien). */
  tipVia?: TipVia
  /** Alleen bij een contante fooi: jjjj-mm-dd waarop hij gestort is (dan telt hij niet meer in Contant). */
  depositedAt?: string
  /** Alleen bij kosten: vervoer, eten en drinken of overig (ontbreekt = overig). */
  category?: CostCategory
  /** De declaratie waar deze uitgave of terugbetaling bij hoort (claims.json.enc). */
  claimId?: string
  /**
   * Eén uitbetaling van een organisatie voor meerdere trips ("SV betaalde € X op <datum>"): per trip een eigen
   * inkomen (naar verhouding van het verwachte salaris), met hetzelfde payoutId.
   */
  payoutId?: string
}

export type AddTab = 'trip' | 'dag' | 'inkomsten' | 'uitgave' | 'skill' | 'declaratie'
export type Water = 'zee' | 'getij' | 'binnen'

export interface Settings extends SyncRecord {
  /**
   * 'settings' = de instellingen; `laatst:<apparaat-id>` = wat dit apparaat het laatst koos bij invoer (boot, rol, valuta,
   * ...), een eigen record per apparaat (src/model/settings.ts), zodat loggen nooit een instelling van een ander apparaat
   * overschrijft.
   */
  id: 'settings' | `laatst:${string}`
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
  /** Teller per organisatie: het nummer van de eerste trip in de app (voor trips van vóór de app); standaard 1. */
  orgFirst?: Partial<Record<CountedOrganisation, number>>
  /** Trips met alleen een afkorting in de naam (YW, SV) waarvan Olivier zei dat ze niet bij die organisatie horen. */
  orgAnswered?: string[]
  /** Standaardsalaris per organisatie; vult alleen trips zonder salaris die nog niet voorbij zijn. */
  salaryDefaults?: Partial<Record<Organisation, SalaryDefault>>
  /** Dagelijkse herinnering in de eigen agenda (Instellingen → Herinnering): tijd (uu:mm) en alleen op werkdagen. */
  dailyReminder?: { time: string; workdaysOnly: boolean }
  /** Uitbetaling per organisatie (na elke trip of maandelijks rond dag N); ontbreekt = na elke trip. */
  payouts?: Partial<Record<Organisation, PayoutRule>>
  /** Laatst gekozen: fooi contant of op de bank. */
  lastTipVia?: TipVia
  /** Begin van de zeilcarrière (jjjj-mm-dd) voor "Sinds …" in Mijn positie; ontbreekt = 11 september 2026. */
  careerStart?: string
  /** Standaard variabele kosten per dag in euro per dagsoort, zolang de app nog te weinig eigen gegevens heeft. */
  costDefaults?: Partial<Record<CostDayType, number>>
  /** Laatst gekozen soort losse uitgave. */
  lastCostCategory?: CostCategory
}

/** Organisaties met een eigen volgnummer per trip ("SV #3", "YW #10"). */
export type CountedOrganisation = 'sailing-virgins' | 'yacht-week'
export const COUNTED_ORGANISATIONS: readonly CountedOrganisation[] = ['sailing-virgins', 'yacht-week']

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
/** onbeschikbaar: bezet (geen werk), met een optionele reden die alleen Olivier ziet. */
export type DayType = 'werk' | 'rust' | 'reis' | 'thuis' | 'onbeschikbaar' | 'beschikbaar' | 'optie'
export const DAY_TYPES: readonly DayType[] = ['werk', 'rust', 'reis', 'thuis', 'onbeschikbaar', 'beschikbaar', 'optie']

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
  /** Bij onbeschikbaar: de reden. Alleen voor Olivier; nooit in gedeelde overzichten of de PDF. */
  reason?: string
}

/**
 * Weekafsluiting (weekreviews.json.enc): cijfer en één zin over een week (maandag tot en met zondag). id =
 * `week:<jjjj>-W<ww>` (ISO-week), zodat twee apparaten dezelfde week samenvoegen. De samenvatting wordt niet opgeslagen
 * maar steeds uitgerekend uit de dagen, de agenda en de studenten (src/model/week-review.ts).
 */
export interface WeekClosing extends SyncRecord {
  /** ISO-week, bijv. "2026-W44". */
  week: string
  /** Maandag van de week (jjjj-mm-dd). */
  start: string
  /** 1–10. */
  rating?: number
  lesson?: string
  /** "Ongeveer los uitgegeven deze week?": telt als variabele kosten van die week. */
  spent?: { amount: number; currency: Currency }
}

/** Een doel dat zichzelf vult uit de gegevens van de app. */
export type GoalMetric = 'nm' | 'trips' | 'yachtmaster' | 'inkomsten'
export const GOAL_METRICS: readonly GoalMetric[] = ['nm', 'trips', 'yachtmaster', 'inkomsten']

/**
 * Doel (goals.json.enc, src/model/goals.ts). `auto`: vult zichzelf uit de app (nm, trips bij een organisatie,
 * Yachtmaster-voortgang, inkomsten) voor een kalenderjaar. `meting`: Olivier meet zelf (bijv. gewicht of keer sporten
 * per week); de metingen zijn losse sessies (sessions.json.enc) met `goalId`.
 */
export interface Goal extends SyncRecord {
  title: string
  kind: 'auto' | 'meting'
  /** Bij auto. */
  metric?: GoalMetric
  /** Bij trips: de organisatie. */
  organisation?: Organisation
  /** Kalenderjaar (auto). */
  year?: number
  target: number
  /** Bij meting: eenheid (vrije tekst, bijv. "kg") en of lager beter is (afvallen). */
  unit?: string
  lower?: boolean
  doneAt?: string | null
}

/** Een mijlpaal van een skill: afgevinkt met datum. */
export interface Milestone {
  id: string
  title: string
  doneAt: string | null
}

/**
 * Skill (skills.json.enc): iets dat Olivier oefent, met sessies (sessions.json.enc) en mijlpalen. `valueUnit` is wat een
 * sessie behalve minuten kan meten (bijv. "s" bij adem inhouden, "kreeften"); `best` zegt of de hoogste waarde telt
 * (adem inhouden) of de som (kreeften gevangen).
 */
export interface Skill extends SyncRecord {
  name: string
  valueUnit?: string
  best?: boolean
  milestones: Milestone[]
}

/**
 * Sessie (sessions.json.enc): één keer oefenen bij een skill (minuten en/of een waarde) of één meting bij een doel
 * (waarde). Losse records, zodat twee apparaten nooit elkaars sessies overschrijven.
 */
export interface Session extends SyncRecord {
  date: string
  skillId?: string
  goalId?: string
  minutes?: number
  value?: number
  note?: string
}

export type DocumentCategory = 'identiteit' | 'certificaten' | 'verzekering' | 'reis-visa' | 'werk-contracten' | 'financieel' | 'overig'
export const DOCUMENT_CATEGORIES: readonly DocumentCategory[] = ['certificaten', 'verzekering', 'reis-visa', 'werk-contracten', 'financieel', 'overig', 'identiteit']

/**
 * Document in de kluis (documents/index.json.enc, src/model/documents.ts). De echte naam staat alleen hier, in de
 * versleutelde index; het bestand zelf staat versleuteld in `documents/<fileId>.bin`, met een willekeurige UUID als
 * naam (regel 8). Een nieuw bestand voor hetzelfde document krijgt een nieuwe `fileId`.
 */
export interface VaultDocument extends SyncRecord {
  title: string
  category: DocumentCategory
  issuedAt?: string
  expiresAt?: string
  notes?: string
  mime: string
  size: number
  /** Ook zonder verbinding te openen: een versleutelde kopie blijft op het apparaat. */
  offline: boolean
  fileId: string
}

export type ApplicationStatus = 'idee' | 'gesolliciteerd' | 'gesprek' | 'aanbod' | 'aangenomen' | 'afgewezen' | 'ingetrokken'
export const APPLICATION_STATUSES: readonly ApplicationStatus[] = ['idee', 'gesolliciteerd', 'gesprek', 'aanbod', 'aangenomen', 'afgewezen', 'ingetrokken']
export type ProjectStatus = 'idee' | 'bezig' | 'gepauzeerd' | 'klaar'
export const PROJECT_STATUSES: readonly ProjectStatus[] = ['bezig', 'idee', 'gepauzeerd', 'klaar']

/** Sollicitatie: bedrijf, functie, status en de volgende actie met datum (die staat bij de termijnen). */
export interface Application extends SyncRecord {
  kind: 'sollicitatie'
  company: string
  role: string
  status: ApplicationStatus
  nextAction?: string
  nextDate?: string
  note?: string
}

/** Iemand uit het netwerk: alleen een voornaam, de rol en waar Olivier diegene ontmoette (geen contactgegevens). */
export interface Contact extends SyncRecord {
  kind: 'contact'
  firstName: string
  role?: string
  metAt?: string
}

/** Een ander project van Olivier, met de status en de volgende stap (zelf bijgehouden). */
export interface Project extends SyncRecord {
  kind: 'project'
  name: string
  status: ProjectStatus
  nextStep?: string
}

/** Carrière (career.json.enc, src/model/career.ts): sollicitaties, netwerk en projecten in één bestand. */
export type CareerRecord = Application | Contact | Project

/** Bij wie de rekening loopt: bepaalt alleen welk importformaat de app voorstelt. */
export type AccountProvider = 'asn' | 'revolut' | 'bux' | 'degiro' | 'duo' | 'overig'
export const ACCOUNT_PROVIDERS: readonly AccountProvider[] = ['asn', 'revolut', 'bux', 'degiro', 'duo', 'overig']
/** Soort rekening; een schuld (bijvoorbeeld de studieschuld) telt negatief mee in de netto waarde. */
export type AccountKind = 'betaal' | 'spaar' | 'beleggen' | 'schuld' | 'contant'
export const ACCOUNT_KINDS: readonly AccountKind[] = ['betaal', 'spaar', 'beleggen', 'schuld', 'contant']

/** Een rekening (accounts.json.enc, src/model/accounts.ts). Geen rekeningnummer, geen inloggegevens. */
export interface Account extends SyncRecord {
  name: string
  provider: AccountProvider
  kind: AccountKind
  currency: Currency
  /** jjjj-mm-dd: opgeheven; telt vanaf die dag niet meer mee. */
  closedAt?: string
  note?: string
}

/**
 * De stand van een rekening (balances.json.enc): één per rekening per maand, id `stand:<accountId>:<jjjj-mm>`, zodat
 * twee apparaten en een nieuwe import dezelfde maand samenvoegen. `date` is de dag waarop de stand gold; het bedrag
 * in de valuta van de rekening, negatief bij een schuld. Geen afzonderlijke mutaties, omschrijvingen of tegenrekeningen.
 */
export interface Balance extends SyncRecord {
  accountId: string
  date: string
  amount: number
  source: 'handmatig' | 'import'
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
  'weekreviews.json.enc': WeekClosing
  'goals.json.enc': Goal
  'skills.json.enc': Skill
  'sessions.json.enc': Session
  'documents/index.json.enc': VaultDocument
  'career.json.enc': CareerRecord
  'accounts.json.enc': Account
  'balances.json.enc': Balance
  'fixedcosts.json.enc': FixedCost
  'claims.json.enc': Claim
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
  'weekreviews.json.enc',
  'goals.json.enc',
  'skills.json.enc',
  'sessions.json.enc',
  'documents/index.json.enc',
  'career.json.enc',
  'accounts.json.enc',
  'balances.json.enc',
  'fixedcosts.json.enc',
  'claims.json.enc',
]

export function newId(): string {
  return crypto.randomUUID()
}

export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Eén milliseconde na een tijd: voor wat de app vanzelf vastlegt bij een bestaand record (een koers, archiveren). Zo wint
 * dat altijd van de vorige versie op dit apparaat, maar nooit van een echte wijziging die een ander apparaat intussen deed.
 */
export function justAfter(iso: string): string {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms + 1).toISOString() : new Date().toISOString()
}

/** Alleen het eerste woord van een ingetypte naam: een voornaam, nooit een achternaam (regel 14). */
export function firstNameOnly(text: string): string {
  return text.trim().split(/\s+/)[0] ?? ''
}

/** Datum van vandaag als jjjj-mm-dd in lokale tijd. */
export function todayIso(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
