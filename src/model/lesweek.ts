import type { Tx } from '../domain/tx'
import { todayIso } from '../basis/datum'
import type { LessonCheck, LessonCourse, Participant, Trip } from './types'

export type { LessonCheck, LessonCourse }

// Lesweek: afvinken per blok in plaats van per los ASA-punt (idee van Olivier, november 2026). Een blok is bijvoorbeeld
// "Veiligheid" of "Zeilen"; de elementen eronder zijn een geheugensteun (wat je benoemt of laat zien), geen eigen vinkjes.
// Groepsblokken (theorie, kort uitleggen) gelden met één vink voor de hele groep; studentblokken (praktijk, doorlopend,
// examens) moeten per student goed zijn: één tik = gedaan voor iedereen voor wie het geldt, een naam aantikken = die
// student nog niet. De vinkjes staan op de trip (`Trip.lessonChecks`), de cursussen bij de deelnemer (`courses`).
// Vast in de code, net als de meegeleverde checklists; de tekst is in eigen woorden (geen officiële ASA-teksten).

export const LESSON_COURSES: readonly LessonCourse[] = ['101', '103', '104', '114', '106', 'plus']
/** Cursussen met een examen en een certificaat. */
export const CERT_COURSES: readonly LessonCourse[] = ['101', '103', '104', '114', '106']

/** Snelkeuzes voor een student: de sporen uit de praktijk. */
export type LessonTrack = '101-103' | '104' | '104-114' | '104-plus' | '106'
export const LESSON_TRACKS: readonly { id: LessonTrack; courses: LessonCourse[] }[] = [
  { id: '101-103', courses: ['101', '103'] },
  { id: '104', courses: ['104'] },
  { id: '104-114', courses: ['104', '114'] },
  { id: '104-plus', courses: ['104', '114', 'plus'] },
  { id: '106', courses: ['106'] },
]

/** Label van een element: alleen voor 104/114/106, alleen op een catamaran, uit RYA (★, extra uitdaging), alleen op een monohull. */
export type ElementLabel = '104' | '114' | 'star' | 'mono'

export type BlockKind = 'groep' | 'student'
export type BlockSection = 'theorie' | 'kort' | 'praktijk' | 'doorlopend' | 'examen'
export const BLOCK_SECTIONS: readonly BlockSection[] = ['theorie', 'kort', 'praktijk', 'doorlopend', 'examen']

export interface LessonElement {
  text: { nl: string; en: string }
  label?: ElementLabel
}

export interface LessonBlock {
  /** Vaste code (T1, P3, examen-101), ook het id van het vinkje op de trip. */
  id: string
  kind: BlockKind
  section: BlockSection
  title: { nl: string; en: string }
  elements: LessonElement[]
  /** De cursussen waar dit blok bij hoort. */
  courses: LessonCourse[]
  /** ASA-nummers ter controle dat alles gedekt is. */
  asa?: string
}

type El = [nl: string, en: string, label?: ElementLabel]

function b(id: string, kind: BlockKind, section: BlockSection, nl: string, en: string, courses: LessonCourse[], elements: El[], asa?: string): LessonBlock {
  return { id, kind, section, title: { nl, en }, courses, elements: elements.map(([enl, een, label]) => ({ text: { nl: enl, en: een }, ...(label ? { label } : {}) })), ...(asa ? { asa } : {}) }
}

const G = 'groep'
const S = 'student'
// 106 volgt 104 (Coastal Skipper-niveau), met de nachttocht erbij.
const C101: LessonCourse = '101'
const C103: LessonCourse = '103'
const C104: LessonCourse = '104'
const C114: LessonCourse = '114'
const C106: LessonCourse = '106'

