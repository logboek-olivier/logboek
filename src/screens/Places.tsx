import { Check, MapPin, MapPinOff, Merge, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { PinQuestionBox } from '../components/PinQuestion'
import { SeaMap, type LatLon } from '../components/SeaMap'
import { useCounters } from '../components/useCounters'
import { ViewRows } from '../components/Views'
import { formatCoordinate } from '../format'
import { getLang } from '../i18n'
import { nameWithCounter } from '../model/counters'
import { suggestPin, type PinSuggestion } from '../model/pin-suggest'
import type { Notify } from '../components/EditSheets'
import { Icon } from '../components/Icon'
import { PinSheet } from '../components/PinSheet'
import { Sheet } from '../components/Sheet'
import { useCollection } from '../components/useCollection'
import { t } from '../i18n'
import { deletePlace, findPlace, mergeCandidates, mergePlaceInto, mergePlaces, pinPlace, pinQuestion, placeCountry, placeKey, placeUses, removePin, renamePlace, savePlace, type MergeCandidate, type PinQuestion, type PlaceUse } from '../model/places'
import type { Store } from '../storage/store'

// Meer → Plaatsen: alle plaatsen uit de dagen (ook geïmporteerde), meest gebruikt eerst. Plaatsen zonder punt zet
// Olivier met één tik op de kaart vast; namen die op een spelvariant na gelijk zijn, staan bovenaan als voorstel om
// samen te voegen.

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
  const [viewing, setViewing] = useState<PlaceUse | null>(null)
  const [editing, setEditing] = useState<PlaceUse | null>(null)
  const [assistant, setAssistant] = useState(false)
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
          {unpinned > 0 && (
            <div className="notice pin-assistant-start">
              <span>{t('pins.assistantCount', { n: unpinned })}</span>
              <button type="button" className="btn small primary" onClick={() => setAssistant(true)}>
                <Icon icon={MapPin} />
                {t('pins.assistant')}
              </button>
            </div>
          )}
          <ul className="rows">
            {uses.map((u) => (
              <li key={u.key}>
                <button className="row-button" onClick={() => setViewing(u)} aria-label={`${t('place.open')}: ${u.name}`}>
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
      {viewing && (
        <PlaceView
          key={viewing.key}
          store={store}
          use={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing)
            setViewing(null)
          }}
          onPin={() => {
            setPinning(viewing)
            setViewing(null)
          }}
        />
      )}
      {assistant && <PinAssistant store={store} notify={notify} onClose={() => setAssistant(false)} />}
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

/** Eén plaats bekijken: land, pin op een kleine kaart, dagen en trips; bewerken via het potlood, pin zetten direct. */
function PlaceView({ store, use, onClose, onEdit, onPin }: { store: Store; use: PlaceUse; onClose: () => void; onEdit: () => void; onPin: () => void }) {
  const legs = useCollection(store, 'legs.json.enc')
  const places = useCollection(store, 'places.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const counters = useCounters(store)
  const current = placeUses(legs, places).find((u) => u.key === use.key) ?? use
  const tripIds = new Set(legs.filter((l) => l.deletedAt === null && (placeKey(l.fromPlace) === use.key || placeKey(l.toPlace) === use.key)).map((l) => l.tripId))
  const visited = trips.filter((x) => x.deletedAt === null && tripIds.has(x.id))
  const country = placeCountry(legs, places, current.name)
  const pin = current.place
  return (
    <Sheet title={current.name} onClose={onClose} onEdit={onEdit}>
      <div className="stack view">
        {pin ? (
          <SeaMap center={pin} places={[]} selected={pin} fit={[pin]} small />
        ) : (
          <p className="muted">{t('place.view.noPin')}</p>
        )}
        <button type="button" className="btn" onClick={onPin}>
          <Icon icon={MapPin} />
          {pin ? t('place.movePin') : t('place.setPin')}
        </button>
        <ViewRows
          rows={[
            [t('guest.country'), country],
            [t('place.view.days'), String(current.days)],
            [t('place.view.trips'), visited.length > 0 && visited.map((x) => nameWithCounter(x, counters.get(x.id))).join(' · ')],
            [t('map.coordinates'), pin && formatCoordinate(pin.lat, pin.lon)],
          ]}
        />
      </div>
    </Sheet>
  )
}

/**
 * Pin-assistent: de plaatsen zonder pin één voor één, meest gebruikt eerst, met een voorstel uit de namen op de
 * offline kaart ("Vis gevonden: klopt?"). Eén tik bevestigt (met ongedaan maken), overslaan mag. De pinregels blijven
 * gelden: ligt het voorstel ver van het land van de plaats, dan eerst de vraag.
 */
function PinAssistant({ store, notify, onClose }: { store: Store; notify: Notify; onClose: () => void }) {
  const [queue] = useState(() => placeUses(store.list('legs.json.enc'), store.list('places.json.enc')).filter((u) => !u.place))
  const [i, setI] = useState(0)
  const [suggestion, setSuggestion] = useState<PinSuggestion | null | 'loading'>('loading')
  const [question, setQuestion] = useState<PinQuestion | null>(null)
  const [manual, setManual] = useState<PlaceUse | null>(null)
  const [busy, setBusy] = useState(false)
  const use = queue[i] ?? null

  useEffect(() => {
    if (!use) return
    let active = true
    setSuggestion('loading')
    setQuestion(null)
    const places = store.list('places.json.enc')
    const neighbours = use.neighbours.map((n) => findPlace(places, n)).filter((p): p is NonNullable<typeof p> => p !== null)
    void suggestPin(use.name, neighbours, placeCountry(store.list('legs.json.enc'), places, use.name)).then((s) => {
      if (active) setSuggestion(s)
    })
    return () => {
      active = false
    }
  }, [use, store])

  const next = () => setI((n) => n + 1)

  async function confirm(point: LatLon, skipQuestion = false) {
    if (!use || busy) return
    const q = skipQuestion ? null : pinQuestion(store.list('legs.json.enc'), store.list('places.json.enc'), use.name, point)
    if (q) {
      setQuestion(q)
      return
    }
    setBusy(true)
    try {
      const undo = await pinPlace(store, use.name, point)
      notify(t('places.pinned', { name: use.name }), undo)
      next()
    } finally {
      setBusy(false)
    }
  }

  if (manual) return <PinSheet store={store} use={manual} notify={notify} onClose={() => { setManual(null); next() }} />
  const point = suggestion && suggestion !== 'loading' ? { lat: suggestion.label.lat, lon: suggestion.label.lon } : null
  return (
    <Sheet title={t('pins.assistant')} onClose={onClose}>
      {!use ? (
        <div className="stack">
          <p>{t('pins.done')}</p>
          <button type="button" className="btn primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      ) : (
        <div className="stack pin-assistant">
          <p className="muted small">{t('pins.progress', { i: i + 1, n: queue.length })}</p>
          <h3>{use.name}</h3>
          <p className="muted small">{t('unit.days', { n: use.days })}</p>
          {suggestion === 'loading' ? (
            <p className="muted">{t('pins.loading')}</p>
          ) : suggestion && point ? (
            <>
              <p>{t('pins.found', { name: suggestion.label.n })}</p>
              <p className="muted small">{t('pins.foundWhere', { label: suggestion.label.n, area: suggestion.area.name[getLang()] })}</p>
              <SeaMap center={point} places={[]} selected={point} fit={[point]} small />
              {question ? (
                <PinQuestionBox
                  question={question}
                  point={point}
                  places={store.list('places.json.enc')}
                  onConfirm={() => void confirm(point, true)}
                  onOther={() => setManual(use)}
                  onNew={async (name) => {
                    await savePlace(store, name, point)
                    void store.sync()
                    notify(t('places.pinned', { name }))
                    next()
                  }}
                />
              ) : (
                <button type="button" className="btn primary" disabled={busy} onClick={() => void confirm(point)}>
                  <Icon icon={Check} />
                  {t('pins.yes')}
                </button>
              )}
              <button type="button" className="btn" onClick={() => setManual(use)}>
                <Icon icon={MapPin} />
                {t('pins.other')}
              </button>
            </>
          ) : (
            <>
              <p>{t('pins.notFound', { name: use.name })}</p>
              <button type="button" className="btn primary" onClick={() => setManual(use)}>
                <Icon icon={MapPin} />
                {t('place.setPin')}
              </button>
            </>
          )}
          <button type="button" className="btn link" onClick={next}>
            {t('pins.skip')}
          </button>
        </div>
      )}
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
