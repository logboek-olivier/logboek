import type { ReminderRepeat } from './types'

// Agenda-bestand (.ics, RFC 5545) voor een termijn, lokaal gemaakt: een hele dag op de datum met een herinnering
// vooraf (standaard een week, om 9:00) en eventueel maandelijks of jaarlijks herhalen. De app verstuurt niets; Olivier
// opent het bestand met zijn agenda-app via delen of downloaden.

export const ALARM_CHOICES = [0, 1, 3, 7, 14, 30] as const
export const DEFAULT_ALARM_DAYS = 7

export interface IcsInput {
  id: string
  title: string
  /** jjjj-mm-dd */
  date: string
  note?: string
  repeat?: ReminderRepeat
  /** Herinnering zoveel dagen vooraf om 9:00 (0 = op de dag zelf). */
  alarmDays: number
}

/** Tekst volgens RFC 5545: backslash, puntkomma, komma en regeleinden geëscaped. */
function escape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Regels langer dan 75 tekens worden gevouwen (vervolgregel begint met een spatie). */
function fold(line: string): string {
  const parts: string[] = []
  let rest = line
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74))
    rest = rest.slice(74)
  }
  parts.push(rest)
  return parts.join('\r\n ')
}

const compact = (date: string) => date.replace(/-/g, '')

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** De herinnering ten opzichte van middernacht aan het begin van de dag: n dagen vooraf om 9:00. */
export function alarmTrigger(days: number): string {
  return days <= 0 ? 'PT9H' : `-P${days - 1}DT15H`
}

export function buildIcs(input: IcsInput, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Logboek//Termijnen//NL',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${input.id}@logboek`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(input.date)}`,
    `DTEND;VALUE=DATE:${compact(nextDay(input.date))}`,
    `SUMMARY:${escape(input.title)}`,
    ...(input.note ? [`DESCRIPTION:${escape(input.note)}`] : []),
    ...(input.repeat === 'maandelijks' ? ['RRULE:FREQ=MONTHLY'] : input.repeat === 'jaarlijks' ? ['RRULE:FREQ=YEARLY'] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(input.title)}`,
    `TRIGGER:${alarmTrigger(input.alarmDays)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}
