// Schemaversie van de databestanden in logboek-data. Wijzigingen zijn altijd achterwaarts compatibel;
// een hogere versie alleen met migratie en een test die data van de vorige versie inleest (zie CLAUDE.md, Werkwijze).
// Ziet de app een hogere versie dan hij kent, dan schrijft hij niets naar GitHub en vraagt hij om een update.

export const SCHEMA_VERSION = 1

// Schrijfversie van deze build: elk databestand dat deze build schrijft, krijgt hem mee als `minWriterVersion` (in de
// versleutelde inhoud). Een build met een lagere schrijfversie leest zo'n bestand als "van een nieuwere versie": hij
// schrijft niets naar GitHub en toont "Werk de app bij". Omhoog wanneer een oudere build niet meer over de bestanden van
// deze build mag schrijven (bijvoorbeeld omdat hij velden of bestanden anders gebruikt), ook als het schema gelijk blijft.
// Builds van vóór de schrijfversie kennen het veld niet; daartegen beschermt alleen de schemaversie.
export const WRITER_VERSION = 1

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
