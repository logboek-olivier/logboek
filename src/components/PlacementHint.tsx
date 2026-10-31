import { formatDate } from '../format'
import { t } from '../i18n'
import type { LegPlacement } from '../model/leg-trip'
import type { Trip } from '../model/types'

/** Onder de keuze van de trip: wat er gebeurt als de datum buiten de gekozen trip valt. */
export function PlacementHint({ trips, placement, chosenId, date }: { trips: readonly Trip[]; placement: LegPlacement; chosenId: string | null; date: string }) {
  const chosen = chosenId ? trips.find((x) => x.id === chosenId) : undefined
  if (placement.extend && chosen) return <p className="muted small placement-hint">{t('day.willExtend', { name: chosen.name, date: formatDate(date) })}</p>
  if (placement.moved && chosen) {
    const target = placement.tripId ? trips.find((x) => x.id === placement.tripId) : undefined
    return <p className="warning small placement-hint">{target ? t('day.goesTo', { name: chosen.name, target: target.name }) : t('day.goesToNew', { name: chosen.name })}</p>
  }
  return null
}