export const LESSON_BLOCKS: readonly LessonBlock[] = [
  // Theorie (groep)
  b('T1', G, 'theorie', 'Rondje over de boot', 'Boat tour', [C101, C103, C104, C114, C106], [
    ['Onderdelen van de boot, tuig, zeilen en trimlijnen', 'Parts of the boat, rig, sails and trim lines'],
    ['Water: tanks, verbruik, juiste vuldop', 'Water: tanks, usage, the right filler cap'],
    ['Toilet en vuilwatertank', 'Heads and holding tank'],
    ['Stroom: accuschakelaar, schakelpaneel, stroom sparen', 'Power: battery switch, panel, saving power'],
    ['Kombuis: kooktoestel en gas, veilig koken, kombuisbrand', 'Galley: stove and gas, safe cooking, galley fire'],
    ['Lenspompen (elektrisch en met de hand), noodroer', 'Bilge pumps (electric and manual), emergency tiller'],
    ['Spullen vastzetten en opbergen', 'Stowing and securing gear'],
    ['Catamaranbegrippen en systemen', 'Catamaran terms and systems', '114'],
  ], '101: 1, 2 · 103: 1, 5, 32 · 104: 8–10, 12, 13, 33, 34, 36 · 114: 1, 2, 19, 20, 22, 23, 34'),
  b('T2', G, 'theorie', 'Manoeuvreren', 'Manoeuvring', [C101, C103, C104, C114, C106], [
    ['Draaipunt van de boot', 'Pivot point of the boat'],
    ['Effect van de wind', 'Effect of the wind'],
    ['Schroefeffect', 'Prop walk', 'mono'],
    ['Plaats van de motoren, twee motoren, windvang', 'Engine position, twin engines, windage', '114'],
  ], '114: 10–12'),
  b('T3', G, 'theorie', 'Koersen en zeiltrim', 'Points of sail and trim', [C101, C114], [
    ['Koersen ten opzichte van de wind', 'Points of sail'],
    ['Oploeven en afvallen', 'Heading up and bearing away'],
    ['Trimmen met schoten en trimmiddelen', 'Trimming with sheets and controls'],
    ["Stuurcommando's en antwoorden", 'Helm commands and responses'],
    ['Windvang en zeilprestaties van een cat', 'Windage and sailing performance of a cat', '114'],
  ], '101: 4, 5, 22 · 114: 13, 14'),
  b('T4', G, 'theorie', 'Vaarregels en betonning', 'Rules of the road and buoyage', [C101, C103, C104, C106], [
    ['Uitkijk houden, veilige vaart, aanvaringsgevaar', 'Lookout, safe speed, risk of collision'],
    ['Zeilschip tegenover zeilschip', 'Sail versus sail'],
    ['Oplopen; motorschepen onderling', 'Overtaking; power versus power'],
    ['Zeilschip tegenover motorschip en beroepsvaart', 'Sail versus power and commercial traffic'],
    ['Uitwijkplichtig en koershouder', 'Give-way and stand-on vessel'],
    ['Betonning', 'Buoyage'],
    ['Plaats en kleur van de lichten', 'Position and colour of the lights'],
  ], '101: 6–15, 17 · 103: 18–20 · 104: 23'),
  b('T5', G, 'theorie', 'Veiligheid', 'Safety', [C101, C103, C104, C114, C106], [
    ['Veiligheidsuitrusting: wat er verplicht is en controleren', 'Safety equipment: what is required, checking it'],
    ['Reddingsvesten, werpmiddel, harnas en jacklines', 'Life jackets, throwing line, harness and jacklines'],
    ['Brand, explosie en blussers', 'Fire, explosion and extinguishers'],
    ['Onderkoeling, hitte', 'Hypothermia, heat'],
    ['Koudwatershock', 'Cold water shock', 'star'],
    ['Noodsignalen', 'Distress signals'],
    ['Reddingsvlot, helikopterredding, sleep vastmaken', 'Liferaft, helicopter rescue, taking a tow', 'star'],
    ['Aanvaring, aan de grond, krabbend anker, lekkage: directe acties', 'Collision, grounding, dragging anchor, leak: immediate actions'],
    ['Motorstoring, schroef vast, geen koelwater', 'Engine failure, fouled prop, no cooling water'],
    ['Eén of twee motoren uitgevallen', 'One or both engines failed', '114'],
    ['Iemand uit het water halen', 'Getting someone out of the water'],
  ], '101: 16, 21 · 103: 2–4, 6, 26–30 · 104: 4, 14–16, 29 · 114: 30, 31, 33, 35'),
  b('T6', G, 'theorie', 'Motorcheck', 'Engine check', [C103, C104, C114, C106], [
    ['WOBBLE-check: olie, lekkage, V-snaar', 'WOBBLE check: oil, leaks, belt'],
    ['Koelwaterfilter en afsluiter', 'Raw water strainer and seacock'],
    ['Starten, laten lopen, stoppen', 'Starting, running, stopping'],
    ['Diesel in grote lijnen: brandstof, smering, koeling, aandrijving', 'Diesel basics: fuel, lubrication, cooling, drive'],
    ['Brandstofverbruik en bereik', 'Fuel consumption and range'],
    ['Routinecontrole van de hele boot', 'Routine check of the whole boat'],
    ['Laden met twee motoren', 'Charging with two engines', '114'],
    ['Brandstoffilters, ontluchten, impeller', 'Fuel filters, bleeding, impeller', 'star'],
  ], '103: 37 · 104: 7, 11, 30–32 · 114: 21, 36'),
  b('T7', G, 'theorie', 'Weer en marifoon', 'Weather and VHF', [C103, C104, C106], [
    ['Weerbericht halen en lezen, plan voor 3 dagen', 'Getting and reading a forecast, a 3-day plan'],
    ['Buien en cumulonimbus, waarschuwingen', 'Squalls and cumulonimbus, warnings'],
    ['Mist', 'Fog'],
    ['Zeewind en landwind', 'Sea breeze and land breeze'],
    ['Barometer', 'Barometer', 'star'],
    ['Marifoon: testen, oproepen op kanaal 16, wisselen naar een werkkanaal', 'VHF: radio check, calling on channel 16, switching to a working channel'],
  ], '103: 11–13, 34 · 104: 25–27, 35, 50'),
  b('T8', G, 'theorie', 'Kaart', 'Chart', [C103, C104, C106], [
    ['Kaartbegrippen: koers, peiling, variatie, deviatie, positie', 'Chart terms: course, bearing, variation, deviation, position'],
    ['Lagerwal', 'Lee shore'],
    ['Diepte en getij ten opzichte van kaartnul', 'Depth and tide relative to chart datum'],
  ], '103: 8, 10 · 104: 24, 53'),
  b('T9', G, 'theorie', 'Lichten en geluidsseinen', 'Lights and sound signals', [C103], [
    ['Lichten: plaats, kleur, sectoren, schepen herkennen', 'Lights: position, colour, arcs, recognising vessels'],
    ['Beperkt zicht', 'Restricted visibility'],
    ['Manoeuvre- en waarschuwingsseinen', 'Manoeuvring and warning signals'],
  ], '103: 21–23'),
  b('T10', G, 'theorie', 'Catamaran', 'Catamaran', [C114], [
    ['Indeling, leven aan boord, zicht vanaf het roer', 'Layout, life on board, visibility from the helm'],
    ['Stabiliteit, gewicht en belading', 'Stability, weight and loading'],
    ['Kielen en zwaarden', 'Keels and daggerboards'],
    ['Kapseizen voorkomen, en wat te doen erna', 'Preventing a capsize, and what to do after'],
  ], '114: 3–9, 28, 29'),
  b('T11', G, 'theorie', 'Reven en zwaar weer', 'Reefing and heavy weather', [C103, C104, C114, C106], [
    ['Zeilvoering per windkracht', 'Sail plan per wind strength'],
    ['Rolfok en reven', 'Roller furling and reefing'],
    ['Bijliggen: waarom en hoe', 'Heaving to: why and how'],
    ['Boot en crew klaarmaken voor zwaar weer', 'Preparing boat and crew for heavy weather'],
    ['Grootzeil, zeilpunt, wanneer reven', 'Mainsail, sail area, when to reef', '114'],
  ], '103: 14–16 · 104: 21 · 114: 16–18, 32'),
  b('T12', G, 'theorie', 'Ankeren', 'Anchoring', [C103, C104, C114, C106], [
    ['Ankertypes en keuze', 'Anchor types and choice'],
    ['Ankerlengte en plek kiezen', 'Scope and choosing a spot'],
    ['Meervoudig ankeren benoemen: fore-and-aft, forked, Bahamian, Med-moor', 'Multiple anchors: fore-and-aft, forked, Bahamian, Med-moor'],
    ['Raften', 'Rafting up'],
  ], '103: 25 · 104: 18, 19 · 114: 25, 27'),
  // Kort uitleggen (groep)
  b('K1', G, 'kort', 'Op reis', 'Cruising', [C104, C106], [
    ['Kleding en spullen, proviand', 'Clothing and gear, provisioning'],
    ['Zeeziekte', 'Seasickness'],
    ['Gereedschap en reserveonderdelen', 'Tools and spares'],
    ['Inklaren', 'Clearing in'],
    ['Etiquette', 'Etiquette'],
  ], '104: 1–3, 5, 6, 22'),
  b('K2', G, 'kort', 'Regels en verantwoordelijkheid', 'Rules and responsibility', [C101, C103], [
    ['Float plan', 'Float plan'],
    ['Ongeval melden', 'Reporting an accident'],
    ['Alcoholgrens', 'Alcohol limit'],
    ['Taken van schipper en crew', 'Duties of skipper and crew'],
  ], '101: 18–20 · 103: 17'),
  b('K3', G, 'kort', 'Losse dingen', 'Odds and ends', [C101, C103, C104, C114, C106], [
    ['Zeilbegrippen', 'Sailing terms'],
    ['Kompas en magnetische invloed', 'Compass and magnetic interference'],
    ['Duikvlag en Alpha-vlag', 'Dive flag and Alpha flag'],
    ['Navigatielichten testen bij donker', 'Testing navigation lights at dusk'],
    ['Steiger met groot getijverschil', 'Docking with a large tidal range'],
    ['Bijboot slepen en hijsen', 'Towing and hoisting the dinghy'],
    ['Reddingsvest aantrekken in het water, veilig tanken (één zin)', 'Putting on a life jacket in the water, safe fuelling (one sentence)'],
    ['AIS en dieptemeter', 'AIS and depth sounder', 'star'],
  ], '101: 3 · 103: 7, 9, 24, 31, 33 · 104: 17, 20 · 114: 24'),
  // Praktijk (per student)
  b('P1', S, 'praktijk', 'Manoeuvreren op de motor', 'Manoeuvring under power', [C101, C103, C104, C114, C106], [
    ['Vooruit en achteruit', 'Ahead and astern'],
    ['Draaien op de plaats', 'Turning in her own length'],
    ['Rondjes door het mooringveld', 'Laps through the mooring field'],
    ['Stoppen bij een boei', 'Stopping at a buoy'],
    ['Schroefeffect, 180° draaien in een krappe ruimte', 'Prop walk, 180° turn in a tight space', '104'],
    ['Draaicirkels met drie motorstanden, 5 bootlengtes recht achteruit, stoppen bij een boei uit drie richtingen', 'Turning circles with three engine settings, 5 boat lengths straight astern, stopping at a buoy from three directions', '114'],
    ['Rechte koers en krappe ruimte met wind en stroom', 'Straight course and tight spaces with wind and current', 'star'],
  ], '104: 39, 40 · 114: 40–43, 45'),
  b('P2', S, 'praktijk', 'Zeilen', 'Sailing', [C101, C103, C114], [
    ['Hijsen', 'Hoisting'],
    ['Lier veilig gebruiken', 'Using a winch safely'],
    ['Alle koersen (in één keer, van aan de wind tot voor de wind)', 'All points of sail (close-hauled to a run in one go)'],
    ['Oploeven en afvallen', 'Heading up and bearing away'],
    ['Loskomen als je in de wind ligt', 'Getting out of irons'],
    ['Strijken en opdoeken', 'Dropping and flaking'],
  ], '101: 24–32, 37 · 103: 42–44, 50 · 114: 51, 53'),
  b('P3', S, 'praktijk', 'Mooring ball', 'Mooring ball', [C101, C103, C114], [
    ['Oppikken', 'Picking up'],
    ['Loslaten en wegvaren', 'Dropping and leaving'],
    ['Als schipper, met briefing van de crew', 'As skipper, briefing the crew', '104'],
    ['Hanenpoot', 'Bridle', '114'],
    ['Oppikken en loslaten onder zeil', 'Picking up and dropping under sail', 'star'],
  ], '101: 23, 38 · 103: 39 · 114: 26, 44, 47'),
  b('P4', S, 'praktijk', 'Overstag en gijpen', 'Tacking and gybing', [C101, C103, C104, C114, C106], [
    ['Overstag', 'Tacking'],
    ['Gijpen', 'Gybing'],
    ["Commando's en taken van de crew", 'Commands and crew duties'],
    ['Alle trimmiddelen, traveller, preventer, zeil laten killen en weer optrekken', 'All sail controls, traveller, preventer, luffing and powering up again', '104'],
    ['Fok gebruiken tegen opdraaien bij overstag', 'Backing the jib so the tack goes through', '114'],
  ], '101: 33–35 · 103: 45, 48 · 104: 45, 46 · 114: 15, 49, 50, 52, 54, 55'),
  b('P5', S, 'praktijk', 'Reven en bijliggen', 'Reefing and heaving to', [C103, C104, C114, C106], [
    ['Reven', 'Reefing'],
    ['Uitreven', 'Shaking out a reef'],
    ['Bijliggen en weer verder', 'Heaving to and getting going again'],
  ], '103: 46, 47 · 104: 47 · 114: 52, 56'),
  b('P6', S, 'praktijk', 'Ankeren', 'Anchoring', [C103, C104, C114, C106], [
    ['Anker zetten met de juiste ankerlengte', 'Setting the anchor with the right scope'],
    ['Handsignalen, veilig met ketting en ankerlier', 'Hand signals, safe with chain and windlass'],
    ['Hanenpoot of snubber', 'Bridle or snubber'],
    ['Anker op en wegvaren', 'Weighing anchor and leaving'],
    ['Op een vooraf gekozen plek', 'On a spot chosen beforehand', 'star'],
    ['Onder zeil', 'Under sail', 'star'],
  ], '103: 40 · 104: 43 · 114: 47'),
  b('P7', S, 'praktijk', 'Navigeren', 'Navigation', [C103, C104, C106], [
    ['Haven in en uit op zicht', 'In and out of harbour by eye'],
    ['Tochtplan met koersen, afstanden en waypoints', 'Passage plan with courses, distances and waypoints', '104'],
    ['Log bijhouden, gegist bestek, ETA', 'Keeping the log, dead reckoning, ETA', '104'],
    ['Kruispeiling', 'Cross bearing fix', '104'],
    ['GPS en plotter', 'GPS and plotter', '104'],
    ['Weerbericht vergelijken met wat je ziet', 'Comparing the forecast with what you see', '104'],
    ['Onbekende ankerplaats binnenlopen', 'Entering an unfamiliar anchorage', '104'],
    ['Pilotage met geleidelijnen, clearing lines, transits en dieptes', 'Pilotage with leading lines, clearing lines, transits and depths', 'star'],
  ], '103: 35 · 104: 49, 51, 52, 54, 55'),
  b('P8', S, 'praktijk', 'Steiger', 'Dock', [C101, C103, C104, C114, C106], [
    ['Aanleggen', 'Coming alongside'],
    ['Vastleggen met lijnen en stootwillen', 'Lines and fenders'],
    ['Met springs weg', 'Leaving on springs'],
    ['Walstroom los en vast', 'Shore power on and off'],
    ['Middellandse Zee: eventueel Med-moor', 'Mediterranean: Med-moor if possible'],
    ['Geen steiger de hele week: mooring ball als vervanging', 'No dock all week: mooring ball instead'],
  ], '101: 39 · 103: 38, 51 · 104: 37, 38, 41 · 114: 37–39'),
  b('P9', S, 'praktijk', 'Man over boord', 'Crew overboard', [C101, C103, C104, C114, C106], [
    ['Onder zeil', 'Under sail'],
    ['Op de motor', 'Under power'],
    ['Terug aan boord halen', 'Getting them back on board'],
    ['Twee methodes, vanuit aan de wind en vanuit ruime wind', 'Two methods, from close-hauled and from a reach', '104'],
    ['Als schipper leiden', 'Leading it as skipper', '104'],
  ], '101: 36 · 103: 41, 49 · 104: 42, 48 · 114: 46, 57'),
  b('P10', S, 'praktijk', 'Nacht- of zonsopgangtocht', 'Night or dawn passage', [C106, 'plus'], [
    ['Nachtpilotage plannen', 'Planning night pilotage', 'star'],
    ['Uitkijk houden, markeringen herkennen', 'Keeping a lookout, recognising marks', 'star'],
    ['Voor 106 verplicht: nachttocht', 'Required for 106: night passage'],
  ]),
  // Doorlopend (per student, de hele week)
  b('D1', S, 'doorlopend', 'Kompaskoers', 'Compass course', [C103, C104, C114, C106], [
    ['Op de motor en onder zeil', 'Under power and under sail'],
  ], '103: 36 · 104: 44 · 114: 48'),
  b('D2', S, 'doorlopend', 'Knopen', 'Knots', [C101, C103, C104, C106], [
    ['Achtknoop, platte knoop, mastworp, rondtorn met twee halve steken, kikkersteek, paalsteek', 'Figure eight, reef knot, clove hitch, round turn and two half hitches, cleat hitch, bowline'],
    ['Schootsteek, rolsteek, truckersknoop', "Sheet bend, rolling hitch, trucker's hitch", '104'],
    ['Touwwerk: opschieten, beleggen op klampen en bolders, landvasten', 'Ropework: coiling, cleating and bollards, mooring lines', 'star'],
  ], '101: 40 · 103: 52 · 104'),
  b('D3', S, 'doorlopend', 'Schipperschap', 'Skippering', [C104, C106], [
    ['PTVU bij elke manoeuvre', 'Plan, prepare, brief, execute at every manoeuvre'],
    ['Crew briefen en leiden', 'Briefing and leading the crew'],
    ['Command en volledige verantwoordelijkheid', 'Command and full responsibility'],
    ['Beslissen: gaan, wachten, uitwijken', 'Deciding: go, wait, divert'],
    ['Rollen wisselen: schipper, navigator, crew', 'Swapping roles: skipper, navigator, crew'],
  ], '104: 28'),
  // Examens (per student): een examen dat gedaan is, is gehaald; een naam aantikken = nog niet.
  ...CERT_COURSES.map((c) => b(`examen-${c}`, S, 'examen', `Examen ${c}`, `Exam ${c}`, [c], [])),
]

