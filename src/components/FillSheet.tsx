import { SkipForward } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { formatDate, formatNumber } from '../format'
import { t } from '../i18n'
import { type Gap } from '../model/gaps'
import { feetToMetres } from '../model/weeks'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { aanvullen } from '../domain/dagen'
import { parseAmount } from '../basis/bedrag'
import { todayIso } from '../basis/datum'

// "N dingen aanvullen": de lege velden één voor één, met een voorstel uit de dagen waar dat kan. Opslaan of
// overslaan gaat naar het volgende veld; sluiten mag altijd.

const FIELD_LABEL = {
  boat: 'boat.name',
  boatModel: 'boat.model',
  boatLengthFt: 'boat.length',
  base: 'boat.base',
  startDate: 'week.startDate',
  fromPlace: 'field.from',
  toPlace: 'field.to',
} as const

export function FillSheet({ store, gaps, notify, onClose }: { store: Store; gaps: Gap[]; notify: Notify; onClose: () => void }) {
  // De lijst staat vast bij openen; opgeslagen velden verdwijnen pas bij het volgende openen uit de telling.
  const [items] = useState(gaps)
  const [index, setIndex] = useState(0)
  const [filled, setFilled] = useState(0)
  const gap = items[index]
  if (!gap) return null

  function next(saved: boolean) {
    const count = filled + (saved ? 1 : 0)
    setFilled(count)
    if (index + 1 >= items.length) {
      onClose()
      notify(t('gaps.done', { n: count }))
    } else setIndex(index + 1)
  }

  return (
    <Sheet title={t('gaps.sheetTitle', { i: index + 1, n: items.length })} onClose={onClose}>
      <GapForm key={gap.key} store={store} gap={gap} onNext={next} />
    </Sheet>
  )
}

function GapForm({ store, gap, onNext }: { store: Store; gap: Gap; onNext: (saved: boolean) => void }) {
  const initial = gap.field === 'boatLengthFt' && gap.suggestion ? formatNumber(Number(gap.suggestion)) : gap.field === 'startDate' ? todayIso() : gap.suggestion
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const numeric = gap.field === 'boatLengthFt'
  const parsed = numeric ? parseAmount(value) : value.trim()
  const ok = numeric ? parsed !== null : value.trim() !== ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy || parsed === null) return
    setBusy(true)
    try {
      await aanvullen(store, gap, numeric ? Math.round((parsed as number) * 10) / 10 : (parsed as string).slice(0, 120))
      onNext(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack fill-card" onSubmit={(e) => void submit(e)}>
      <div className="fill-context">
        <strong>{context(gap)}</strong>
        <span className="muted small">{detail(gap)}</span>
      </div>
      <label>
        {t(FIELD_LABEL[gap.field])}
        <input
          type={gap.field === 'startDate' ? 'date' : 'text'}
          inputMode={numeric ? 'decimal' : undefined}
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {numeric && typeof parsed === 'number' && <span className="muted small">{t('boat.metres', { m: formatNumber(feetToMetres(parsed)) })}</span>}
      {gap.suggestion && gap.field !== 'boatLengthFt' && value === gap.suggestion && <p className="muted small">{t('gaps.suggested')}</p>}
      <div className="sheet-actions">
        <button className="btn primary" type="submit" disabled={!ok || busy}>
          {t('common.save')}
        </button>
        <button className="btn" type="button" onClick={() => onNext(false)}>
          <Icon icon={SkipForward} />
          {t('gaps.skip')}
        </button>
      </div>
    </form>
  )
}

function context(gap: Gap): string {
  if (gap.kind === 'boat') return gap.boat
  if (gap.kind === 'trip') return gap.trip.name
  return [gap.leg.fromPlace, gap.leg.toPlace].filter(Boolean).join(' → ') || t('gaps.day')
}

function detail(gap: Gap): string {
  if (gap.kind === 'boat') return t('gaps.boatTrips', { n: gap.tripIds.length })
  if (gap.kind === 'trip') return t('gaps.trip')
  return [formatDate(gap.leg.date), gap.trip?.name ?? ''].filter(Boolean).join(' · ')
}
