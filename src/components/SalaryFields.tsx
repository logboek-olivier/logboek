import { ChevronDown, ChevronUp, Wallet } from 'lucide-react'
import { useState } from 'react'
import { formatMoney, formatNumber } from '../format'
import { t } from '../i18n'
import { parseAmount } from '../model/money'
import { salaryDefault, withSalaryDefault } from '../model/salary'
import { CURRENCIES, type Currency, type Organisation, type SalaryStatus, type Settings, type Trip, type TripSalary } from '../model/types'
import { Icon } from './Icon'
import { organisationLabel } from './WeekSheet'

// Salaris in het tripscherm, standaard ingeklapt (geen bedragen in beeld zolang Olivier er niet om vraagt). Zolang
// Olivier niets aanpast, geldt het standaardbedrag van de organisatie; een getypt bedrag is "eigen" en wordt nooit
// automatisch overschreven.

type Mode = 'auto' | 'eigen' | 'standaard'

export interface SalaryDraft {
  /** Wat opgeslagen wordt: undefined = laat het model beslissen (standaardbedrag), null = geen salaris. */
  input: () => TripSalary | null | undefined
  props: SalaryFieldsProps
}

interface SalaryFieldsProps {
  open: boolean
  setOpen: (open: boolean) => void
  amount: string
  currency: Currency
  status: SalaryStatus
  source: TripSalary['source'] | null
  standard: { amount: number; currency: Currency; org: Organisation } | null
  onAmount: (text: string) => void
  onCurrency: (c: Currency) => void
  onStatus: (s: SalaryStatus) => void
  onStandard: () => void
}

/** Toestand van het salarisveld voor een trip (of een nieuwe trip) met de gekozen organisatie. */
export function useSalaryDraft(trip: Trip | null, organisation: Organisation | '', settings: Settings): SalaryDraft {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('auto')
  const [text, setText] = useState('')
  const [currency, setCurrency] = useState<Currency>(trip?.salary?.currency ?? 'EUR')
  const [status, setStatus] = useState<SalaryStatus | null>(null)
  const org = organisation || undefined
  const def = salaryDefault(settings, org)
  // Wat er zonder aanpassen gebeurt: het bestaande salaris, of het standaardbedrag van de (nieuwe) organisatie.
  const draftTrip: Trip = trip ? { ...trip, ...(org ? { organisation: org } : {}) } : { id: '', name: '', updatedAt: '', deletedAt: null, ...(org ? { organisation: org } : {}) }
  if (trip && !org) delete draftTrip.organisation
  const effective = withSalaryDefault(draftTrip, settings, trip ?? undefined).salary ?? null
  const shownStatus = status ?? effective?.status ?? 'verwacht'
  const shown =
    mode === 'eigen'
      ? { amount: text, currency, source: 'eigen' as const }
      : mode === 'standaard' && def
        ? { amount: formatNumber(def.amount), currency: def.currency, source: 'standaard' as const }
        : { amount: effective ? formatNumber(effective.amount) : '', currency: effective?.currency ?? currency, source: effective?.source ?? null }

  function input(): TripSalary | null | undefined {
    const keep = trip?.salary?.transactionId ? { transactionId: trip.salary.transactionId } : {}
    if (mode === 'eigen') {
      const amount = parseAmount(text)
      if (amount === null || amount <= 0) return null
      return { amount, currency, status: shownStatus, source: 'eigen', ...keep }
    }
    if (mode === 'standaard' && def) return { amount: def.amount, currency: def.currency, status: shownStatus, source: 'standaard', ...keep }
    if (status !== null && effective) return { ...effective, status }
    return undefined
  }

  return {
    input,
    props: {
      open,
      setOpen,
      amount: shown.amount,
      currency: shown.currency,
      status: shownStatus,
      source: shown.source,
      standard: def && org ? { ...def, org } : null,
      onAmount: (value) => {
        if (mode !== 'eigen') setCurrency(shown.currency)
        setMode('eigen')
        setText(value)
      },
      onCurrency: (c) => {
        if (mode !== 'eigen') setText(shown.amount)
        setMode('eigen')
        setCurrency(c)
      },
      onStatus: setStatus,
      onStandard: () => setMode('standaard'),
    },
  }
}

export function SalaryFields(p: SalaryFieldsProps) {
  const summary = p.source ? `${t(`salaryStatus.${p.status}`)} · ${t(p.source === 'standaard' ? 'salary.sourceStandard' : 'salary.sourceOwn')}` : t('salary.none')
  return (
    <fieldset className="salary-fields">
      <button type="button" className="btn quiet disclosure" aria-expanded={p.open} onClick={() => p.setOpen(!p.open)}>
        <Icon icon={Wallet} />
        <span className="grow">{t('salary.title')}</span>
        <span className="muted small">{summary}</span>
        <Icon icon={p.open ? ChevronUp : ChevronDown} />
      </button>
      {p.open && (
        <div className="stack-sm">
          <div className="row">
            <label className="grow">
              {t('salary.amount')}
              <input type="text" inputMode="decimal" autoComplete="off" value={p.amount} onChange={(e) => p.onAmount(e.target.value)} />
            </label>
            <label>
              {t('field.currency')}
              <select value={p.currency} onChange={(e) => p.onCurrency(e.target.value as Currency)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="segments small" role="radiogroup" aria-label={t('salary.status')}>
            {(['verwacht', 'ontvangen'] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={p.status === s} className={`segment${p.status === s ? ' active' : ''}`} onClick={() => p.onStatus(s)}>
                {t(`salaryStatus.${s}`)}
              </button>
            ))}
          </div>
          {p.source === 'standaard' && p.standard && <p className="muted small">{t('salary.isStandard', { org: organisationLabel(p.standard.org) })}</p>}
          {p.source !== 'standaard' && p.standard && (
            <button type="button" className="btn small" onClick={p.onStandard}>
              {t('salary.useStandard', { amount: formatMoney(p.standard.amount, p.standard.currency) })}
            </button>
          )}
          {!p.standard && <p className="muted small">{t('salary.noStandard')}</p>}
        </div>
      )}
    </fieldset>
  )
}
