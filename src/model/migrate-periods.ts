import type { Store } from '../storage/store'
import type { Change } from './changes'
import { applyChanges } from './changes'
import { active } from './derive'
import { addDays } from './money'
import { waterRanges } from './periods'
import { saveSettings, currentSettings } from './settings'
import { justAfter, type CalendarDay, type CollectionPath, type Leg, type StayKind, type StayPeriod, type Transaction, type Trip } from './types'

// Eenmalige omzetting naar het periodemodel (docs/PERIODEMODEL.md, hoofdstuk 2). Draait na de eerste geslaagde sync van
// deze versie, één keer per logboek (settings.periodsMigratedAt), alleen als alle betrokken bestanden leesbaar zijn.
// Vaste id's (periode:<soort>:<start>) en justAfter-tijden: twee apparaten maken hetzelfde, en een echte wijziging op
// een ander apparaat wint altijd. Niets wordt gewist: een tombstone houdt zijn inhoud.

export const MIGRATION_FILES: readonly CollectionPath[] = ['trips.json.enc', 'legs.json.enc', 'calendar.json.enc', 'transactions.json.enc', 'periods.json.enc', 'settings.json.enc']

/** Agendadagsoort → soort aan land; rust heet voortaan vrij. */
export const STAY_FROM_DAY: Partial<Record<CalendarDay['type'], StayKind>> = { thuis: 'thuis', reis: 'reis', rust: 'vrij' }

export function stayId(kind: StayKind, start: string): string {
  return `periode:${kind}:${start}`
}

/** Heeft een agendadag eigen gegevens (dan blijft hij staan als gegevens van die dag)? */
export function dayHasDetails(day: CalendarDay): boolean {
  return !!(day.note || day.location || day.travel?.from || day.travel?.to || day.travel?.flight || day.reason || day.boat)
}

export interface MigrationInput {
  trips: readonly Trip[]
  legs: readonly Leg[]
  calendar: readonly CalendarDay[]
  transactions: readonly Transaction[]
  stays: readonly StayPeriod[]
}

/** Alle wijzigingen van de omzetting, zonder iets te schrijven. */
export function migrationChanges(input: MigrationInput, now: string): Change[] {
  const ranges = waterRanges(input.trips, input.legs)
  // Bij een wisseldag (twee trips) de laatst begonnen, zoals in de agenda.
  const inWater = (d: string) => ranges.filter((r) => r.start <= d && d <= r.end).sort((a, b) => (a.start < b.start ? -1 : 1)).at(-1)?.id ?? null
  const existing = new Map(input.stays.map((s) => [s.id, s]))
  const liveStays = active(input.stays)
  const inStay = (d: string, list: readonly StayPeriod[]) => list.find((s) => s.startDate <= d && d <= s.endDate)?.id ?? null
  const changes: Change[] = []

  // 1. Agendadagen thuis, reis en rust buiten een trip → aaneengesloten periodes.
  const days = active(input.calendar)
    .filter((d) => STAY_FROM_DAY[d.type] && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && !inWater(d.date) && !inStay(d.date, liveStays))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  const runs: { kind: StayKind; days: CalendarDay[] }[] = []
  for (const day of days) {
    const kind = STAY_FROM_DAY[day.type]!
    const last = runs.at(-1)
    if (last && last.kind === kind && last.days.at(-1)!.date === addDays(day.date, -1)) last.days.push(day)
    else runs.push({ kind, days: [day] })
  }
  const created: StayPeriod[] = []
  for (const run of runs) {
    const start = run.days[0]!.date
    const id = stayId(run.kind, start)
    // Een ander apparaat zette deze periode al om (ook als die later verwijderd is): niet nog eens.
    if (existing.has(id)) continue
    const first = run.days[0]!.travel
    const last = run.days.at(-1)!.travel
    const flight = run.days.some((d) => d.travel?.flight)
    const from = first?.from?.trim()
    const to = last?.to?.trim()
    const travel = run.kind === 'reis' && (from || to || flight) ? { ...(from ? { from } : {}), ...(to ? { to } : {}), ...(flight ? { by: 'vliegtuig' as const } : {}) } : undefined
    const stay: StayPeriod = { id, kind: run.kind, startDate: start, endDate: run.days.at(-1)!.date, ...(travel ? { travel } : {}), updatedAt: now, deletedAt: null }
    created.push(stay)
    changes.push({ path: 'periods.json.enc', before: null, after: stay })
    // De dagsoort volgt voortaan uit de periode; een dag zonder eigen gegevens is dan niet meer nodig.
    for (const day of run.days) if (!dayHasDetails(day)) changes.push({ path: 'calendar.json.enc', before: day, after: { ...day, updatedAt: justAfter(day.updatedAt), deletedAt: justAfter(day.updatedAt) } })
  }

  // 2. Uitgaven zonder periode op een dag aan land → die periode. Op een tripdatum, en bij inkomsten, niets vanzelf:
  // een inkomen of uitgave aan een trip koppelen verandert zijn resultaat (en bij loon: salaris ontvangen). Dat staat in
  // Nakijken, met de trip als voorstel.
  const stays = [...liveStays, ...created]
  for (const tx of active(input.transactions)) {
    if (tx.tripId || tx.claimId || tx.payoutId) continue
    if (tx.kind !== 'kosten' && tx.kind !== 'investering') continue
    if (inWater(tx.date)) continue
    const id = inStay(tx.date, stays)
    if (!id) continue
    changes.push({ path: 'transactions.json.enc', before: tx, after: { ...tx, tripId: id, updatedAt: justAfter(tx.updatedAt) } })
  }
  return changes
}

/** Mag de omzetting nu draaien? Na een geslaagde sync, één keer, met alle betrokken bestanden leesbaar. */
export function migrationReady(store: Store): boolean {
  if (!store.hasSynced()) return false
  if (currentSettings(store.list('settings.json.enc')).periodsMigratedAt) return false
  const bad = new Set<CollectionPath>([...store.unreadableFiles().map((u) => u.path), ...store.setAside(), ...store.frozenPaths()])
  return !MIGRATION_FILES.some((p) => bad.has(p))
}

/** De omzetting uitvoeren (als dat nu mag). Geeft terug of er iets gedaan is. */
export async function migratePeriods(store: Store): Promise<boolean> {
  if (!migrationReady(store)) return false
  const now = new Date().toISOString()
  const changes = migrationChanges(
    {
      trips: store.list('trips.json.enc'),
      legs: store.list('legs.json.enc'),
      calendar: store.list('calendar.json.enc'),
      transactions: store.list('transactions.json.enc'),
      stays: store.get('periods.json.enc'),
    },
    now,
  )
  await applyChanges(store, changes, false)
  await saveSettings(store, { periodsMigratedAt: now })
  void store.sync()
  return true
}
