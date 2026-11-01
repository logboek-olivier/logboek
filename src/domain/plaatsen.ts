// Opdrachten voor plaatsen en pins. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { deletePlace, mergePlaceInto, mergePlaces, pinPlace, removePin, renamePlace, savePlace } from '../model/places'
import { opdracht, opdrachtMet } from './opdracht'

export const pinVerwijderen = opdracht('pinVerwijderen', removePin)
export const pinZetten = opdracht('pinZetten', pinPlace)
export const plaatsHernoemen = opdracht('plaatsHernoemen', renamePlace)
export const plaatsOpslaan = opdrachtMet('plaatsOpslaan', savePlace)
export const plaatsVariantenSamenvoegen = opdracht('plaatsVariantenSamenvoegen', mergePlaces)
export const plaatsVerwijderen = opdracht('plaatsVerwijderen', deletePlace)
export const plaatsenSamenvoegen = opdracht('plaatsenSamenvoegen', mergePlaceInto)
