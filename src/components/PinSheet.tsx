import { useState } from 'react'
import { t } from '../i18n'
import { findPlace, pinPlace, pinQuestion, savePlace, type PinQuestion, type PlaceUse } from '../model/places'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { PinQuestionBox } from './PinQuestion'
import { SeaMap } from './LazyMap'
import type { LatLon } from './SeaMap'
import { Sheet } from './Sheet'

const FALLBACK: LatLon = { lat: 18, lon: -63 }

/**
 * Eén tik op de kaart zet de plaats vast (met ongedaan maken). Heeft de plaats al een pin, of ligt het punt ver van het
 * land van de plaats, dan eerst de vraag; nooit stil.
 */
export function PinSheet({ store, use, notify, onClose }: { store: Store; use: PlaceUse; notify: Notify; onClose: () => void }) {
  const places = store.list('places.json.enc')
  const near = use.place ?? use.neighbours.map((n) => findPlace(places, n)).find((p) => p !== null) ?? places.at(-1) ?? null
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ point: LatLon; question: PinQuestion } | null>(null)

  function pick(point: LatLon) {
    if (busy) return
    const question = pinQuestion(store.list('legs.json.enc'), places, use.name, point)
    if (question) setPending({ point, question })
    else void pin(point)
  }

  async function pin(point: LatLon) {
    if (busy) return
    setBusy(true)
    const undo = await pinPlace(store, use.name, point)
    onClose()
    notify(t('places.pinned', { name: use.name }), undo)
  }

  async function newPlace(name: string, point: LatLon) {
    if (busy) return
    setBusy(true)
    const saved = await savePlace(store, name, point)
    void store.sync()
    onClose()
    notify(t('places.pinned', { name: saved.name }))
  }

  return (
    <Sheet title={t('places.pin', { name: use.name })} onClose={onClose}>
      <div className="stack map-sheet">
        <p className="muted small">{t('places.pinHint', { name: use.name })}</p>
        <SeaMap
          center={near ? { lat: near.lat, lon: near.lon } : FALLBACK}
          places={places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon }))}
          selected={pending?.point ?? (use.place ? { lat: use.place.lat, lon: use.place.lon } : null)}
          onPick={pick}
          onSelectPlace={(p) => pick(p)}
        />
        {pending && (
          <PinQuestionBox
            question={pending.question}
            point={pending.point}
            places={places}
            onConfirm={() => void pin(pending.point)}
            onOther={() => setPending(null)}
            onNew={(name) => void newPlace(name, pending.point)}
          />
        )}
      </div>
    </Sheet>
  )
}

