import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, it } from 'vitest'
import { currentSettings } from '../src/model/settings'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'
import { instellingenOpslaan } from '../src/domain/instellingen'

// Fundering: "laatst gebruikt" (boot, rol, valuta, bron, ...) per apparaat, in een eigen record naast de instellingen.
// Een dag of uitgave loggen op een telefoon zonder verbinding overschrijft dan nooit een instelling die intussen op de
// laptop veranderde (standaardsalaris, uitbetaling, jaardoel). Verzonnen data.

let masterKey: CryptoKey
let counter = 0

beforeAll(async () => {
  masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

async function store(github: FakeGithub): Promise<Store> {
  return Store.open(await openLogboekDb(`logboek-instellingen-${++counter}`), masterKey, new GithubClient('github_pat_INSTEL_0123456789abcdefghijklmnopqrstuvwxy', github.fetch))
}

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('laatst gebruikt per apparaat', () => {
  it('loggen op een telefoon zonder verbinding laat een instelling van de laptop staan', async () => {
    const github = new FakeGithub()
    const laptop = await store(github)
    const phone = await store(github)
    await instellingenOpslaan(laptop, { yearGoalNm: 3000 })
    await laptop.sync()
    await phone.sync()
    await tick()
    // Laptop: standaardsalaris instellen, gesynct.
    await instellingenOpslaan(laptop, { salaryDefaults: { 'sailing-virgins': { amount: 1200, currency: 'EUR' } } })
    await laptop.sync()
    await tick()
    // Telefoon (nog zonder die wijziging): een dag loggen onthoudt boot en rol.
    await instellingenOpslaan(phone, { lastBoat: 'Nepboot', lastRole: 'instructeur' })
    await phone.sync()
    await laptop.sync()
    for (const s of [laptop, phone]) {
      const settings = currentSettings(s.list('settings.json.enc'))
      expect(settings.salaryDefaults?.['sailing-virgins']?.amount).toBe(1200)
      expect(settings.yearGoalNm).toBe(3000)
    }
    expect(currentSettings(phone.list('settings.json.enc'))).toMatchObject({ lastBoat: 'Nepboot', lastRole: 'instructeur' })
  })
})
