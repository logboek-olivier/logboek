import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { deleteStudents, setArchived } from '../src/model/students'
import type { Transaction, Trip } from '../src/model/types'
import { cleanParticipants, syncParticipants } from '../src/model/weeks'
import { cleanInput } from '../src/model/students'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

// Fundering: persoonsgegevens van studenten en gasten (regel 14). Alleen een voornaam, en "Archief wissen" wist een
// student ook als deelnemer van zijn trip (met de verwijzing in een fooi per persoon). Verzonnen data.

let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(): Promise<Store> {
  return Store.open(await openLogboekDb(`logboek-privacy-${++counter}`), masterKey, new GithubClient('github_pat_PRIVACY_0123456789abcdefghijklmnopqrstuvw', new FakeGithub().fetch))
}

describe('alleen een voornaam', () => {
  it('een ingetypte achternaam wordt niet bewaard, bij deelnemers en studenten', () => {
    expect(cleanParticipants([{ firstName: '  Nepnick Nepbakker ' }])[0]!.firstName).toBe('Nepnick')
    expect(cleanInput({ firstName: 'Nepanna de Nepvries', curriculumId: 'c', level: 'beginner', startedAt: '2026-10-01' }).firstName).toBe('Nepanna')
  })
})

describe('archief wissen', () => {
  it('wist de student ook als deelnemer van zijn trip, en haalt hem uit een fooi per persoon', async () => {
    const s = await store()
    const now = new Date().toISOString()
    const trip: Trip = {
      id: 'trip-1',
      name: 'Nepweek',
      startDate: '2025-01-01',
      endDate: '2025-01-07',
      participants: [
        { id: 'p-1', firstName: 'Nepnick', country: 'VS', tag: 'B', curriculumId: 'seed-asa-101', level: 'beginner' },
        { id: 'p-2', firstName: 'Nepsara' },
      ],
      updatedAt: now,
      deletedAt: null,
    }
    await s.put('trips.json.enc', trip)
    await syncParticipants(s, trip)
    const tip: Transaction = { id: 'tip', date: '2025-01-05', kind: 'fooi', amount: 50, currency: 'EUR', amountEur: 50, source: 'overig', tripId: 'trip-1', tipFrom: { kind: 'personen', participantIds: ['p-1', 'p-2'], amounts: { 'p-1': 30, 'p-2': 20 } }, updatedAt: now, deletedAt: null }
    await s.put('transactions.json.enc', tip)
    const student = s.list('students.json.enc').find((x) => x.id === 'p-1')!
    await setArchived(s, [student], '2026-02-01')
    const undo = await deleteStudents(s, [s.list('students.json.enc').find((x) => x.id === 'p-1')!])
    const after = s.list('trips.json.enc')[0]!
    expect(after.participants?.map((p) => p.id)).toEqual(['p-2'])
    expect(JSON.stringify(after)).not.toContain('Nepnick')
    expect(s.list('transactions.json.enc')[0]!.tipFrom).toEqual({ kind: 'personen', participantIds: ['p-2'], amounts: { 'p-2': 20 } })
    // Ongedaan maken (alleen binnen de melding) zet alles terug.
    await undo()
    expect(s.list('trips.json.enc')[0]!.participants?.map((p) => p.firstName)).toEqual(['Nepnick', 'Nepsara'])
    expect(s.list('transactions.json.enc')[0]!.tipFrom).toMatchObject({ participantIds: ['p-1', 'p-2'] })
  })
})
