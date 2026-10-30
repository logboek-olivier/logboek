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
import { LegSheet } from '../components/EditSheets'
import { stayName } from '../model/periods'
import {
  acceptAllKinds,
  fixDayInStay,
  fixLegStart,
  legOutsideCanExtend,
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
import { ORGANISATIONS, WORK_TYPES, type Leg, type Organisation, type Trip, type WeekType } from '../model/types'
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
  const [editLeg, setEditLeg] = useState<Leg | null>(null)

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
        <button type="button" className="btn" disabled={busy} onClick={() => void run(() => acceptAllKinds(store, kinds))}>
          {t('review.acceptAllKinds', { n: kinds.length })}
        </button>
      )}
      <OverlapNotices store={store} overlaps={overlaps} notify={notify} onEditTrip={setEditTrip} />
      <ul className="rows review-list">
        {rest.map((item) => (
          <li key={item.key} className="card card-body review-item">
            <p>{describe(item)}</p>
            <div className="review-actions">
              {fixes(store, item, lang).map((fix) => (
                <button key={fix.label} type="button" className={`btn small${fix.primary ? ' primary' : ''}`} disabled={busy} onClick={() => (fix.edit ? setEditLeg(fix.edit) : void run(fix.run))}>
                  {fix.label}
                </button>
              ))}
              <button type="button" className="btn small link" disabled={busy} onClick={() => void run(() => dismissReview(store, item), t('review.dismissed'))}>
                {item.kind === 'aansluiting' || item.kind === 'plaatsen' ? t('review.notSame') : t('review.ok')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editTrip && <WeekSheet key={editTrip.id} store={store} trip={editTrip} notify={notify} onClose={() => setEditTrip(null)} />}
      {editLeg && <LegSheet store={store} leg={editLeg} notify={notify} onClose={() => setEditLeg(null)} />}
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
      return t('review.placesSpelling', { a: item.from.name, b: item.into.name })
    case 'aansluiting':
      return t('review.placesJoin', { date: formatDate(item.leg.date), a: item.leg.fromPlace, b: item.previous.toPlace })
    case 'agendadag-in-periode':
      return t('review.dayInStay', { date: formatDate(item.day.date), type: t(`dayType.${item.day.type}`), name: stayName(item.stay) })
    case 'overlap-trips':
      return ''
  }
}

function range(start?: string, end?: string): string {
  return start && end ? formatDateRange(start, end) : start ? formatDate(start) : t('review.noDates')
}

type Fix = { label: string; primary?: boolean } & ({ run: () => Promise<Undo>; edit?: undefined } | { edit: Leg; run?: undefined })

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
      // Ver buiten de trip is de datum vast fout: dan de dag bewerken, nooit weken verlengen met één tik.
      if (!item.target && !legOutsideCanExtend(item.leg, item.trip)) return [{ label: t('review.editDay'), primary: true, edit: item.leg }]
      return [
        {
          label: item.target ? t('review.moveTo', { name: item.target.name }) : t('review.extendTo', { name: item.trip.name, date: formatDate(item.leg.date) }),
          primary: true,
          run: () => fixLegOutside(store, item.leg, item.trip, item.target),
        },
        { label: t('review.editDay'), edit: item.leg },
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
      return [{ label: t('review.mergeInto', { name: item.into.name, n: item.from.days }), primary: true, run: () => mergePlaceInto(store, item.from, item.into) }]
    case 'aansluiting':
      // Eerst alleen deze dag; overal samenvoegen raakt ook andere trips en staat er daarom met het aantal dagen bij.
      return [
        { label: t('review.startAt', { name: item.previous.toPlace }), primary: true, run: () => fixLegStart(store, item.leg, item.previous) },
        { label: t('review.mergeInto', { name: item.into.name, n: item.from.days }), run: () => mergePlaceInto(store, item.from, item.into) },
      ]
    case 'agendadag-in-periode':
      return [{ label: t('review.dayWins', { type: t(`dayType.${item.day.type}`) }), primary: true, run: () => fixDayInStay(store, item.day) }]
    case 'overlap-trips':
      return []
  }
}
