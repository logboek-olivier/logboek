import { describe, expect, it } from 'vitest'
import { dateAfter, dueItems, doneReminders, QUICK_OFFSETS } from '../src/model/reminders'
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
})
