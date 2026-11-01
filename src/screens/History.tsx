import { History as HistoryIcon, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import type { Notify } from '../components/EditSheets'
import { useCollection } from '../components/useCollection'
import { geschiedenisTerugzetten } from '../domain/prullenbak'
import { formatDate } from '../format'
import { t, type MessageKey } from '../i18n'
import { canRevert, historyRows, type HistoryFilter, type HistoryLine, type HistoryRow } from '../model/history-view'
import type { Store } from '../storage/store'

// Meer → Geschiedenis, en dezelfde lijst per periode (onder "⋯") en per dag (de dagkaart): wat er de laatste 30 dagen
// veranderde, met "Terugzetten" per regel. Terugzetten is zelf ook een regel (en dus weer terug te zetten).

/** Namen voor de opdrachten die Olivier het vaakst ziet; de rest heet "Wijziging". */
const COMMAND: Record<string, MessageKey> = {
  dagLoggen: 'history.cmd.dagLoggen',
  dagBewerken: 'history.cmd.dagBewerken',
  dagBewerkenMetTrip: 'history.cmd.dagBewerken',
  dagVerwijderen: 'history.cmd.dagVerwijderen',
  dagZoalsGepland: 'history.cmd.dagLoggen',
  periodeMaken: 'history.cmd.periodeMaken',
  periodeBewerken: 'history.cmd.periodeBewerken',
  periodeVerwijderen: 'history.cmd.periodeVerwijderen',
  landperiodeVerwijderen: 'history.cmd.periodeVerwijderen',
  landperiodeBewerken: 'history.cmd.periodeBewerken',
  samenvoegen: 'history.cmd.samenvoegen',
  periodeVervangen: 'history.cmd.periodeVervangen',
  geldToevoegen: 'history.cmd.geldToevoegen',
  uitgaveToevoegen: 'history.cmd.geldToevoegen',
  geldBewerken: 'history.cmd.geldBewerken',
  uitgaveBewerken: 'history.cmd.geldBewerken',
  geldVerwijderen: 'history.cmd.geldVerwijderen',
  geldKoppelen: 'history.cmd.geldKoppelen',
  dagenNaarTrip: 'history.cmd.dagenNaarTrip',
  dagBuitenPeriodeOplossen: 'history.cmd.dagenNaarTrip',
  terugzetten: 'history.cmd.terugzetten',
  tripTerugzetten: 'history.cmd.terugzetten',
  geschiedenisTerugzetten: 'history.cmd.terugzetten',
  ongedaanMaken: 'history.cmd.terugzetten',
}

/** Wat voor record: dag, geld, trip, periode aan land, agendadag; de rest "Overig". */
const KIND: Partial<Record<string, MessageKey>> = {
  'legs.json.enc': 'history.file.leg',
  'transactions.json.enc': 'history.file.money',
  'trips.json.enc': 'history.file.trip',
  'periods.json.enc': 'history.file.stay',
  'calendar.json.enc': 'history.file.day',
  'places.json.enc': 'history.file.place',
  'claims.json.enc': 'history.file.claim',
}

function lineText(line: HistoryLine): string {
  const r = line.record ?? {}
  const date = typeof r.date === 'string' ? formatDate(r.date) : ''
  const label =
    line.path === 'legs.json.enc'
      ? [date, [r.fromPlace, r.toPlace].filter((x) => typeof x === 'string' && x).join(' → ')].filter(Boolean).join(' · ')
      : line.path === 'transactions.json.enc'
        ? [date, typeof r.note === 'string' && r.note ? r.note : typeof r.kind === 'string' ? t(`kind.${r.kind}` as MessageKey) : ''].filter(Boolean).join(' · ')
        : typeof r.name === 'string' && r.name
          ? r.name
          : date
  return `${t(KIND[line.path] ?? 'history.file.other')}${label ? `: ${label}` : ''} · ${t(`history.what.${line.what}`)}`
}

export function useHistoryRows(store: Store, filter: HistoryFilter = {}): HistoryRow[] {
  const history = useCollection(store, 'history.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const money = useCollection(store, 'transactions.json.enc')
  return useMemo(() => historyRows(store, filter), [store, history, trips, legs, money, filter.periodId, filter.date])
}

export function HistoryList({ store, notify, filter = {} }: { store: Store; notify: Notify; filter?: HistoryFilter }) {
  const rows = useHistoryRows(store, filter)
  const [busy, setBusy] = useState<string | null>(null)

  async function revert(row: HistoryRow) {
    if (busy) return
    setBusy(row.entry.id)
    try {
      const undo = await geschiedenisTerugzetten(store, row.entry.id)
      notify(t('history.reverted'), undo)
    } finally {
      setBusy(null)
    }
  }

  if (rows.length === 0) return <p className="muted">{t('history.empty')}</p>
  return (
    <ul className="rows history">
      {rows.map((row) => (
        <li key={row.entry.id} className="row-item history-row">
          <span className="row-main">
            <span>{t(COMMAND[row.entry.command] ?? 'history.cmd.other')}</span>
            <span className="muted small">
              {formatDate(row.entry.at.slice(0, 10))} {new Date(row.entry.at).toTimeString().slice(0, 5)}
              {row.entry.undoneAt ? ` · ${t('history.undone')}` : ''}
            </span>
            {row.changes.slice(0, 4).map((line, i) => (
              <span key={i} className="muted small">
                {lineText(line)}
              </span>
            ))}
            {row.changes.length > 4 && <span className="muted small">{t('history.more', { n: row.changes.length - 4 })}</span>}
          </span>
          {canRevert(row.entry) && (
            <button type="button" className="btn small" disabled={busy !== null} onClick={() => void revert(row)}>
              <Icon icon={RotateCcw} />
              {t('history.revert')}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Meer → Geschiedenis. */
export function History({ store, notify }: { store: Store; notify: Notify }) {
  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('history.title')}</h1>
      </header>
      <p className="muted small">{t('history.intro')}</p>
      <HistoryList store={store} notify={notify} />
    </section>
  )
}

/** De geschiedenis van één periode of één dag, in een onderblad. */
export function HistorySheet({ store, notify, filter, title, onClose }: { store: Store; notify: Notify; filter: HistoryFilter; title: string; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="stack">
        <HistoryList store={store} notify={notify} filter={filter} />
      </div>
    </Sheet>
  )
}

/** Knop "Geschiedenis" bij een periode of dag; alleen als er iets in staat. */
export function HistoryButton({ store, notify, filter, title }: { store: Store; notify: Notify; filter: HistoryFilter; title: string }) {
  const rows = useHistoryRows(store, filter)
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return null
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Icon icon={HistoryIcon} />
        {t('history.button', { n: rows.length })}
      </button>
      {open && <HistorySheet store={store} notify={notify} filter={filter} title={title} onClose={() => setOpen(false)} />}
    </>
  )
}
