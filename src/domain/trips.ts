// Opdrachten voor trips: maken, bewerken, afronden, deelnemers, samenvoegen en verwijderen, teller, checklists, boten en Nakijken. Elke wijziging is een benoemde opdracht via `commit` (src/domain/commit.ts, docs/FUNDERING.md).

import { confirmBoats, deleteBoat, mergeBoat, skipBoats } from '../model/boats'
import { addChecklist, deleteChecklist, saveChecklist, toggleCheck } from '../model/checklists'
import { answerDoubt, saveFirstNumbers } from '../model/counters'
import { renameTrip } from '../model/edit'
import { answerReturning } from '../model/guests'
import { acceptAllKinds, dismissReview, fixDayInStay, fixDayInTrip, fixLandOverlap, fixLegOutside, fixLegStart, fixMoneyWithoutPeriod, makeStayFor, makeTripFor, setInvestmentCategory, setTripKind, setTripOrganisation } from '../model/review'
import { changeParticipant, deleteTripWith, mergeTrips, replaceTrip } from '../model/trip-ops'
import { addParticipant, closeWeek, startWeek, updateWeek } from '../model/weeks'
import { opdracht, opdrachtMet } from './opdracht'

export const agendadagBijTrip = opdracht('agendadagBijTrip', fixDayInTrip)
export const bootVerwijderen = opdracht('bootVerwijderen', deleteBoat)
export const botenBevestigen = opdracht('botenBevestigen', confirmBoats)
export const botenOverslaan = opdracht('botenOverslaan', skipBoats)
export const botenSamenvoegen = opdracht('botenSamenvoegen', mergeBoat)
export const checklistAfvinken = opdracht('checklistAfvinken', toggleCheck)
export const checklistOpslaan = opdracht('checklistOpslaan', saveChecklist)
export const checklistToevoegen = opdrachtMet('checklistToevoegen', addChecklist)
export const checklistVerwijderen = opdracht('checklistVerwijderen', deleteChecklist)
export const dagBeginAansluiten = opdracht('dagBeginAansluiten', fixLegStart)
export const dagBuitenPeriodeOplossen = opdracht('dagBuitenPeriodeOplossen', fixLegOutside)
export const dagtoestandUitLandperiode = opdracht('dagtoestandUitLandperiode', fixDayInStay)
export const deelnemerToevoegen = opdracht('deelnemerToevoegen', addParticipant)
export const deelnemerWijzigen = opdracht('deelnemerWijzigen', changeParticipant)
export const geldKoppelen = opdracht('geldKoppelen', fixMoneyWithoutPeriod)
export const investeringssoortZetten = opdracht('investeringssoortZetten', setInvestmentCategory)
export const landperiodeInkorten = opdracht('landperiodeInkorten', fixLandOverlap)
export const landperiodeMaken = opdracht('landperiodeMaken', makeStayFor)
export const nakijkenKloptZo = opdracht('nakijkenKloptZo', dismissReview)
export const organisatieBeantwoorden = opdracht('organisatieBeantwoorden', answerDoubt)
export const periodeAfronden = opdracht('periodeAfronden', closeWeek)
export const periodeBewerken = opdracht('periodeBewerken', updateWeek)
export const periodeHernoemen = opdracht('periodeHernoemen', renameTrip)
export const periodeMaken = opdrachtMet('periodeMaken', startWeek)
export const periodeMakenOverDagen = opdracht('periodeMakenOverDagen', makeTripFor)
export const periodeOrganisatieZetten = opdracht('periodeOrganisatieZetten', setTripOrganisation)
export const periodeSoortZetten = opdracht('periodeSoortZetten', setTripKind)
export const periodeVervangen = opdracht('periodeVervangen', replaceTrip)
export const periodeVerwijderen = opdracht('periodeVerwijderen', deleteTripWith)
export const samenvoegen = opdracht('samenvoegen', mergeTrips)
export const soortenOvernemen = opdracht('soortenOvernemen', acceptAllKinds)
export const tellerBeginnummersOpslaan = opdracht('tellerBeginnummersOpslaan', saveFirstNumbers)
export const terugkerendeGastBeantwoorden = opdracht('terugkerendeGastBeantwoorden', answerReturning)
