import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error: Node-script zonder typen
import { parseEcb, XCD_PER_USD } from '../scripts/build-rates.mjs'
import { totals } from '../src/model/money'
import { backfillRates, eurValue, finalRateFields, isRatesFile, loadRates, rateFor, setRates, type RatesFile } from '../src/model/rates'
import type { Transaction } from '../src/model/types'
import { GithubClient } from '../src/storage/github'
import { openLogboekDb } from '../src/storage/idb'
import { Store } from '../src/storage/store'
import { FakeGithub } from './helpers/fake-github'

const NOW = '2026-10-26T10:00:00.000Z'

/** Verzonnen ECB-XML in het echte formaat: nieuwste dag eerst, HRK alleen op de oudste dag. */
const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time="2026-10-23">
      <Cube currency="USD" rate="1.0800"/>
      <Cube currency="GBP" rate="0.8400"/>
      <Cube currency="CHF" rate="0.9400"/>
    </Cube>
    <Cube time="2026-10-22">
      <Cube currency="USD" rate="1.0700"/>
      <Cube currency="GBP" rate="0.8500"/>
    </Cube>
    <Cube time="2022-12-30">
      <Cube currency="USD" rate="1.0666"/>
      <Cube currency="HRK" rate="7.5365"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`

const file: RatesFile = {
  format: 'logboek-rates',
  source: 'nep',
  dates: ['2026-10-21', '2026-10-22', '2026-10-23'],
  rates: { USD: [1.06, 1.07, 1.08], GBP: [0.85, null, 0.84] },
}

function tx(patch: Partial<Transaction>): Transaction {
  return { id: 'x', date: '2026-10-22', kind: 'fooi', amount: 107, currency: 'USD', source: 'yacht-week', updatedAt: NOW, deletedAt: null, ...patch }
}

afterEach(() => setRates(null))

describe('koersbestand bouwen (deploy.yml)', () => {
  it('leest de ECB-XML: datums oplopend, ontbrekende koersen null, XCD via 2,70 per USD', () => {
    const out = parseEcb(ECB_XML)
    expect(out.format).toBe('logboek-rates')
    expect(out.dates).toEqual(['2022-12-30', '2026-10-22', '2026-10-23'])
    expect(out.rates.USD).toEqual([1.0666, 1.07, 1.08])
    expect(out.rates.HRK).toEqual([7.5365, null, null])
    expect(out.rates.CHF).toEqual([null, null, 0.94])
    expect(out.rates.XCD).toEqual([2.8798, 2.889, 2.916])
    expect(XCD_PER_USD).toBe(2.7)
    expect(isRatesFile(out)).toBe(true)
    expect(() => parseEcb('<html>geen koersen</html>')).toThrow()
  })
})

describe('koers van een datum', () => {
  it('de datum zelf, anders de laatste werkdag daarvoor; na het bestand de laatste koers, voorlopig', () => {
    expect(rateFor(file, 'USD', '2026-10-22')).toEqual({ rate: 1.07, date: '2026-10-22', provisional: false })
    // Een ontbrekende koers (GBP op 22 oktober) valt terug op de dag ervoor.
    expect(rateFor(file, 'GBP', '2026-10-22')).toEqual({ rate: 0.85, date: '2026-10-21', provisional: false })
    expect(rateFor(file, 'USD', '2026-10-25')).toEqual({ rate: 1.08, date: '2026-10-23', provisional: true })
    expect(rateFor(file, 'USD', '2026-10-01')).toBeNull()
    expect(rateFor(file, 'SEK', '2026-10-22')).toBeNull()
    expect(rateFor(null, 'USD', '2026-10-22')).toBeNull()
  })

  it('volgorde: ontvangen eurobedrag, opgeslagen koers, koersbestand; voorlopige koersen worden nooit opgeslagen', () => {
    expect(eurValue(tx({}), file)).toMatchObject({ eur: 100, basis: 'rate', provisional: false, rate: 1.07 })
    expect(eurValue(tx({ amountEur: 99, rate: 1.0808 }), file)).toMatchObject({ eur: 99, basis: 'stored' })
    expect(eurValue(tx({ amountEur: 99, receivedEur: 97.5 }), file)).toMatchObject({ eur: 97.5, basis: 'received' })
    expect(eurValue(tx({ currency: 'EUR', amount: 12 }), file)).toMatchObject({ eur: 12, basis: 'eur' })
    expect(eurValue(tx({ date: '2026-10-25', amount: 108 }), file)).toMatchObject({ eur: 100, provisional: true })
    expect(finalRateFields(tx({}), file)).toEqual({ rate: 1.07, rateDate: '2026-10-22', amountEur: 100 })
    expect(finalRateFields(tx({ date: '2026-10-25' }), file)).toBeNull()
    expect(eurValue(tx({}), null)).toBeNull()
  })

  it('Geld telt alles in euro zodra er koersen zijn; zonder koersen staat een bedrag apart per valuta', () => {
    const list = [tx({ id: 'a' }), tx({ id: 'b', currency: 'EUR', amount: 20 }), tx({ id: 'c', kind: 'kosten', currency: 'GBP', amount: 8.4, date: '2026-10-23' })]
    expect(totals(list).other).toEqual({ USD: { income: 107, costs: 0 }, GBP: { income: 0, costs: 8.4 } })
    setRates(file)
    const t = totals(list)
    expect(t).toMatchObject({ incomeEur: 120, costsEur: 10, balanceEur: 110, other: {} })
  })

  it('laadt rates.json van dezelfde origin en weigert een ongeldig bestand', async () => {
    const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
    expect(await loadRates('/logboek/rates.json', ok(file))).toEqual(file)
    setRates(null)
    expect(await loadRates('/logboek/rates.json', ok({ ...file, rates: { USD: [1] } }))).toBeNull()
    const offline = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await loadRates('/logboek/rates.json', offline)).toBeNull()
  })
})

describe('koers opslaan bij bestaande transacties', () => {
  let masterKey: CryptoKey
  beforeAll(async () => {
    masterKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  })

  it('een fooi in USD van de huidige versie (zonder amountEur) krijgt de definitieve koers; voorlopige en EUR blijven ongemoeid', async () => {
    const db = await openLogboekDb('logboek-rates-1')
    const store = await Store.open(db, masterKey, new GithubClient('github_pat_RATES_0123456789abcdefghijklmnopqrstuvwxyz', new FakeGithub().fetch))
    // Zo slaat de huidige versie een fooi in USD op: zonder amountEur, rate of rateDate.
    await store.putMany('transactions.json.enc', [
      tx({ id: 'oud-usd' }),
      tx({ id: 'nieuw-usd', date: '2026-10-25', amount: 108 }),
      tx({ id: 'eur', currency: 'EUR', amount: 50, amountEur: 50 }),
    ])
    expect(await backfillRates(store, file)).toBe(1)
    const byId = new Map(store.list('transactions.json.enc').map((t) => [t.id, t]))
    expect(byId.get('oud-usd')).toMatchObject({ amountEur: 100, rate: 1.07, rateDate: '2026-10-22' })
    expect(byId.get('nieuw-usd')!.amountEur).toBeUndefined()
    expect(byId.get('eur')).toEqual(tx({ id: 'eur', currency: 'EUR', amount: 50, amountEur: 50 }))
    // Nog een keer: niets meer te doen.
    expect(await backfillRates(store, file)).toBe(0)
  })
})
