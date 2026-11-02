import type { Settings, TransactionSource, Trip } from '../model/types'

// Organisaties: één plek die zegt welke organisaties er zijn en bij welke een trip hoort (de teller, de bron van geld,
// het jaaroverzicht en de statistieken gebruiken allemaal deze regels; docs/FUNDERING.md). Instelbaar onder
// Instellingen → Organisaties (`settings.organisations`). Een logboek van vóór deze versie heeft Sailing Virgins en
// Yacht Week (zoals altijd); een nieuw logboek begint leeg (`settings.startedEmpty`). "Eigen" en "Overig" bestaan altijd.

export interface OrgDef {
  /** Vast: 'sailing-virgins' en 'yacht-week' voor de bestaande, anders 'org:<uuid>'. */
  id: string
  name: string
  /** Afkorting voor de teller ("SV" → "SV #3"); leeg = geen teller. */
  short?: string
}

/** Wat een logboek van vóór de instelbare organisaties heeft (Olivier). */
export const LEGACY_ORGS: readonly OrgDef[] = [
  { id: 'sailing-virgins', name: 'Sailing Virgins', short: 'SV' },
  { id: 'yacht-week', name: 'Yacht Week', short: 'YW' },
]

/** Altijd te kiezen, los van de instellingen. */
export const BUILT_IN_ORGS = ['eigen', 'overig'] as const

let current: readonly OrgDef[] = LEGACY_ORGS

/** De organisaties van dit logboek uit de instellingen. */
export function organisationsFrom(settings: Pick<Settings, 'organisations' | 'startedEmpty'>): readonly OrgDef[] {
  if (Array.isArray(settings.organisations)) return settings.organisations.filter((o) => typeof o?.id === 'string' && typeof o.name === 'string')
  return settings.startedEmpty ? [] : LEGACY_ORGS
}

/** Na het laden of wijzigen van de instellingen (src/screens/Home.tsx); de demo en tests houden de bestaande. */
export function setOrganisations(list: readonly OrgDef[]): void {
  current = list
}

export function organisations(): readonly OrgDef[] {
  return current
}

/**
 * Te kiezen bij een trip: de eigen organisaties, dan eigen en overig, en daarna elke organisatie van `inUse` die niet
 * (meer) in de lijst staat (op een ander apparaat weggehaald, of een trip uit de prullenbak): die blijft te zien en te kiezen.
 */
export function organisationChoices(inUse: readonly { organisation?: string; deletedAt?: string | null }[] = []): string[] {
  const base: string[] = [...current.map((o) => o.id), ...BUILT_IN_ORGS]
  const extra = inUse.filter((x) => !x.deletedAt).map((x) => x.organisation).filter((o): o is string => !!o && !base.includes(o))
  return [...base, ...new Set(extra)]
}

/** Organisaties met een teller (een afkorting). */
export function countedOrganisations(): string[] {
  return current.filter((o) => !!o.short?.trim()).map((o) => o.id)
}

export function orgShort(id: string): string {
  return current.find((o) => o.id === id)?.short?.trim() ?? ''
}

/** De naam; null voor eigen en overig (die vertaalt het scherm) en voor een onbekende id. */
export function orgName(id: string): string | null {
  return current.find((o) => o.id === id)?.name ?? null
}

/** Tekst letterlijk in een reguliere expressie (een afkorting als "C++" of "(SV)"). */
export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * De volledige naam als patroon: spaties of een streepje ertussen, een s op het eind mag weg ("Sailing Virgins",
 * "sailing-virgin", "Yacht week"). Een eigen organisatie alleen als losse woorden ("Sun" telt niet in "Sunsail").
 */
function namePattern(name: string, bounded: boolean): RegExp | null {
  const words = name.trim().split(/\s+/).filter(Boolean).map(escapeRegExp)
  if (words.length === 0) return null
  const body = words.join('\\s*-?\\s*').replace(/s$/, 's?')
  return bounded ? new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu') : new RegExp(body, 'i')
}

/** De namen waaraan een organisatie te herkennen is; Sailing Virgins en Yacht Week ook onder hun oude naam (na hernoemen). */
function namePatterns(o: OrgDef): RegExp[] {
  const legacy = LEGACY_ORGS.find((l) => l.id === o.id)
  return [legacy && namePattern(legacy.name, false), namePattern(o.name, !legacy || o.name.trim().toLowerCase() !== legacy.name.toLowerCase())].filter((r): r is RegExp => !!r)
}

/** Organisatie uit de naam van een trip: de volledige naam is zeker, alleen een afkorting als los woord is twijfel. */
export function orgFromName(name: string): { org: string; sure: boolean } | null {
  for (const o of current) {
    if (namePatterns(o).some((r) => r.test(name))) return { org: o.id, sure: true }
  }
  for (const o of current) {
    const short = o.short?.trim()
    if (short && new RegExp(`(^|[^A-Za-z])${escapeRegExp(short)}([^A-Za-z]|$)`).test(name)) return { org: o.id, sure: false }
  }
  return null
}

export const isCounted = (org: string | undefined): org is string => !!org && countedOrganisations().includes(org)

/** De organisatie waarvoor een trip telt: opgeslagen, anders zeker uit de naam; een andere opgeslagen organisatie telt niet. */
export function tripOrganisation(trip: Trip): string | null {
  if (trip.organisation) return isCounted(trip.organisation) ? trip.organisation : null
  const guess = orgFromName(trip.name)
  return guess?.sure && isCounted(guess.org) ? guess.org : null
}

/**
 * De bron die oudere versies (en het jaaroverzicht als terugval) lezen: Sailing Virgins of Yacht Week als de trip daarbij
 * hoort (ook uit de naam, zoals de teller), delivery bij een delivery, anders overig. Nooit een eerder gekozen bron.
 */
/** De bron van geld bij een organisatie (een seizoen): oudere versies kennen alleen deze vier. */
export function sourceForOrganisation(org: string): TransactionSource {
  return org === 'sailing-virgins' || org === 'yacht-week' ? org : 'overig'
}

export function sourceForPeriod(trip: Trip | undefined): TransactionSource {
  const org = trip ? (trip.organisation ?? tripOrganisation(trip)) : null
  if (org === 'sailing-virgins' || org === 'yacht-week') return org
  if (trip?.type === 'delivery') return 'delivery'
  return 'overig'
}
