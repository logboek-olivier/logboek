// Schemaversie van de databestanden in logboek-data. Wijzigingen zijn altijd achterwaarts compatibel;
// een hogere versie alleen met migratie en een test die data van de vorige versie inleest (zie CLAUDE.md, Werkwijze).
// Ziet de app een hogere versie dan hij kent, dan schrijft hij niets naar GitHub en vraagt hij om een update.

export const SCHEMA_VERSION = 1


export class NewerSchemaError extends Error {
  constructor(readonly found: number) {
    super('Werk de app bij')
    this.name = 'NewerSchemaError'
  }
}
