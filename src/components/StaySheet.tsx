import { Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { t } from '../i18n'
import { deleteStay, updateStay } from '../model/periods'
import { STAY_KINDS, TRAVEL_MODES, type StayKind, type StayPeriod, type TravelMode } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { NoteField } from './NoteField'
import { Sheet } from './Sheet'

// Een periode aan land bewerken: soort (reis, thuis, vrij), naam, datums, notitie en bij reis van, naar en vervoer.
// Verwijderen onderaan, zonder vraag, met ongedaan maken; de dagen worden dan weer automatisch.

export function StaySheet({ store, stay, notify, onClose }: { store: Store; stay: StayPeriod; notify: Notify; onClose: () => void }) {
  const [kind, setKind] = useState<StayKind>(stay.kind)
  const [name, setName] = useState(stay.name ?? '')
  const [startDate, setStartDate] = useState(stay.startDate)
  const [endDate, setEndDate] = useState(stay.endDate)
  const [note, setNote] = useState(stay.note ?? '')
  const [from, setFrom] = useState(stay.travel?.from ?? '')
  const [to, setTo] = useState(stay.travel?.to ?? '')
  const [by, setBy] = useState<TravelMode | ''>(stay.travel?.by ?? '')
  const [busy, setBusy] = useState(false)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      const undo = await updateStay(store, stay, { kind, name, startDate, endDate, note, travel: { from, to, ...(by ? { by } : {}) } })
      notify(t('toast.saved'), undo)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const undo = await deleteStay(store, stay)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={t('period.edit')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="type-buttons" role="radiogroup" aria-label={t('period.kind')}>
          {STAY_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
              {t(`periodKind.${k}`)}
            </button>
          ))}
        </div>
        <label>
          {t('field.name')}
          <input type="text" autoComplete="off" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="two">
          <label>
            {t('period.start')}
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            {t('period.end')}
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        {kind === 'reis' && (
          <>
            <div className="two">
              <label>
                {t('day.from')}
                <input type="text" autoComplete="off" maxLength={80} value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label>
                {t('day.to')}
                <input type="text" autoComplete="off" maxLength={80} value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            <label>
              {t('period.travelBy')}
              <select value={by} onChange={(e) => setBy(e.target.value as TravelMode | '')}>
                <option value="">–</option>
                {TRAVEL_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`travelMode.${m}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <NoteField label={t('field.note')} value={note} onChange={setNote} />
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!valid || busy}>
            {t('common.save')}
          </button>
          <button className="btn danger" type="button" onClick={() => void remove()}>
            <Icon icon={Trash2} />
            {t('common.delete')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
