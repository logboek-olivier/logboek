import { escapeIcs, foldIcs, icsStamp } from './ics'

// Dagelijkse herinnering (Instellingen → Herinnering): een agenda-bestand (.ics) met "Logboek: log je dag" op een vaste
// tijd (standaard 20:00), met een link die de app direct op Toevoegen → Dag opent. Elke dag (één terugkerend item) of
// alleen op de werkdagen uit de agenda, van vandaag tot het einde van de planning (één item per werkdag). De tijd is
// zwevend (geen tijdzone), zodat 20:00 overal 20:00 plaatselijke tijd is, ook als Olivier van de BVI naar Kroatië gaat.
// Vaste UID's: opnieuw toevoegen werkt het item bij in plaats van het te verdubbelen. De app verstuurt niets.

export const DEFAULT_REMINDER_TIME = '20:00'
/** De app op Toevoegen → Dag (snelkoppeling uit het manifest). */
/** De link naar Toevoegen → Dag van deze app (de site waarop hij draait); buiten de browser die van Olivier. */
export const LOG_DAY_URL = typeof location !== 'undefined' && location.origin.startsWith('http') ? `${location.origin}${import.meta.env.BASE_URL}?toevoegen=dag` : 'https://logboek-olivier.github.io/logboek/?toevoegen=dag'

export interface DailyIcsInput {
  title: string
  description: string
  /** uu:mm */
  time: string
  /** jjjj-mm-dd: de eerste dag */
  start: string
  /** Alleen deze dagen (werkdagen); zonder: elke dag. */
  dates?: readonly string[]
}

export function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function event(uid: string, date: string, time: string, input: DailyIcsInput, stamp: string, daily: boolean): string[] {
  const start = `${date.replace(/-/g, '')}T${time.replace(':', '')}00`
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@logboek`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    'DURATION:PT10M',
    ...(daily ? ['RRULE:FREQ=DAILY'] : []),
    `SUMMARY:${escapeIcs(input.title)}`,
    `DESCRIPTION:${escapeIcs(`${input.description}\n${LOG_DAY_URL}`)}`,
    `URL:${LOG_DAY_URL}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcs(input.title)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
  ]
}

export function dailyIcs(input: DailyIcsInput, now: Date = new Date()): string {
  const time = isTime(input.time) ? input.time : DEFAULT_REMINDER_TIME
  const stamp = icsStamp(now)
  const events = input.dates
    ? input.dates.filter((d) => d >= input.start).flatMap((d) => event(`logboek-dag-${d}`, d, time, input, stamp, false))
    : event('logboek-dagelijks', input.start, time, input, stamp, true)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Logboek//Herinnering//NL', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR']
  return lines.map(foldIcs).join('\r\n') + '\r\n'
}
