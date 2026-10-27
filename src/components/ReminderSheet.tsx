import { Check, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { t } from '../i18n'
import { deleteReminder } from '../model/edit'
import { dateAfter, QUICK_OFFSETS, saveReminder, setDone } from '../model/reminders'
import { REMINDER_KINDS, todayIso, type Reminder, type ReminderKind } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

// Termijn toevoegen of bewerken: wat, deadline of vervaldatum, en wanneer (snelle keuze of datum). Drie velden.

export function ReminderSheet({ store, reminder, notify, onClose }: { store: Store; reminder: Reminder | null; notify: Notify; onClose: () => void }) {
  const today = todayIso()
  const [title, setTitle] = useState(reminder?.title ?? '')
  const [kind, setKind] = useState<ReminderKind>(reminder?.kind ?? 'deadline')
  const [date, setDate] = useState(reminder?.date ?? dateAfter(today, QUICK_OFFSETS[1]))
  const [note, setNote] = useState(reminder?.note ?? '')
  const [busy, setBusy] = useState(false)
  const ok = title.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(date)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    try {
      await saveReminder(store, { title, date, kind, note }, reminder ?? undefined)
      notify(t('toast.saved'))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function toggleDone() {
    if (!reminder) return
    const undo = await setDone(store, reminder, !reminder.doneAt, today)
    onClose()
    notify(t(reminder.doneAt ? 'reminder.reopened' : 'reminder.doneToast'), undo)
  }

  async function remove() {
    if (!reminder) return
    const undo = await deleteReminder(store, reminder)
    onClose()
    notify(t('toast.deleted'), undo)
  }

  return (
    <Sheet title={reminder ? t('reminder.edit') : t('reminder.new')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('reminder.title')}
          <input type="text" autoComplete="off" autoFocus={!reminder} maxLength={120} placeholder={t('reminder.titlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="segments small" role="radiogroup" aria-label={t('reminder.kind')}>
          {REMINDER_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`segment${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>
              {t(`reminderKind.${k}`)}
            </button>
          ))}
        </div>
        <div className="type-buttons" role="group" aria-label={t('reminder.when')}>
          {QUICK_OFFSETS.map((o) => {
            const value = dateAfter(today, o)
            return (
              <button key={o.key} type="button" aria-pressed={date === value} className={`chip${date === value ? ' active' : ''}`} onClick={() => setDate(value)}>
                {t(`reminder.offset.${o.key}`)}
              </button>
            )
          })}
        </div>
        <div className="two">
          <label>
            {t(kind === 'deadline' ? 'reminder.dateDeadline' : 'reminder.dateExpiry')}
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            {t('field.note')}
            <input type="text" autoComplete="off" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <div className="sheet-actions">
          <button className="btn primary" type="submit" disabled={!ok || busy}>
            {t('common.save')}
          </button>
          {reminder && (
            <button className="btn" type="button" onClick={() => void toggleDone()}>
              <Icon icon={reminder.doneAt ? RotateCcw : Check} />
              {t(reminder.doneAt ? 'reminder.reopen' : 'reminder.done')}
            </button>
          )}
          {reminder && (
            <button className="btn danger" type="button" onClick={() => void remove()}>
              <Icon icon={Trash2} />
              {t('common.delete')}
            </button>
          )}
        </div>
      </form>
    </Sheet>
  )
}