export function lessonBlock(id: string): LessonBlock | undefined {
  return LESSON_BLOCKS.find((x) => x.id === id)
}

/** Monohull: 114 kan daar niet. Zonder soort boot gaan we uit van een catamaran (de meeste lesweken). */
export function isMonohull(trip: Pick<Trip, 'boatKind'>): boolean {
  return trip.boatKind === 'eenromp'
}

/** De cursussen van een student op deze trip; op een monohull zonder 114. */
export function coursesOf(p: Pick<Participant, 'courses'>, trip: Pick<Trip, 'boatKind'>): LessonCourse[] {
  const list = (p.courses ?? []).filter((c): c is LessonCourse => LESSON_COURSES.includes(c as LessonCourse))
  return isMonohull(trip) ? list.filter((c) => c !== '114') : list
}

/** Een student in de lesweek: voornaam, id en de cursussen op deze trip. */
export interface LessonStudent {
  id: string
  name: string
  courses: LessonCourse[]
}

/** Welke blokken in deze week voorkomen: alles wat bij een cursus van een student hoort; zonder cursussen alle blokken van 101 t/m 114. */
export function blocksForWeek(students: readonly LessonStudent[], trip: Pick<Trip, 'boatKind'>): LessonBlock[] {
  const all = new Set(students.flatMap((s) => s.courses).filter((c) => !(isMonohull(trip) && c === '114')))
  const chosen = all.size > 0 ? all : new Set<LessonCourse>(isMonohull(trip) ? ['101', '103', '104'] : ['101', '103', '104', '114'])
  return LESSON_BLOCKS.filter((x) => x.courses.some((c) => chosen.has(c)))
}

