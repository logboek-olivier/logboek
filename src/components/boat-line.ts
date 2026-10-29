import { formatNumber } from '../format'
import { t } from '../i18n'
import type { Trip } from '../model/types'
import { feetToMetres } from '../model/weeks'

/** Bootgegevens op één regel: naam · model · lengte in voet en meter · soort. */
export function boatLine(trip: Trip, fallbackBoat = ''): string {
  const length = trip.boatLengthFt ? t('boat.feet', { ft: formatNumber(trip.boatLengthFt), m: formatNumber(feetToMetres(trip.boatLengthFt)) }) : ''
  // De boot uit de dagen alleen als de trip zelf geen naam en geen model heeft (geïmporteerd: "Naam (Model)").
  return [trip.boat || (trip.boatModel ? '' : fallbackBoat), trip.boatModel ?? '', length, trip.boatKind ? t(`boatKind.${trip.boatKind}`) : ''].filter(Boolean).join(' · ')
}
