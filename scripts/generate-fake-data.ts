// Schrijft de gegenereerde nep-fixtures (verzonnen plaatsen en getallen) naar tests/fixtures.
// Gebruik: npm run fixtures
import { writeFileSync } from 'node:fs'
import { buildFakeMileageXlsx } from './fake-xlsx.ts'

writeFileSync(new URL('../tests/fixtures/mijlen-nep.xlsx', import.meta.url), buildFakeMileageXlsx())
console.log('tests/fixtures/mijlen-nep.xlsx geschreven')
