import type { Checklist, ChecklistItem, LocalizedText, WeekType } from './types'

// Meegeleverde checklists, in eigen woorden. Een lijst wordt pas opgeslagen (zelfde id, source seed) als Olivier hem
// bewerkt; een tombstone verbergt hem.

const SEED_TIME = '2026-10-27T00:00:00.000Z'

function list(id: string, title: LocalizedText, tripTypes: WeekType[] | undefined, items: [string, string][]): Checklist {
  return {
    id,
    title,
    ...(tripTypes ? { tripTypes } : {}),
    items: items.map(([nl, en], i): ChecklistItem => ({ id: `${id}-${i + 1}`, text: { nl, en } })),
    source: 'seed',
    updatedAt: SEED_TIME,
    deletedAt: null,
  }
}

const WITH_GUESTS: WeekType[] = ['training-geven', 'skipper-charter']
const CHARTER: WeekType[] = ['training-geven', 'skipper-charter', 'zelf-cruisen']

export const SEED_CHECKLISTS: Checklist[] = [
  list('seed-veiligheid', { nl: 'Safety briefing gasten', en: 'Guest safety briefing' }, WITH_GUESTS, [
    ['Reddingsvesten: waar, hoe aan, wanneer verplicht', 'Lifejackets: where, how to wear, when required'],
    ['Man over boord: roepen, wijzen, boei gooien', 'Man overboard: shout, point, throw the buoy'],
    ['Bewegen aan dek: één hand voor de boot', 'Moving on deck: one hand for the boat'],
    ['Brand: blussers, branddeken, gas dicht', 'Fire: extinguishers, fire blanket, gas off'],
    ['Gas en kooktoestel veilig gebruiken', 'Using the gas and cooker safely'],
    ['Toiletten en afsluiters', 'Heads and seacocks'],
    ['Marifoon en noodoproep', 'VHF and distress call'],
    ['EHBO-doos en medicijnen', 'First aid kit and medication'],
    ['Lieren, schoten en vallen: vingers vrij', 'Winches, sheets and halyards: fingers clear'],
    ["Dinghy: altijd een reddingsvest, nooit 's nachts zonder licht", 'Dinghy: always a lifejacket, never at night without a light'],
    ['Zon, water en zeeziekte', 'Sun, water and seasickness'],
  ]),
  list('seed-check-in', { nl: 'Check-in charterboot', en: 'Charter boat check-in' }, CHARTER, [
    ['Inventarislijst nalopen', 'Go through the inventory'],
    ["Schade vastleggen met foto's", 'Record damage with photos'],
    ['Zeilen, schoten en tuigage', 'Sails, sheets and rigging'],
    ['Motor: olie, koelwater, V-snaar, impeller', 'Engine: oil, coolant, belt, impeller'],
    ['Brandstof en water vol', 'Fuel and water full'],
    ['Anker, ketting en ankerlier', 'Anchor, chain and windlass'],
    ['Dinghy en buitenboordmotor', 'Dinghy and outboard'],
    ['Veiligheidsmiddelen: vesten, vuurpijlen, vlot, blussers', 'Safety gear: lifejackets, flares, liferaft, extinguishers'],
    ['Navigatie, marifoon en kaarten', 'Navigation, VHF and charts'],
    ['Bootpapieren en borg', 'Boat papers and deposit'],
  ]),
  list('seed-check-out', { nl: 'Check-out charterboot', en: 'Charter boat check-out' }, CHARTER, [
    ['Brandstof bijtanken', 'Refuel'],
    ['Boot schoon en leeg', 'Boat clean and empty'],
    ['Schade en verlies melden', 'Report damage and losses'],
    ['Inventaris compleet', 'Inventory complete'],
    ["Foto's van de staat bij teruggave", 'Photos of the condition at return'],
    ['Borg en papieren afgerond', 'Deposit and papers settled'],
  ]),
  list('seed-paklijst-charter', { nl: 'Paklijst skipper charter', en: 'Packing list skipper charter' }, ['skipper-charter'], [
    ['Paspoort en vaarbewijzen', 'Passport and certificates'],
    ['Zeilkleding en zeilhandschoenen', 'Sailing clothes and gloves'],
    ['Zonnebrand, pet en zonnebril', 'Sunscreen, cap and sunglasses'],
    ['Hoofdlamp en powerbank', 'Head torch and power bank'],
    ['Multitool of mes', 'Multitool or knife'],
    ['Eigen medicijnen en pleisters', 'Own medication and plasters'],
    ['Handheld marifoon', 'Handheld VHF'],
  ]),
  list('seed-paklijst-training', { nl: 'Paklijst training geven', en: 'Packing list teaching' }, ['training-geven'], [
    ['Paspoort en instructeursbevoegdheid', 'Passport and instructor qualification'],
    ['Lesmateriaal en checklists', 'Teaching material and checklists'],
    ['Kaarten, passer en driehoeken', 'Charts, dividers and plotters'],
    ['Fluitje en stopwatch', 'Whistle and stopwatch'],
    ['Zeilkleding en handschoenen', 'Sailing clothes and gloves'],
    ['Zonnebrand, pet en zonnebril', 'Sunscreen, cap and sunglasses'],
    ['Hoofdlamp en powerbank', 'Head torch and power bank'],
  ]),
  list('seed-paklijst-tocht', { nl: 'Paklijst delivery en tocht', en: 'Packing list delivery and passage' }, ['delivery', 'zelf-cruisen', 'zelf-trainen'], [
    ['Paspoort en vaarbewijzen', 'Passport and certificates'],
    ['Offshore-kleding en laarzen', 'Offshore clothing and boots'],
    ['Reddingsvest met harnas en lifeline', 'Lifejacket with harness and tether'],
    ['Persoonlijke AIS of PLB', 'Personal AIS or PLB'],
    ['Hoofdlamp met rood licht', 'Head torch with red light'],
    ['Slaapzak en kussen', 'Sleeping bag and pillow'],
    ['Zeeziektemiddelen', 'Seasickness medication'],
    ['Snacks voor de nachtwacht', 'Snacks for the night watch'],
  ]),
]
