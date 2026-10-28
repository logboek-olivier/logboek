import { CalendarPlus, Check, RotateCcw, Trash2 } from 'lucide-react'
import { formatDate } from '../format'
import { ALARM_CHOICES, buildIcs, DEFAULT_ALARM_DAYS } from '../model/ics'
import { currentSettings, saveSettings } from '../model/settings'
import { shareOrDownload } from '../share'
import { useState, type FormEvent } from 'react'
import { t } from '../i18n'
import { deleteReminder } from '../model/edit'
import { dateAfter, nextOccurrence, QUICK_OFFSETS, saveReminder, setDone } from '../model/reminders'
import { newId, REMINDER_KINDS, REMINDER_REPEATS, todayIso, type Reminder, type ReminderKind, type ReminderRepeat } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

// Termijn toevoegen of bewerken: wat, deadline of vervaldatum, en wanneer (snelle keuze of datum). Drie velden; herhalen
// (maandelijks, jaarlijks) en "Zet in agenda" (een .ics-bestand met herinnering vooraf) zijn optioneel.

/** `initialDate`: datum van een nieuwe termijn (vanuit het dagblad in de agenda). */
export function ReminderSheet({ store, reminder, notify, onClose, initialDate }: { store: Store; reminder: Reminder | null; notify: Notify; onClose: () => void; initialDate?: string }) {
  const today = todayIso()
  const [title, setTitle] = useState(reminder?.title ?? '')
  const [kind, setKind] = useState<ReminderKind>(reminder?.kind ?? 'deadline')
  const [date, setDate] = useState(reminder?.date ?? initialDate ?? dateAfter(today, QUICK_OFFSETS[1]))
  const [note, setNote] = useState(reminder?.note ?? '')
  const [repeat, setRepeat] = useState<ReminderRepeat | undefined>(reminder?.repeat)
  const settings = currentSettings(store.get('settings.json.enc'))
  const [alarmDays, setAlarmDays] = useState(settings.reminderAlarmDays ?? DEFAULT_ALARM_DAYS)
  const [busy, setBusy] = useState(false)
  const ok = title.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(date)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    try {
      await saveReminder(store, { title, date, kind, note, repeat }, reminder ?? undefined)
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
    if (reminder.repeat && !reminder.doneAt) notify(t('reminder.nextTime', { date: formatDate(nextOccurrence(reminder)) }), undo)
    else notify(t(reminder.doneAt ? 'reminder.reopened' : 'reminder.doneToast'), undo)
  }

  /** Agenda-bestand (.ics) met herinnering vooraf; lokaal gemaakt en gedeeld of gedownload. */
  async function toCalendar() {
    if (!ok) return
    if (alarmDays !== settings.reminderAlarmDays) {
      await saveSettings(store, { reminderAlarmDays: alarmDays })
      void store.sync()
    }
    const ics = buildIcs({ id: reminder?.id ?? newId(), title: title.trim(), date, note: note.trim() || undefined, repeat, alarmDays })
    await shareOrDownload(new File([ics], 'termijn.ics', { type: 'text/calendar' }), title.trim())
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
        <div className="segments small" role="radiogroup" aria-label={t('reminder.repeat')}>
          {([undefined, ...REMINDER_REPEATS] as (ReminderRepeat | undefined)[]).map((r) => (
            <button key={r ?? 'eenmalig'} type="button" role="radio" aria-checked={repeat === r} className={`segment${repeat === r ? ' active' : ''}`} onClick={() => setRepeat(r)}>
              {t(r ? `reminderRepeat.${r}` : 'reminderRepeat.eenmalig')}
            </button>
          ))}
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
        <div className="calendar-row">
          <label>
            {t('reminder.alarm')}
            <select value={alarmDays} onChange={(e) => setAlarmDays(Number(e.target.value))}>
              {ALARM_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? t('reminder.alarmSameDay') : t('reminder.alarmBefore', { n: d })}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="button" disabled={!ok} onClick={() => void toCalendar()}>
            <Icon icon={CalendarPlus} />
            {t('reminder.toCalendar')}
          </button>
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
