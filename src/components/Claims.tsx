import { Camera, Check, FileText, FileUp, Images, Share2, Trash2, Wallet } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { DecryptError, type Bytes } from '../crypto/encrypt'
import { recordError } from '../errors'
import { formatDate, formatMoney } from '../format'
import { t } from '../i18n'
import { claimsToShow, receiptFileName, tripClaims, type ClaimInput } from '../model/claims'
import { nameWithCounter } from '../model/counters'
import { active, tripForDate } from '../model/derive'
import { isImage, prepareFile } from '../model/documents'
import { currentSettings } from '../model/settings'
import { CURRENCIES, type Claim, type Currency, type Trip } from '../model/types'
import { activeWeek } from '../model/weeks'
import { shareOrDownload } from '../share'
import type { Store } from '../storage/store'
import { fileError } from './DocumentSheets'
import type { Notify } from './EditSheets'
import { CopyErrorDetails } from './ErrorDetails'
import { Icon } from './Icon'
import { NoteField } from './NoteField'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'
import { declaratieBewerken, declaratieIngediend, declaratieTerugbetaald, declaratieToevoegen, declaratieVerwijderen } from '../domain/geld'
import { instellingenOpslaan } from '../domain/instellingen'
import { amountInput, parseAmount } from '../basis/bedrag'
import { todayIso } from '../basis/datum'

// Declaraties (src/model/claims.ts): + → Declaratie met een foto van het bonnetje, per trip een lijst met de status,
// Geld → Declaraties (wat openstaat en wat geen trip heeft), en per declaratie "Bonnetje delen" (naar de app van de
// organisatie), "Ingediend?" en "Terugbetaling invoeren".

function CurrencySelect({ value, onChange }: { value: Currency; onChange: (c: Currency) => void }) {
  return (
    <label>
      {t('field.currency')}
      <select value={value} onChange={(e) => onChange(e.target.value as Currency)}>
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  )
}

function TripSelect({ store, value, onChange }: { store: Store; value: string; onChange: (id: string) => void }) {
  const counters = useCounters(store)
  const all = active(useCollection(store, 'trips.json.enc'))
  const recent = [...all].sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1)).slice(0, 30)
  // De gekozen trip staat er altijd bij, ook als hij ouder is of geen startdatum heeft.
  const chosen = all.find((x) => x.id === value)
  const trips = chosen && !recent.some((x) => x.id === value) ? [chosen, ...recent] : recent
  return (
    <label>
      {t('field.trip')}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('quick.noTrip')}</option>
        {trips.map((x) => (
          <option key={x.id} value={x.id}>
            {nameWithCounter(x, counters.get(x.id))}
          </option>
        ))}
      </select>
    </label>
  )
}

/** De velden van een declaratie (nieuw of bewerken); de trip volgt de datum zolang Olivier zelf niets kiest. */
function useClaimFields(store: Store, claim: Claim | null, preset?: string) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const [date, setDate] = useState(claim?.date ?? todayIso())
  const [note, setNote] = useState(claim?.note ?? '')
  const [amount, setAmount] = useState(claim?.amount !== undefined ? amountInput(claim.amount) : '')
  const [currency, setCurrency] = useState<Currency>(claim?.currency ?? settings.lastCurrency)
  const [chosenTrip, setChosenTrip] = useState<string | null>(claim ? (claim.tripId ?? '') : (preset ?? null))
  // Zoals bij inkomsten: de trip van de datum, anders de lopende trip, anders de dichtstbijzijnde (de laatste die vóór de
  // datum begon, anders de eerstvolgende). Een declaratie zonder trip is alleen een eigen keuze.
  const fallback = useMemo(() => {
    const day = date || todayIso()
    const byDate = tripForDate(trips, legs, day)
    if (byDate) return byDate.id
    const running = activeWeek(trips, settings, day)
    if (running) return running.id
    const dated = active(trips).filter((x) => x.startDate)
    const before = dated.filter((x) => x.startDate! <= day).sort((a, b) => (a.startDate! < b.startDate! ? 1 : -1))[0]
    return (before ?? dated.sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1))[0])?.id ?? ''
  }, [trips, legs, date, settings])
  const tripId = chosenTrip ?? fallback
  const parsed = amount.trim() === '' ? null : parseAmount(amount)
  const invalid = amount.trim() !== '' && parsed === null
  const input = (): ClaimInput => ({ date: date || todayIso(), tripId: tripId || null, note, amount: parsed, currency })
  return { date, setDate, note, setNote, amount, setAmount, currency, setCurrency, tripId, setTripId: setChosenTrip, invalid, input }
}

