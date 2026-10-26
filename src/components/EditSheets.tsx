import { Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { formatDateRange, formatNm } from '../format'
import { summarizeTrips } from '../model/derive'
import {
  deleteLeg,
  deleteTransaction,
  deleteTrip,
  parseNonNegative,
  renameTrip,
  updateLeg,
  updateTransaction,
  type Undo,
} from '../model/edit'
import { parseAmount } from '../model/money'
import { saveSettings } from '../model/settings'
import {
  CURRENCIES,
  KIND_LABELS,
  ROLE_LABELS,
  ROLES,
  SOURCE_LABELS,
  TRANSACTION_SOURCES,
  type Currency,
  type Leg,
  type Role,
  type Transaction,
  type TransactionKind,
  type TransactionSource,
  type Trip,
} from '../model/types'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

// Onderbladen om een transactie, dag of tocht te bewerken. Verwijderen zonder bevestigingsvraag; de aanroeper toont
// "Verwijderd · Ongedaan maken".

export type Notify = (text: string, undo?: Undo) => void

const KINDS: TransactionKind[] = ['fooi', 'loon', 'kosten', 'investering']

/** 12.5 → "12,5"; 0 → "" zodat lege velden leeg blijven. */
function toInput(n: number): string {
  return n === 0 ? '' : String(n).replace('.', ',')
}

export function TransactionSheet({
  store,
  tx,
  onClose,
  notify,
}: {
  store: Store
  tx: Transaction
  onClose: () => void
  notify: Notify
}) {
  const [amount, setAmount] = useState(tx.amount.toFixed(2).replace('.', ','))
  const [kind, setKind] = useState<TransactionKind>(tx.kind)
  const [source, setSource] = useState<TransactionSource>(tx.source)
  const [currency, setCurrency] = useState<Currency>(tx.currency)
  const [date, setDate] = useState(tx.date)
  const [note, setNote] = useState(tx.note ?? '')
  const [busy, setBusy] = useState(false)
  const parsed = parseAmount(amount)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (parsed === null || !date || busy) return
    setBusy(true)
    try {
      await updateTransaction(store, tx, { amount: parsed, kind, source, currency, date, note: note.trim() || undefined })
      onClose()
      notify('Opgeslagen')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const undo = await deleteTransaction(store, tx)
    onClose()
    notify('Verwijderd', undo)
  }

  return (
    <Sheet title={`${KIND_LABELS[tx.kind]} bewerken`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          Bedrag
          <input
            className="amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <div className="two">
          <label>
            Soort
            <select value={kind} onChange={(e) => setKind(e.target.value as TransactionKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Valuta
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="two">
          <label>
            Bron
            <select value={source} onChange={(e) => setSource(e.target.value as TransactionSource)}>
              {TRANSACTION_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Datum
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label>
          Omschrijving
          <input type="text" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={parsed === null || !date || busy}>
            Opslaan
          </button>
          <button className="btn danger" type="button" onClick={() => void remove()}>
            <Icon icon={Trash2} />
            Verwijderen
          </button>
        </div>
      </form>
    </Sheet>
  )
}

const NEW_TRIP = '__nieuw__'

export function LegSheet({ store, leg, onClose, notify }: { store: Store; leg: Leg; onClose: () => void; notify: Notify }) {
  const trips = summarizeTrips(store.get('trips.json.enc'), store.get('legs.json.enc'))
  const [date, setDate] = useState(leg.date)
  const [fromPlace, setFromPlace] = useState(leg.fromPlace)
  const [fromCountry, setFromCountry] = useState(leg.fromCountry)
  const [toPlace, setToPlace] = useState(leg.toPlace)
  const [toCountry, setToCountry] = useState(leg.toCountry)
  const [role, setRole] = useState<Role>(leg.role)
  const [boat, setBoat] = useState(leg.boat)
  const [skipper, setSkipper] = useState(leg.skipperName ?? '')
  const [coSkipper, setCoSkipper] = useState(leg.coSkipperName ?? '')
  const [inland, setInland] = useState(toInput(leg.nmInland))
  const [sea, setSea] = useState(toInput(leg.nmSea))
  const [tidal, setTidal] = useState(toInput(leg.nmTidal))
  const [night, setNight] = useState(toInput(leg.nightHours))
  const [wind, setWind] = useState(leg.windBft ?? '')
  const [notes, setNotes] = useState(leg.notes ?? '')
  const [tripId, setTripId] = useState(leg.tripId)
  const [newTripName, setNewTripName] = useState('')
  const [busy, setBusy] = useState(false)

  const numbers = [inland, sea, tidal, night].map(parseNonNegative)
  const ok = !!date && numbers.every((n) => n !== null) && (tripId !== NEW_TRIP || newTripName.trim() !== '')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    const [nmInland, nmSea, nmTidal, nightHours] = numbers as number[]
    setBusy(true)
    try {
      await updateLeg(
        store,
        leg,
        {
          date,
          fromPlace: fromPlace.trim(),
          fromCountry: fromCountry.trim(),
          toPlace: toPlace.trim(),
          toCountry: toCountry.trim(),
          role,
          boat: boat.trim(),
          skipperName: skipper.trim(),
          coSkipperName: coSkipper.trim(),
          windBft: wind.trim(),
          nmInland: nmInland!,
          nmSea: nmSea!,
          nmTidal: nmTidal!,
          nightHours: nightHours!,
          notes: notes.trim(),
        },
        tripId === NEW_TRIP ? { newName: newTripName } : { id: tripId },
      )
      onClose()
      notify('Opgeslagen')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const undo = await deleteLeg(store, leg)
    onClose()
    notify('Verwijderd', undo)
  }

  return (
    <Sheet title="Dag bewerken" onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {leg.source === 'import' && <p className="muted">Geïmporteerde dag: een nieuwe import vervangt deze wijziging.</p>}
        <label>
          Datum
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="two">
          <label>
            Van (plaats)
            <input type="text" autoComplete="off" value={fromPlace} onChange={(e) => setFromPlace(e.target.value)} />
          </label>
          <label>
            Van (land)
            <input type="text" autoComplete="off" value={fromCountry} onChange={(e) => setFromCountry(e.target.value)} />
          </label>
        </div>
        <div className="two">
          <label>
            Naar (plaats)
            <input type="text" autoComplete="off" value={toPlace} onChange={(e) => setToPlace(e.target.value)} />
          </label>
          <label>
            Naar (land)
            <input type="text" autoComplete="off" value={toCountry} onChange={(e) => setToCountry(e.target.value)} />
          </label>
        </div>
        <div className="three">
          <label>
            Binnen (nm)
            <input inputMode="decimal" autoComplete="off" value={inland} onChange={(e) => setInland(e.target.value)} />
          </label>
          <label>
            Zee (nm)
            <input inputMode="decimal" autoComplete="off" value={sea} onChange={(e) => setSea(e.target.value)} />
          </label>
          <label>
            Getij (nm)
            <input inputMode="decimal" autoComplete="off" value={tidal} onChange={(e) => setTidal(e.target.value)} />
          </label>
        </div>
        <div className="two">
          <label>
            Nachturen
            <input inputMode="decimal" autoComplete="off" value={night} onChange={(e) => setNight(e.target.value)} />
          </label>
          <label>
            Wind (bft)
            <input type="text" autoComplete="off" value={wind} onChange={(e) => setWind(e.target.value)} />
          </label>
        </div>
        <div className="two">
          <label>
            Boot
            <input type="text" autoComplete="off" value={boat} onChange={(e) => setBoat(e.target.value)} />
          </label>
          <label>
            Rol
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="two">
          <label>
            Schipper/trainer
            <input type="text" autoComplete="off" value={skipper} onChange={(e) => setSkipper(e.target.value)} />
          </label>
          <label>
            Co-schipper
            <input type="text" autoComplete="off" value={coSkipper} onChange={(e) => setCoSkipper(e.target.value)} />
          </label>
        </div>
        <label>
          Tocht
          <select value={tripId} onChange={(e) => setTripId(e.target.value)}>
            {trips.map((t) => (
              <option key={t.trip.id} value={t.trip.id}>
                {t.trip.name}
              </option>
            ))}
            <option value={NEW_TRIP}>Nieuwe tocht…</option>
          </select>
        </label>
        {tripId === NEW_TRIP && (
          <label>
            Naam nieuwe tocht
            <input type="text" autoComplete="off" value={newTripName} onChange={(e) => setNewTripName(e.target.value)} />
          </label>
        )}
        <label>
          Bijzonderheden
          <input type="text" autoComplete="off" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!ok || busy}>
            Opslaan
          </button>
          <button className="btn danger" type="button" onClick={() => void remove()}>
            <Icon icon={Trash2} />
            Verwijderen
          </button>
        </div>
      </form>
    </Sheet>
  )
}

export function TripSheet({ store, trip, onClose, notify }: { store: Store; trip: Trip; onClose: () => void; notify: Notify }) {
  const [name, setName] = useState(trip.name)
  const [busy, setBusy] = useState(false)
  const summary = summarizeTrips([trip], store.get('legs.json.enc'))[0]

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await renameTrip(store, trip, name)
      onClose()
      notify('Opgeslagen')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const undo = await deleteTrip(store, trip)
    onClose()
    notify('Verwijderd', undo)
  }

  return (
    <Sheet title="Tocht bewerken" onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          Naam
          <input type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {summary && (
          <p className="muted">
            {formatDateRange(summary.startDate, summary.endDate)} · {summary.days} {summary.days === 1 ? 'dag' : 'dagen'} ·{' '}
            {formatNm(summary.nm)}. Een dag naar een andere tocht verplaatsen: tik op de dag en kies de tocht.
          </p>
        )}
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!name.trim() || busy}>
            Opslaan
          </button>
          <button className="btn danger" type="button" onClick={() => void remove()}>
            <Icon icon={Trash2} />
            Tocht en dagen verwijderen
          </button>
        </div>
      </form>
    </Sheet>
  )
}

export function GoalSheet({
  store,
  current,
  onClose,
  notify,
}: {
  store: Store
  current: number
  onClose: () => void
  notify: Notify
}) {
  const [value, setValue] = useState(String(current))
  const parsed = parseAmount(value)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (parsed === null) return
    await saveSettings(store, { yearGoalNm: Math.round(parsed) })
    void store.sync()
    onClose()
    notify('Jaardoel opgeslagen')
  }

  return (
    <Sheet title="Jaardoel" onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          Zeemijlen per kalenderjaar
          <input
            className="amount"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <button className="btn primary" type="submit" disabled={parsed === null}>
          Opslaan
        </button>
      </form>
    </Sheet>
  )
}
