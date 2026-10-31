import { Check, ChevronRight, Merge, SkipForward, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { useCollection } from '../components/useCollection'
import { formatDateRange, formatNm, formatNumber } from '../format'
import { useCounters } from '../components/useCounters'
import { ViewRows } from '../components/Views'
import { nameWithCounter } from '../model/counters'
import { active, round1, totalNm } from '../model/derive'
import { t } from '../i18n'
import { boatList, type BoatEntry, type BoatInput } from '../model/boats'
import { type BoatKind } from '../model/types'
import { feetToMetres, weekView } from '../model/weeks'
import type { Store } from '../storage/store'
import { bootVerwijderen, botenBevestigen, botenOverslaan, botenSamenvoegen } from '../domain/trips'
import { parseAmount } from '../basis/bedrag'

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
  // Per boot afgehandeld (bevestigd of overgeslagen): die verdwijnt uit de lijst.
  const [done, setDone] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const open = rows.filter((r) => !done.has(r.key))
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const inputs: BoatInput[] = open.map((r) => ({ key: r.key, name: r.name, model: r.model, lengthFt: parseAmount(r.length), kind: r.kind }))
      await botenBevestigen(store, frozen, inputs)
      notify(t('boats.saved', { n: open.length }))
      onDone()
    } finally {
      setBusy(false)
    }
  }

  async function skip() {
    await botenOverslaan(store, frozen.filter((b) => !done.has(b.key)))
    onDone()
  }

  /** Eén boot bevestigen of overslaan; de andere blijven staan. Na de laatste is het klaar. */
  async function one(r: Row, confirm: boolean) {
    if (busy) return
    setBusy(true)
    try {
      if (confirm) await botenBevestigen(store, frozen, [{ key: r.key, name: r.name, model: r.model, lengthFt: parseAmount(r.length), kind: r.kind }])
      else await botenOverslaan(store, frozen.filter((b) => b.key === r.key))
      notify(t(confirm ? 'boats.savedOne' : 'boats.skippedOne', { name: r.name || r.model }))
      const next = new Set(done).add(r.key)
      setDone(next)
      if (rows.every((x) => next.has(x.key))) onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <p className="muted">{t('boats.intro')}</p>
      <ul className="boat-list">
        {rows.map((r, i) => {
          if (done.has(r.key)) return null
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
              {canSkip && rows.length > 1 && (
                <div className="row wrap boat-one">
                  <button type="button" className="btn small" disabled={busy} onClick={() => void one(r, true)}>
                    <Icon icon={Check} />
                    {t('boats.confirmOne')}
                  </button>
                  <button type="button" className="btn small" disabled={busy} onClick={() => void one(r, false)}>
                    <Icon icon={SkipForward} />
                    {t('boats.skipOne')}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="sheet-actions">
        <button className="btn primary" type="submit" disabled={busy}>
          <Icon icon={Check} />
          {t(canSkip ? 'boats.confirm' : 'common.save')}
          {canSkip && open.length < rows.length ? ` (${open.length})` : ''}
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

/** Meer → Boten: alle boten uit de trips; tikken opent bewerken, samenvoegen met een andere boot of verwijderen. */
export function Boats({ store, notify }: { store: Store; notify: Notify }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const boats = boatList(trips, legs)
  const [open, setOpen] = useState<BoatEntry | null>(null)
  const [viewing, setViewing] = useState<BoatEntry | null>(null)
  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('boats.screen')}</h1>
      </header>
      {boats.length === 0 ? (
        <p className="muted">{t('boats.empty')}</p>
      ) : (
        <>
          <p className="muted small">{t('boats.tapHint')}</p>
          <ul className="rows">
            {boats.map((b) => (
              <li key={b.key}>
                <button type="button" className="row-button" onClick={() => setViewing(b)} aria-label={`${t('boat.open')}: ${b.name || b.model}`}>
                  <span className="row-main">
                    <span>{b.name || b.model}</span>
                    <span className="muted small">{boatDetails(b)}</span>
                  </span>
                  <Icon icon={ChevronRight} className="chevron" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {viewing && (
        <BoatView
          store={store}
          boat={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setOpen(viewing)
            setViewing(null)
          }}
        />
      )}
      {open && <BoatSheet key={open.key} store={store} boat={open} boats={boats} notify={notify} onClose={() => setOpen(null)} />}
    </section>
  )
}

/** Eén boot bekijken: model, soort, lengte, totalen en de trips; bewerken (ook samenvoegen en verwijderen) via het potlood. */
function BoatView({ store, boat, onClose, onEdit }: { store: Store; boat: BoatEntry; onClose: () => void; onEdit: () => void }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const counters = useCounters(store)
  const current = boatList(trips, legs).find((b) => b.key === boat.key) ?? boat
  const own = trips.filter((x) => current.tripIds.includes(x.id) && x.deletedAt === null)
  const boatLegs = active(legs).filter((l) => current.tripIds.includes(l.tripId))
  const nm = boatLegs.reduce((n, l) => n + totalNm(l), 0)
  return (
    <Sheet title={current.name || current.model} onClose={onClose} onEdit={onEdit}>
      <div className="stack view">
        <ViewRows
          rows={[
            [t('boat.model'), current.name ? current.model : ''],
            [t('boat.kind'), current.kind && t(`boatKind.${current.kind}`)],
            [t('boat.length'), current.lengthFt && `${formatNumber(current.lengthFt)} ft · ${formatNumber(feetToMetres(current.lengthFt))} m`],
            [t('stat.total'), boatLegs.length > 0 && t('boat.totals', { nm: formatNm(round1(nm)), days: boatLegs.length })],
          ]}
        />
        {own.length > 0 && (
          <div className="stack-sm">
            <h3>{t('boat.trips')}</h3>
            <ul className="rows">
              {own.map((x) => {
                const v = weekView(x, legs)
                return (
                  <li key={x.id} className="row-item">
                    <span className="row-main">
                      <span>{nameWithCounter(x, counters.get(x.id))}</span>
                      <span className="muted small">{v.startDate && v.endDate ? formatDateRange(v.startDate, v.endDate) : ''}</span>
                    </span>
                    <span className="row-value small">{formatNm(v.nm)}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  )
}

function boatDetails(b: BoatEntry): string {
  return [
    b.name ? b.model : '',
    b.lengthFt ? `${formatNumber(b.lengthFt)} ft · ${formatNumber(feetToMetres(b.lengthFt))} m` : '',
    b.kind ? t(`boatKind.${b.kind}`) : '',
    t('gaps.boatTrips', { n: b.tripIds.length }),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Eén boot: alle velden; samenvoegen met een andere boot (trips en dagen gaan mee); onderaan verwijderen. */
function BoatSheet({ store, boat, boats, notify, onClose }: { store: Store; boat: BoatEntry; boats: BoatEntry[]; notify: Notify; onClose: () => void }) {
  const [row, setRow] = useState(() => initialRow(boat))
  const others = boats.filter((b) => b.key !== boat.key)
  const [target, setTarget] = useState(others[0]?.key ?? '')
  const [busy, setBusy] = useState(false)
  const ft = parseAmount(row.length)
  const kinds = row.kind && !SHOWN_KINDS.includes(row.kind) ? [...SHOWN_KINDS, row.kind] : SHOWN_KINDS

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await botenBevestigen(store, [boat], [{ key: boat.key, name: row.name, model: row.model, lengthFt: ft, kind: row.kind }])
      onClose()
      notify(t('toast.saved'))
    } finally {
      setBusy(false)
    }
  }

  async function merge() {
    const into = others.find((b) => b.key === target)
    if (!into || busy) return
    setBusy(true)
    const undo = await botenSamenvoegen(store, boat, into)
    onClose()
    notify(t('boats.merged', { name: into.name || into.model }), undo)
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    const undo = await bootVerwijderen(store, boat)
    onClose()
    notify(t('boats.deleted', { name: boat.name || boat.model }), undo)
  }

  return (
    <Sheet title={t('boat.edit')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)}>
        <div className="two">
          <label>
            {t('boat.name')}
            <input type="text" autoComplete="off" maxLength={120} value={row.name} onChange={(e) => setRow({ ...row, name: e.target.value })} />
          </label>
          <label>
            {t('boat.model')}
            <input type="text" autoComplete="off" maxLength={120} value={row.model} onChange={(e) => setRow({ ...row, model: e.target.value })} />
          </label>
        </div>
        <div className="two">
          <label>
            {t('boat.length')}
            <input inputMode="decimal" autoComplete="off" value={row.length} onChange={(e) => setRow({ ...row, length: e.target.value, lengthSuggested: false })} />
          </label>
          <span className="muted small boat-length-hint">
            {[ft !== null ? t('boat.metres', { m: formatNumber(feetToMetres(ft)) }) : '', row.lengthSuggested ? t('boats.lengthSuggested') : ''].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="segments small" role="radiogroup" aria-label={t('boat.kind')}>
          {kinds.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={row.kind === k} className={`segment${row.kind === k ? ' active' : ''}`} onClick={() => setRow({ ...row, kind: row.kind === k ? undefined : k })}>
              {t(`boatKind.${k}`)}
            </button>
          ))}
        </div>
        <span className="muted small">{t('gaps.boatTrips', { n: boat.tripIds.length })}</span>
        <button className="btn primary" type="submit" disabled={busy}>
          <Icon icon={Check} />
          {t('common.save')}
        </button>
        {others.length > 0 && (
          <div className="stack-sm">
            <label>
              {t('boat.mergeWith')}
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {others.map((b) => (
                  <option key={b.key} value={b.key}>
                    {[b.name, b.model].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="button" disabled={busy || !target} onClick={() => void merge()}>
              <Icon icon={Merge} />
              {t('boat.merge')}
            </button>
            <span className="muted small">{t('boat.mergeHint')}</span>
          </div>
        )}
        <button className="btn danger" type="button" disabled={busy} onClick={() => void remove()}>
          <Icon icon={Trash2} />
          {t('boat.delete')}
        </button>
        <span className="muted small">{t('boat.deleteHint')}</span>
      </form>
    </Sheet>
  )
}
