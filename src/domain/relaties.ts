import type { CollectionPath, Participant, SyncRecord } from '../model/types'

// "Relaties veranderen niet, tenzij bedoeld" (docs/FUNDERING.md). Een koppeling is altijd een id: een dag, geld, een
// planning of een declaratie hangt aan een periode via tripId, een student aan een trip via weekId, een deelnemer aan
// een trip doordat hij in de lijst van die trip staat. Nooit een positie of volgorde.
//
// Opdrachten die vanzelf draaien (migraties, opruimen, koersen) en imports mogen geen bestaande koppeling veranderen:
// `commit` (src/domain/commit.ts) rekent ze eerst uit op de transactie (een kopie; er is dan nog niets geschreven) en
// schrijft niets als een koppeling verandert. Nieuwe records en records die weggaan tellen niet: die maakt of ruimt de
// opdracht zelf op (een import vervangt zijn dagen door dagen met een vast id).

/**
 * Opdrachten die vanzelf draaien: geen koppeling anders en ook geen nieuwe overtreding om na te kijken. Opruimen na 30
 * dagen (geschiedenisOpruimen) staat er niet bij: dat haalt regels uit de geschiedenis, waardoor een regel die op de
 * geschiedenis leunt (welke datums Olivier zelf koos) anders kan uitvallen; opruimen moet altijd door (regel 14). Het
 * mag wel geen koppeling veranderen (zie KEEPS_RELATIONS).
 */
export const AUTOMATIC: ReadonlySet<string> = new Set(['koersenVastleggen', 'vasteLastenBoeken', 'periodemodelMigreren', 'studentenArchiveren', 'nieuwLogboekInrichten'])

/**
 * Opdrachten die nooit een bestaande koppeling mogen veranderen: de automatische, opruimen, en de imports (die mogen wel
 * iets nieuws laten nakijken, zoals een geïmporteerde dag buiten de eigen datums van zijn trip).
 */
// De planningsimport staat er niet bij: een werkregel die een periode aan land splitst, neemt het geld van die dagen
// bewust mee (dezelfde periode in twee stukken); hij heeft zijn eigen voorbeeld vooraf.
export const KEEPS_RELATIONS: ReadonlySet<string> = new Set([...AUTOMATIC, 'geschiedenisOpruimen', 'mijlenImporteren', 'standenImporteren', 'backupTerugzetten'])

const LINK_FIELD: Partial<Record<CollectionPath, 'tripId' | 'weekId'>> = {
  'legs.json.enc': 'tripId',
  'transactions.json.enc': 'tripId',
  'plans.json.enc': 'tripId',
  'claims.json.enc': 'tripId',
  'students.json.enc': 'weekId',
}

export interface RelationChange {
  path: CollectionPath
  id: string
  field: 'tripId' | 'weekId' | 'participants'
}

const participantIds = (record: SyncRecord | null): string =>
  (((record as unknown as { participants?: Participant[] } | null)?.participants ?? []) as Participant[])
    .map((p) => p.id)
    .sort()
    .join(',')

/** De koppelingen die een opdracht veranderde aan records die er al waren en blijven (alleen paden en id's). */
export function relationChanges(written: ReadonlyArray<{ path: CollectionPath; before: SyncRecord | null; after: SyncRecord }>): RelationChange[] {
  const out: RelationChange[] = []
  for (const { path, before, after } of written) {
    if (!before || before.deletedAt !== null || after.deletedAt !== null) continue
    const field = LINK_FIELD[path]
    if (field) {
      const a = (before as unknown as Record<string, unknown>)[field] ?? null
      const b = (after as unknown as Record<string, unknown>)[field] ?? null
      if (a !== b) out.push({ path, id: after.id, field })
    } else if (path === 'trips.json.enc' && participantIds(before) !== participantIds(after)) {
      out.push({ path, id: after.id, field: 'participants' })
    }
  }
  return out
}

/** Een opdracht die vanzelf draait, wilde een koppeling veranderen; er is niets geschreven. */
export class RelationError extends Error {
  constructor(
    readonly changes: readonly RelationChange[],
    /** De opdracht (alleen de naam, nooit inhoud; regel 9). */
    readonly command: string,
  ) {
    super(`Relatie: ${changes.length}× ${[...new Set(changes.map((c) => `${c.path}.${c.field}`))].join(', ')} (${command})`)
    this.name = 'RelationError'
  }
}