function ClaimFieldsView({ store, f }: { store: Store; f: ReturnType<typeof useClaimFields> }) {
  return (
    <>
      <NoteField label={t('claims.note')} value={f.note} onChange={f.setNote} maxLength={500} />
      <div className="row">
        <label className="grow">
          {t('claims.amount')}
          <input type="text" inputMode="decimal" autoComplete="off" value={f.amount} onChange={(e) => f.setAmount(e.target.value)} />
        </label>
        <CurrencySelect value={f.currency} onChange={f.setCurrency} />
      </div>
      <div className="two">
        <label>
          {t('field.date')}
          <input type="date" max={todayIso()} value={f.date} onChange={(e) => f.setDate(e.target.value)} />
        </label>
        <TripSelect store={store} value={f.tripId} onChange={f.setTripId} />
      </div>
    </>
  )
}

/** Toevoegen → Declaratie: foto van het bonnetje (camera of galerij), notitie, optioneel bedrag, bij de trip van de datum. */
export function ClaimForm({ store, onDone, tripId }: { store: Store; onDone: (message: string) => void; /** Vanaf de periodepagina: de trip staat al vast. */ tripId?: string }) {
  const f = useClaimFields(store, null, tripId)
  const camera = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ bytes: Bytes; mime: string } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  async function choose(input: HTMLInputElement) {
    const chosen = input.files?.[0]
    // Hetzelfde bestand nog eens kiezen moet weer werken.
    input.value = ''
    if (!chosen) return
    setError(null)
    // Tijdens het verkleinen kan er niet opgeslagen worden (anders gaat de declaratie zonder bonnetje).
    setBusy(true)
    try {
      const ready = await prepareFile(chosen)
      setFile(ready)
      setPreview(isImage(ready.mime) ? URL.createObjectURL(new Blob([ready.bytes], { type: ready.mime })) : null)
    } catch (e) {
      setFile(null)
      setPreview(null)
      setError(fileError(e))
    } finally {
      setBusy(false)
    }
  }

  const empty = !file && f.note.trim() === '' && f.amount.trim() === ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (f.invalid || busy || empty) return
    setBusy(true)
    try {
      await declaratieToevoegen(store, f.input(), file)
      if (f.amount.trim() !== '') await instellingenOpslaan(store, { lastCurrency: f.currency })
      try {
        navigator.vibrate?.(20)
      } catch {
        // Geen trilling: niets.
      }
      onDone(t('claims.saved'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <div className="row wrap">
        <button type="button" className="btn" disabled={busy} onClick={() => camera.current?.click()}>
          <Icon icon={Camera} />
          {t('vault.takePhoto')}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => picker.current?.click()}>
          <Icon icon={Images} />
          {t('claims.fromGallery')}
        </button>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden aria-label={t('vault.takePhoto')} onChange={(e) => void choose(e.target)} />
        {/* Geen accept-filter: Android en Google Drive grijzen anders bestanden uit. */}
        <input ref={picker} type="file" hidden aria-label={t('claims.fromGallery')} onChange={(e) => void choose(e.target)} />
      </div>
      {preview && <img className="claim-preview" src={preview} alt={t('claims.receipt')} />}
      {file && !preview && (
        <p className="muted small">
          <Icon icon={FileUp} /> {t('claims.pdfChosen')}
        </p>
      )}
      {error && <p className="error small">{error}</p>}
      <ClaimFieldsView store={store} f={f} />
      <p className="muted small">{t('claims.vaultHint')}</p>
      <button className="btn primary" type="submit" disabled={busy || f.invalid || empty}>
        {t('common.save')}
      </button>
    </form>
  )
}

function statusLabel(claim: Claim): string {
  return t(`claimStatus.${claim.status}`)
}

