import { MapPin, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatCoordinate, formatNumber } from '../format'
import { t } from '../i18n'
import { greatCircleNm, placeKey, type PinQuestion } from '../model/places'
import type { Place } from '../model/types'
import type { LatLon } from './SeaMap'
import { Icon } from './Icon'

// Een pin koppelen of vervangen gebeurt nooit stil. Heeft de plaats al een pin, dan eerst "Pin van X verplaatsen?" met
// oud en nieuw; ligt de nieuwe pin ver van het land van de plaats, dan "Dit ligt ver van Engeland. Klopt de plaats?".
// Keuzes: een andere plaats kiezen (terug naar de kaart), een nieuwe plaats maken (andere naam), of toch hier.

/** "18,427° N · 64,618° W, bij Road Town" (de dichtstbijzijnde andere bekende plaats, als die dichtbij ligt). */
function where(point: LatLon, places: readonly Place[], self: string): string {
  const others = places.filter((p) => placeKey(p.name) !== placeKey(self))
  const near = nearestPlaceWithin(others, point, 30)
  return near ? t('pin.near', { where: formatCoordinate(point.lat, point.lon), name: near.name }) : formatCoordinate(point.lat, point.lon)
}

function nearestPlaceWithin(places: readonly Place[], point: LatLon, maxNm: number): Place | null {
  let best: Place | null = null
  let bestNm = maxNm
  for (const p of places) {
    const d = greatCircleNm(p, point)
    if (d <= bestNm) {
      best = p
      bestNm = d
    }
  }
  return best
}

export function PinQuestionBox({
  question,
  point,
  places,
  onConfirm,
  onOther,
  onNew,
}: {
  question: PinQuestion
  point: LatLon
  places: readonly Place[]
  /** Verplaatsen of toch hier. */
  onConfirm: () => void
  /** Terug naar de kaart: een andere plaats kiezen. */
  onOther: () => void
  /** Een nieuwe plaats maken met een andere naam (de oude pin blijft staan). */
  onNew: (name: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  // De vraag staat onder de kaart: direct in beeld brengen.
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest' })
  }, [])
  const [naming, setNaming] = useState(false)
  const [newName, setNewName] = useState('')
  const taken = newName.trim() !== '' && places.some((p) => placeKey(p.name) === placeKey(newName))
  const same = placeKey(newName) === placeKey(question.name)
  return (
    <div ref={box} className="notice pin-question" role="alert">
      {question.farFrom && <p>{t('pin.far', { country: question.farFrom })}</p>}
      {question.existing && (
        <>
          <p>{t('pin.move', { name: question.name })}</p>
          <p className="small">
            {t('pin.old', { where: where(question.existing, places, question.name) })}
            <br />
            {t('pin.new', { where: where(point, places, question.name) })}
            {question.moveNm !== null && <> · {t('pin.distance', { nm: formatNumber(Math.round(question.moveNm)) })}</>}
          </p>
        </>
      )}
      {naming ? (
        <div className="stack-sm">
          <label>
            {t('pin.newName')}
            <input type="text" autoComplete="off" maxLength={80} value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          {(taken || same) && newName.trim() !== '' && <p className="small">{t('pin.nameTaken')}</p>}
          <button type="button" className="btn primary" disabled={!newName.trim() || taken || same} onClick={() => onNew(newName.trim())}>
            <Icon icon={Plus} />
            {t('pin.makeNew')}
          </button>
        </div>
      ) : (
        <div className="pin-actions">
          <button type="button" className="btn small" onClick={onOther}>
            <Icon icon={RotateCcw} />
            {t('pin.other')}
          </button>
          <button type="button" className="btn small" onClick={() => setNaming(true)}>
            <Icon icon={Plus} />
            {t('pin.makeNew')}
          </button>
          <button type="button" className="btn small primary" onClick={onConfirm}>
            <Icon icon={MapPin} />
            {question.farFrom ? t('pin.anyway') : t('pin.moveIt')}
          </button>
        </div>
      )}
    </div>
  )
}
