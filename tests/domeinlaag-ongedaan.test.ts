import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { geldToevoegen, standOpslaan, standWijzigen } from '../src/domain/geld'
import { termijnOpslaan } from '../src/domain/termijnen'
import { weekAfsluitenMetGeld } from '../src/domain/termijnen'
import { cursusVerwijderen } from '../src/domain/training'
import { effectiveCurricula } from '../src/model/curricula'
import { SEED_CURRICULA } from '../src/model/seed-curricula'
import type { Account, Balance } from '../src/model/types'
import { closingFor } from '../src/model/week-close'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { put } from './helpers/schrijf'

// Regressietests uit de review van de domeinlaag (PR 0): ongedaan maken, vergrendelen tijdens opdrachten, uitkomsten.

const TOKEN = 'github_pat_X0123456789abcdefghijklmnopqrstuvwxyz'
let counter = 0

async function open(name = `logboek-domein-${++counter}`) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const db = await openLogboekDb(name)
  const store = await Store.open(db, key, new GithubClient(TOKEN, new FakeGithub().fetch))
  return { store, db, key }
}

const account: Account = { id: 'acc', name: 'Nepbank', provider: 'overig', kind: 'betaal', currency: 'EUR', updatedAt: '2026-10-01T00:00:00.000Z', deletedAt: null }

describe('ongedaan maken', () => {
  it('een meegeleverde cursus die nooit bewerkt is: verwijderen en ongedaan maken maakt hem weer zichtbaar', async () => {
    const { store } = await open()
    const seed = SEED_CURRICULA.find((c) => c.id === 'seed-asa-101')!
    const undo = await cursusVerwijderen(store, seed)
    expect(effectiveCurricula(store.get('curricula.json.enc')).some((c) => c.id === 'seed-asa-101')).toBe(false)
    await undo()
    expect(effectiveCurricula(store.get('curricula.json.enc')).some((c) => c.id === 'seed-asa-101')).toBe(true)
  })

  it('weekafsluiting met geldstap: ongedaan maken zet alleen de geldstap terug, cijfer en zin blijven', async () => {
    const { store } = await open()
    await geldToevoegen(store, { date: '2026-10-20', kind: 'fooi', amount: 50, currency: 'EUR', source: 'overig', tipVia: 'contant' }, null)
    const { undo } = await weekAfsluitenMetGeld(store, '2026-10-25', { rating: 8, lesson: 'Nep zin' }, { balances: [], received: [], deposited: ['EUR'] }, '2026-10-25', null)
    expect(store.list('transactions.json.enc')[0]!.depositedAt).toBe('2026-10-25')
    await undo()
    expect(store.list('transactions.json.enc')[0]!.depositedAt).toBeUndefined()
    expect(closingFor(store.get('weekreviews.json.enc'), '2026-10-25')).toMatchObject({ rating: 8, lesson: 'Nep zin' })
  })

  it('een nieuw record dat daarna nog veranderde, blijft staan bij ongedaan maken (een latere wijziging wint)', async () => {
    const { store } = await open()
    const { result, undo } = await termijnOpslaan(store, { title: 'Nep termijn', date: '2026-12-01', kind: 'deadline', note: '' })
    await termijnOpslaan(store, { title: 'Nep termijn later', date: '2026-12-01', kind: 'deadline', note: '' }, result)
    await undo()
    expect(store.list('reminders.json.enc').map((r) => r.title)).toEqual(['Nep termijn later'])
  })
})

describe('uitkomsten en velden', () => {
  it('een stand vóór een nieuwere stand in dezelfde maand: niets geschreven, en de uitkomst zegt dat', async () => {
    const { store } = await open()
    await put(store, 'accounts.json.enc', account)
    expect((await standOpslaan(store, account, '2026-10-20', 100, '2026-10-31')).result).not.toBeNull()
    expect((await standOpslaan(store, account, '2026-10-03', 50, '2026-10-31')).result).toBeNull()
    expect(store.list('balances.json.enc')).toEqual([expect.objectContaining({ date: '2026-10-20', amount: 100 })])
  })

  it('een stand wijzigen houdt velden van een nieuwere versie', async () => {
    const { store } = await open()
    await put(store, 'accounts.json.enc', account)
    const balance = { id: 'stand:acc:2026-10', accountId: 'acc', date: '2026-10-20', amount: 100, source: 'import', toekomst: 'nep', updatedAt: '2026-10-21T00:00:00.000Z', deletedAt: null } as Balance
    await put(store, 'balances.json.enc', balance)
    await standWijzigen(store, account, balance, 120)
    expect(store.list('balances.json.enc')[0]).toMatchObject({ amount: 120, source: 'handmatig', toekomst: 'nep' })
  })
})

describe('vergrendelen tijdens opdrachten', () => {
  it('een opdracht die nog achter een andere wacht, wordt afgemaakt; het geheugen blijft leeg', async () => {
    const { store, db, key } = await open()
    const first = termijnOpslaan(store, { title: 'Nep een', date: '2026-12-01', kind: 'deadline', note: '' })
    const second = termijnOpslaan(store, { title: 'Nep twee', date: '2026-12-02', kind: 'deadline', note: '' })
    store.lock()
    await Promise.all([first, second])
    // Na vergrendelen: geen ontsleutelde records meer in het geheugen (regel 10).
    expect(() => store.get('reminders.json.enc')).toThrow()
    expect((store as unknown as { collections: Map<string, unknown> }).collections.size).toBe(0)
    // Na vergrendelen gaat er niets meer bij.
    await expect(termijnOpslaan(store, { title: 'Nep drie', date: '2026-12-03', kind: 'deadline', note: '' })).rejects.toThrow()
    const again = await Store.open(db, key, new GithubClient(TOKEN, new FakeGithub().fetch))
    expect(again.list('reminders.json.enc').map((r) => r.title).sort()).toEqual(['Nep een', 'Nep twee'])
  })
})
