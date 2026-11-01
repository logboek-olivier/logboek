import { Check, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { t } from '../i18n'
import { doubtfulTrips, firstNumber, ORG_CODE, tripCounters } from '../model/counters'
import { currentSettings } from '../model/settings'
import { COUNTED_ORGANISATIONS, type CountedOrganisation } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { organisationLabel } from './WeekSheet'
import { organisatieBeantwoorden, tellerBeginnummersOpslaan } from '../domain/trips'

/** Twijfel bij de teller: een naam met alleen "SV" of "YW". Eén vraag tegelijk, ja of nee, nooit stil meegeteld. */
export function CounterDoubtNotice({ store, notify }: { store: Store; notify: Notify }) {
  const trips = useCollection(store, 'trips.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const [busy, setBusy] = useState(false)
  const doubts = doubtfulTrips(trips, settings)
  const first = doubts[0]
  if (!first) return null

  async function answer(yes: boolean) {
    if (!first || busy) return
    setBusy(true)
    try {
      await organisatieBeantwoorden(store, first.trip, first.org, yes)
      const label = tripCounters(store.list('trips.json.enc'), store.list('legs.json.enc'), currentSettings(store.get('settings.json.enc'))).get(first.trip.id)?.label
      notify(yes && label ? t('counter.counted', { name: first.trip.name, label }) : t('counter.notCounted', { name: first.trip.name }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="notice counter-doubt">
      <p className="small">{t('counter.doubt', { name: first.trip.name, org: organisationLabel(first.org) })}</p>
      {doubts.length > 1 && <p className="muted small">{t('counter.doubtLeft', { n: doubts.length - 1 })}</p>}
      <div className="row">
        <button className="btn small primary" disabled={busy} onClick={() => void answer(true)}>
          <Icon icon={Check} />
          {t('counter.yes')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => void answer(false)}>
          <Icon icon={X} />
          {t('counter.no')}
        </button>
      </div>
    </div>
  )
}

/** Korte weergave van de beginnummers voor de rij in Instellingen: "SV #1 · YW #10". */
export function firstNumbersLine(store: Store): string {
  const settings = currentSettings(store.get('settings.json.enc'))
  return COUNTED_ORGANISATIONS.map((org) => `${ORG_CODE[org]} #${firstNumber(settings, org)}`).join(' · ')
}

/** Beginnummer per organisatie, voor trips van vóór de app. */
export function FirstNumbersSheet({ store, onClose, notify }: { store: Store; onClose: () => void; notify: Notify }) {
  const settings = currentSettings(store.get('settings.json.enc'))
  const [values, setValues] = useState<Record<CountedOrganisation, string>>(() => ({
    'sailing-virgins': String(firstNumber(settings, 'sailing-virgins')),
    'yacht-week': String(firstNumber(settings, 'yacht-week')),
  }))
  const parse = (v: string) => (/^\d{1,4}$/.test(v.trim()) && Number(v) >= 1 ? Number(v) : null)
  const valid = COUNTED_ORGANISATIONS.every((org) => parse(values[org]) !== null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    await tellerBeginnummersOpslaan(store, { 'sailing-virgins': parse(values['sailing-virgins']) ?? 1, 'yacht-week': parse(values['yacht-week']) ?? 1 })
    onClose()
    notify(t('counter.saved'))
  }

  return (
    <Sheet title={t('counter.title')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="two">
          {COUNTED_ORGANISATIONS.map((org) => (
            <label key={org}>
              {t('counter.first', { org: ORG_CODE[org] })}
              <input inputMode="numeric" autoComplete="off" value={values[org]} onChange={(e) => setValues({ ...values, [org]: e.target.value })} />
            </label>
          ))}
        </div>
        <p className="muted small">{t('counter.firstHint')}</p>
        <button className="btn primary" type="submit" disabled={!valid}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}
