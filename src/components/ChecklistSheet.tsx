import { Check, GripVertical, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { t, useLang } from '../i18n'
import { checkedItems, moveItem } from '../model/checklists'
import { localized } from '../model/curricula'
import { WEEK_TYPES, type Checklist, type Trip, type WeekType } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { checklistAfvinken, checklistOpslaan, checklistVerwijderen } from '../domain/trips'

// Vaste checklists. Bij een trip: grote vinkvakken (één tik = afvinken). Eerst bekijken, dan bewerken via het potlood:
// naam, bij welke trips, punten wijzigen, toevoegen, weghalen en slepen (of met de pijltjestoetsen verplaatsen), en de
// lijst verwijderen. Het sjabloon geldt voor alle trips. Ook onder Meer → Checklists (src/screens/Checklists.tsx).

export function ChecklistSheet({ store, trip, list, notify, onClose }: { store: Store; trip: Trip; list: Checklist; notify: Notify; onClose: () => void }) {
  const lang = useLang()
  const [editing, setEditing] = useState(list.items.length === 0)
  const ticked = checkedItems(trip, list)

  if (editing) return <ChecklistForm store={store} list={list} notify={notify} onDone={() => setEditing(false)} onClose={onClose} />

  return (
    <Sheet title={localized(list.title, lang)} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack">
        <p className="muted small">{t('checklist.progress', { done: ticked.size, n: list.items.length })}</p>
        <ul className="check-items">
          {list.items.map((item) => {
            const on = ticked.has(item.id)
            return (
              <li key={item.id}>
                <button type="button" role="checkbox" aria-checked={on} className={`check-item${on ? ' on' : ''}`} onClick={() => void checklistAfvinken(store, trip, list.id, item.id)}>
                  <span className="check-box">{on && <Icon icon={Check} />}</span>
                  <span>{localized(item.text, lang)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Sheet>
  )
}

/** Een lijst bekijken zonder trip (Meer → Checklists): de punten op volgorde en bij welke trips hij hoort. */
export function ChecklistTemplateSheet({ store, list, notify, onClose }: { store: Store; list: Checklist; notify: Notify; onClose: () => void }) {
  const lang = useLang()
  const [editing, setEditing] = useState(list.items.length === 0)
  if (editing) return <ChecklistForm store={store} list={list} notify={notify} onDone={() => setEditing(false)} onClose={onClose} />
  return (
    <Sheet title={localized(list.title, lang)} kicker={t('checklist.kicker')} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack">
        <p className="muted small">{tripTypesText(list.tripTypes)}</p>
        {list.items.length > 0 ? (
          <ol className="check-items checklist-preview">
            {list.items.map((item) => (
              <li key={item.id}>{localized(item.text, lang)}</li>
            ))}
          </ol>
        ) : (
          <p className="muted">{t('checklist.empty')}</p>
        )}
      </div>
    </Sheet>
  )
}

/** "Elke trip" of de soorten trip, gescheiden door een komma. */
export function tripTypesText(types: readonly WeekType[] | undefined): string {
  return types?.length ? types.map((type) => t(`weekType.${type}`)).join(', ') : t('checklist.allTrips')
}

interface Row {
  /** Vaste sleutel voor React, ook voor een nieuw punt (zonder id) en na verplaatsen. */
  key: string
  id?: string
  text: string
}

let rowKeys = 0
const newRow = (text = '', id?: string): Row => ({ key: `rij-${++rowKeys}`, id, text })

/** Alleen ingevulde punten zijn te verplaatsen; de lege regel onderaan blijft onderaan. */
function lastMovable(rows: readonly Row[]): number {
  return rows.at(-1)?.text.trim() ? rows.length - 1 : rows.length - 2
}

function ChecklistForm({ store, list, notify, onDone, onClose }: { store: Store; list: Checklist; notify: Notify; onDone: () => void; onClose: () => void }) {
  const lang = useLang()
  const [title, setTitle] = useState(localized(list.title, lang))
  const [types, setTypes] = useState<WeekType[]>(() => [...(list.tripTypes ?? [])])
  const [rows, setRows] = useState<Row[]>(() => [...list.items.map((i) => newRow(localized(i.text, lang), i.id)), newRow()])
  const [busy, setBusy] = useState(false)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const pointerY = useRef<number | null>(null)
  const dragKeyRef = useRef<string | null>(null)

  const setText = (i: number, text: string) => {
    const next = rows.map((x, j) => (j === i ? { ...x, text } : x))
    // Altijd één lege regel onderaan: punten één per regel toevoegen.
    if (next.at(-1)?.text.trim()) next.push(newRow())
    setRows(next)
  }

  const move = (from: number, to: number) => {
    const current = rowsRef.current
    const target = Math.max(0, Math.min(lastMovable(current), to))
    if (target === from) return
    const next = moveItem(current, from, target)
    rowsRef.current = next
    setRows(next)
  }

  // Slepen: het punt springt naar de plek van de regel onder de vinger. Bij de rand van het blad scrolt het mee, zodat
  // een punt onderaan een lange lijst ook bovenaan komt.
  const dragTo = (y: number) => {
    const key = dragKeyRef.current
    const box = listRef.current
    if (!key || !box) return
    const elements = [...box.querySelectorAll<HTMLElement>('[data-row]')]
    const from = rowsRef.current.findIndex((r) => r.key === key)
    if (from < 0) return
    let to = elements.length - 1
    for (let i = 0; i < elements.length; i++) {
      const rect = elements[i]!.getBoundingClientRect()
      if (y < rect.top + rect.height / 2) {
        to = i > from ? i - 1 : i
        break
      }
    }
    move(from, to)
  }

  useEffect(() => {
    if (!dragKey) return
    const scroller = listRef.current?.closest<HTMLElement>('.sheet-body')
    const timer = window.setInterval(() => {
      const y = pointerY.current
      if (!scroller || y === null) return
      const rect = scroller.getBoundingClientRect()
      const edge = 56
      const step = y < rect.top + edge ? -12 : y > rect.bottom - edge ? 12 : 0
      if (step === 0) return
      scroller.scrollTop += step
      dragTo(y)
    }, 30)
    return () => window.clearInterval(timer)
  }, [dragKey])

  useEffect(() => {
    if (!focusKey) return
    listRef.current?.querySelector<HTMLElement>(`[data-row="${focusKey}"] .drag-handle`)?.focus()
    setFocusKey(null)
  }, [focusKey, rows])

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, key: string) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointerY.current = e.clientY
    dragKeyRef.current = key
    setDragKey(key)
  }
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!dragKeyRef.current) return
    pointerY.current = e.clientY
    dragTo(e.clientY)
  }
  const endDrag = () => {
    pointerY.current = null
    dragKeyRef.current = null
    setDragKey(null)
  }
  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, i: number, key: string) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? lastMovable(rows) : null
    if (to === null) return
    e.preventDefault()
    move(i, to)
    setFocusKey(key)
  }

  const toggleType = (type: WeekType | null) => {
    if (type === null) setTypes([])
    else setTypes(types.includes(type) ? types.filter((x) => x !== type) : WEEK_TYPES.filter((x) => x === type || types.includes(x)))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await checklistOpslaan(store, list, { title, items: rows.map(({ id, text }) => ({ id, text })), tripTypes: types }, lang)
      notify(t('toast.saved'))
      onDone()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const undo = await checklistVerwijderen(store, list)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={t('checklist.editTemplate')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('checklist.title')}
          <input type="text" autoComplete="off" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <fieldset className="participants checklist-types">
          <legend>{t('checklist.forTrips')}</legend>
          <div className="type-buttons">
            <button type="button" aria-pressed={types.length === 0} className={`chip${types.length === 0 ? ' active' : ''}`} onClick={() => toggleType(null)}>
              {t('checklist.allTrips')}
            </button>
            {WEEK_TYPES.map((type) => (
              <button key={type} type="button" aria-pressed={types.includes(type)} className={`chip${types.includes(type) ? ' active' : ''}`} onClick={() => toggleType(type)}>
                {t(`weekType.${type}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="participants">
          <legend>{t('checklist.items')}</legend>
          <div ref={listRef} className="checklist-rows">
            {rows.map((row, i) => {
              const filled = row.text.trim() !== ''
              return (
                <div key={row.key} data-row={row.key} className={`checklist-row${dragKey === row.key ? ' dragging' : ''}`}>
                  {filled && i <= lastMovable(rows) ? (
                    <button
                      type="button"
                      className="btn icon drag-handle"
                      aria-label={t('checklist.moveItem', { n: i + 1 })}
                      onPointerDown={(e) => onPointerDown(e, row.key)}
                      onPointerMove={onPointerMove}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onLostPointerCapture={endDrag}
                      onKeyDown={(e) => onHandleKey(e, i, row.key)}
                    >
                      <Icon icon={GripVertical} />
                    </button>
                  ) : (
                    <span className="drag-spacer" aria-hidden="true" />
                  )}
                  <input
                    type="text"
                    autoComplete="off"
                    maxLength={200}
                    aria-label={t('checklist.item', { n: i + 1 })}
                    placeholder={filled || row.id ? '' : t('checklist.newItem')}
                    value={row.text}
                    onChange={(e) => setText(i, e.target.value)}
                  />
                  {filled ? (
                    <button type="button" className="btn icon" aria-label={t('checklist.removeItem', { n: i + 1 })} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                      <Icon icon={X} />
                    </button>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </div>
              )
            })}
          </div>
        </fieldset>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={busy}>
            {t('common.save')}
          </button>
          <button className="btn danger" type="button" disabled={busy} onClick={() => void remove()}>
            <Icon icon={Trash2} />
            {t('checklist.delete')}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

/** Nieuwe eigen lijst: alleen een naam; daarna direct punten toevoegen. */
export function NewChecklistButton({ onAdd }: { onAdd: () => void }) {
  return (
    <button type="button" className="btn small quiet" onClick={onAdd}>
      <Icon icon={Plus} />
      {t('checklist.new')}
    </button>
  )
}
