import { describe, expect, it } from 'vitest'
import { alarmTrigger, buildIcs } from '../src/model/ics'
import { dateAfter, dueItems, doneReminders, nextOccurrence, QUICK_OFFSETS } from '../src/model/reminders'
import type { Reminder } from '../src/model/types'

// Termijnen: deadlines en vervaldatums samen. Alle gegevens zijn verzonnen.

const NOW = '2026-10-27T10:00:00.000Z'
const r = (id: string, title: string, date: string, extra: Partial<Reminder> = {}): Reminder => ({ id, title, date, kind: 'deadline', doneAt: null, updatedAt: NOW, deletedAt: null, ...extra })

describe('termijnen', () => {
  it('snelle keuzes: weken in dagen, maanden op dezelfde dag (of de laatste dag van de maand)', () => {
    const [week1, weeks3, month1, months3, year1] = QUICK_OFFSETS
    expect(dateAfter('2026-10-27', week1)).toBe('2026-11-03')
    expect(dateAfter('2026-10-27', weeks3)).toBe('2026-11-17')
    expect(dateAfter('2026-01-31', month1)).toBe('2026-02-28')
    expect(dateAfter('2026-11-30', months3)).toBe('2027-02-28')
    expect(dateAfter('2028-02-29', year1)).toBe('2029-02-28')
  })

  it('openstaande termijnen plus token en volgende trip, eerstvolgende eerst; afgeronde en verwijderde apart', () => {
    const list = [
      r('a', 'Nepticket boeken', '2026-11-17'),
      r('b', 'Neppas', '2027-10-27', { kind: 'vervalt' }),
      r('c', 'Al gedaan', '2026-11-01', { doneAt: '2026-10-20' }),
      r('d', 'Weg', '2026-10-30', { deletedAt: NOW }),
      r('e', 'Te laat', '2026-10-20'),
    ]
    const due = dueItems(list, [{ title: 'GitHub-token', date: '2027-01-01', kind: 'vervalt', source: 'token' }])
    expect(due.map((d) => d.title)).toEqual(['Te laat', 'Nepticket boeken', 'GitHub-token', 'Neppas'])
    expect(doneReminders(list).map((d) => d.id)).toEqual(['c'])
  })

  it('terugkerend: de volgende keer een maand of een jaar later (laatste dag van de maand als die korter is)', () => {
    expect(nextOccurrence({ date: '2026-01-31', repeat: 'maandelijks' })).toBe('2026-02-28')
    expect(nextOccurrence({ date: '2026-10-27', repeat: 'jaarlijks' })).toBe('2027-10-27')
  })

  it('agenda-bestand: hele dag, herinnering vooraf om 9:00, herhalen, tekst geëscaped en gevouwen', () => {
    const ics = buildIcs(
      { id: 'abc', title: 'Neppas; verlengen, nu', date: '2026-12-31', note: 'regel 1\nregel 2', repeat: 'jaarlijks', alarmDays: 7 },
      new Date('2026-10-27T10:00:00Z'),
    )
    const lines = ics.split('\r\n')
    expect(lines).toContain('BEGIN:VCALENDAR')
    expect(lines).toContain('UID:abc@logboek')
    expect(lines).toContain('DTSTAMP:20261027T100000Z')
    expect(lines).toContain('DTSTART;VALUE=DATE:20261231')
    expect(lines).toContain('DTEND;VALUE=DATE:20270101')
    expect(lines).toContain('SUMMARY:Neppas\\; verlengen\\, nu')
    expect(lines).toContain('DESCRIPTION:regel 1\\nregel 2')
    expect(lines).toContain('RRULE:FREQ=YEARLY')
    expect(lines).toContain('TRIGGER:-P6DT15H')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(alarmTrigger(0)).toBe('PT9H')
    expect(alarmTrigger(1)).toBe('-P0DT15H')
    const long = buildIcs({ id: 'x', title: 'N'.repeat(200), date: '2026-12-31', alarmDays: 7 })
    expect(long.split('\r\n').every((l) => l.length <= 75)).toBe(true)
    expect(buildIcs({ id: 'x', title: 'Nep', date: '2026-12-31', alarmDays: 7 })).not.toContain('RRULE')
  })
})
