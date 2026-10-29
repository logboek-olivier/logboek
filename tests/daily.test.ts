import { describe, expect, it } from 'vitest'
import { DEFAULT_REMINDER_TIME, dailyIcs, isTime, LOG_DAY_URL } from '../src/model/daily'

// Dagelijkse herinnering als agenda-bestand: elke dag op een vaste, zwevende tijd (plaatselijke tijd), of alleen op de
// werkdagen; met een link naar Toevoegen → Dag; vaste UID's zodat opnieuw toevoegen bijwerkt.

const NOW = new Date('2026-10-29T12:00:00Z')
const base = { title: 'Logboek: log je dag', description: 'Open het logboek.', start: '2026-10-29' }
const unfold = (ics: string) => ics.replace(/\r\n /g, '')

describe('dagelijkse herinnering', () => {
  it('elke dag om 20:00 plaatselijke tijd, met link en melding op het moment zelf', () => {
    const ics = unfold(dailyIcs({ ...base, time: '20:00' }, NOW))
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(ics).toContain('UID:logboek-dagelijks@logboek')
    // Zwevend: geen Z en geen TZID, dus 20:00 waar Olivier ook is.
    expect(ics).toContain('DTSTART:20261029T200000\r\n')
    expect(ics).not.toMatch(/DTSTART[^\r]*Z\r/)
    expect(ics).not.toContain('TZID')
    expect(ics).toContain('RRULE:FREQ=DAILY')
    expect(ics).toContain(`URL:${LOG_DAY_URL}`)
    expect(ics).toContain('TRIGGER:PT0M')
    expect(ics).toContain('SUMMARY:Logboek: log je dag')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    // Regels van hoogstens 75 tekens (RFC 5545).
    for (const line of dailyIcs({ ...base, time: '20:00' }, NOW).split('\r\n')) expect(line.length).toBeLessThanOrEqual(75)
  })

  it('alleen op werkdagen: één item per werkdag vanaf vandaag, zonder herhaling', () => {
    const ics = unfold(dailyIcs({ ...base, time: '19:30', dates: ['2026-10-28', '2026-10-30', '2026-11-02'] }, NOW))
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).toContain('UID:logboek-dag-2026-10-30@logboek')
    expect(ics).toContain('DTSTART:20261102T193000')
    expect(ics).not.toContain('2026-10-28')
    expect(ics).not.toContain('RRULE')
  })

  it('tijd controleren; een ongeldige tijd wordt 20:00', () => {
    expect(isTime('07:05')).toBe(true)
    expect(isTime('24:00')).toBe(false)
    expect(isTime('7:5')).toBe(false)
    expect(DEFAULT_REMINDER_TIME).toBe('20:00')
    expect(unfold(dailyIcs({ ...base, time: 'nep' }, NOW))).toContain('DTSTART:20261029T200000')
  })

  it('tekst wordt geëscaped', () => {
    const ics = unfold(dailyIcs({ ...base, title: 'Log; je, dag', time: '20:00' }, NOW))
    expect(ics).toContain('SUMMARY:Log\\; je\\, dag')
  })
})
