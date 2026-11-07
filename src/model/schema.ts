// Schemaversie van de databestanden in logboek-data. Wijzigingen zijn altijd achterwaarts compatibel;
// een hogere versie alleen met migratie en een test die data van de vorige versie inleest (zie CLAUDE.md, Werkwijze).
// Ziet de app een hogere versie dan hij kent, dan schrijft hij niets naar GitHub en vraagt hij om een update.

// 2: één waarheid voor geld (src/domain/geldmodel.ts): het salaris is een transactie met een status, contant en gestort
// bestaan niet meer. Versie 1 blijft leesbaar; "Geld omzetten" (na één tik, src/domain/geld-omzetten.ts) zet het geld om.
// Een build van vóór de schrijfversie (die alleen de schemaversie kent) schrijft daardoor niet meer over deze bestanden.
// 3: scenario's (scenarios.json.enc, Geld → Verwacht → Scenario): een nieuw databestand en recordtype. De bestanden van
// versie 2 blijven ongewijzigd leesbaar (er is niets om te zetten); een oudere build leest een bestand van versie 3 als
// "van een nieuwere versie" en schrijft niets.
// 4: de laatst gebruikte valuta per soort invoer in de instellingen (`lastCurrencies`), en het begindag- en koersgedrag
// van Mijn positie gelijk aan Geld. Bestanden van versie 3 blijven ongewijzigd leesbaar (niets om te zetten); een oudere
// build leest ze als "van een nieuwere versie".
// 5: het scenario als stappenplan (`version: 2`, start vanaf vandaag met een eigen startwaarde, blokken met salaris en
// fooi apart, een doel). Bestanden van versie 4 blijven ongewijzigd leesbaar (een ouder scenario wordt pas na een tik
// omgezet); een oudere build leest een bestand van versie 5 als "van een nieuwere versie".
// 6: de rol van een persoon op een trip (`role` bij een deelnemer: student, gast, crew, medezeiler, schipper, overig).
// Bestanden van versie 5 blijven ongewijzigd leesbaar (zonder rol volgt de rol uit de trip); een oudere build leest een
// bestand van versie 6 als "van een nieuwere versie".
// 7: trips per scenarioblok (`trips`, salaris en fooi per trip), een doel op verdiend, de verwachte fooi per trip
// (`expectedTip`) en per organisatie (`tipDefaults`). Bestanden van versie 6 blijven ongewijzigd leesbaar; een oudere
// build leest een bestand van versie 7 als "van een nieuwere versie".
// 8: de berichtengenerator: sjablonen (templates.json.enc, een nieuw databestand en recordtype), per trip de berichtvelden
// (`messageFields`) en wat verstuurd is (`messages`), en per organisatie de standaard (`messageDefaults`). Bestanden van
// versie 7 blijven ongewijzigd leesbaar; een oudere build leest een bestand van versie 8 als "van een nieuwere versie".
// 9: soorten declaratie: voorgeschoten voor iemand en een schuld aan iemand (`kind`, `person` op een declaratie). Bestanden
// van versie 8 blijven ongewijzigd leesbaar (zonder soort = declaratie); een oudere build leest een bestand van versie 9
// als "van een nieuwere versie".
export const SCHEMA_VERSION = 9

