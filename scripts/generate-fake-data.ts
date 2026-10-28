// Schrijft de gegenereerde nep-fixtures (verzonnen plaatsen en getallen) naar tests/fixtures.
// Gebruik: npm run fixtures
import { writeFileSync } from 'node:fs'
import { buildFakeBoatsCsv } from './fake-boats-csv.ts'
import { buildFakePlanningCsv } from './fake-planning-csv.ts'
import { buildFakeMileageXlsx } from './fake-xlsx.ts'

writeFileSync(new URL('../tests/fixtures/mijlen-nep.xlsx', import.meta.url), buildFakeMileageXlsx())
console.log('tests/fixtures/mijlen-nep.xlsx geschreven')
writeFileSync(new URL('../tests/fixtures/boten-nep.csv', import.meta.url), buildFakeBoatsCsv())
console.log('tests/fixtures/boten-nep.csv geschreven')
writeFileSync(new URL('../tests/fixtures/planning-nep.csv', import.meta.url), buildFakePlanningCsv())
console.log('tests/fixtures/planning-nep.csv geschreven')
