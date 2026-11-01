// Opdracht voor de instellingen. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { saveSettings } from '../model/settings'
import { opdracht } from './opdracht'
import type { Tx } from './tx'

export const instellingenOpslaan = opdracht('instellingenOpslaan', saveSettings)

/** Een nieuw logboek: leeg beginnen (geen organisaties, cursuspakketten of startdatum vooraf). */
export function startEmpty(tx: Tx): Promise<void> {
  return saveSettings(tx, { startedEmpty: true, organisations: [], curriculumPacks: [] })
}

export const nieuwLogboekInrichten = opdracht('nieuwLogboekInrichten', startEmpty)
