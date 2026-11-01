import type { Store } from '../storage/store'
import { commit, run, type Undo } from './commit'
import type { Tx } from './tx'

// Een opdracht maken van een modelfunctie die op een transactie werkt: de opdracht krijgt de Store, voert de functie uit
// in een transactie en legt die in één keer vast (src/domain/commit.ts).

type Args<F> = F extends (tx: Tx, ...args: infer A) => unknown ? A : never
type Result<F> = F extends (tx: Tx, ...args: never[]) => infer R ? Awaited<R> : never

/** Een opdracht zonder uitkomst: geeft ongedaan maken terug. */
export function opdracht<F extends (tx: Tx, ...args: never[]) => unknown>(name: string, fn: F): (store: Store, ...args: Args<F>) => Promise<Undo> {
  return (store, ...args) => run(store, name, (tx) => (fn as (tx: Tx, ...rest: Args<F>) => unknown)(tx, ...args))
}

/** Een opdracht met een uitkomst (bijvoorbeeld het nieuwe record): geeft de uitkomst en ongedaan maken terug. */
export function opdrachtMet<F extends (tx: Tx, ...args: never[]) => unknown>(name: string, fn: F): (store: Store, ...args: Args<F>) => Promise<{ result: Result<F>; undo: Undo }> {
  return async (store, ...args) => {
    const { result, undo } = await commit(store, name, (tx) => (fn as (tx: Tx, ...rest: Args<F>) => Promise<Result<F>>)(tx, ...args))
    return { result, undo }
  }
}
