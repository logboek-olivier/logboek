// Eén schrijver tegelijk per logboek, over alle vensters van de app heen (het Chrome-tabblad en de geïnstalleerde app
// delen dezelfde opslag). Met de Web Locks API van de browser; waar die ontbreekt (tests) een wachtrij binnen dit venster.
// Een slot wordt vrijgegeven zodra het venster sluit, dus een gesloten venster houdt niemand tegen.
//
// Twee sloten, nooit genest met dezelfde naam (dat zou vastlopen):
// - 'lokaal': lezen, samenvoegen en schrijven van één bestand in IndexedDB (kort);
// - 'sync': een hele syncronde naar GitHub (één venster tegelijk; een ander venster wacht en synct daarna).

export type LockName = 'lokaal' | 'sync'

const queues = new Map<string, Promise<unknown>>()

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

export function exclusive<T>(dbName: string, lock: LockName, run: () => Promise<T>): Promise<T> {
  const name = `logboek-${lock}:${dbName}`
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks
  if (locks) return locks.request(name, run)
  const previous = queues.get(name) ?? Promise.resolve()
  const next = previous.then(run, run)
  queues.set(
    name,
    next.catch(() => undefined),
  )
  return next
}
