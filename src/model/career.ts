import type { Tx } from '../domain/tx'
import type { DueItem } from './reminders'
import { newId, type Application, type ApplicationStatus, type CareerRecord, type Contact, type Project, type ProjectStatus } from './types'

// Carrière (Meer → Carrière): sollicitaties (bedrijf, functie, status, volgende actie met datum), het netwerk (alleen een
// voornaam, de rol en waar Olivier diegene ontmoette; geen achternaam of contactgegevens) en de status van andere
// projecten. Alles in career.json.enc. De volgende actie van een lopende sollicitatie staat bij de termijnen.

const text = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max)
const date = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined)

/** Een sollicitatie loopt nog (de volgende actie telt als termijn). */
export function isOpen(status: ApplicationStatus): boolean {
  return status !== 'aangenomen' && status !== 'afgewezen' && status !== 'ingetrokken'
}

export interface ApplicationInput {
  company: string
  role: string
  status: ApplicationStatus
  nextAction: string
  nextDate: string
  note: string
}

export function cleanApplication(input: ApplicationInput): Omit<Application, 'id' | 'updatedAt' | 'deletedAt'> {
  const nextAction = text(input.nextAction, 120)
  const nextDate = date(input.nextDate)
  const note = input.note.trim().slice(0, 2000)
  return {
    kind: 'sollicitatie',
    company: text(input.company, 80),
    role: text(input.role, 80),
    status: input.status,
    ...(nextAction ? { nextAction } : {}),
    ...(nextDate ? { nextDate } : {}),
    ...(note ? { note } : {}),
  }
}

export interface ContactInput {
  firstName: string
  role: string
  metAt: string
}

/** Alleen het eerste woord van de naam: een voornaam, nooit een achternaam (zoals bij deelnemers, regel 14). */
export function cleanContact(input: ContactInput): Omit<Contact, 'id' | 'updatedAt' | 'deletedAt'> {
  const firstName = text(input.firstName, 40).split(' ')[0] ?? ''
  const role = text(input.role, 80)
  const metAt = text(input.metAt, 120)
  return { kind: 'contact', firstName, ...(role ? { role } : {}), ...(metAt ? { metAt } : {}) }
}

export interface ProjectInput {
  name: string
  status: ProjectStatus
  nextStep: string
}

export function cleanProject(input: ProjectInput): Omit<Project, 'id' | 'updatedAt' | 'deletedAt'> {
  const nextStep = text(input.nextStep, 160)
  return { kind: 'project', name: text(input.name, 80), status: input.status, ...(nextStep ? { nextStep } : {}) }
}

export async function saveCareer(store: Tx, id: string | null, fields: Omit<Application, 'id' | 'updatedAt' | 'deletedAt'> | Omit<Contact, 'id' | 'updatedAt' | 'deletedAt'> | Omit<Project, 'id' | 'updatedAt' | 'deletedAt'>): Promise<CareerRecord> {
  const record = { ...fields, id: id ?? newId(), updatedAt: new Date().toISOString(), deletedAt: null } as CareerRecord
  await store.put('career.json.enc', record)
  return record
}

export function applications(records: readonly CareerRecord[]): Application[] {
  return records.filter((r): r is Application => r.kind === 'sollicitatie' && r.deletedAt === null)
}

export function contacts(records: readonly CareerRecord[]): Contact[] {
  return records.filter((r): r is Contact => r.kind === 'contact' && r.deletedAt === null).sort((a, b) => a.firstName.localeCompare(b.firstName))
}

export function projects(records: readonly CareerRecord[]): Project[] {
  return records.filter((r): r is Project => r.kind === 'project' && r.deletedAt === null)
}

/**
 * Tombstone zonder inhoud (zoals bij studenten): alleen id, soort en tijden. Bedrijf, naam, rol en notities staan daarna
 * niet meer in het bestand of in een back-up; oudere versies blijven versleuteld in de geschiedenis van logboek-data.
 */
export function scrubbedCareer(record: CareerRecord, now: string): CareerRecord {
  const times = { id: record.id, updatedAt: now, deletedAt: now }
  if (record.kind === 'sollicitatie') return { ...times, kind: 'sollicitatie', company: '', role: '', status: 'idee' }
  if (record.kind === 'contact') return { ...times, kind: 'contact', firstName: '' }
  return { ...times, kind: 'project', name: '', status: 'idee' }
}

/** De volgende acties van lopende sollicitaties, als termijnen ("Bedrijf: actie"). */
export function careerDueItems(records: readonly CareerRecord[]): DueItem[] {
  return applications(records)
    .filter((a) => isOpen(a.status) && a.nextDate)
    .map((a) => ({ id: a.id, title: [a.company, a.nextAction].filter(Boolean).join(': '), date: a.nextDate!, kind: 'deadline', source: 'career' }))
}

/** Lopende sollicitaties eerst (op de datum van de volgende actie), daarna de afgeronde. */
export function sortApplications(list: readonly Application[]): Application[] {
  return [...list].sort((a, b) => Number(isOpen(b.status)) - Number(isOpen(a.status)) || (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999') || a.company.localeCompare(b.company))
}
