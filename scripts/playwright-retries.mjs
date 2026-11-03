// Print na een Playwright-run in CI welke tests een tweede poging nodig hadden (retries: 1 in playwright.config.ts) en
// laat de job falen bij meer dan twee: een test die alleen bij herhaling slaagt, is geen groene test. Leest het
// JSON-verslag uit playwright-report/results.json. Werkt in PowerShell en bash (alleen Node).
import { existsSync, readFileSync } from 'node:fs'

const MAX_RETRIED = 2
const file = process.argv[2] ?? 'playwright-report/results.json'
if (!existsSync(file)) {
  console.log(`Geen verslag gevonden (${file}); niets te controleren.`)
  process.exit(0)
}
const report = JSON.parse(readFileSync(file, 'utf8'))
const retried = []
function walk(suite, path) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      // Meer dan één poging en uiteindelijk geslaagd: een flaky test. Een echt gefaalde test meldt Playwright zelf.
      if (test.results.length > 1 && test.results.at(-1)?.status === 'passed') retried.push(`${[...path, spec.title].join(' › ')} (${test.projectName})`)
    }
  }
  for (const child of suite.suites ?? []) walk(child, [...path, child.title])
}
for (const suite of report.suites ?? []) walk(suite, [suite.title])
if (retried.length === 0) {
  console.log('Geen test had een tweede poging nodig.')
  process.exit(0)
}
console.log(`${retried.length} test(s) slaagden pas bij de tweede poging:`)
for (const name of retried) console.log(`  - ${name}`)
if (retried.length > MAX_RETRIED) {
  console.error(`Meer dan ${MAX_RETRIED} tests hadden een tweede poging nodig: dat is geen groene run.`)
  process.exit(1)
}
