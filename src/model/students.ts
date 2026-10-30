import type { Store } from '../storage/store'
import { allTopics } from './curricula'
import type { Undo } from './edit'
import { addDays, mondayOf } from './money'
import { firstNameOnly, justAfter, newId, type Curriculum, type Student, type StudentExam, type TipFrom, type StudentLevel, type Topic, type TopicStatus } from './types'

// Studenten en hun voortgang per onderwerp. Beveiligingsregel 14: alleen voornaam, cursus, niveau, voortgang en
// examenuitslag; geen contact-, gezondheids- of identiteitsgegevens; nooit in logs of foutdetails. Na 12 maanden
// zonder activiteit automatisch gearchiveerd; het archief is te wissen. Na wissen bevat het huidige bestand alleen
// id en tijden; oudere versies blijven versleuteld in de geschiedenis van logboek-data tot die opnieuw wordt aangemaakt.

export const ARCHIVE_AFTER_MONTHS = 12
export const MAX_FIRST_NAME = 40
export const MAX_NOTE = 500

const NEXT: Record<TopicStatus, TopicStatus> = { nieuw: 'geoefend', geoefend: 'beheerst', beheerst: 'nieuw' }
const RANK: Record<TopicStatus, number> = { nieuw: 0, geoefend: 1, beheerst: 2 }

export function statusOf(student: Student, topicId: string): TopicStatus {
  return student.progress[topicId]?.status ?? 'nieuw'
}

/** Eén tik = volgende status: nieuw → geoefend → beheerst → nieuw. */
export function nextStatus(status: TopicStatus): TopicStatus {
  return NEXT[status]
}

export function withStatus(student: Student, topicId: string, status: TopicStatus, now: string): Student {
  return { ...student, progress: { ...student.progress, [topicId]: { status, updatedAt: now } } }
}

/** Voor groepsafvinken: verhoogt naar minstens `status`, verlaagt nooit (wie al "beheerst" heeft, houdt dat). */
export function raiseStatus(student: Student, topicId: string, status: TopicStatus, now: string): Student {
  return RANK[statusOf(student, topicId)] >= RANK[status] ? student : withStatus(student, topicId, status, now)
}

export interface Progress {
  total: number
  practised: number
  mastered: number
  /** 0–1: beheerst telt volledig, geoefend half. */
  share: number
}

export function progressFor(student: Student, topics: readonly Topic[]): Progress {
  let practised = 0
  let mastered = 0
  for (const tp of topics) {
    const s = statusOf(student, tp.id)
    if (s === 'geoefend') practised++
    else if (s === 'beheerst') mastered++
  }
  const total = topics.length
  return { total, practised, mastered, share: total === 0 ? 0 : (mastered + practised / 2) / total }
}

/** Examenkritische onderwerpen die nog op "nieuw" staan: bovenaan in de checklist. */
export function criticalOpen(student: Student, curriculum: Curriculum): Topic[] {
  return allTopics(curriculum).filter((tp) => tp.examCritical && statusOf(student, tp.id) === 'nieuw')
}

export function isArchived(s: Student): boolean {
  return !!s.archivedAt
}

export function activeStudents(list: readonly Student[]): Student[] {
  return list.filter((s) => s.deletedAt === null && !isArchived(s))
}

export function archivedStudents(list: readonly Student[]): Student[] {
  return list.filter((s) => s.deletedAt === null && isArchived(s))
}

/** Laatste activiteit (jjjj-mm-dd): begin, examen, voortgang of een andere wijziging (ook terugzetten uit het archief). */
export function lastActivity(s: Student): string {
  const dates = [s.updatedAt.slice(0, 10), s.startedAt ?? '', s.exam?.date ?? '', ...Object.values(s.progress).map((p) => p.updatedAt.slice(0, 10))]
  return dates.filter(Boolean).sort().at(-1)!
}

/** Studenten die 12 maanden niets gedaan hebben: te archiveren op `today`. */
export function dueForArchive(list: readonly Student[], today: string): Student[] {
  const limit = monthsBefore(today, ARCHIVE_AFTER_MONTHS)
  return activeStudents(list).filter((s) => lastActivity(s) <= limit)
}

function monthsBefore(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1 - months, d!))
  return date.toISOString().slice(0, 10)
}

/** Week (maandag) waarin de student begon. */
export function weekOf(s: Student): string {
  return mondayOf(s.startedAt ?? s.updatedAt.slice(0, 10))
}

export function weekEnd(monday: string): string {
  return addDays(monday, 6)
}

// ---------- Opslaan ----------

export interface StudentInput {
  firstName: string
  curriculumId: string
  level: StudentLevel
  startedAt: string
  note?: string
  exam?: StudentExam
}