// Schrijfversie van deze build: elk databestand dat deze build schrijft, krijgt hem mee als `minWriterVersion` (in de
// versleutelde inhoud). Een build met een lagere schrijfversie leest zo'n bestand als "van een nieuwere versie": hij
// schrijft niets naar GitHub en toont "Werk de app bij". Omhoog wanneer een oudere build niet meer over de bestanden van
// deze build mag schrijven (bijvoorbeeld omdat hij velden of bestanden anders gebruikt), ook als het schema gelijk blijft.
// Builds van vóór de schrijfversie kennen het veld niet; daartegen beschermt alleen de schemaversie. Nooit verlagen, ook
// niet bij terugdraaien: de bestanden van de hogere versie blijven dan voor elke build "van een nieuwere versie".
// 2: het periodemodel (docs/PERIODEMODEL.md). Een build zonder (thuis, reis en vrij als periodes, de soort van een trip,
// geld aan een periode) schrijft niet meer over de bestanden van een build met het periodemodel.
// 3: de prullenbak (history.json.enc). Een oudere build zou het bestand van een verwijderd document na een dag van GitHub
// halen (nu na 30 dagen) en kent dagen en geld die naar een verwijderde periode wijzen niet.
// 4: organisaties in de instellingen (`organisation` is elk id uit Instellingen → Organisaties). Een oudere build kent
// alleen Sailing Virgins en Yacht Week en zou het salaris, de uitbetaling en de beginnummers van een eigen organisatie
// bij het opslaan weggooien.
// 5: start- en einddatum van een trip zijn gewone velden (CLAUDE.md, uitgangspunten 1, 2 en 5). Een oudere build rekent
// ze uit de dagen, verlengt of verkort trips vanzelf en zet koppelingen "terug"; dat mag niet meer over deze bestanden.
// 6: één waarheid voor geld. Een oudere build leest het salaris van de tocht en contant/gestort bij een fooi, telt een
// verwacht salaris als verdiend en zou de omzetting ongedaan maken; hij schrijft niet meer over deze bestanden.
// 7: standen van rekeningen hebben een geschiedenis (een stand per dag, id `stand:<rekening>:<jjjj-mm-dd>`). Een oudere
// build houdt één stand per maand bij en zou een beginsaldo eerder in de maand weigeren of een tweede stand op dezelfde
// dag maken; hij schrijft niet meer over deze bestanden.
// 8: scenario's (scenarios.json.enc) en het actieve scenario in de instellingen. Een oudere build kent het bestand niet
// en zou het actieve scenario bij het opslaan van de instellingen niet bewaren.
// 9: bezittingen (een rekening van soort `bezit`: huis, boot, auto) en de aannames van een scenario. Een oudere build zou
// een bezitting bij het opslaan een andere soort geven en de aannames weggooien.
// 10: de laatst gebruikte valuta per soort invoer (`lastCurrencies` in het record `laatst:<apparaat>`). Een oudere build
// zou dat veld bij het opslaan van "laatst gebruikt" weggooien en alles weer in één valuta zetten.
// 11: het scenario als stappenplan. Een oudere build leest de blokken van een omgezet scenario als weken ná de planning,
// telt de planning dan dubbel en zou salaris en fooi per blok, de startwaarde en het doel bij het opslaan weggooien.
// 12: de rol van een persoon op een trip. Een oudere build bouwt de deelnemers bij het opslaan van een trip opnieuw op
// en zou de rol weggooien (en van een medezeiler op een lestrip weer een student maken).
// 13: trips per scenarioblok, een doel op verdiend en de verwachte fooi per trip en per organisatie. Een oudere build
// zou een blok met trips als bedragen per week opslaan (de trips kwijt), het doel als netto waarde lezen en de verwachte
// fooi bij het opslaan van een trip of de instellingen weggooien.
// 14: de berichtengenerator. Een oudere build kent templates.json.enc niet en zou bij het opslaan van een trip de
// berichtvelden en "verstuurd" weggooien, en bij het opslaan van de instellingen de standaard per organisatie.
// 15: soorten declaratie. Een oudere build zou een schuld als declaratie lezen (te ontvangen in plaats van te betalen) en
// bij het bewerken de soort en de persoon weggooien, en de uitgave van een schuld als declaratie boeken.
export const WRITER_VERSION = 15

let writer = WRITER_VERSION

/** De schrijfversie van deze build (in tests in te stellen met writerVersionForTests). */
export function writerVersion(): number {
  return writer
}

/** Alleen voor tests: alsof deze build een andere schrijfversie heeft (een oudere of nieuwere build als tweede schrijver). */
export function writerVersionForTests(version: number = WRITER_VERSION): void {
  writer = version
}

export class NewerSchemaError extends Error {
  constructor(readonly found: number) {
    super('Werk de app bij')
    this.name = 'NewerSchemaError'
  }
}

/** Een bestand geschreven door een build met een hogere schrijfversie: lezen en schrijven gaan zoals bij een nieuwere schemaversie. */
export class NewerWriterError extends NewerSchemaError {
  constructor(found: number) {
    super(found)
    this.name = 'NewerWriterError'
  }
}
