import { formatNumber } from '../format'
import { t } from '../i18n'
import type { Trip } from '../model/types'
import { feetToMetres, tripDayCounts, type WeekView } from '../model/weeks'

/** Bootgegevens op één regel: naam · model · lengte in voet en meter · soort. */
export function boatLine(trip: Trip, fallbackBoat = ''): string {
  const length = trip.boatLengthFt ? t('boat.feet', { ft: formatNumber(trip.boatLengthFt), m: formatNumber(feetToMetres(trip.boatLengthFt)) }) : ''
  // De boot uit de dagen alleen als de trip zelf geen naam en geen model heeft (geïmporteerd: "Naam (Model)").
  return [trip.boat || (trip.boatModel ? '' : fallbackBoat), trip.boatModel ?? '', length, trip.boatKind ? t(`boatKind.${trip.boatKind}`) : ''].filter(Boolean).join(' · ')
}

/** "6 dagen · 5 gelogd" (dagen van start tot en met eind); zonder datums alleen het aantal gelogde dagen. */
export function tripDaysText(view: Pick<WeekView, 'startDate' | 'endDate' | 'legs'>, until?: string): string {
  const { days, logged } = tripDayCounts(view, until)
  return days === null ? t('trip.loggedOnly', { logged }) : t('trip.daysLogged', { days, logged })
}
