import { useMemo, useState } from 'react'
import { t } from '../i18n'
import { nameWithCounter } from '../model/counters'
import { expenseTargets, targetKey, type ExpenseTarget } from '../model/expenses'
import { allPeriods, isWaterKind, type Period } from '../model/periods'
import type { CostCategory } from '../model/types'
import type { Store } from '../storage/store'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'

// "Hoort bij" bij een uitgave (docs/PERIODEMODEL.md): de periodes rond de datum als knoppen, standaard de periode van
// die datum (een vlucht op een reisdag: de werkweek). Zonder periode op die dag: een nieuwe periode thuis of vrij.

export function usePeriods(store: Store): Period[] {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const stays = useCollection(store, 'periods.json.enc')
  return useMemo(() => allPeriods(trips.filter((x) => x.deletedAt === null), legs.filter((x) => x.deletedAt === null), stays.filter((x) => x.deletedAt === null)), [trips, legs, stays])
}

export function useBelongsTo(store: Store, date: string, category: CostCategory, preset?: string) {
  const periods = usePeriods(store)
  const calendar = useCollection(store, 'calendar.json.enc')
  // Een zelf ingestelde dagtoestand (optie, onbeschikbaar, beschikbaar) op die dag.
  const dayState = calendar.some((d) => d.deletedAt === null && d.date === date && (d.type === 'optie' || d.type === 'onbeschikbaar' || d.type === 'beschikbaar'))
  const { options, fallback } = useMemo(() => {
    const result = expenseTargets(periods, date, category, dayState)
    // Een vooraf gekozen periode (vanaf de periodepagina, of de huidige bij bewerken) staat er altijd bij.
    const given = preset ? periods.find((p) => p.id === preset) : undefined
    if (given && !result.options.some((o) => o.kind === 'periode' && o.period.id === given.id)) result.options.unshift({ kind: 'periode', period: given })
    return result
  }, [periods, date, category, preset, dayState])
  const [chosen, setChosen] = useState<string | null>(preset ?? null)
  const key = chosen && options.some((o) => targetKey(o) === chosen) ? chosen : targetKey(fallback)
  const current = options.find((o) => targetKey(o) === key) ?? fallback
  return { options, key, choose: setChosen, current }
}

export function targetLabel(target: ExpenseTarget, counter?: (period: Period) => string): string {
  if (target.kind === 'nieuw') return t('belongsTo.new', { kind: t(`periodKind.${target.stayKind}`) })
  const p = target.period
  const name = counter ? counter(p) : p.name
  return isWaterKind(p.kind) ? name : p.stay?.name ? `${t(`periodKind.${p.kind}`)} · ${p.stay.name}` : t(`periodKind.${p.kind}`)
}

export function BelongsTo({ store, options, value, onChange }: { store: Store; options: readonly ExpenseTarget[]; value: string; onChange: (key: string) => void }) {
  const counters = useCounters(store)
  const label = (p: Period) => (p.view ? nameWithCounter(p.view.trip, counters.get(p.id)) : p.name)
  return (
    <div className="stack-sm belongs-to">
      <span className="label">{t('belongsTo.title')}</span>
      <div className="type-buttons" role="radiogroup" aria-label={t('belongsTo.title')}>
        {options.map((o) => {
          const k = targetKey(o)
          return (
            <button key={k} type="button" role="radio" aria-checked={value === k} className={`chip${value === k ? ' active' : ''}`} onClick={() => onChange(k)}>
              {targetLabel(o, label)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
