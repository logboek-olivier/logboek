// Opdrachten die veel in één keer schrijven: mijlen of planning importeren en een back-up terugzetten. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { applyImport } from '../import/apply'
import { applyPlan } from '../import/planning'
import { applyRestore } from '../storage/backup'
import { opdracht, opdrachtMet } from './opdracht'

export const backupTerugzetten = opdracht('backupTerugzetten', applyRestore)
export const mijlenImporteren = opdracht('mijlenImporteren', applyImport)
export const planningImporteren = opdrachtMet('planningImporteren', applyPlan)
