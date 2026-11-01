// Opdracht voor de instellingen. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { saveSettings } from '../model/settings'
import { opdracht } from './opdracht'

export const instellingenOpslaan = opdracht('instellingenOpslaan', saveSettings)
