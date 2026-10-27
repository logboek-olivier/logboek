import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { t, useLang } from '../i18n'
import { checkedItems, deleteChecklist, saveChecklist, toggleCheck } from '../model/checklists'
import { localized } from '../model/curricula'
import type { Checklist, Trip } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

// Een vaste checklist bij een trip: grote vinkvakken (één tik = afvinken). "Sjabloon bewerken" past de lijst aan
// voor alle trips: punten wijzigen, toevoegen, weghalen.

export function ChecklistSheet({ store, trip, list, notify, onClose }: { store: Store; trip: Trip; list: Checklist; notify: Notify; onClose: () => void }) {
  const lang = useLang()
  const [editing, setEditing] = useState(list.items.length === 0)
  const ticked = checkedItems(trip, list)

  if (editing) return <TemplateForm store={store} list={list} notify={notify} onDone={() => setEditing(false)} onClose={onClose} />

  return (
    <Sheet title={localized(list.title, lang)} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{t('checklist.progress', { done: ticked.size, n: list.items.length })}</p>
        <ul className="check-items">
          {list.items.map((item) => {
            const on = ticked.has(item.id)
            return (
              <li key={item.id}>
                <button type="button" role="checkbox" aria-checked={on} className={`check-item${on ? ' on' : ''}`} onClick={() => void toggleCheck(store, trip, list.id, item.id)}>
                  <span className="check-box">{on && <Icon icon={Check} />}</span>
                  <span>{localized(item.text, lang)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <button type="button" className="btn small quiet" onClick={() => setEditing(true)}>
          <Icon icon={Pencil} />
          {t('checklist.editTemplate')}
        </button>
      </div>
    </Sheet>
  )
}

function TemplateForm({ store, list, notify, onDone, onClose }: { store: Store; list: Checklist; notify: Notify; onDone: () => void; onClose: () => void }) {
  const lang = useLang()
  const [title, setTitle] = useState(localized(list.title, lang))
  const [items, setItems] = useState(() => [...list.items.map((i) => ({ id: i.id as string | undefined, text: localized(i.text, lang) })), { id: undefined, text: '' }])
  const [busy, setBusy] = useState(false)

  const setItem = (i: number, text: string) => {
    const next = items.map((x, j) => (j === i ? { ...x, text } : x))
    // Altijd één lege regel onderaan: punten één per regel toevoegen.
    if (next.at(-1)?.text.trim()) next.push({ id: undefined, text: '' })
    setItems(next)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await saveChecklist(store, list, { title, items }, lang)
      notify(t('toast.saved'))
      onDone()
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const undo = await deleteChecklist(store, list)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={t('checklist.editTemplate')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <p className="muted small">{t('checklist.templateHint')}</p>
        <label>
          {t('checklist.title')}
          <input type="text" autoComplete="off" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <fieldset className="participants">
          <legend>{t('checklist.items')}</legend>
          {items.map((item, i) => (
            <div key={item.id ?? `nieuw-${i}`} className="participant-row checklist-row">
              <input
                type="text"
                autoComplete="off"
                maxLength={200}
                aria-label={t('checklist.item', { n: i + 1 })}
                placeholder={item.id ? '' : t('checklist.newItem')}
                value={item.text}
                onChange={(e) => setItem(i, e.target.value)}
              />
              {item.text.trim() !== '' && (
                <button type="button" className="btn icon" aria-label={t('checklist.removeItem', { n: i + 1 })} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  <Icon icon={X} />
                </button>
              )}
            </div>
          ))}
        </fieldset>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={busy}>
            {t('common.save')}
          </button>
          <button className="btn danger" type="button" onClick={() => void remove()}>
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