/** De studenten voor wie een blok geldt. */
export function studentsFor(block: LessonBlock, students: readonly LessonStudent[]): LessonStudent[] {
  return students.filter((s) => s.courses.some((c) => block.courses.includes(c)))
}

/** Welke labels in deze week van toepassing zijn (alleen die elementen staan in beeld). */
export function activeLabels(students: readonly LessonStudent[], trip: Pick<Trip, 'boatKind'>): Set<ElementLabel> {
  const courses = new Set(students.flatMap((s) => s.courses))
  const labels = new Set<ElementLabel>()
  if (courses.has('104') || courses.has('114') || courses.has('106')) labels.add('104')
  if (courses.has('114')) labels.add('114')
  if (courses.has('plus') || courses.has('106')) labels.add('star')
  if (isMonohull(trip)) labels.add('mono')
  return labels
}

export function elementsFor(block: LessonBlock, labels: ReadonlySet<ElementLabel>): LessonElement[] {
  return block.elements.filter((e) => !e.label || labels.has(e.label))
}

/** Gedaan voor deze student? Een groepsblok: gedaan is gedaan. Een studentblok: gedaan en de student staat niet bij "nog niet". */
export function doneFor(trip: Pick<Trip, 'lessonChecks'>, blockId: string, studentId?: string): boolean {
  const check = trip.lessonChecks?.[blockId]
  if (!check) return false
  return !studentId || !(check.open ?? []).includes(studentId)
}

