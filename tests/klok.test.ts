import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { backfillRates, type RatesFile } from '../src/model/rates'
import type { Student, Transaction } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put, remove } from './helpers/schrijf'
import { geldBewerken } from '../src/domain/geld'
import { studentenArchiveren } from '../src/domain/training'

// Fundering: de laatste wijziging wint echt. Een bewerking of verwijdering gaat nooit stil verloren omdat een record een
// tijd in de toekomst heeft (een ander apparaat met een klok die voorloopt, of de eigen klok die terugsprong), en wat de
// app vanzelf vastlegt (koersen, archiveren) wint nooit van een echte wijziging op een ander apparaat. Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(github = new FakeGithub()): Promise<Store> {
  return Store.open(await openLogboekDb(`logboek-klok-${++counter}`), masterKey, new GithubClient('github_pat_KLOK_0123456789abcdefghijklmnopqrstuvwxyz', github.fetch))
}

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('klokverschil', () => {
  it('een record met een tijd in de toekomst is gewoon te bewerken en te verwijderen', async () => {
    const s = await store()
    const future = new Date(Date.now() + 2 * 3_600_000).toISOString()
    await put(s, 'trips.json.enc', { id: 't', name: 'Oud', updatedAt: future, deletedAt: null })
    await put(s, 'trips.json.enc', { ...s.list('trips.json.enc')[0]!, name: 'Nieuw', updatedAt: new Date().toISOString() })
    expect(s.list('trips.json.enc')[0]!.name).toBe('Nieuw')
    expect(s.list('trips.json.enc')[0]!.updatedAt > future).toBe(true)
    await remove(s, 'trips.json.enc', 't')
    expect(s.list('trips.json.enc')).toHaveLength(0)
  })
})

describe('vanzelf vastgelegd wint nooit van een echte wijziging', () => {
  const fresh: RatesFile = { format: 'logboek-rates', source: 'nep', dates: ['2026-10-01', '2026-10-20'], rates: { USD: [1.1, 1.08] } }

  it('de koers vastleggen op de laptop overschrijft geen offline correctie van de telefoon', async () => {
    const github = new FakeGithub()
    const phone = await store(github)
    const laptop = await store(github)
    const tx: Transaction = { id: 'tip', date: '2026-10-20', kind: 'fooi', amount: 100, currency: 'USD', source: 'yacht-week', updatedAt: T0, deletedAt: null }
    await put(phone, 'transactions.json.enc', tx)
    await phone.sync()
    await laptop.sync()
    await tick()
    // Telefoon zonder verbinding: bedrag verbeterd naar 150.
    github.offline = true
    const t = phone.list('transactions.json.enc')[0]!
    await geldBewerken(phone, t, { date: t.date, kind: t.kind, amount: 150, currency: 'USD', source: t.source })
    await phone.sync()
    github.offline = false
    await tick()
    // Laptop legt later vanzelf de koers vast (geen handeling van Olivier).
    await inTx(laptop, backfillRates, fresh)
    await laptop.sync()
    await phone.sync()
    await laptop.sync()
    expect(phone.list('transactions.json.enc')[0]!.amount).toBe(150)
    expect(laptop.list('transactions.json.enc')[0]!.amount).toBe(150)
  })

  it('vanzelf archiveren overschrijft geen offline voortgang van een ander apparaat', async () => {
    const github = new FakeGithub()
    const phone = await store(github)
    const laptop = await store(github)
    const student: Student = { id: 'st', firstName: 'Nepnina', curriculumId: 'seed-asa-101', level: 'beginner', progress: {}, startedAt: '2025-01-01', updatedAt: T0, deletedAt: null }
    await put(phone, 'students.json.enc', student)
    await phone.sync()
    await laptop.sync()
    await tick()
    github.offline = true
    const now = new Date().toISOString()
    await put(phone, 'students.json.enc', { ...phone.list('students.json.enc')[0]!, progress: { t1: { status: 'beheerst', updatedAt: now } }, updatedAt: now })
    await phone.sync()
    github.offline = false
    await tick()
    await studentenArchiveren(laptop, laptop.list('students.json.enc'), '2026-10-30')
    await laptop.sync()
    await phone.sync()
    await laptop.sync()
    expect(laptop.list('students.json.enc')[0]!.progress.t1?.status).toBe('beheerst')
  })
})
