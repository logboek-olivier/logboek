import { LocateFixed } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { t } from '../i18n'
import { findPlace, nearestPlace, savePlace } from '../model/places'
import type { Place } from '../model/types'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { SeaMap, type LatLon, type MapPlace } from './SeaMap'
import { Sheet } from './Sheet'

// Plaats kiezen op de offline kaart: tik op een bekende plaats (direct gekozen) of zet een nieuw punt, geef het een
// naam en kies. "Huidige locatie" gebruikt de GPS van de telefoon (geen internet nodig).

const FALLBACK: LatLon = { lat: 18, lon: -63 }

export function MapSheet({
  store,
  title,
  name,
  around,
  onChoose,
  onClose,
}: {
  store: Store
  title: string
  /** Huidige tekst in het veld. */
  name: string
  /** Andere bekende punten om op te centreren als het veld nog geen punt heeft (bijvoorbeeld het andere veld). */
  around: readonly string[]
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
  const mapPlaces: MapPlace[] = places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon }))

  function pick(p: LatLon) {
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

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!point || !placeName.trim() || busy) return
    setBusy(true)
    try {
      const saved = await savePlace(store, placeName, point)
      void store.sync()
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
        {point && (
          <>
            {near && (
              <button type="button" className="btn link" onClick={() => onChoose(near.name)}>
                {t('map.nearKnown', { name: near.name })}
              </button>
            )}
            <label>
              {t('map.placeName')}
              <input type="text" autoComplete="off" maxLength={80} value={placeName} onChange={(e) => setPlaceName(e.target.value)} />
            </label>
            <button className="btn primary" type="submit" disabled={!placeName.trim() || busy}>
              {t('map.choose')}
            </button>
          </>
        )}
      </form>
    </Sheet>
  )
}
