import { LocateFixed } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { formatNumber } from '../format'
import { t } from '../i18n'
import { estimateWater, type WaterEstimate } from '../model/estimate'
import { findPlace, nearestPlace, pinQuestion, type PinQuestion } from '../model/places'
import type { Place } from '../model/types'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { PinQuestionBox } from './PinQuestion'
import { SeaMap } from './LazyMap'
import type { LatLon, MapPlace } from './SeaMap'
import { Sheet } from './Sheet'
import { plaatsOpslaan } from '../domain/plaatsen'

// Plaats kiezen op de offline kaart: tik op een bekende plaats (direct gekozen) of zet een nieuw punt, geef het een
// naam en kies. "Huidige locatie" gebruikt de GPS van de telefoon (geen internet nodig). Met een vertrek- of
// aankomstplaats met punt staat de waterroute naar het gekozen punt op de kaart, met de schatting in nm.

const FALLBACK: LatLon = { lat: 18, lon: -63 }

export function MapSheet({
  store,
  title,
  name,
  around,
  routeFrom,
  onChoose,
  onClose,
}: {
  store: Store
  title: string
  /** Huidige tekst in het veld. */
  name: string
  /** Andere bekende punten om op te centreren als het veld nog geen punt heeft (bijvoorbeeld het andere veld). */
  around: readonly string[]
  /** De andere plaats van de dag: de waterroute daarvandaan naar het gekozen punt staat op de kaart. */
  routeFrom?: string
  onChoose: (name: string) => void
  onClose: () => void
}) {
  const places = store.list('places.json.enc')
  const own = findPlace(places, name)
  const start = own ?? around.map((n) => findPlace(places, n)).find((p): p is Place => p !== null) ?? places.at(-1) ?? null
  const [point, setPoint] = useState<LatLon | null>(own ? { lat: own.lat, lon: own.lon } : null)
  const [placeName, setPlaceName] = useState(own ? own.name : name)
  const [near, setNear] = useState<Place | null>(null)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Pin koppelen of vervangen nooit stil: eerst de vraag (pin verplaatsen, of ver van het land van de plaats).
  const [question, setQuestion] = useState<PinQuestion | null>(null)
  const mapPlaces: MapPlace[] = places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon }))
  const other = routeFrom ? findPlace(places, routeFrom) : null
  const [estimate, setEstimate] = useState<WaterEstimate | null>(null)
  useEffect(() => {
    setEstimate(null)
    if (!other || !point) return
    let active = true
    void estimateWater(other, point, store.list('legs.json.enc'), places).then((e) => active && setEstimate(e))
    return () => {
      active = false
    }
  }, [other?.id, other?.lat, other?.lon, point?.lat, point?.lon])

  function pick(p: LatLon) {
    setQuestion(null)
    setPoint(p)
    setError(null)
    const close = nearestPlace(places, p)
    setNear(close)
  }

  function here() {
    if (!('geolocation' in navigator)) {
      setError(t('map.hereFailed'))
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        pick({ lat: pos.coords.latitude, lon: pos.coords.longitude })
      },
      () => {
        setLocating(false)
        setError(t('map.hereFailed'))
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!point || !placeName.trim() || busy) return
    const q = pinQuestion(store.list('legs.json.enc'), places, placeName, point)
    if (q) setQuestion(q)
    else void save(placeName)
  }

  async function save(name: string) {
    if (!point || busy) return
    setBusy(true)
    try {
      const { result: saved } = await plaatsOpslaan(store, name, point)
      onChoose(saved.name)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form className="stack map-sheet" onSubmit={(e) => void submit(e)}>
        <p className="muted small">{t('map.hint')}</p>
        <SeaMap
          key={start?.id ?? 'start'}
          center={point ?? (start ? { lat: start.lat, lon: start.lon } : FALLBACK)}
          places={mapPlaces}
          selected={point}
          route={estimate?.path}
          onPick={pick}
          onSelectPlace={(p) => onChoose(p.name)}
        />
        <button type="button" className="btn" onClick={here} disabled={locating}>
          <Icon icon={LocateFixed} />
          {locating ? t('common.busy') : t('map.here')}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {estimate && <p className="muted small">{t('route.water', { nm: formatNumber(estimate.nm), water: formatNumber(estimate.water), factor: formatNumber(estimate.factor) })}</p>}
        {point && (
          <>
            {near && (
              <button type="button" className="btn link" onClick={() => onChoose(near.name)}>
                {t('map.nearKnown', { name: near.name })}
              </button>
            )}
            <label>
              {t('map.placeName')}
              <input
                type="text"
                autoComplete="off"
                maxLength={80}
                value={placeName}
                onChange={(e) => {
                  setPlaceName(e.target.value)
                  setQuestion(null)
                }}
              />
            </label>
            {question ? (
              <PinQuestionBox
                question={question}
                point={point}
                places={places}
                onConfirm={() => void save(placeName)}
                onOther={() => {
                  setQuestion(null)
                  setPoint(null)
                }}
                onNew={(name) => void save(name)}
              />
            ) : (
              <button className="btn primary" type="submit" disabled={!placeName.trim() || busy}>
                {t('map.choose')}
              </button>
            )}
          </>
        )}
      </form>
    </Sheet>
  )
}
