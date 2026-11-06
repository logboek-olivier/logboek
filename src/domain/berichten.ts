import { deleteTemplate, markMessage, saveTemplate, setMessageDefaults, setMessageField } from '../model/messages'
import { opdracht, opdrachtMet } from './opdracht'

// Berichtengenerator: sjablonen (templates.json.enc), de velden en "verstuurd" per trip, en de standaard per
// organisatie (instellingen). De tekst van een bericht zelf wordt nooit opgeslagen.

export const sjabloonOpslaan = opdrachtMet('sjabloonOpslaan', saveTemplate)
export const sjabloonVerwijderen = opdracht('sjabloonVerwijderen', deleteTemplate)
export const berichtVeldZetten = opdracht('berichtVeldZetten', setMessageField)
export const berichtMarkeren = opdracht('berichtMarkeren', markMessage)
export const berichtStandaardZetten = opdracht('berichtStandaardZetten', setMessageDefaults)