/** Per cursus: welke blokken nog openstaan, met de namen van de studenten voor wie (bij een studentblok). */
export interface CourseOpen {
  course: LessonCourse
  total: number
  open: { block: LessonBlock; names: string[] }[]
}

export function openPerCourse(trip: Pick<Trip, 'lessonChecks' | 'boatKind'>, students: readonly LessonStudent[]): CourseOpen[] {
  const present = CERT_COURSES.filter((c) => students.some((s) => s.courses.includes(c)))
  return present.map((course) => {
    const blocks = LESSON_BLOCKS.filter((x) => x.courses.includes(course))
    const withCourse = students.filter((s) => s.courses.includes(course))
    const open = blocks
      .map((block) => {
        if (block.kind === 'groep') return doneFor(trip, block.id) ? null : { block, names: [] }
        const notYet = withCourse.filter((s) => !doneFor(trip, block.id, s.id))
        return notYet.length === 0 ? null : { block, names: notYet.length === withCourse.length ? [] : notYet.map((s) => s.name) }
      })
      .filter((x): x is { block: LessonBlock; names: string[] } => x !== null)
    return { course, total: blocks.length, open }
  })
}

/** Een blok aan- of uitvinken voor de hele groep. Uitvinken haalt ook "nog niet" weg. */
export function toggledBlock(checks: Trip['lessonChecks'], blockId: string, today: string): NonNullable<Trip['lessonChecks']> {
  const next = { ...(checks ?? {}) }
  if (next[blockId]) delete next[blockId]
  else next[blockId] = { at: today }
  return next
}

