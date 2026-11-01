import { Check } from 'lucide-react'
import { useState } from 'react'
import { useReviewItems } from '../components/ReviewNotice'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { organisationLabel, weekTypeLabel } from '../components/WeekSheet'
import { formatDate, formatDateRange } from '../format'
import { t, useLang, type Lang } from '../i18n'
import { kindLabel } from '../i18n/labels'
import type { Undo } from '../model/changes'
import type { ReviewItem } from '../model/review'
import { WORK_TYPES, type Organisation, type WeekType } from '../model/types'
import type { Store } from '../storage/store'
import { tripTerugzetten } from '../domain/prullenbak'
import { trashItemForTrip } from '../model/trash'
import { defaultTripName } from '../model/trip-name'
import { tripVoorDagen, geldKoppelen, investeringssoortZetten, landperiodeMaken, nakijkenKloptZo, periodeMakenOverDagen, periodeOrganisatieZetten, periodeSoortZetten, soortenOvernemen } from '../domain/trips'
import { organisationChoices } from '../basis/organisatie'

// Nakijken (Meer → Nakijken, docs/PERIODEMODEL.md): vragen over wat ontbreekt (soort, organisatie, periode), elk met één
// knop (met ongedaan maken) en "Klopt zo". Nooit een voorstel om iets uit de import te verbeteren, trips samen te voegen
// of dagen te verplaatsen. Zonder punten staat het scherm niet in Meer.

/** Soort als knop: werk met subtype, training of plezier. */
const KIND_CHOICES: readonly WeekType[] = [...WORK_TYPES, 'zelf-trainen', 'zelf-cruisen']

export function kindChoiceLabel(type: WeekType): string {
  if (type === 'zelf-trainen') return t('periodKind.training')
  if (type === 'zelf-cruisen') return t('periodKind.plezier')
  if (type === 'overig') return t('review.workOther')
  return weekTypeLabel(type)
}

export function Review({ store, notify }: { store: Store; notify: Notify }) {
  const lang = useLang()
  const items = useReviewItems(store)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<Undo>, message = t('review.fixed')) {
    if (busy) return
    setBusy(true)
    try {
      const undo = await action()
      notify(message, undo)
    } finally {
      setBusy(false)
    }
  }

  const kinds = items.filter((i) => i.kind === 'soort')

  return (
    <section className="stack-lg review">
      <header className="page-header">
        <h1>{t('review.title')}</h1>
      </header>
      {items.length === 0 ? (
        <p className="muted">
          <Icon icon={Check} /> {t('review.empty')}
        </p>
      ) : (
        <p className="muted">{t('review.intro', { n: items.length })}</p>
      )}
      {kinds.length > 1 && (
        <button type="button" className="btn" disabled={busy} onClick={() => void run(() => soortenOvernemen(store, kinds))}>
          {t('review.acceptAllKinds', { n: kinds.length })}
        </button>
      )}
      <ul className="rows review-list">
        {items.map((item) => (
          <li key={item.key} className="card card-body review-item">
            <p>{describe(item)}</p>
            <div className="review-actions">
              {fixes(store, item, lang).map((fix) => (
                <button key={fix.label} type="button" className={`btn small${fix.primary ? ' primary' : ''}`} disabled={busy} onClick={() => void run(fix.run)}>
                  {fix.label}
                </button>
              ))}
              <button type="button" className="btn small link" disabled={busy} onClick={() => void run(() => nakijkenKloptZo(store, item), t('review.dismissed'))}>
                {t('review.ok')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Eén regel per punt, in gewone taal; geen bedragen. */
function describe(item: ReviewItem): string {
  switch (item.kind) {
    case 'soort':
      return t('review.kindQuestion', { name: item.trip.name, range: range(item.trip.startDate, item.trip.endDate) })
    case 'organisatie':
      return t('review.orgQuestion', { name: item.trip.name, range: range(item.trip.startDate, item.trip.endDate) })
    case 'werkdag-zonder-trip':
      return t('review.workWithoutTrip', { range: formatDateRange(item.from, item.to) })
    case 'dag-zonder-periode':
      return t('review.dayWithoutPeriod', { range: formatDateRange(item.from, item.to), kind: t(`periodKind.${item.stayKind}`) })
    case 'dagen-zonder-trip':
      return t('review.daysWithoutTrip', { n: item.legs.length, range: formatDateRange(item.legs[0]!.date, item.legs.at(-1)!.date), name: item.tripName ?? t('review.unknownTrip') })
    case 'geld-zonder-periode':
      return t('review.moneyWithoutPeriod', { kind: kindLabel(item.tx.kind), date: formatDate(item.tx.date), note: item.tx.note ? ` · ${item.tx.note}` : '' })
    case 'investering-soort':
      return t('review.investmentKind', { date: formatDate(item.tx.date), note: item.tx.note ? ` · ${item.tx.note}` : '' })
  }
}

function range(start?: string, end?: string): string {
  return start && end ? formatDateRange(start, end) : start ? formatDate(start) : t('review.noDates')
}

type Fix = { label: string; primary?: boolean; run: () => Promise<Undo> }

function fixes(store: Store, item: ReviewItem, lang: Lang): Fix[] {
  switch (item.kind) {
    case 'soort':
      return [item.suggestion, ...KIND_CHOICES.filter((k) => k !== item.suggestion)].map((type, i) => ({ label: kindChoiceLabel(type), primary: i === 0, run: () => periodeSoortZetten(store, item.trip, type) }))
    case 'organisatie': {
      const order: Organisation[] = item.suggestion ? [item.suggestion, ...organisationChoices().filter((o) => o !== item.suggestion)] : organisationChoices()
      return order.map((org, i) => ({ label: organisationLabel(org), primary: i === 0 && !!item.suggestion, run: () => periodeOrganisatieZetten(store, item.trip, org) }))
    }
    case 'dagen-zonder-trip': {
      // Op id: een andere trip met dezelfde naam in de prullenbak telt niet.
      const restorable = !!item.tripName && !!trashItemForTrip(store, item.tripId)
      return [
        ...(restorable ? [{ label: t('review.restoreTrip', { name: item.tripName! }), primary: true, run: () => tripTerugzetten(store, item.tripId) }] : []),
        { label: t('review.newTripForDays'), primary: !restorable, run: () => tripVoorDagen(store, item.legs, item.tripName ?? defaultTripName(item.legs[0]!.boat || t('field.trip'), item.legs[0]!.date)) },
      ]
    }
    case 'werkdag-zonder-trip':
      return [{ label: t('review.makeTrip'), primary: true, run: () => periodeMakenOverDagen(store, item.from, item.to, lang) }]
    case 'dag-zonder-periode':
      return [{ label: t('review.makePeriod'), primary: true, run: () => landperiodeMaken(store, item.stayKind, item.from, item.to) }]
    case 'geld-zonder-periode':
      return [{ label: item.target ? t('review.linkTo', { name: item.target.name }) : t('review.makeHome'), primary: true, run: () => geldKoppelen(store, item.tx, item.target) }]
    case 'investering-soort':
      return (['opleiding', 'uitrusting'] as const).map((c) => ({ label: t(`costCategory.${c}`), run: () => investeringssoortZetten(store, item.tx, c) }))
  }
}
