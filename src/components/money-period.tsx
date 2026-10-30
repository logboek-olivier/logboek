import { CalendarRange } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { formatDate } from '../format'
import { t } from '../i18n'
import type { PeriodChoice, PeriodPreset, Period } from '../model/position'
import { Icon } from './Icon'

// De periode voor Mijn positie en de vooruitblik in Geld: een snelkeuze of zelf van en tot. Per apparaat onthouden in
// localStorage (geen inhoud, alleen de keuze en twee datums), net als de taal; niet gesynct.

const KEY = 'logboek-geld-periode'
const PRESETS: readonly PeriodPreset[] = ['carriere', 'jaar', 'planning', 'alles', 'eigen']
const DEFAULT: PeriodChoice = { preset: 'carriere' }
const listeners = new Set<() => void>()
let cached: PeriodChoice | null = null

function read(): PeriodChoice {
  if (cached) return cached
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PeriodChoice> | null
    if (raw && PRESETS.includes(raw.preset as PeriodPreset)) {
      cached = { preset: raw.preset as PeriodPreset, ...(typeof raw.from === 'string' ? { from: raw.from } : {}), ...(typeof raw.to === 'string' ? { to: raw.to } : {}) }
      return cached
    }
  } catch {
    // Geen opslag (privévenster) of iets onleesbaars: de standaardkeuze.
  }
  cached = DEFAULT
  return cached
}

export function setPeriodChoice(choice: PeriodChoice): void {
  cached = choice
  try {
    localStorage.setItem(KEY, JSON.stringify(choice))
  } catch {
    // Niet te bewaren: geldt dan alleen tot herladen.
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** De gekozen periode (gedeeld door Mijn positie en de vooruitblik). */
export function usePeriodChoice(): PeriodChoice {
  return useSyncExternalStore(subscribe, read, () => DEFAULT)
}

/** Snelkeuzes en zelf kiezen, met de periode die eruit volgt. */
export function PeriodPicker({ period }: { period: Period }) {
  const choice = usePeriodChoice()
  return (
    <div className="section card card-body stack-sm money-period">
      <div className="section-head">
        <h2>
          <Icon icon={CalendarRange} />
          {t('period.title')}
        </h2>
        <span className="muted small">
          {formatDate(period.from)} – {formatDate(period.to)}
        </span>
      </div>
      <div className="type-buttons" role="radiogroup" aria-label={t('period.title')}>
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={choice.preset === p}
            className={`chip${choice.preset === p ? ' active' : ''}`}
            onClick={() => setPeriodChoice(p === 'eigen' ? { preset: 'eigen', from: choice.from ?? period.from, to: choice.to ?? period.to } : { ...choice, preset: p })}
          >
            {t(`period.${p}`)}
          </button>
        ))}
      </div>
      {choice.preset === 'eigen' && (
        <div className="two">
          <label>
            {t('period.from')}
            <input type="date" value={choice.from ?? period.from} max={choice.to ?? period.to} onChange={(e) => e.target.value && setPeriodChoice({ ...choice, from: e.target.value })} />
          </label>
          <label>
            {t('period.to')}
            <input type="date" value={choice.to ?? period.to} min={choice.from ?? period.from} onChange={(e) => e.target.value && setPeriodChoice({ ...choice, to: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  )
}
