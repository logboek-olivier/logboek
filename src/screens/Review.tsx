import { Check } from 'lucide-react'
import { useState } from 'react'
import { useReviewItems } from '../components/ReviewNotice'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { OverlapNotices } from '../components/TripSheets'
import { organisationLabel, WeekSheet, weekTypeLabel } from '../components/WeekSheet'
import { formatDate, formatDateRange } from '../format'
import { t, useLang, type Lang } from '../i18n'
import { kindLabel } from '../i18n/labels'
import type { Undo } from '../model/changes'
import { mergePlaceInto } from '../model/places'
import {
  dismissReview,
  fixDayInTrip,
  fixLandOverlap,
  fixLegOutside,
  fixMoneyWithoutPeriod,
  makeStayFor,
  makeTripFor,
  setTripKind,
  setTripOrganisation,
  type ReviewItem,
} from '../model/review'
import { ORGANISATIONS, WORK_TYPES, type Organisation, type Trip, type WeekType } from '../model/types'
import type { Store } from '../storage/store'

// Nakijken (Meer → Nakijken, docs/PERIODEMODEL.md): twijfelgevallen en tegenstrijdigheden, elk met één knop die het
// oplost (met ongedaan maken) en "Klopt zo". Zonder punten staat het scherm niet in Meer.

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
  const [editTrip, setEditTrip] = useState<Trip | null>(null)

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

  const overlaps = items.flatMap((i) => (i.kind === 'overlap-trips' ? [i.overlap] : []))
  const rest = items.filter((i) => i.kind !== 'overlap-trips')

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
      <OverlapNotices store={store} overlaps={overlaps} notify={notify} onEditTrip={setEditTrip} />
      <ul className="rows review-list">
        {rest.map((item) => (
          <li key={item.key} className="card review-item">
            <p>{describe(item)}</p>
            <div className="review-actions">
              {fixes(store, item, lang).map((fix) => (
                <button key={fix.label} type="button" className={`btn small${fix.primary ? ' primary' : ''}`} disabled={busy} onClick={() => void run(fix.run)}>
                  {fix.label}
                </button>
              ))}
              <button type="button" className="btn small link" disabled={busy} onClick={() => void run(() => dismissReview(store, item), t('review.dismissed'))}>
                {t('review.ok')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editTrip && <WeekSheet key={editTrip.id} store={store} trip={editTrip} notify={notify} onClose={() => setEditTrip(null)} />}
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
    case 'overlap-land':
      return t('review.landOverlap', { name: item.stay.name || t(`periodKind.${item.stay.kind}`), other: item.other.name, range: formatDateRange(item.from, item.to) })
    case 'dag-buiten':
      return t('review.legOutside', { date: formatDate(item.leg.date), route: [item.leg.fromPlace, item.leg.toPlace].filter(Boolean).join(' → ') || '–', trip: item.trip.name, range: range(item.trip.startDate, item.trip.endDate) })
    case 'agendadag-in-trip':
      return t('review.dayInTrip', { date: formatDate(item.day.date), type: t(`dayType.${item.day.type}`), trip: item.trip.name })
    case 'werkdag-zonder-trip':
      return t('review.workWithoutTrip', { range: formatDateRange(item.from, item.to) })
    case 'dag-zonder-periode':
      return t('review.dayWithoutPeriod', { range: formatDateRange(item.from, item.to), kind: t(`periodKind.${item.stayKind}`) })
    case 'geld-zonder-periode':
      return t('review.moneyWithoutPeriod', { kind: kindLabel(item.tx.kind), date: formatDate(item.tx.date), note: item.tx.note ? ` · ${item.tx.note}` : '' })
    case 'plaatsen':
      return item.reason === 'spelling' ? t('review.placesSpelling', { a: item.from.name, b: item.into.name }) : t('review.placesJoin', { a: item.from.name, b: item.into.name })
    case 'overlap-trips':
      return ''
  }
}

function range(start?: string, end?: string): string {
  return start && end ? formatDateRange(start, end) : start ? formatDate(start) : t('review.noDates')
}

interface Fix {
  label: string
  primary?: boolean
  run: () => Promise<Undo>
}

function fixes(store: Store, item: ReviewItem, lang: Lang): Fix[] {
  switch (item.kind) {
    case 'soort':
      return [item.suggestion, ...KIND_CHOICES.filter((k) => k !== item.suggestion)].map((type, i) => ({ label: kindChoiceLabel(type), primary: i === 0, run: () => setTripKind(store, item.trip, type) }))
    case 'organisatie': {
      const order: Organisation[] = item.suggestion ? [item.suggestion, ...ORGANISATIONS.filter((o) => o !== item.suggestion)] : [...ORGANISATIONS]
      return order.map((org, i) => ({ label: organisationLabel(org), primary: i === 0 && !!item.suggestion, run: () => setTripOrganisation(store, item.trip, org) }))
    }
    case 'overlap-land':
      return [{ label: t('review.otherWins', { name: item.other.name }), primary: true, run: () => fixLandOverlap(store, item.from, item.to, item.other) }]
    case 'dag-buiten':
      return [
        {
          label: item.target ? t('review.moveTo', { name: item.target.name }) : t('review.extendTo', { name: item.trip.name, date: formatDate(item.leg.date) }),
          primary: true,
          run: () => fixLegOutside(store, item.leg, item.trip, item.target),
        },
      ]
    case 'agendadag-in-trip':
      return [{ label: t('review.belongsTo', { name: item.trip.name }), primary: true, run: () => fixDayInTrip(store, item.day) }]
    case 'werkdag-zonder-trip':
      return [{ label: t('review.makeTrip'), primary: true, run: () => makeTripFor(store, item.from, item.to, lang) }]
    case 'dag-zonder-periode':
      return [{ label: t('review.makePeriod'), primary: true, run: () => makeStayFor(store, item.stayKind, item.from, item.to) }]
    case 'geld-zonder-periode':
      return [{ label: item.target ? t('review.linkTo', { name: item.target.name }) : t('review.makeHome'), primary: true, run: () => fixMoneyWithoutPeriod(store, item.tx, item.target) }]
    case 'plaatsen':
      return [{ label: t('review.mergeInto', { name: item.into.name }), primary: true, run: () => mergePlaceInto(store, item.from, item.into) }]
    case 'overlap-trips':
      return []
  }
}