/**
 * Eén student wisselen tussen goed en nog niet. Staat het blok nog niet aan, dan wordt het gedaan voor iedereen behalve
 * deze student (de tik op een naam is altijd "deze nog niet" of "deze nu wel").
 */
export function toggledStudent(checks: Trip['lessonChecks'], blockId: string, studentId: string, today: string): NonNullable<Trip['lessonChecks']> {
  const next = { ...(checks ?? {}) }
  const current = next[blockId]
  if (!current) {
    next[blockId] = { at: today, open: [studentId] }
    return next
  }
  const open = new Set(current.open ?? [])
  if (open.has(studentId)) open.delete(studentId)
  else open.add(studentId)
  const { open: _o, ...rest } = current
  void _o
  next[blockId] = open.size > 0 ? { ...rest, open: [...open] } : rest
  return next
}

function liveTrip(store: Tx, tripId: string): Trip {
  const trip = store.get('trips.json.enc').find((x) => x.id === tripId && x.deletedAt === null)
  if (!trip) throw new Error('Trip bestaat niet')
  return trip
}

/** Een blok aan- of uitvinken op de trip (voor de hele groep). */
export async function toggleLessonBlock(store: Tx, tripId: string, blockId: string): Promise<void> {
  if (!lessonBlock(blockId)) throw new Error('Onbekend blok')
  const trip = liveTrip(store, tripId)
  await store.put('trips.json.enc', { ...trip, lessonChecks: toggledBlock(trip.lessonChecks, blockId, todayIso()), updatedAt: store.now })
}

