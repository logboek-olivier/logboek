import { MapPin, MapPinOff, Merge, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { SeaMap, type LatLon } from '../components/SeaMap'
import { Sheet } from '../components/Sheet'
import { useCollection } from '../components/useCollection'
import { t } from '../i18n'
import { deletePlace, findPlace, mergeCandidates, mergePlaceInto, mergePlaces, pinPlace, placeUses, removePin, renamePlace, type MergeCandidate, type PlaceUse } from '../model/places'
import type { Store } from '../storage/store'

// Meer → Plaatsen: alle plaatsen uit de dagen (ook geïmporteerde), meest gebruikt eerst. Plaatsen zonder punt zet
// Olivier met één tik op de kaart vast; namen die op een spelvariant na gelijk zijn, staan bovenaan als voorstel om
// samen te voegen.

const FALLBACK: LatLon = { lat: 18, lon: -63 }

export function MergeProposal({ store, candidate, notify }: { store: Store; candidate: MergeCandidate; notify: Notify }) {
  async function merge() {
    const undo = await mergePlaces(store, candidate)
    notify(t('places.merged', { name: candidate.into.name }), undo)
  }
  return (
    <div className="notice">
      <span>{t('places.alike', { names: [candidate.into, ...candidate.others].map((u) => u.name).join(' / ') })}</span>
      <button type="button" className="btn small primary" onClick={() => void merge()}>
        <Icon icon={Merge} />
        {t('places.merge')}
      </button>
    </div>
  )
}

export function Places({ store, notify }: { store: Store; notify: Notify }) {
  const legs = useCollection(store, 'legs.json.enc')
  const places = useCollection(store, 'places.json.enc')
  const uses = placeUses(legs, places)
  const candidates = mergeCandidates(uses)
  const [pinning, setPinning] = useState<PlaceUse | null>(null)
  const [editing, setEditing] = useState<PlaceUse | null>(null)
  const unpinned = uses.filter((u) => !u.place).length

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('places.screen')}</h1>
      </header>
      {uses.length === 0 ? (
        <p className="muted">{t('places.empty')}</p>
      ) : (
        <>
          {candidates.map((c) => (
            <MergeProposal key={c.into.key} store={store} candidate={c} notify={notify} />
          ))}
          {unpinned > 0 && <p className="muted small">{t('places.unpinnedHint', { n: unpinned })}</p>}
          <ul className="rows">
            {uses.map((u) => (
              <li key={u.key}>
                <button className="row-button" onClick={() => setEditing(u)} aria-label={`${t('place.edit')}: ${u.name}`}>
                  <span className="row-main">
                    <span>{u.name}</span>
                    <span className="muted small">{t('unit.days', { n: u.days })}</span>
                  </span>
                  <span className={`row-value small${u.place ? ' pinned' : ' muted'}`}>
                    <Icon icon={MapPin} />
                    {u.place ? t('places.onMap') : t('places.notOnMap')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {editing && (
        <PlaceSheet
          key={editing.key}
          store={store}
          use={editing}
          uses={uses}
          notify={notify}
          onClose={() => setEditing(null)}
          onPin={() => {
            setPinning(editing)
            setEditing(null)
          }}
        />
      )}
      {pinning && <PinSheet store={store} use={pinning} notify={notify} onClose={() => setPinning(null)} />}
    </section>
  )
}

/** Eén tik op de kaart zet de plaats vast (met ongedaan maken). */
function PinSheet({ store, use, notify, onClose }: { store: Store; use: PlaceUse; notify: Notify; onClose: () => void }) {
  const places = store.list('places.json.enc')
  const near = use.place ?? use.neighbours.map((n) => findPlace(places, n)).find((p) => p !== null) ?? places.at(-1) ?? null
  const [busy, setBusy] = useState(false)

  async function pin(point: LatLon) {
    if (busy) return
    setBusy(true)
    const undo = await pinPlace(store, use.name, point)
    onClose()
    notify(t('places.pinned', { name: use.name }), undo)
  }

  return (
    <Sheet title={t('places.pin', { name: use.name })} onClose={onClose}>
      <div className="stack map-sheet">
        <p className="muted small">{t('places.pinHint', { name: use.name })}</p>
        <SeaMap
          center={near ? { lat: near.lat, lon: near.lon } : FALLBACK}
          places={places.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon }))}
          selected={use.place ? { lat: use.place.lat, lon: use.place.lon } : null}
          onPick={(p) => void pin(p)}
          onSelectPlace={(p) => void pin(p)}
        />
      </div>
    </Sheet>
  )
}

/** Eén plaats: hernoemen, op de kaart zetten of de pin verplaatsen, de pin weghalen, samenvoegen, en verwijderen. */
function PlaceSheet({ store, use, uses, notify, onClose, onPin }: { store: Store; use: PlaceUse; uses: PlaceUse[]; notify: Notify; onClose: () => void; onPin: () => void }) {
  const [name, setName] = useState(use.name)
  const others = uses.filter((u) => u.key !== use.key)
  const [target, setTarget] = useState(others[0]?.key ?? '')
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<() => Promise<void>>, message: string) {
    if (busy) return
    setBusy(true)
    try {
      const undo = await action()
      onClose()
      notify(message, undo)
    } finally {
      setBusy(false)
    }
  }

  function rename(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || name.trim() === use.name) {
      onClose()
      return
    }
    void run(() => renamePlace(store, use, name), t('place.renamed', { name: name.trim() }))
  }

  const into = others.find((u) => u.key === target)
  return (
    <Sheet title={t('place.edit')} onClose={onClose}>
      <form className="stack" onSubmit={rename}>
        <label>
          {t('field.name')}
          <input type="text" autoComplete="off" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <span className="muted small">{t('place.renameHint', { n: use.days })}</span>
        <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
          {t('common.save')}
        </button>
        <button className="btn" type="button" disabled={busy} onClick={onPin}>
          <Icon icon={MapPin} />
          {use.place ? t('place.movePin') : t('place.setPin')}
        </button>
        {use.place && (
          <button className="btn" type="button" disabled={busy} onClick={() => void run(() => removePin(store, use), t('place.pinRemoved', { name: use.name }))}>
            <Icon icon={MapPinOff} />
            {t('place.removePin')}
          </button>
        )}
        {others.length > 0 && (
          <div className="stack-sm">
            <label>
              {t('place.mergeWith')}
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {others.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="button" disabled={busy || !into} onClick={() => into && void run(() => mergePlaceInto(store, use, into), t('places.merged', { name: into.name }))}>
              <Icon icon={Merge} />
              {t('places.merge')}
            </button>
          </div>
        )}
        {use.days === 0 ? (
          <button className="btn danger" type="button" disabled={busy} onClick={() => void run(() => deletePlace(store, use), t('place.deleted', { name: use.name }))}>
            <Icon icon={Trash2} />
            {t('place.delete')}
          </button>
        ) : (
          <span className="muted small">{t('place.deleteHint', { n: use.days })}</span>
        )}
      </form>
    </Sheet>
  )
}
