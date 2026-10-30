import { ClipboardCheck } from 'lucide-react'
import { useMemo } from 'react'
import { t } from '../i18n'
import { reviewItems, type ReviewItem } from '../model/review'
import { currentSettings } from '../model/settings'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { useCollection } from './useCollection'

// Nakijken op Vandaag en in Meer: alleen het aantal punten (studenten kunnen meekijken); het scherm zelf staat in
// src/screens/Review.tsx en laadt pas bij openen.

/** De punten om na te kijken; rekent opnieuw bij elke wijziging. */
export function useReviewItems(store: Store): ReviewItem[] {
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const stays = useCollection(store, 'periods.json.enc')
  const calendar = useCollection(store, 'calendar.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const places = useCollection(store, 'places.json.enc')
  const settings = useCollection(store, 'settings.json.enc')
  return useMemo(
    () =>
      reviewItems({
        trips: trips.filter((x) => x.deletedAt === null),
        legs: legs.filter((x) => x.deletedAt === null),
        stays: stays.filter((x) => x.deletedAt === null),
        calendar: calendar.filter((x) => x.deletedAt === null),
        transactions: transactions.filter((x) => x.deletedAt === null),
        places: places.filter((x) => x.deletedAt === null),
        settings: currentSettings(settings),
      }),
    [trips, legs, stays, calendar, transactions, places, settings],
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
