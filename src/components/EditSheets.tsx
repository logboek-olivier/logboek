import { Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { formatDate, formatNumber, formatRate } from '../format'
import { active, summarizeTrips } from '../model/derive'
import {
  deleteLeg,
  deleteTransaction,
  parseNonNegative,
  updateLeg,
  updateTransaction,
  type Undo,
} from '../model/edit'
import { parseAmount } from '../model/money'
import { eurValue } from '../model/rates'
import { saveSettings } from '../model/settings'
import {
  CURRENCIES,
  INCOME_KIND_LIST,
  ROLES,
  TRANSACTION_SOURCES,
  type Currency,
  type Leg,
  type Role,
  type Transaction,
  type TransactionKind,
  type TransactionSource,
} from '../model/types'
import type { Store } from '../storage/store'
import { defaultTripName } from '../model/trip-name'
import { Icon } from './Icon'
import { NoteField } from './NoteField'
import { kindLabel, roleLabel, sourceLabel } from '../i18n/labels'
import { Sheet } from './Sheet'
import { TipFromPicker } from './TipFromPicker'
import { draftFromTip, draftTotal, EMPTY_TIP, formatAmountInput, tipFromDraft, totalWhenLeavingSplit, type TipDraft } from '../model/tip-draft'
import { t } from '../i18n'

// Onderbladen om een transactie, dag of tocht te bewerken. Verwijderen zonder bevestigingsvraag; de aanroeper toont
// "Verwijderd · Ongedaan maken".

export type Notify = (text: string, undo?: Undo) => void

const KINDS: TransactionKind[] = [...INCOME_KIND_LIST, 'kosten', 'investering']

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
  const [received, setReceived] = useState(tx.receivedEur !== undefined ? tx.receivedEur.toFixed(2).replace('.', ',') : '')
  const [tripId, setTripId] = useState(tx.tripId ?? '')
  const trips = active(store.get('trips.json.enc')).sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1))
  const [busy, setBusy] = useState(false)
  // Fooi: van wie, achteraf te wijzigen; een andere trip begint weer bij onbekend.
  const people = kind === 'fooi' ? (trips.find((x) => x.id === tripId)?.participants ?? []) : []
  const [tip, setTip] = useState<{ tripId: string; draft: TipDraft }>(() => ({ tripId: tx.tripId ?? '', draft: draftFromTip(tx.tipFrom, trips.find((x) => x.id === tx.tripId)?.participants ?? []) }))
  const draft = tip.tripId === tripId ? tip.draft : EMPTY_TIP
  const total = people.length > 0 ? draftTotal(draft) : undefined
  const parsed = total !== undefined ? total : parseAmount(amount)
  const parsedReceived = received.trim() === '' ? undefined : parseAmount(received)
  const converted = currency === 'EUR' || parsed === null ? null : eurValue({ ...tx, currency, amount: parsed, date, receivedEur: undefined, amountEur: undefined })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (parsed === null || parsedReceived === null || !date || busy) return
    setBusy(true)
    try {
      await updateTransaction(store, tx, {
        amount: parsed,
        kind,
        source,
        currency,
        date,
        note: note.trim() || undefined,
        receivedEur: currency === 'EUR' ? undefined : (parsedReceived ?? undefined),
        tripId: tripId || null,
        tipFrom: people.length > 0 ? (tipFromDraft(draft, people) ?? null) : null,
      })
      onClose()
      notify(t('toast.saved'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const undo = await deleteTransaction(store, tx)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={t('edit.transaction', { kind: kindLabel(tx.kind) })} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('field.amount')}
          <input
            className="amount"
            inputMode="decimal"
            autoComplete="off"
            value={total !== undefined ? (total === null ? '' : formatAmountInput(total)) : amount}
            readOnly={total !== undefined}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <div className="two">
          <label>
            {t('field.kind')}
            <select value={kind} onChange={(e) => setKind(e.target.value as TransactionKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('field.currency')}
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
            {t('field.source')}
            <select value={source} onChange={(e) => setSource(e.target.value as TransactionSource)}>
              {TRANSACTION_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('field.date')}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {currency !== 'EUR' && (
          <>
            <label>
              {t('money.receivedEur')}
              <input inputMode="decimal" autoComplete="off" placeholder={converted ? formatNumber(converted.eur) : ''} value={received} onChange={(e) => setReceived(e.target.value)} />
            </label>
            <p className="muted small">
              {converted?.rate
                ? t(converted.provisional ? 'money.rateProvisional' : 'money.rateUsed', { rate: formatRate(converted.rate), currency, date: formatDate(converted.rateDate ?? date) })
                : t('money.noRate')}{' '}
              {t('money.receivedHint')}
            </p>
          </>
        )}
        <label>
          {t('field.trip')}
          <select value={tripId} onChange={(e) => setTripId(e.target.value)}>
            <option value="">{t('quick.noTrip')}</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </select>
        </label>
        {people.length > 0 && (
          <TipFromPicker
            participants={people}
            value={draft}
            currency={currency}
            onChange={(next) => {
              const kept = totalWhenLeavingSplit(draft, next)
              if (kept !== null) setAmount(formatAmountInput(kept))
              setTip({ tripId, draft: next })
            }}
          />
        )}
        <label>
          {t('field.description')}
          <input type="text" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={parsed === null || parsedReceived === null || !date || busy}>
            {t('common.save')}
          </button>
          <button className="btn danger" type="button" onClick={() => void remove()}>
            <Icon icon={Trash2} />
            {t('common.delete')}
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
  // Niets is verplicht: zonder datum blijft de oude datum, zonder naam krijgt een nieuwe trip de standaardnaam.
  const ok = numbers.every((n) => n !== null)

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
          date: date || leg.date,
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
        tripId === NEW_TRIP ? { newName: newTripName.trim() || defaultTripName(boat.trim() || t('field.trip'), date || leg.date) } : { id: tripId },
      )
      onClose()
      notify(t('toast.saved'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const undo = await deleteLeg(store, leg)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={t('edit.day')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {leg.source === 'import' && <p className="muted">{t('edit.importedDay')}</p>}
        <label>
          {t('field.date')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="two">
          <label>
            {t('field.fromPlace')}
            <input type="text" autoComplete="off" value={fromPlace} onChange={(e) => setFromPlace(e.target.value)} />
          </label>
          <label>
            {t('field.fromCountry')}
            <input type="text" autoComplete="off" value={fromCountry} onChange={(e) => setFromCountry(e.target.value)} />
          </label>
        </div>
        <div className="two">
          <label>
            {t('field.toPlace')}
            <input type="text" autoComplete="off" value={toPlace} onChange={(e) => setToPlace(e.target.value)} />
          </label>
          <label>
            {t('field.toCountry')}
            <input type="text" autoComplete="off" value={toCountry} onChange={(e) => setToCountry(e.target.value)} />
          </label>
        </div>
        <div className="three">
          <label>
            {t('field.inlandNm')}
            <input inputMode="decimal" autoComplete="off" value={inland} onChange={(e) => setInland(e.target.value)} />
          </label>
          <label>
            {t('field.seaNm')}
            <input inputMode="decimal" autoComplete="off" value={sea} onChange={(e) => setSea(e.target.value)} />
          </label>
          <label>
            {t('field.tidalNm')}
            <input inputMode="decimal" autoComplete="off" value={tidal} onChange={(e) => setTidal(e.target.value)} />
          </label>
        </div>
        <div className="two">
          <label>
            {t('field.nightHours')}
            <input inputMode="decimal" autoComplete="off" value={night} onChange={(e) => setNight(e.target.value)} />
          </label>
          <label>
            {t('field.wind')}
            <input type="text" autoComplete="off" value={wind} onChange={(e) => setWind(e.target.value)} />
          </label>
        </div>
        <div className="two">
          <label>
            {t('field.boat')}
            <input type="text" autoComplete="off" value={boat} onChange={(e) => setBoat(e.target.value)} />
          </label>
          <label>
            {t('field.role')}
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="two">
          <label>
            {t('field.skipper')}
            <input type="text" autoComplete="off" value={skipper} onChange={(e) => setSkipper(e.target.value)} />
          </label>
          <label>
            {t('field.coSkipper')}
            <input type="text" autoComplete="off" value={coSkipper} onChange={(e) => setCoSkipper(e.target.value)} />
          </label>
        </div>
        <label>
          {t('field.trip')}
          <select value={tripId} onChange={(e) => setTripId(e.target.value)}>
            {trips.map((t) => (
              <option key={t.trip.id} value={t.trip.id}>
                {t.trip.name}
              </option>
            ))}
            <option value={NEW_TRIP}>{t('edit.newTrip')}</option>
          </select>
        </label>
        {tripId === NEW_TRIP && (
          <label>
            {t('field.newTripName')}
            <input type="text" autoComplete="off" value={newTripName} onChange={(e) => setNewTripName(e.target.value)} />
          </label>
        )}
        <NoteField label={t('field.notes')} value={notes} onChange={setNotes} maxLength={2000} />
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!ok || busy}>
            {t('common.save')}
          </button>
          <button className="btn danger" type="button" onClick={() => void remove()}>
            <Icon icon={Trash2} />
            {t('common.delete')}
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
    notify(t('toast.goalSaved'))
  }

  return (
    <Sheet title={t('settings.yearGoal')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('field.yearGoal')}
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
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}