/** Per trip de declaraties met hun status (bedragen pas in de declaratie zelf). */
export function TripClaims({ store, trip, notify, heading = 'h2' }: { store: Store; trip: Trip; notify: Notify; heading?: 'h2' | 'h3' }) {
  const claims = tripClaims(useCollection(store, 'claims.json.enc'), trip.id)
  const [open, setOpen] = useState<Claim | null>(null)
  if (claims.length === 0) return null
  const Heading = heading
  return (
    <div className="section stack-sm trip-claims">
      <Heading>{t('claims.title')}</Heading>
      <ul className="plain-list">
        {claims.map((c) => (
          <li key={c.id}>
            <button type="button" className="row claim-row" onClick={() => setOpen(c)}>
              <span className={`claim-status ${c.status}`}>{statusLabel(c)}</span>
              <span className="grow">{c.note || t('claims.noNote')}</span>
              <span className="muted small">{formatDate(c.date)}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && <ClaimView store={store} claim={open} notify={notify} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Geld → Declaraties: wat nog openstaat of ingediend is, en declaraties zonder trip (die staan niet bij een trip). */
export function ClaimsSection({ store, notify }: { store: Store; notify: Notify }) {
  const claims = claimsToShow(useCollection(store, 'claims.json.enc'))
  const trips = useCollection(store, 'trips.json.enc')
  const counters = useCounters(store)
  const [open, setOpen] = useState<Claim | null>(null)
  if (claims.length === 0) return null
  return (
    <div className="section card card-body stack-sm claims-section">
      <h2>{t('claims.title')}</h2>
      <ul className="plain-list">
        {claims.map((c) => {
          const trip = trips.find((x) => x.id === c.tripId && x.deletedAt === null)
          return (
            <li key={c.id}>
              <button type="button" className="row claim-row" onClick={() => setOpen(c)}>
                <span className={`claim-status ${c.status}`}>{statusLabel(c)}</span>
                <span className="grow">
                  {c.note || t('claims.noNote')}
                  <span className="muted small"> · {trip ? nameWithCounter(trip, counters.get(trip.id)) : t('quick.noTrip')}</span>
                </span>
                {c.amount !== undefined && c.currency && <span className="num small">{formatMoney(c.amount, c.currency)}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {open && <ClaimView store={store} claim={open} notify={notify} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Eén declaratie: het bonnetje, notitie, bedrag en status; "Bonnetje delen", "Ingediend?" en "Terugbetaling invoeren". */
export function ClaimView({ store, claim, notify, onClose }: { store: Store; claim: Claim; notify: Notify; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const [repaying, setRepaying] = useState(false)
  const [askSubmitted, setAskSubmitted] = useState(false)
  const [error, setError] = useState<{ text: string; details: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const current = useCollection(store, 'claims.json.enc').find((c) => c.id === claim.id) ?? claim
  const document = useCollection(store, 'documents/index.json.enc').find((d) => d.id === current.documentId && d.deletedAt === null)
  const trip = useCollection(store, 'trips.json.enc').find((x) => x.id === current.tripId && x.deletedAt === null)
  const counters = useCounters(store)
  const [bytes, setBytes] = useState<Bytes | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const fileId = document?.fileId
  const mime = document?.mime
  const offline = document?.offline ?? false

  // Het bonnetje vooraf ophalen en ontsleutelen (ook een PDF): delen gebeurt dan meteen uit het geheugen, binnen de tik.
  useEffect(() => {
    setBytes(null)
    setUrl(null)
    if (!fileId || !mime) return
    let cancelled = false
    let objectUrl: string | null = null
    store
      .documentFile(fileId, offline)
      .then((plain) => {
        if (cancelled) return
        setBytes(plain)
        if (isImage(mime)) {
          objectUrl = URL.createObjectURL(new Blob([plain], { type: mime }))
          setUrl(objectUrl)
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (e instanceof DecryptError) recordError(e)
        setError({ text: fileError(e), details: e instanceof DecryptError })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [store, fileId, mime, offline])

  if (editing) return <ClaimSheet store={store} claim={current} notify={notify} onClose={onClose} />

  async function share() {
    if (!bytes || !mime || busy) return
    setBusy(true)
    try {
      // Een neutrale bestandsnaam en geen titel: de andere app krijgt alleen het bonnetje.
      const result = await shareOrDownload(new File([bytes], receiptFileName(mime), { type: mime }))
      if (result !== 'afgebroken' && current.status === 'open') setAskSubmitted(true)
    } finally {
      setBusy(false)
    }
  }

  async function submitted() {
    if (busy) return
    setBusy(true)
    try {
      const undo = await declaratieIngediend(store, current, todayIso())
      setAskSubmitted(false)
      notify(t('claims.submittedToast'), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('claims.one', { date: formatDate(current.date) })} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack view">
        {url && <img className="claim-receipt" src={url} alt={t('claims.receipt')} />}
        {document && mime === 'application/pdf' && (
          <p className="muted small">
            <Icon icon={FileText} /> {t('claims.pdfReceipt')}
          </p>
        )}
        {current.documentId && !document && <p className="muted small">{t('claims.receiptGone')}</p>}
        {current.amount !== undefined && current.currency && <p className="view-amount">{formatMoney(current.amount, current.currency)}</p>}
        <p className="row">
          <span className={`claim-status ${current.status}`}>{statusLabel(current)}</span>
          {current.submittedAt && <span className="muted small">{t('claims.submittedOn', { date: formatDate(current.submittedAt) })}</span>}
        </p>
        {current.repaid && <p className="muted small">{t('claims.repaidLine', { date: formatDate(current.repaid.date), amount: formatMoney(current.repaid.amount, current.repaid.currency) })}</p>}
        {current.note && <p className="note-text">{current.note}</p>}
        {trip && <p className="muted small">{nameWithCounter(trip, counters.get(trip.id))}</p>}
        {error && (
          <div className="stack-sm">
            <p className="error small">{error.text}</p>
            {error.details && <CopyErrorDetails />}
          </div>
        )}
        {document && (
          <button type="button" className="btn" disabled={busy || !bytes} onClick={() => void share()}>
            <Icon icon={Share2} />
            {t('claims.share')}
          </button>
        )}
        {document && <p className="muted small">{t('claims.shareHint')}</p>}
        {askSubmitted && (
          <div className="card card-body stack-sm claim-question">
            <p>{t('claims.askSubmitted')}</p>
            <div className="row wrap">
              <button type="button" className="btn small primary" disabled={busy} onClick={() => void submitted()}>
                <Icon icon={Check} />
                {t('claims.yesSubmitted')}
              </button>
              <button type="button" className="btn small quiet" onClick={() => setAskSubmitted(false)}>
                {t('salary.notYet')}
              </button>
            </div>
          </div>
        )}
        {current.status === 'open' && !askSubmitted && (
          <button type="button" className="btn" disabled={busy} onClick={() => void submitted()}>
            <Icon icon={Check} />
            {t('claims.markSubmitted')}
          </button>
        )}
        {current.status !== 'terugbetaald' && (
          <button type="button" className="btn" onClick={() => setRepaying(true)}>
            <Icon icon={Wallet} />
            {t('claims.markRepaid')}
          </button>
        )}
      </div>
      {repaying && <RepaySheet store={store} claim={current} notify={notify} onClose={() => setRepaying(false)} />}
    </Sheet>
  )
}

/** Terugbetaald: datum en bedrag (standaard het gedeclareerde bedrag). */
function RepaySheet({ store, claim, notify, onClose }: { store: Store; claim: Claim; notify: Notify; onClose: () => void }) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const [date, setDate] = useState(todayIso())
  const [amount, setAmount] = useState(claim.amount !== undefined ? amountInput(claim.amount) : '')
  const [currency, setCurrency] = useState<Currency>(claim.currency ?? settings.lastCurrency)
  const [busy, setBusy] = useState(false)
  const parsed = parseAmount(amount)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (parsed === null || !date || busy) return
    setBusy(true)
    try {
      const undo = await declaratieTerugbetaald(store, claim, { date, amount: parsed, currency })
      onClose()
      notify(t('claims.repaidToast'), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('claims.markRepaid')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="row">
          <label className="grow">
            {t('claims.repaidAmount')}
            <input className="amount" type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </div>
        <label>
          {t('claims.repaidDate')}
          <input type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <p className="muted small">{t('claims.repaidHint')}</p>
        <button className="btn primary" type="submit" disabled={parsed === null || !date || busy}>
          <Icon icon={Check} />
          {t('claims.saveRepaid')}
        </button>
      </form>
    </Sheet>
  )
}

/** Een declaratie bewerken (notitie, bedrag, datum, trip) of verwijderen (het bonnetje gaat mee de kluis uit). */
function ClaimSheet({ store, claim, notify, onClose }: { store: Store; claim: Claim; notify: Notify; onClose: () => void }) {
  const f = useClaimFields(store, claim)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (f.invalid || busy) return
    setBusy(true)
    try {
      await declaratieBewerken(store, claim, f.input())
      onClose()
      notify(t('toast.saved'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    try {
      const undo = await declaratieVerwijderen(store, claim)
      onClose()
      notify(t('toast.deleted'), undo)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('claims.edit')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <ClaimFieldsView store={store} f={f} />
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={f.invalid || busy}>
            {t('common.save')}
          </button>
          <button className="btn danger" type="button" disabled={busy} onClick={() => void remove()}>
            <Icon icon={Trash2} />
            {t('common.delete')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
