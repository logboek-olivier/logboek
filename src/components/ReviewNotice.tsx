import { ClipboardCheck } from 'lucide-react'
import { useMemo } from 'react'
import { t } from '../i18n'
import { reviewInput, reviewItems, type ReviewItem } from '../model/review'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { useCollection } from './useCollection'

// Nakijken op Vandaag en in Meer: alleen het aantal punten (studenten kunnen meekijken); het scherm zelf staat in
// src/screens/Review.tsx en laadt pas bij openen.

/** De punten om na te kijken; rekent opnieuw bij elke wijziging (dezelfde invoer als het scherm en de tests: `reviewInput`). */
export function useReviewItems(store: Store): ReviewItem[] {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const stays = useCollection(store, 'periods.json.enc')
  const calendar = useCollection(store, 'calendar.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const places = useCollection(store, 'places.json.enc')
  const settings = useCollection(store, 'settings.json.enc')
  const plans = useCollection(store, 'plans.json.enc')
  const claims = useCollection(store, 'claims.json.enc')
  const students = useCollection(store, 'students.json.enc')
  const curricula = useCollection(store, 'curricula.json.enc')
  return useMemo(
    () => reviewItems(reviewInput(store)),
    // De lijsten zijn de afhankelijkheden: reviewInput leest dezelfde bestanden uit de store.
    [store, trips, legs, stays, calendar, transactions, places, settings, plans, claims, students, curricula],
  )
}

/** De regel op Vandaag en in Meer: alleen het aantal (studenten kunnen meekijken). */
export function ReviewNotice({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count === 0) return null
  return (
    <div className="notice review-notice">
      <span>
        <Icon icon={ClipboardCheck} />
        {t('review.notice', { n: count })}
      </span>
      <button type="button" className="btn small" onClick={onOpen}>
        {t('review.open')}
      </button>
    </div>
  )
}
