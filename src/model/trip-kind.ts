import { WORK_TYPES, type Leg, type Trip, type WaterKind, type WeekType } from './types'

// Soort van een trip (werk, training of plezier) en het subtype bij werk. Opgeslagen bij trips die na het periodemodel
// bewaard zijn (`kind`); oudere en geïmporteerde trips krijgen een afgeleide soort zonder iets op te slaan: type,
// organisatie, rollen in de dagen en de naam. Is dat niet zeker, dan komt de trip in Nakijken (src/model/review.ts).

export interface KindGuess {
  kind: WaterKind
  /** Het type dat bij deze soort hoort (bij werk het subtype). */
  type: WeekType
  /** Zeker (opgeslagen of een duidelijk signaal); anders een voorstel voor Nakijken. */
  sure: boolean
}

/** Het type dat oudere versies lezen bij een soort (training = zelf trainen, plezier = zelf cruisen). */
export function typeForKind(kind: WaterKind, sub?: WeekType): WeekType {
  if (kind === 'training') return 'zelf-trainen'
  if (kind === 'plezier') return 'zelf-cruisen'
  return sub && WORK_TYPES.includes(sub) ? sub : 'overig'
}

export function kindForType(type: WeekType): WaterKind {
  if (type === 'zelf-trainen') return 'training'
  if (type === 'zelf-cruisen') return 'plezier'
  return 'werk'
}

const TRAINING_NAME = /\b(RYA|ASA|CWO|ISSA|STCW|VHF|SRC|exam|examen|course|cursus|opleiding|training|prep|theory|theorie)\b/i
const PLEASURE_NAME = /\b(vrienden|friends|vakantie|holiday|familie|family)\b/i
const WORK_NAME = /yacht\s*week|sailing\s*virgins|\b(SV|YW)\b|skipper|delivery|overvaart|charter/i

function subFromName(name: string): WeekType {
  if (/yacht\s*week|charter|skipper/i.test(name)) return 'skipper-charter'
  if (/delivery|overvaart/i.test(name)) return 'delivery'
  return 'overig'
}

export function tripKind(trip: Trip, legs: readonly Leg[]): KindGuess {
  const type = trip.type
  // Opgeslagen soort; spreekt het type hem tegen (een oudere versie wijzigde alleen het type), dan geldt het type.
  if (trip.kind && (!type || kindForType(type) === trip.kind)) return { kind: trip.kind, type: type ?? typeForKind(trip.kind), sure: true }
  if (type && type !== 'overig') return { kind: kindForType(type), type, sure: true }
  const roles = new Set(legs.filter((l) => l.tripId === trip.id && l.deletedAt === null).map((l) => l.role))
  const name = trip.name ?? ''
  if (trip.organisation === 'sailing-virgins' || trip.organisation === 'yacht-week') {
    const sub = roles.has('instructeur') ? 'training-geven' : subFromName(name) === 'overig' && trip.organisation === 'yacht-week' ? 'skipper-charter' : subFromName(name)
    return { kind: 'werk', type: sub, sure: true }
  }
  if (roles.size > 0 && [...roles].every((r) => r === 'instructeur')) return { kind: 'werk', type: 'training-geven', sure: true }
  if (roles.size > 0 && [...roles].every((r) => r === 'trainee')) return { kind: 'training', type: 'zelf-trainen', sure: true }
  if (TRAINING_NAME.test(name)) return { kind: 'training', type: 'zelf-trainen', sure: true }
  if (WORK_NAME.test(name)) return { kind: 'werk', type: subFromName(name), sure: true }
  if (PLEASURE_NAME.test(name)) return { kind: 'plezier', type: 'zelf-cruisen', sure: true }
  // Geen duidelijk signaal: een voorstel uit de rollen (bemanningslid = plezier, anders werk).
  if (roles.has('instructeur')) return { kind: 'werk', type: 'training-geven', sure: false }
  if (roles.has('trainee')) return { kind: 'training', type: 'zelf-trainen', sure: false }
  if (roles.size > 0 && [...roles].every((r) => r === 'bemanningslid')) return { kind: 'plezier', type: 'zelf-cruisen', sure: false }
  return { kind: 'werk', type: 'overig', sure: false }
}
