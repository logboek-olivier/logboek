import { commit } from '../../src/domain/commit'
import type { Tx } from '../../src/domain/tx'
import type { CollectionPath, Collections } from '../../src/model/types'
import type { Store } from '../../src/storage/store'

// Tests schrijven, net als de app, alleen via een opdracht (src/domain/commit.ts): zo test elke test ook de domeinlaag.

/** Testdata klaarzetten: één record. */
export async function put<P extends CollectionPath>(store: Store, path: P, record: Collections[P]): Promise<void> {
  await commit(store, 'test', (tx) => tx.put(path, record))
}

/** Testdata klaarzetten: meerdere records in één keer. */
export async function putMany<P extends CollectionPath>(store: Store, path: P, records: readonly Collections[P][]): Promise<void> {
  await commit(store, 'test', (tx) => tx.putMany(path, records))
}

/** Een record verwijderen (tombstone). */
export async function remove<P extends CollectionPath>(store: Store, path: P, id: string): Promise<void> {
  await commit(store, 'test', (tx) => tx.remove(path, id))
}

type Args<F> = F extends (tx: Tx, ...args: infer A) => unknown ? A : never

/** Een modelfunctie in één transactie uitvoeren en haar uitkomst teruggeven. */
export async function inTx<F extends (tx: Tx, ...args: never[]) => unknown>(store: Store, fn: F, ...args: Args<F>): Promise<Awaited<ReturnType<F>>> {
  const { result } = await commit(store, 'test', (tx) => (fn as (tx: Tx, ...rest: Args<F>) => Promise<Awaited<ReturnType<F>>>)(tx, ...args))
  return result
}
