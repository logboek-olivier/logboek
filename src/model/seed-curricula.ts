import type { Curriculum, CurriculumBody, TopicKind } from './types'

// Meegeleverde cursussen. ASA 101, 103, 104 en 114: de belangrijke onderwerpen per cursus, in eigen woorden
// (geen officiële ASA-teksten). RYA en CWO: alleen de cursussen, zonder onderwerpen; Olivier vult ze zelf.
// Vaste id's, zodat twee apparaten dezelfde cursus herkennen. Een seed wordt pas opgeslagen als Olivier hem bewerkt.

type Row = [id: string, nl: string, en: string, kind: TopicKind, critical?: boolean]
type Group = [id: string, nl: string, en: string, topics: Row[]]

const T = 'theorie'
const P = 'praktijk'

function curriculum(id: string, body: CurriculumBody, courseCode: string, nl: string, en: string, groups: Group[]): Curriculum {
  return {
    id,
    body,
    courseCode,
    name: { nl, en },
    source: 'seed',
    groups: groups.map(([gid, gnl, gen, topics]) => ({
      id: gid,
      title: { nl: gnl, en: gen },
      topics: topics.map(([tid, tnl, ten, kind, critical]) => ({ id: tid, title: { nl: tnl, en: ten }, kind, examCritical: critical ?? false })),
    })),
    // Vast tijdstip: een opgeslagen (bewerkte) versie is altijd nieuwer.
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

const ASA_101 = curriculum('seed-asa-101', 'ASA', '101', 'Basic Keelboat Sailing', 'Basic Keelboat Sailing', [
  ['asa101-boot', 'Boot en begrippen', 'Boat and terms', [
    ['asa101-t01', 'Onderdelen van de boot en het tuig benoemen', 'Name the parts of the boat and rig', T],
    ['asa101-t02', 'Koersen ten opzichte van de wind', 'Points of sail', T, true],
    ['asa101-t03', 'Zeilen aanslaan, hijsen en strijken', 'Bending on, hoisting and lowering sails', P],
    ['asa101-t04', 'Knopen: paalsteek, kikkersteek, achtknoop, mastworp, platte knoop', 'Knots: bowline, cleat hitch, figure eight, clove hitch, reef knot', P, true],
  ]],
  ['asa101-veilig', 'Veiligheid', 'Safety', [
    ['asa101-t05', 'Reddingsvesten en veiligheidsmiddelen aan boord', 'Life jackets and safety equipment on board', T, true],
    ['asa101-t06', 'Man-over-boord: alarm, zicht houden en terugkeren', 'Crew overboard: alarm, keep sight and return', P, true],
    ['asa101-t07', 'Voorrangsregels: zeil, motor, bakboord en stuurboord', 'Right of way: sail, power, port and starboard', T, true],
    ['asa101-t08', 'Weer inschatten vóór vertrek', 'Assessing the weather before departure', T],
    ['asa101-t09', 'Onderkoeling, zon en zeeziekte', 'Hypothermia, sun and seasickness', T],
  ]],
  ['asa101-varen', 'Bootbeheersing', 'Boat handling', [
    ['asa101-t10', 'Sturen op een koers en op een herkenningspunt', 'Steering a course and on a landmark', P],
    ['asa101-t11', 'Overstag gaan', 'Tacking', P, true],
    ['asa101-t12', 'Gijpen onder controle', 'Controlled gybing', P, true],
    ['asa101-t13', 'Zeiltrim: schoten, neerhouder en verklikkers', 'Sail trim: sheets, vang and telltales', P],
    ['asa101-t14', 'Bijliggen', 'Heaving to', P],
    ['asa101-t15', 'Reven of zeil verkleinen', 'Reefing or reducing sail', P],
  ]],
  ['asa101-haven', 'Vertrekken en aanleggen', 'Leaving and docking', [
    ['asa101-t16', 'Lijnen en stootwillen klaarmaken', 'Preparing lines and fenders', P],
    ['asa101-t17', 'Wegvaren van de steiger', 'Leaving the dock', P, true],
    ['asa101-t18', 'Aanleggen aan de steiger', 'Returning to the dock', P, true],
    ['asa101-t19', 'Een mooring oppikken', 'Picking up a mooring', P],
  ]],
])

const ASA_103 = curriculum('seed-asa-103', 'ASA', '103', 'Basic Coastal Cruising', 'Basic Coastal Cruising', [
  ['asa103-nav', 'Navigatie en vaarwegmarkering', 'Navigation and aids to navigation', [
    ['asa103-t01', 'Zeekaart lezen: diepte, gevaren, symbolen', 'Reading a chart: depth, hazards, symbols', T, true],
    ['asa103-t02', 'Betonning (IALA) en lichten van boeien', 'Buoyage (IALA) and buoy lights', T, true],
    ['asa103-t03', 'Getij en stroom in de planning', 'Tides and currents in planning', T],
    ['asa103-t04', 'Kompas, koers en peiling', 'Compass, course and bearing', T],
  ]],
  ['asa103-regels', 'Regels en communicatie', 'Rules and communication', [
    ['asa103-t05', 'Bepalingen ter voorkoming van aanvaringen: lichten en geluidsseinen', 'Collision regulations: lights and sound signals', T, true],
    ['asa103-t06', 'Marifoon: kanalen en procedures', 'VHF radio: channels and procedures', T, true],
    ['asa103-t07', 'Noodoproep (Mayday en Pan-Pan)', 'Distress and urgency calls (Mayday and Pan-Pan)', P, true],
  ]],
  ['asa103-systemen', 'Systemen aan boord', 'Systems on board', [
    ['asa103-t08', 'Motorcontrole voor vertrek', 'Engine checks before departure', P],
    ['asa103-t09', 'Brandstof, water en elektriciteit', 'Fuel, water and electrics', T],
    ['asa103-t10', 'Toilet en lenspomp', 'Head and bilge pump', P],
  ]],
  ['asa103-varen', 'Varen op motor en zeil', 'Handling under power and sail', [
    ['asa103-t11', 'Schroefeffect en manoeuvreren op motor', 'Prop walk and manoeuvring under power', P],
    ['asa103-t12', 'Aanleggen en wegvaren op motor', 'Docking and leaving under power', P, true],
    ['asa103-t13', 'Ankeren en het anker controleren', 'Anchoring and checking the anchor', P, true],
    ['asa103-t14', 'Man-over-boord op motor', 'Crew overboard under power', P, true],
    ['asa103-t15', 'Reven op tijd', 'Reefing in good time', P],
  ]],
  ['asa103-tocht', 'Dagtocht en veiligheid', 'Day passage and safety', [
    ['asa103-t16', 'Een dagtocht plannen', 'Planning a day passage', T],
    ['asa103-t17', 'Weerbericht lezen en lokale effecten', 'Reading forecasts and local effects', T],
    ['asa103-t18', 'Veiligheidsinstructie voor de bemanning', 'Crew safety briefing', P],
    ['asa103-t19', 'Brand en lekkage aan boord', 'Fire and flooding on board', T, true],
  ]],
])

const ASA_104 = curriculum('seed-asa-104', 'ASA', '104', 'Bareboat Cruising', 'Bareboat Cruising', [
  ['asa104-plan', 'Plannen en voorbereiden', 'Planning and preparation', [
    ['asa104-t01', 'Meerdaagse tocht plannen', 'Planning a multi-day passage', T],
    ['asa104-t02', 'Proviand, water en brandstof voor meerdere dagen', 'Provisions, water and fuel for several days', T],
    ['asa104-t03', 'Overname van een charterboot: controlelijst', 'Charter boat check-out: checklist', P, true],
  ]],
  ['asa104-nav', 'Navigatie', 'Navigation', [
    ['asa104-t04', 'Gegist bestek en positie bepalen', 'Dead reckoning and position fixing', T, true],
    ['asa104-t05', 'Uitzetten in de kaart en koers met stroom', 'Chart plotting and course to steer with current', T],
    ['asa104-t06', 'Getijberekening', 'Tidal calculations', T],
    ['asa104-t07', 'Navigeren in het donker: lichten herkennen', 'Night navigation: identifying lights', T],
  ]],
  ['asa104-anker', 'Ankeren en afmeren', 'Anchoring and mooring', [
    ['asa104-t08', 'Ankerplaats kiezen: bodem, beschutting, zwaaicirkel', 'Choosing an anchorage: holding, shelter, swing', T, true],
    ['asa104-t09', 'Mediterraan afmeren (achteruit met anker)', 'Mediterranean mooring (stern-to with anchor)', P, true],
    ['asa104-t10', 'Afmeren aan een boei', 'Mooring to a buoy', P],
    ['asa104-t11', 'Bijboot en buitenboordmotor veilig gebruiken', 'Using the dinghy and outboard safely', P],
  ]],
  ['asa104-systemen', 'Systemen', 'Systems', [
    ['asa104-t12', 'Eenvoudige motorstoringen verhelpen', 'Basic engine troubleshooting', P],
    ['asa104-t13', 'Accubeheer en stroomverbruik', 'Battery management and power use', T],
  ]],
  ['asa104-nood', 'Noodsituaties', 'Emergencies', [
    ['asa104-t14', 'Zwaar weer: voorbereiden en reven', 'Heavy weather: preparing and reefing', P, true],
    ['asa104-t15', 'Aan de grond lopen', 'Running aground', T],
    ['asa104-t16', 'Schip verlaten en reddingsvlot', 'Abandoning ship and liferaft', T, true],
    ['asa104-t17', 'Man-over-boord met de hele bemanning oefenen', 'Crew overboard drill with the whole crew', P, true],
  ]],
  ['asa104-schipper', 'Schipperschap', 'Skippering', [
    ['asa104-t18', 'Bemanning indelen en wachtschema', 'Crew roles and watch system', T],
    ['asa104-t19', 'Beslissen als schipper: vertrekken, uitwijken, wachten', 'Skipper decisions: go, divert or wait', T],
  ]],
])

const ASA_114 = curriculum('seed-asa-114', 'ASA', '114', 'Cruising Catamaran', 'Cruising Catamaran', [
  ['asa114-cat', 'Eigenschappen van een catamaran', 'Catamaran characteristics', [
    ['asa114-t01', 'Verschillen met een eenromper', 'Differences from a monohull', T],
    ['asa114-t02', 'Stabiliteit en kapseisrisico', 'Stability and risk of capsize', T, true],
    ['asa114-t03', 'Windvang en afdrijven', 'Windage and leeway', T],
  ]],
  ['asa114-motor', 'Varen op twee motoren', 'Handling under twin engines', [
    ['asa114-t04', 'Manoeuvreren met twee motoren', 'Manoeuvring with twin engines', P, true],
    ['asa114-t05', 'Draaien op de plaats', 'Turning in its own length', P],
    ['asa114-t06', 'Aanleggen en wegvaren met een catamaran', 'Docking and leaving with a catamaran', P, true],
    ['asa114-t07', 'Mediterraan afmeren met een catamaran', 'Mediterranean mooring with a catamaran', P],
  ]],
  ['asa114-zeil', 'Zeilen', 'Sailing', [
    ['asa114-t08', 'Zeiltrim op een catamaran', 'Sail trim on a catamaran', P],
    ['asa114-t09', 'Vroeg reven: reefpunten bij windkracht', 'Reefing early: reef points by wind strength', P, true],
    ['asa114-t10', 'Overstag zonder in de wind te blijven hangen', 'Tacking without stalling head to wind', P],
    ['asa114-t11', 'Veilig gijpen', 'Gybing safely', P],
  ]],
  ['asa114-anker', 'Ankeren', 'Anchoring', [
    ['asa114-t12', 'Ankeren met een hanenpoot', 'Anchoring with a bridle', P, true],
  ]],
  ['asa114-veilig', 'Systemen en veiligheid', 'Systems and safety', [
    ['asa114-t13', 'Systemen in twee rompen', 'Systems in two hulls', T],
    ['asa114-t14', 'Man-over-boord op een catamaran', 'Crew overboard on a catamaran', P, true],
    ['asa114-t15', 'Zwaar weer: tactiek en noodluiken', 'Heavy weather: tactics and escape hatches', T],
  ]],
])

/** Alleen de cursus, zonder onderwerpen. */
function empty(id: string, body: CurriculumBody, courseCode: string, nl: string, en: string): Curriculum {
  return curriculum(id, body, courseCode, nl, en, [])
}

export const SEED_CURRICULA: readonly Curriculum[] = [
  ASA_101,
  ASA_103,
  ASA_104,
  ASA_114,
  empty('seed-rya-cc', 'RYA', 'Competent Crew', 'Competent Crew', 'Competent Crew'),
  empty('seed-rya-ds', 'RYA', 'Day Skipper', 'Day Skipper', 'Day Skipper'),
  empty('seed-rya-cs', 'RYA', 'Coastal Skipper', 'Coastal Skipper', 'Coastal Skipper'),
  empty('seed-rya-ymo', 'RYA', 'Yachtmaster Offshore', 'Yachtmaster Offshore', 'Yachtmaster Offshore'),
  empty('seed-cwo-kajuit-1', 'CWO', 'Kajuitzeilen I', 'Kajuitzeilen I', 'Cruising I'),
  empty('seed-cwo-kajuit-2', 'CWO', 'Kajuitzeilen II', 'Kajuitzeilen II', 'Cruising II'),
  empty('seed-cwo-kajuit-3', 'CWO', 'Kajuitzeilen III', 'Kajuitzeilen III', 'Cruising III'),
]
