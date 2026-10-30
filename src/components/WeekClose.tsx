import { CalendarCheck, ChevronDown, ChevronUp, Pencil, Trash2, Wallet } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { formatDate, formatDateRange, formatHours, formatMoney, formatNm } from '../format'
import { getLang, t } from '../i18n'
import { balanceOn, liveAccounts, parseStand } from '../model/accounts'
import { nameWithCounter } from '../model/counters'
import { cashOnHand, hasSalaryIncome, openSalaryTrips } from '../model/money-path'
import { getRates } from '../model/rates'
import { applyMoneyStep, isEmptyStep, type MoneyStep } from '../model/week-money'
import { useIsDemo } from './DemoBar'
import { organisationLabel } from '../i18n/labels'
import { useCounters } from './useCounters'
import type { CalendarIndex } from '../model/calendar'
import { deleteWeekClosing } from '../model/edit'
import { canClose, closingFor, LESSON_MAX, saveClosing, weekSummary, weekToClose, type WeekSummary } from '../model/week-close'
import { CURRENCIES, ORGANISATIONS, todayIso, type Currency, type WeekClosing } from '../model/types'
import { amountInput, parseAmount } from '../model/money'
import { currentSettings } from '../model/settings'
import { isoWeek } from '../model/weeks'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'

// Weekafsluiting: op Vandaag op zondag (en op maandag voor de week van gisteren) een kaart met de automatische
// samenvatting van de week, een cijfer en één zin; opslaan met één tik, daarna is de kaart weg. Terug te lezen (en te
// bewerken of verwijderen) op de dagkaart van de zondag in de agenda. Geen bedragen en geen namen van studenten.

