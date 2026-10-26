// Bouwt public/rates.json uit de ECB-referentiekoersen (volledige historie), voor deploy.yml. De app haalt zelf nooit
// externe data op (beveiligingsregel 2): de koersen komen mee als bestand op dezelfde origin.
//
// Gebruik: node scripts/build-rates.mjs [--file ecb.xml]
// Zonder --file: ophalen bij de ECB; lukt dat niet, dan de koersen van de live app overnemen; lukt dat ook niet, dan
// geen rates.json (de app toont dan bedragen zonder omrekening). Nooit verzonnen koersen.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml'
export const LIVE_URL = 'https://logboek-olivier.github.io/logboek/rates.json'
export const CURRENCIES = ['USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'HRK']
/** Oost-Caribische dollar: vaste koppeling van 2,70 XCD per USD. */
export const XCD_PER_USD = 2.7

/** ECB-XML → { dates, rates } met oplopende datums; ontbrekende koersen null. */
export function parseEcb(xml) {
  const days = []
  const dayPattern = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g
  for (const m of xml.matchAll(dayPattern)) {
    const rates = {}
    for (const r of m[2].matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]\s*\/>/g)) rates[r[1]] = Number(r[2])
    days.push({ date: m[1], rates })
  }
  if (days.length === 0) throw new Error('Geen koersen gevonden in de ECB-XML')
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const out = { format: 'logboek-rates', source: 'ECB euro foreign exchange reference rates', dates: days.map((d) => d.date), rates: {} }
  for (const c of CURRENCIES) out.rates[c] = days.map((d) => (d.rates[c] > 0 ? d.rates[c] : null))
  out.rates.XCD = out.rates.USD.map((usd) => (usd ? Math.round(usd * XCD_PER_USD * 10000) / 10000 : null))
  return out
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.text()
}

async function main() {
  const args = process.argv.slice(2)
  const fileArg = args.indexOf('--file')
  let result = null
  try {
    const xml = fileArg >= 0 ? readFileSync(args[fileArg + 1], 'utf8') : await fetchText(ECB_URL)
    result = parseEcb(xml)
    console.log(`ECB-koersen: ${result.dates.length} dagen, t/m ${result.dates.at(-1)}`)
  } catch (error) {
    console.warn(`ECB niet bereikbaar (${error.message}); koersen van de live app proberen`)
    try {
      const live = JSON.parse(await fetchText(LIVE_URL))
      if (live?.format === 'logboek-rates' && Array.isArray(live.dates) && live.dates.length > 0) result = live
    } catch (fallbackError) {
      console.warn(`Ook de live koersen niet beschikbaar (${fallbackError.message}); geen rates.json`)
    }
  }
  if (!result) return
  mkdirSync(new URL('../public/', import.meta.url), { recursive: true })
  writeFileSync(new URL('../public/rates.json', import.meta.url), JSON.stringify(result))
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-rates.mjs')) await main()
