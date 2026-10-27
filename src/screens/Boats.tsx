import { Check, SkipForward } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { formatNumber } from '../format'
import { t } from '../i18n'
import { boatList, confirmBoats, skipBoats, type BoatEntry, type BoatInput } from '../model/boats'
import { parseAmount } from '../model/money'
import { type BoatKind } from '../model/types'
import { feetToMetres } from '../model/weeks'
import type { Store } from '../storage/store'

// Bootgegevens controleren: per boot naam, model, soort en lengte, met het voorstel uit het model zichtbaar
// ingevuld. Eén tik bevestigt alles; overslaan mag (na een import). Onder Meer → Boten staat dezelfde lijst.

interface Row {
  key: string
  name: string
  model: string
  length: string
  kind?: BoatKind
  /** De lengte in het veld is het voorstel uit het model, nog niet bevestigd. */
  lengthSuggested: boolean
  trips: number
}

function initialRow(b: BoatEntry): Row {
  const suggestedKind = b.kind ?? b.suggestedKind ?? (b.model ? 'eenromp' : undefined)
  return {
    key: b.key,
    name: b.name,
    model: b.model,
    length: b.lengthFt ? formatNumber(b.lengthFt) : b.suggestedLengthFt ? formatNumber(b.suggestedLengthFt) : '',
    kind: suggestedKind,
    lengthSuggested: !b.lengthFt && !!b.suggestedLengthFt,
    trips: b.tripIds.length,
  }
}

const SHOWN_KINDS: BoatKind[] = ['eenromp', 'catamaran']

export function BoatCheck({
  store,
  boats,
  notify,
  onDone,
  canSkip,
}: {
  store: Store
  boats: BoatEntry[]
  notify: Notify
  onDone: () => void
  canSkip: boolean
}) {
  // Lijst en regels staan vast bij openen: bevestigen verandert de bootlijst (en de sleutels) tijdens het opslaan.
  const [frozen] = useState(boats)
  const [rows, setRows] = useState<Row[]>(() => boats.map(initialRow))
  const [busy, setBusy] = useState(false)
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const inputs: BoatInput[] = rows.map((r) => ({ key: r.key, name: r.name, model: r.model, lengthFt: parseAmount(r.length), kind: r.kind }))
      await confirmBoats(store, frozen, inputs)
      notify(t('boats.saved', { n: rows.length }))
      onDone()
    } finally {
      setBusy(false)
    }
  }

  async function skip() {
    await skipBoats(store, frozen)
    onDone()
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <p className="muted">{t('boats.intro')}</p>
      <ul className="boat-list">
        {rows.map((r, i) => {
          const ft = parseAmount(r.length)
          const kinds = r.kind && !SHOWN_KINDS.includes(r.kind) ? [...SHOWN_KINDS, r.kind] : SHOWN_KINDS
          return (
            <li key={r.key} className="card boat-card">
              <div className="two">
                <label>
                  {t('boat.name')}
                  <input type="text" autoComplete="off" maxLength={120} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
                </label>
                <label>
                  {t('boat.model')}
                  <input type="text" autoComplete="off" maxLength={120} value={r.model} onChange={(e) => set(i, { model: e.target.value })} />
                </label>
              </div>
              <div className="two">
                <label>
                  {t('boat.length')}
                  <input inputMode="decimal" autoComplete="off" value={r.length} onChange={(e) => set(i, { length: e.target.value, lengthSuggested: false })} />
                </label>
                <span className="muted small boat-length-hint">
                  {[ft !== null ? t('boat.metres', { m: formatNumber(feetToMetres(ft)) }) : '', r.lengthSuggested ? t('boats.lengthSuggested') : ''].filter(Boolean).join(' · ')}
                </span>
              </div>
              <div className="segments small" role="radiogroup" aria-label={`${t('boat.kind')}: ${r.name || r.model}`}>
                {kinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={r.kind === k}
                    className={`segment${r.kind === k ? ' active' : ''}`}
                    onClick={() => set(i, { kind: r.kind === k ? undefined : k })}
                  >
                    {t(`boatKind.${k}`)}
                  </button>
                ))}
              </div>
              <span className="muted small">{t('gaps.boatTrips', { n: r.trips })}</span>
            </li>
          )
        })}
      </ul>
      <div className="sheet-actions">
        <button className="btn primary" type="submit" disabled={busy}>
          <Icon icon={Check} />
          {t(canSkip ? 'boats.confirm' : 'common.save')}
        </button>
        {canSkip && (
          <button className="btn" type="button" onClick={() => void skip()} disabled={busy}>
            <Icon icon={SkipForward} />
            {t('gaps.skip')}
          </button>
        )}
      </div>
    </form>
  )
}

/** Meer → Boten: alle boten uit de trips, te bewerken in één keer. */
export function Boats({ store, notify }: { store: Store; notify: Notify }) {
  const boats = boatList(useCollection(store, 'trips.json.enc'), useCollection(store, 'legs.json.enc'))
  const [version, setVersion] = useState(0)
  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('boats.screen')}</h1>
      </header>
      {boats.length === 0 ? (
        <p className="muted">{t('boats.empty')}</p>
      ) : (
        <BoatCheck key={version} store={store} boats={boats} notify={notify} canSkip={false} onDone={() => setVersion(version + 1)} />
      )}
    </section>
  )
}
