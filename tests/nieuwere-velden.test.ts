import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { setDay } from '../src/model/calendar'
import { updateDocument } from '../src/model/documents'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { inTx, put } from './helpers/schrijf'
import { declaratieBewerken } from '../src/domain/geld'

// Fundering: een record bewerken laat velden staan die deze versie niet kent (geschreven door een nieuwere versie op
// een ander apparaat). Alleen wat deze versie zelf beheert, wordt bijgewerkt of gewist. Verzonnen data.

const T0 = '2026-01-01T00:00:00.000Z'
let masterKey: CryptoKey

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

describe('onbekende velden van een nieuwere versie', () => {
  it('blijven staan bij een declaratie, een document en een agendadag bewerken; bekende velden worden gewoon gewist', async () => {
    const s = await Store.open(await openLogboekDb('logboek-nieuwere-velden'), masterKey, new GithubClient('github_pat_VELDEN_0123456789abcdefghijklmnopqrstuvwxy', new FakeGithub().fetch))
    await put(s, 'claims.json.enc', { id: 'c', date: '2026-10-20', status: 'open', amount: 10, currency: 'EUR', note: 'Nepnotitie', toekomstVeld: 'x', updatedAt: T0, deletedAt: null } as never)
    await put(s, 'documents/index.json.enc', { id: 'd', title: 'Nep', category: 'overig', mime: 'image/jpeg', size: 1, offline: false, fileId: '00000000-0000-4000-8000-000000000000', notes: 'Nepnotitie', toekomstVeld: 'x', updatedAt: T0, deletedAt: null } as never)
    await put(s, 'calendar.json.enc', { id: 'dag:2026-10-25', date: '2026-10-25', type: 'reis', note: 'Nepnotitie', toekomstVeld: 'x', updatedAt: T0, deletedAt: null } as never)
    await declaratieBewerken(s, s.list('claims.json.enc')[0]!, { date: '2026-10-20', tripId: null, note: '', amount: 12, currency: 'EUR' })
    await inTx(s, updateDocument, s.list('documents/index.json.enc')[0]!, { title: 'Nep 2', category: 'overig', issuedAt: '', expiresAt: '', notes: '', offline: false })
    await inTx(s, setDay, '2026-10-25', 'thuis', {})
    for (const record of [s.list('claims.json.enc')[0], s.list('documents/index.json.enc')[0], s.list('calendar.json.enc')[0]]) {
      expect(record).toMatchObject({ toekomstVeld: 'x' })
      // Wat deze versie kent en Olivier leegmaakte, is weg.
      expect(record).not.toHaveProperty('note')
      expect(record).not.toHaveProperty('notes')
    }
    expect(s.list('claims.json.enc')[0]).toMatchObject({ amount: 12 })
  })
})
