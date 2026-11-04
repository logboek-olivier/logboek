import { useState, useSyncExternalStore } from 'react'
import { formatDateRangeShort, formatMoney } from '../format'
import { getLang, t } from '../i18n'
import { parseStand, amountInput } from '../basis/bedrag'
import { todayIso } from '../basis/datum'
import { organisationOfTrip } from '../basis/organisatie'
import { fooiStandaardZetten, verwachteFooiZetten } from '../domain/geld'
import { nameWithCounter } from '../model/counters'
import { getRates, subscribeRates } from '../model/rates'
import { expectedTip, tipAverages, tripEnd } from '../model/salary'
import { currentSettings, defaultCurrency } from '../model/settings'
import { tripKind } from '../model/trip-kind'
import { endedFor } from '../model/trip-dates'
import { active } from '../model/derive'
import { CURRENCIES, type Currency, type Organisation, type SalaryDefault, type Trip } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { organisationLabel } from '../i18n/labels'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'

// Geld → Verwacht → Gepland: de verwachte fooi zelf instellen, per organisatie (standaard per trip) en per charter.
// Gewoon typen, zoals in Excel: opslaan bij het verlaten van het veld. Leeg = de standaard van de organisatie, en zonder
// standaard het eigen gemiddelde (trips zonder fooi tellen mee als 0, vanaf de eerste gelogde fooi). De vooruitblik en
// het scenario ("De planning") rekenen met dezelfde verwachting (`expectedTip` in src/model/salary.ts).

/** Een bedrag om in te typen: opslaan bij het verlaten van het veld of Enter; leeg = geen eigen bedrag. */
function AmountCell({ label, value, currency, placeholder, onCommit }: { label: string; value: SalaryDefault | undefined; currency: Currency; placeholder: string; onCommit: (value: SalaryDefault | null) => void }) {
  const [text, setText] = useState(value ? amountInput(value.amount) : '')
  const [cur, setCur] = useState<Currency>(value?.currency ?? currency)
  const parsed = text.trim() === '' ? null : parseStand(text, getLang())
  const invalid = parsed !== null && parsed < 0
  function commit(nextCurrency: Currency = cur) {
    if (invalid || (text.trim() !== '' && parsed === null)) return
    const next = parsed === null ? null : { amount: parsed, currency: nextCurrency }
    const same = next === null ? !value : !!value && value.amount === next.amount && value.currency === next.currency
    if (!same) onCommit(next)
  }
  return (
    <span className="amount-currency expected-tip-cell">
      <input
        className="amount"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      <select
        aria-label={`${label}: ${t('scenario.currency')}`}
        value={cur}
        onChange={(e) => {
          const next = e.target.value as Currency
          setCur(next)
          if (parsed !== null) commit(next)
        }}
      >
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </span>
  )
}

export function ExpectedTips({ store, notify }: { store: Store; notify: Notify }) {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const counters = useCounters(store)
  const rates = useSyncExternalStore(subscribeRates, getRates)
  const today = todayIso()
  const averages = tipAverages(trips, legs, transactions, today)
  // Komende werktrips (nog niet voorbij), eerstvolgende eerst.
  const upcoming = active(trips)
    .map((trip) => ({ trip, end: tripEnd(trip, legs) }))
    .filter(({ trip, end }) => end && endedFor(trip, end) >= today && tripKind(trip, legs).kind === 'werk')
    .sort((a, b) => a.end.localeCompare(b.end))
  if (upcoming.length === 0) return null
  const orgs = [...new Set(upcoming.map(({ trip }) => organisationOfTrip(trip)).filter((o) => o !== 'overig'))] as Organisation[]
  const fallbackCurrency = defaultCurrency(settings, 'fooi')
  const placeholderFor = (trip: Trip) => {
    const org = organisationOfTrip(trip)
    const def = settings.tipDefaults?.[org]
    if (def) return formatMoney(def.amount, def.currency)
    const avg = averages[org]
    return avg !== undefined ? t('expectedTips.average', { amount: formatMoney(avg, 'EUR') }) : t('expectedTips.none')
  }
  async function saveTrip(trip: Trip, value: SalaryDefault | null) {
    const undo = await verwachteFooiZetten(store, trip.id, value)
    notify(t('expectedTips.saved'), undo)
  }
  async function saveDefault(org: Organisation, value: SalaryDefault | null) {
    const undo = await fooiStandaardZetten(store, org, value)
    notify(t('expectedTips.saved'), undo)
  }
  return (
    <div className="section card card-body stack-sm expected-tips">
      <h2>{t('expectedTips.title')}</h2>
      {orgs.length > 0 && (
        <ul className="plain-list expected-tip-list">
          {orgs.map((org) => (
            <li key={org} className="expected-tip-row">
              <span className="grow">
                {t('expectedTips.default', { org: organisationLabel(org) })}
                {averages[org] !== undefined && <span className="muted small"> · {t('expectedTips.average', { amount: formatMoney(averages[org]!, 'EUR') })}</span>}
              </span>
              <AmountCell
                key={`${org}-${settings.tipDefaults?.[org]?.amount ?? ''}-${settings.tipDefaults?.[org]?.currency ?? ''}`}
                label={t('expectedTips.default', { org: organisationLabel(org) })}
                value={settings.tipDefaults?.[org]}
                currency={settings.tipDefaults?.[org]?.currency ?? fallbackCurrency}
                placeholder={averages[org] !== undefined ? amountInput(averages[org]!) : ''}
                onCommit={(v) => void saveDefault(org, v)}
              />
            </li>
          ))}
        </ul>
      )}
      <ul className="plain-list expected-tip-list">
        {upcoming.map(({ trip }) => {
          const tip = expectedTip(trip, averages, settings, tripEnd(trip, legs), rates)
          const range = trip.startDate && trip.endDate ? formatDateRangeShort(trip.startDate, trip.endDate) : ''
          return (
            <li key={trip.id} className="expected-tip-row">
              <span className="grow">
                {nameWithCounter(trip, counters.get(trip.id))}
                <span className="muted small"> · {[range, tip ? formatMoney(tip.eur, 'EUR') : ''].filter(Boolean).join(' · ')}</span>
              </span>
              <AmountCell
                key={`${trip.id}-${trip.expectedTip?.amount ?? ''}-${trip.expectedTip?.currency ?? ''}`}
                label={t('expectedTips.forTrip', { name: trip.name })}
                value={trip.expectedTip}
                currency={trip.expectedTip?.currency ?? settings.tipDefaults?.[organisationOfTrip(trip)]?.currency ?? fallbackCurrency}
                placeholder={placeholderFor(trip)}
                onCommit={(v) => void saveTrip(trip, v)}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