/** Alleen de toegestane velden, ingekort; nooit andere gegevens (regel 14). */
export function cleanInput(input: StudentInput): StudentInput {
  const out: StudentInput = {
    firstName: firstNameOnly(input.firstName).slice(0, MAX_FIRST_NAME),
    curriculumId: input.curriculumId,
    level: input.level,
    startedAt: input.startedAt,
  }
  const note = input.note?.trim().slice(0, MAX_NOTE)
  if (note) out.note = note
  if (input.exam) {
    const examNote = input.exam.note?.trim().slice(0, MAX_NOTE)
    out.exam = { date: input.exam.date, passed: input.exam.passed, ...(examNote ? { note: examNote } : {}) }
  }
  return out
}

export async function addStudent(store: Store, input: StudentInput, weekId?: string): Promise<Student> {
  const student: Student = {
    id: newId(),
    ...cleanInput(input),
    progress: {},
    archivedAt: null,
    ...(weekId ? { weekId } : {}),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  }
  await store.put('students.json.enc', student)
  void store.sync()
  return student
}

export async function updateStudent(store: Store, student: Student, input: StudentInput): Promise<void> {
  const { note: _n, exam: _e, ...rest } = student
  void [_n, _e]
  await store.put('students.json.enc', { ...rest, ...cleanInput(input), updatedAt: new Date().toISOString() })
  void store.sync()
}

export async function saveStudents(store: Store, students: readonly Student[]): Promise<void> {
  if (students.length === 0) return
  const now = new Date().toISOString()
  await store.putMany('students.json.enc', students.map((s) => ({ ...s, updatedAt: now })))
  void store.sync()
}

export async function setArchived(store: Store, students: readonly Student[], archivedAt: string | null): Promise<void> {
  await saveStudents(store, students.map((s) => ({ ...s, archivedAt })))
}

/**
 * Vanzelf archiveren (12 maanden zonder activiteit), net na de vorige versie van elke student: voortgang die een ander
 * apparaat intussen zonder verbinding vastlegde, wint altijd (dan was er activiteit en hoort hij niet in het archief).
 */
export async function autoArchive(store: Store, students: readonly Student[], today: string): Promise<void> {
  if (students.length === 0) return
  await store.putMany('students.json.enc', students.map((s) => ({ ...s, archivedAt: today, updatedAt: justAfter(s.updatedAt) })))
  void store.sync()
}

/** Tombstone zonder persoonsgegevens: alleen id en tijden blijven in het huidige bestand staan. */
export function scrubbed(student: Student, now: string): Student {
  return { id: student.id, firstName: '', curriculumId: '', level: 'beginner', progress: {}, archivedAt: null, updatedAt: now, deletedAt: now }
}

/**
 * Wist studenten (geschoonde tombstones), ook als deelnemer van hun trip (een student met cursus is een deelnemer met
 * hetzelfde id) en uit een fooi per persoon, zodat voornaam, land en kenmerk nergens blijven staan (regel 14). Ongedaan
 * maken zet alles uit het geheugen terug, alleen binnen de melding.
 */
export async function deleteStudents(store: Store, students: readonly Student[]): Promise<Undo> {
  const now = new Date().toISOString()
  const ids = new Set(students.map((s) => s.id))
  const originals = students.map((s) => ({ ...s }))
  const trips = store.list('trips.json.enc').filter((t) => t.participants?.some((p) => ids.has(p.id)))
  const tips = store.list('transactions.json.enc').filter((tx) => tx.tipFrom?.kind === 'personen' && tx.tipFrom.participantIds.some((id) => ids.has(id)))
  await store.putMany('students.json.enc', students.map((s) => scrubbed(s, now)))
  if (trips.length > 0) await store.putMany('trips.json.enc', trips.map((t) => ({ ...t, participants: (t.participants ?? []).filter((p) => !ids.has(p.id)), updatedAt: now })))
  if (tips.length > 0) await store.putMany('transactions.json.enc', tips.map((tx) => ({ ...tx, tipFrom: withoutPeople(tx.tipFrom!, ids), updatedAt: now })))
  void store.sync()
  return async () => {
    const later = new Date().toISOString()
    await store.putMany('students.json.enc', originals.map((s) => ({ ...s, updatedAt: later, deletedAt: null })))
    if (trips.length > 0) await store.putMany('trips.json.enc', trips.map((t) => ({ ...(store.list('trips.json.enc').find((x) => x.id === t.id) ?? t), participants: t.participants, updatedAt: later })))
    if (tips.length > 0) await store.putMany('transactions.json.enc', tips.map((tx) => ({ ...(store.list('transactions.json.enc').find((x) => x.id === tx.id) ?? tx), tipFrom: tx.tipFrom, updatedAt: later })))
    void store.sync()
  }
}

/** Een fooi per persoon zonder deze deelnemers; blijft er niemand over, dan is de gever onbekend. */
function withoutPeople(from: TipFrom, ids: ReadonlySet<string>): TipFrom {
  if (from.kind !== 'personen') return from
  const participantIds = from.participantIds.filter((id) => !ids.has(id))
  if (participantIds.length === 0) return { kind: 'onbekend' }
  const amounts = from.amounts ? Object.fromEntries(Object.entries(from.amounts).filter(([id]) => !ids.has(id))) : undefined
  return { kind: 'personen', participantIds, ...(amounts ? { amounts } : {}) }
}