export function SummaryLines({ summary }: { summary: WeekSummary }) {
  const lines = [
    summary.sailingDays > 0 ? t('weekClose.sailed', { days: summary.sailingDays, nm: formatNm(summary.nm) }) : t('weekClose.noSailing'),
    summary.nightHours > 0 ? t('weekClose.night', { hours: formatHours(summary.nightHours) }) : null,
    summary.werk + summary.rust + summary.reis > 0 ? t('weekClose.days', { work: summary.werk, rest: summary.rust, travel: summary.reis }) : null,
    summary.trips.length > 0 ? t('weekClose.trips', { n: summary.trips.length, names: summary.trips.join(', ') }) : null,
    summary.places > 0 ? t('weekClose.places', { n: summary.places }) : null,
    summary.exams > 0 ? t('weekClose.exams', { passed: summary.passed, exams: summary.exams }) : null,
  ].filter((l): l is string => l !== null)
  return (
    <ul className="week-summary">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

/**
 * De geldstap (wekelijks 2 minuten), ingeklapt: pas na een tik bedragen in beeld (de kaart staat op Vandaag). De stand
 * per rekening, ontvangen uitbetalingen en gestorte contanten afvinken; alles overslaan mag.
 */
function useMoneyStep(store: Store, enabled: boolean) {
  const demo = useIsDemo()
  const accounts = liveAccounts(useCollection(store, 'accounts.json.enc')).filter((a) => !a.closedAt)
  const balances = useCollection(store, 'balances.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const counters = useCounters(store)
  const [open, setOpen] = useState(false)
  const [stands, setStands] = useState<Record<string, string>>({})
  const [received, setReceived] = useState<ReadonlySet<string>>(new Set())
  const [deposited, setDeposited] = useState<ReadonlySet<Currency>>(new Set())
  const today = todayIso()
  const openTrips = ORGANISATIONS.flatMap((org) => openSalaryTrips(trips, legs, org, today)).filter((x) => !hasSalaryIncome(x, transactions))
  const cash = Object.entries(cashOnHand(transactions)) as [Currency, number][]
  const lang = getLang()
  const parsedStands = accounts.map((a) => ({ account: a, text: stands[a.id] ?? '', value: (stands[a.id] ?? '').trim() === '' ? null : parseStand(stands[a.id]!, lang) }))
  const invalid = parsedStands.some((s) => s.text.trim() !== '' && s.value === null)
  const step: MoneyStep = {
    balances: parsedStands.filter((s) => s.value !== null).map((s) => ({ account: s.account, amount: s.value! })),
    received: openTrips.filter((x) => received.has(x.id)),
    deposited: cash.map(([c]) => c).filter((c) => deposited.has(c)),
  }
  const available = enabled && !demo && (accounts.length > 0 || openTrips.length > 0 || cash.length > 0)
  const view = !available ? null : (
    <div className="money-step stack-sm">
      <button type="button" className="btn quiet disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon icon={Wallet} />
        <span className="grow">{t('weekMoney.title')}</span>
        <Icon icon={open ? ChevronUp : ChevronDown} />
      </button>
      {open && (
        <div className="stack-sm">
          <p className="muted small">{t('weekMoney.hint')}</p>
          {accounts.length > 0 && (
            <>
              <h3>{t('weekMoney.balances')}</h3>
              {parsedStands.map(({ account, text }) => {
                const last = balanceOn(balances, account.id, today)
                return (
                  <label key={account.id}>
                    {account.name}
                    {last && <span className="muted small"> · {t('weekMoney.lastStand', { amount: formatMoney(last.amount, account.currency), date: formatDate(last.date) })}</span>}
                    <input type="text" inputMode="decimal" autoComplete="off" placeholder={account.currency} value={text} onChange={(e) => setStands({ ...stands, [account.id]: e.target.value })} />
                  </label>
                )
              })}
            </>
          )}
          {openTrips.length > 0 && (
            <>
              <h3>{t('weekMoney.received')}</h3>
              {openTrips.map((x) => (
                <label key={x.id} className="check">
                  <input
                    type="checkbox"
                    checked={received.has(x.id)}
                    onChange={() => {
                      const next = new Set(received)
                      if (next.has(x.id)) next.delete(x.id)
                      else next.add(x.id)
                      setReceived(next)
                    }}
                  />
                  <span className="grow">{nameWithCounter(x, counters.get(x.id))}</span>
                  <span className="num small">{formatMoney(x.salary!.amount, x.salary!.currency)}</span>
                </label>
              ))}
              <p className="muted small">{t('weekMoney.receivedHint')}</p>
            </>
          )}
          {cash.length > 0 && (
            <>
              <h3>{t('weekMoney.cash')}</h3>
              {cash.map(([c, v]) => (
                <label key={c} className="check">
                  <input
                    type="checkbox"
                    checked={deposited.has(c)}
                    onChange={() => {
                      const next = new Set(deposited)
                      if (next.has(c)) next.delete(c)
                      else next.add(c)
                      setDeposited(next)
                    }}
                  />
                  <span className="grow">{t('weekMoney.deposited', { amount: formatMoney(v, c) })}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
  return { view, step, invalid }
}

function WeekCloseForm({ store, date, initial, onSaved }: { store: Store; date: string; initial: WeekClosing | null; onSaved: (undo?: () => Promise<void>, message?: string) => void }) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  // De geldstap hoort bij het afsluiten, niet bij het later bewerken van een afsluiting.
  const money = useMoneyStep(store, initial === null)
  const [busy, setBusy] = useState(false)
  const [rating, setRating] = useState<number | null>(initial?.rating ?? null)
  const [lesson, setLesson] = useState(initial?.lesson ?? '')
  // Eén getal: ongeveer los uitgegeven deze week (telt als variabele kosten van die week). Leeg = niet ingevuld.
  const [spent, setSpent] = useState(initial?.spent ? amountInput(initial.spent.amount) : '')
  const [currency, setCurrency] = useState<Currency>(initial?.spent?.currency ?? settings.lastCurrency)
  const spentValue = spent.trim() === '' ? null : parseAmount(spent)
  const spentInvalid = spent.trim() !== '' && spentValue === null

  async function save(e: FormEvent) {
    e.preventDefault()
    if (spentInvalid || money.invalid || busy) return
    setBusy(true)
    try {
      // De geldstap eerst (alleen wat is ingevuld of aangevinkt; één ongedaan maken voor alles daarvan), dan de afsluiting:
      // zodra die er staat, is de kaart weg.
      const result = isEmptyStep(money.step) ? null : await applyMoneyStep(store, money.step, todayIso(), getRates())
      await saveClosing(store, date, { rating, lesson, spent: spentValue !== null ? { amount: spentValue, currency } : null })
      // Zonder koers is een uitbetaling in gemengde valuta niet op te tellen: dan zeggen we dat, zonder te boeken.
      if (result) onSaved(result.undo, result.skipped.length > 0 ? t('weekMoney.skipped', { orgs: result.skipped.map((o) => organisationLabel(o)).join(', ') }) : undefined)
      else onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void save(e)}>
      <div className="stack-sm">
        <span className="label">{t('weekClose.rating')}</span>
        <div className="rating-buttons" role="radiogroup" aria-label={t('weekClose.rating')}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={rating === n} className={`chip${rating === n ? ' active' : ''}`} onClick={() => setRating(rating === n ? null : n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <label>
        {t('weekClose.lesson')}
        <input type="text" autoComplete="off" autoCapitalize="sentences" maxLength={LESSON_MAX} placeholder={t('weekClose.lessonPlaceholder')} value={lesson} onChange={(e) => setLesson(e.target.value)} />
      </label>
      <div className="row">
        <label className="grow">
          {t('weekClose.spent')}
          <input type="text" inputMode="decimal" autoComplete="off" value={spent} onChange={(e) => setSpent(e.target.value)} />
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
      {money.view}
      <button type="submit" className="btn primary" disabled={busy || spentInvalid || money.invalid || (rating === null && lesson.trim() === '' && spentValue === null && isEmptyStep(money.step))}>
        <Icon icon={CalendarCheck} />
        {t('weekClose.save')}
      </button>
    </form>
  )
}

/** Kaart op Vandaag: op zondag de week van vandaag, op maandag de week van gisteren, zolang die niet is afgesloten. */
export function WeekClose({ store, index, today, notify }: { store: Store; index: CalendarIndex; today: string; notify: Notify }) {
  const closings = useCollection(store, 'weekreviews.json.enc')
  const students = useCollection(store, 'students.json.enc')
  const date = weekToClose(today, closings)
  if (!date) return null
  const summary = weekSummary(index, students, date, today)
  return (
    <div className="card card-body week-close stack">
      <h2>
        <Icon icon={CalendarCheck} />
        {t('weekClose.title', { week: isoWeek(date) })}
      </h2>
      <p className="muted small">{formatDateRange(summary.start, summary.end)}</p>
      <SummaryLines summary={summary} />
      <WeekCloseForm key={date} store={store} date={date} initial={null} onSaved={(undo, message) => notify(message ?? t('weekClose.saved'), undo)} />
    </div>
  )
}

/** Blad om een week af te sluiten of een afsluiting te bewerken (met verwijderen en ongedaan maken). */
function WeekClosingSheet({ store, index, date, today, notify, onClose }: { store: Store; index: CalendarIndex; date: string; today: string; notify: Notify; onClose: () => void }) {
  const closings = useCollection(store, 'weekreviews.json.enc')
  const students = useCollection(store, 'students.json.enc')
  const closing = closingFor(closings, date)
  const summary = weekSummary(index, students, date, today)

  async function remove() {
    if (!closing) return
    const undo = await deleteWeekClosing(store, closing)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={closing ? t('weekClose.edit') : t('weekClose.title', { week: isoWeek(date) })} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{formatDateRange(summary.start, summary.end)}</p>
        <SummaryLines summary={summary} />
        <WeekCloseForm
          store={store}
          date={date}
          initial={closing}
          onSaved={(undo, message) => {
            onClose()
            notify(message ?? t('weekClose.saved'), undo)
          }}
        />
        {closing && (
          <button type="button" className="btn danger" onClick={() => void remove()}>
            <Icon icon={Trash2} />
            {t('common.delete')}
          </button>
        )}
      </div>
    </Sheet>
  )
}

/** Op de dagkaart van een zondag: de afsluiting van die week (terug te lezen), of "Week N afsluiten". */
export function WeekClosingSection({ store, index, date, today, notify }: { store: Store; index: CalendarIndex; date: string; today: string; notify: Notify }) {
  const closings = useCollection(store, 'weekreviews.json.enc')
  const students = useCollection(store, 'students.json.enc')
  const [open, setOpen] = useState(false)
  const closing = closingFor(closings, date)
  if (!closing && !canClose(date, today)) return null
  const week = isoWeek(date)
  return (
    <div className="stack-sm week-closing">
      {closing ? (
        <>
          <div className="section-head">
            <h3>{t('weekClose.heading', { week })}</h3>
            <button type="button" className="btn icon" aria-label={t('weekClose.edit')} onClick={() => setOpen(true)}>
              <Icon icon={Pencil} />
            </button>
          </div>
          {typeof closing.rating === 'number' && <p className="week-closing-rating">{t('weekClose.ratingLine', { rating: closing.rating })}</p>}
          {closing.lesson && <p className="week-closing-lesson">{closing.lesson}</p>}
          <SummaryLines summary={weekSummary(index, students, date, today)} />
        </>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          <Icon icon={CalendarCheck} />
          {t('weekClose.title', { week })}
        </button>
      )}
      {open && <WeekClosingSheet store={store} index={index} date={date} today={today} notify={notify} onClose={() => setOpen(false)} />}
    </div>
  )
}
