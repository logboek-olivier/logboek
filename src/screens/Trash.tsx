import { ArrowLeftRight, CalendarRange, Coins, FileSpreadsheet, FileText, MapPin, RotateCcw, Route, Sailboat, Users, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import type { Notify } from '../components/EditSheets'
import { useCollection } from '../components/useCollection'
import { terugzetten } from '../domain/prullenbak'
import { formatDate, formatMoney } from '../format'
import { t } from '../i18n'
import { movedAway, relinkCandidates, trashItems, type TrashItem, type TrashKind } from '../model/trash'
import type { Leg, Transaction } from '../model/types'
import type { Store } from '../storage/store'

// Meer → Prullenbak: wat in de laatste 30 dagen verwijderd werd (periodes, dagen, geld, deelnemers, plaatsen, boten,
// documenten), met wat eraan hing. Eén tik op Terugzetten zet het terug; daarna staat het weer waar het stond.

const ICON: Record<TrashKind, LucideIcon> = {
  periode: CalendarRange,
  dag: Route,
  geld: Coins,
  deelnemer: Users,
  plaats: MapPin,
  boot: Sailboat,
  document: FileText,
  import: FileSpreadsheet,
  omzetten: ArrowLeftRight,
}

/** De prullenbak, opnieuw berekend zodra een van de betrokken bestanden verandert. */
export function useTrashItems(store: Store): TrashItem[] {
  const history = useCollection(store, 'history.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const money = useCollection(store, 'transactions.json.enc')
  const places = useCollection(store, 'places.json.enc')
  const stays = useCollection(store, 'periods.json.enc')
  const documents = useCollection(store, 'documents/index.json.enc')
  return useMemo(() => trashItems(store), [store, history, trips, legs, money, places, stays, documents])
}

function countsText(item: TrashItem): string {
  return [
    item.counts.days > 0 && t('trip.part.legs', { n: item.counts.days }),
    item.counts.money > 0 && t('trip.part.transactions', { n: item.counts.money }),
    item.counts.participants > 0 && t('trip.part.participants', { n: item.counts.participants }),
  ]
    .filter((x): x is string => !!x)
    .join(' · ')
}

export function Trash({ store, notify }: { store: Store; notify: Notify }) {
  const items = useTrashItems(store)
  const [open, setOpen] = useState<TrashItem | null>(null)
  return (
    <section className="stack-lg trash">
      <header className="page-header">
        <h1>{t('trash.title')}</h1>
      </header>
      <p className="muted small">{t('trash.intro')}</p>
      {items.length === 0 ? (
        <p className="muted">{t('trash.empty')}</p>
      ) : (
        <ul className="rows">
          {items.map((item) => (
            <li key={item.key}>
              <button type="button" className="settings-row" onClick={() => setOpen(item)}>
                <Icon icon={ICON[item.kind]} />
                <span className="row-main">
                  <span>{item.title || t(`trash.kind.${item.kind}`)}</span>
                  <span className="muted small">
                    {[t(`trash.kind.${item.kind}`), item.date ? formatDate(item.date) : '', countsText(item)].filter(Boolean).join(' · ')}
                  </span>
                  <span className="muted small">{t('trash.deletedOn', { date: formatDate(item.deletedAt.slice(0, 10)), until: formatDate(item.until.slice(0, 10)) })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <RestoreSheet store={store} item={open} notify={notify} onClose={() => setOpen(null)} />}
    </section>
  )
}

function RestoreSheet({ store, item, notify, onClose }: { store: Store; item: TrashItem; notify: Notify; onClose: () => void }) {
  // Van vóór de geschiedenis: geld rond de datums dat nu bij geen trip hoort; Olivier kiest zelf wat er terug moet.
  const candidates = useMemo(() => relinkCandidates(store, item), [store, item])
  // Wat bij het verwijderen naar een andere trip ging (zelfde tijd als de verwijderde trip): staat aangevinkt, zichtbaar.
  const moved = useMemo(() => movedAway(store, item), [store, item])
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(moved.map((m) => m.record.id)))
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen)
    if (on) next.add(id)
    else next.delete(id)
    setChosen(next)
  }
  const tripName = (id: string) => store.get('trips.json.enc').find((x) => x.id === id)?.name ?? ''
  const [busy, setBusy] = useState(false)
  const counts = countsText(item)

  async function restore() {
    if (busy) return
    setBusy(true)
    try {
      const { result, undo } = await terugzetten(store, item.key, [...chosen])
      onClose()
      if (result === 0) notify(t('trash.nothing'))
      else notify(t('trash.restored', { name: item.title || t(`trash.kind.${item.kind}`) }), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={item.title || t(`trash.kind.${item.kind}`)} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{[t(`trash.kind.${item.kind}`), item.date ? formatDate(item.date) : ''].filter(Boolean).join(' · ')}</p>
        <p>{item.kind === 'import' ? t('trash.importBack') : item.kind === 'omzetten' ? t('trash.convertBack') : counts ? t('trash.comesBack', { parts: counts }) : t('trash.comesBackAlone')}</p>
        {moved.length > 0 && (
          <fieldset className="stack-sm">
            <legend>{t('trash.movedBack', { name: tripName(moved[0]!.tripId) })}</legend>
            <p className="muted small">{t('trash.movedHint')}</p>
            {moved.map((m) => (
              <label key={m.record.id} className="check-row">
                <input type="checkbox" checked={chosen.has(m.record.id)} onChange={(e) => toggle(m.record.id, e.target.checked)} />
                <span>{movedLabel(m.path, m.record)}</span>
              </label>
            ))}
          </fieldset>
        )}
        {candidates.length > 0 && (
          <fieldset className="stack-sm">
            <legend>{t('trash.relink')}</legend>
            <p className="muted small">{t('trash.relinkHint')}</p>
            {candidates.map((tx) => (
              <label key={tx.id} className="check-row">
                <input
                  type="checkbox"
                  checked={chosen.has(tx.id)}
                  onChange={(e) => toggle(tx.id, e.target.checked)}
                />
                <span>
                  {formatDate(tx.date)} · {tx.note?.trim() || t(`kind.${tx.kind}`)} · {formatMoney(tx.amount, tx.currency)}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <button type="button" className="btn primary" disabled={busy} onClick={() => void restore()}>
          <Icon icon={RotateCcw} />
          {t('trash.restore')}
        </button>
      </div>
    </Sheet>
  )
}

/** Eén regel voor iets dat naar een andere trip ging: een dag met zijn route, geld met datum en bedrag. */
function movedLabel(path: string, record: unknown): string {
  if (path === 'legs.json.enc') {
    const leg = record as Leg
    return `${formatDate(leg.date)} · ${[leg.fromPlace, leg.toPlace].filter(Boolean).join(' → ') || t('trash.kind.dag')}`
  }
  if (path === 'transactions.json.enc') {
    const tx = record as Transaction
    return `${formatDate(tx.date)} · ${tx.note?.trim() || t(`kind.${tx.kind}`)} · ${formatMoney(tx.amount, tx.currency)}`
  }
  return t(path === 'students.json.enc' ? 'trash.movedStudent' : path === 'plans.json.enc' ? 'trash.movedPlan' : 'trash.movedClaim')
}