/** Eén student bij een studentblok wisselen tussen goed en nog niet. */
export async function toggleLessonStudent(store: Tx, tripId: string, blockId: string, studentId: string): Promise<void> {
  const block = lessonBlock(blockId)
  if (!block || block.kind !== 'student') throw new Error('Geen studentblok')
  const trip = liveTrip(store, tripId)
  if (!(trip.participants ?? []).some((p) => p.id === studentId)) throw new Error('Student bestaat niet')
  await store.put('trips.json.enc', { ...trip, lessonChecks: toggledStudent(trip.lessonChecks, blockId, studentId, todayIso()), updatedAt: store.now })
}

/** De cursussen van een student in de lesweek kiezen (leeg = nog niet gekozen). */
export async function setLessonCourses(store: Tx, tripId: string, participantId: string, courses: readonly LessonCourse[]): Promise<void> {
  const trip = liveTrip(store, tripId)
  const current = (trip.participants ?? []).find((p) => p.id === participantId)
  if (!current) throw new Error('Student bestaat niet')
  const list = LESSON_COURSES.filter((c) => courses.includes(c))
  const { courses: _c, ...rest } = current
  void _c
  const next: Participant = list.length > 0 ? { ...rest, courses: list } : rest
  await store.put('trips.json.enc', { ...trip, participants: (trip.participants ?? []).map((p) => (p.id === participantId ? next : p)), updatedAt: store.now })
}
