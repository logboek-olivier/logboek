// Schemaversie van de databestanden in logboek-data. Wijzigingen zijn altijd achterwaarts compatibel;
// een hogere versie alleen met migratie en een test die data van de vorige versie inleest (zie CLAUDE.md, Werkwijze).
// Ziet de app een hogere versie dan hij kent, dan schrijft hij niets naar GitHub en vraagt hij om een update.

// 2: één waarheid voor geld (src/domain/geldmodel.ts): het salaris is een transactie met een status, contant en gestort
// bestaan niet meer. Versie 1 blijft leesbaar; "Geld omzetten" (na één tik, src/domain/geld-omzetten.ts) zet het geld om.
// Een build van vóór de schrijfversie (die alleen de schemaversie kent) schrijft daardoor niet meer over deze bestanden.
export const SCHEMA_VERSION = 2

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
export const WRITER_VERSION = 6

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
