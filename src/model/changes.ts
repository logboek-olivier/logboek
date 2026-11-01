import type { Tx } from '../domain/tx'
import type { CollectionPath, Collections, SyncRecord } from './types'

// Een groep wijzigingen over meerdere bestanden in de transactie van een opdracht. Ongedaan maken regelt de opdracht zelf
// (src/domain/commit.ts): de toestand vooraf van elk record komt terug.

export type { Undo } from '../domain/commit'

export type Change = { [P in CollectionPath]: { path: P; before: Collections[P] | null; after: Collections[P] } }[CollectionPath]

/** Wijzigingen in de transactie zetten, per bestand in één keer. */
export async function applyChanges(tx: Tx, changes: readonly Change[]): Promise<void> {
  const byPath = new Map<CollectionPath, SyncRecord[]>()
  for (const c of changes) byPath.set(c.path, [...(byPath.get(c.path) ?? []), c.after])
  for (const [path, records] of byPath) await tx.putMany(path, records as Collections[typeof path][])
}
