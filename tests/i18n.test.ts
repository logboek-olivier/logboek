import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { formatDate, formatDateRange, formatMoney, formatMoneyShort, formatMonth, formatNm, formatNumber } from '../src/format'
import { catalogs, setLang, t, translate } from '../src/i18n'
import { kindLabel, roleLabel, sourceLabel } from '../src/i18n/labels'
import { describeStatus } from '../src/storage/store'

afterEach(() => setLang('nl', false))

describe('vertalingen', () => {
  it('elke sleutel bestaat in beide talen, met dezelfde vorm (tekst of functie) en zonder lege tekst', () => {
    const { nl, en } = catalogs()
    expect(Object.keys(en).sort()).toEqual(Object.keys(nl).sort())
    for (const key of Object.keys(nl) as (keyof typeof nl)[]) {
      expect(typeof en[key], key).toBe(typeof nl[key])
      if (typeof nl[key] === 'string') {
        expect((nl[key] as string).trim(), key).not.toBe('')
        expect((en[key] as string).trim(), key).not.toBe('')
      }
    }
  })

  it('teksten met getallen en meervoud', () => {
    expect(t('unit.days', { n: 1 })).toBe('1 dag')
    expect(t('unit.days', { n: 3 })).toBe('3 dagen')
    expect(translate('en', 'unit.days', { n: 1 })).toBe('1 day')
    expect(translate('en', 'sync.pending', { n: 3 })).toBe('3 changes waiting')
    setLang('en', false)
    expect(t('import.row', { row: 7, message: 'x' })).toBe('Row 7: x')
    expect(roleLabel('bemanningslid')).toBe('Crew')
    expect(kindLabel('fooi')).toBe('Tip')
    expect(sourceLabel('overig')).toBe('Other')
  })

  it('getallen, bedragen en datums volgen de taal', () => {
    expect(formatNumber(1240.5)).toBe('1.240,5')
    expect(formatNm(1240)).toBe('1.240 nm')
    expect(formatMoney(1250.5, 'EUR')).toBe('€ 1.250,50')
    expect(formatMoneyShort(1250, 'EUR')).toBe('€ 1.250')
    expect(formatDate('2024-05-03')).toBe('3 mei 2024')
    expect(formatDateRange('2024-05-03', '2024-05-04')).toBe('3–4 mei 2024')
    expect(formatMonth('2026-10')).toBe('oktober 2026')
    setLang('en', false)
    expect(formatNumber(1240.5)).toBe('1,240.5')
    expect(formatMoney(1250.5, 'EUR')).toBe('€1,250.50')
    expect(formatMoney(12, 'USD')).toBe('$12.00')
    expect(formatDate('2024-05-03')).toBe('3 May 2024')
    expect(formatMonth('2026-10')).toBe('October 2026')
    // Een export kan een andere taal hebben dan de app.
    expect(formatDate('2024-05-03', 'nl')).toBe('3 mei 2024')
  })

  it('sync-status in beide talen', () => {
    expect(describeStatus({ kind: 'error', code: 'token', count: 1 })).toBe('Token verlopen of ingetrokken · Token vervangen')
    setLang('en', false)
    expect(describeStatus({ kind: 'synced' })).toBe('Synced')
    expect(describeStatus({ kind: 'error', code: 'github', github: 'rateLimit', count: 0 })).toBe('GitHub limit reached; try again later')
  })

  it('schermen en onderdelen bevatten geen vaste Nederlandse of Engelse tekst buiten de vertalingen', () => {
    const allowed = new Set(['Logboek', 'Nederlands', 'English', 'nm', 'EUR', 'github_pat_…', 'Promise'])
    const found: string[] = []
    for (const dir of ['src/screens', 'src/components']) {
      for (const file of readdirSync(new URL(`../${dir}`, import.meta.url))) {
        if (!file.endsWith('.tsx')) continue
        const source = readFileSync(new URL(`../${dir}/${file}`, import.meta.url), 'utf8')
        // Tekst tussen tags (JSX-tekst) en tekstattributen die de gebruiker ziet.
        for (const m of source.matchAll(/(?<![=-])>\s*([A-Za-zÀ-ÿ][^<>{}=;()'?]*?)\s*</g)) {
          const text = m[1]!.trim()
          if (text && !allowed.has(text) && /[a-z]{2}/.test(text)) found.push(`${file}: ${text}`)
        }
        for (const m of source.matchAll(/\b(?:aria-label|title|placeholder|label|submitLabel|text)="([^"]+)"/g)) {
          if (!allowed.has(m[1]!) && /[a-z]{2}/i.test(m[1]!)) found.push(`${file}: ${m[1]}`)
        }
      }
    }
    expect(found).toEqual([])
  })
})
