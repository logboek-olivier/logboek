import { CalendarPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { formatDate } from '../format'
import { t } from '../i18n'
import { buildIndex, dayInfo, planningEnd } from '../model/calendar'
import { DEFAULT_REMINDER_TIME, dailyIcs, isTime } from '../model/daily'
import { currentSettings, saveSettings } from '../model/settings'
import { todayIso } from '../model/types'
import { shareOrDownload } from '../share'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

// Instellingen → Herinnering: een dagelijkse herinnering in de eigen agenda-app ("Logboek: log je dag"), elke dag of
// alleen op de werkdagen uit de agenda tot het einde van de planning. De app maakt een .ics-bestand en deelt het; hij
// verstuurt zelf niets en heeft geen meldingen nodig.

/** De werkdagen uit de agenda van vandaag tot het einde van de planning. */
export function workDates(store: Store, today: string): string[] {
  const index = buildIndex(store.list('calendar.json.enc'), store.list('trips.json.enc'), store.list('legs.json.enc'))
  const end = planningEnd(index)
  const out: string[] = []
  if (!end) return out
  for (let d = today; d <= end; d = nextDay(d)) if (dayInfo(index, d, today).type === 'werk') out.push(d)
  return out
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function reminderLine(store: Store): string {
  const r = currentSettings(store.list('settings.json.enc')).dailyReminder
  if (!r) return ''
  return `${r.time} · ${t(r.workdaysOnly ? 'reminderDaily.workdays' : 'reminderDaily.everyDay')}`
}

export function DailyReminderSheet({ store, onClose, notify }: { store: Store; onClose: () => void; notify: Notify }) {
  const current = currentSettings(store.list('settings.json.enc')).dailyReminder
  const today = todayIso()
  const [time, setTime] = useState(current?.time ?? DEFAULT_REMINDER_TIME)
  const dates = workDates(store, today)
  const [workdaysOnly, setWorkdaysOnly] = useState(Boolean(current?.workdaysOnly) && dates.length > 0)
  const valid = isTime(time)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    const ics = dailyIcs({ title: t('reminderDaily.title'), description: t('reminderDaily.description'), time, start: today, ...(workdaysOnly ? { dates } : {}) })
    await saveSettings(store, { dailyReminder: { time, workdaysOnly } })
    void store.sync()
    await shareOrDownload(new File([ics], 'logboek-herinnering.ics', { type: 'text/calendar' }), t('reminderDaily.title'))
    onClose()
    notify(t('reminderDaily.done'))
  }

  return (
    <Sheet title={t('reminderDaily.screen')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <p className="muted">{t('reminderDaily.hint')}</p>
        <label>
          {t('reminderDaily.time')}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
        <div className="type-buttons" role="radiogroup" aria-label={t('reminderDaily.when')}>
          <button type="button" role="radio" aria-checked={!workdaysOnly} className={`chip${!workdaysOnly ? ' active' : ''}`} onClick={() => setWorkdaysOnly(false)}>
            {t('reminderDaily.everyDay')}
          </button>
          <button type="button" role="radio" aria-checked={workdaysOnly} disabled={dates.length === 0} className={`chip${workdaysOnly ? ' active' : ''}`} onClick={() => setWorkdaysOnly(true)}>
            {t('reminderDaily.workdays')}
          </button>
        </div>
        {dates.length > 0 ? (
          workdaysOnly && <p className="muted small">{t('reminderDaily.workdaysHint', { n: dates.length, until: formatDate(dates.at(-1)!) })}</p>
        ) : (
          <p className="muted small">{t('reminderDaily.noWorkdays')}</p>
        )}
        <button className="btn primary" type="submit" disabled={!valid}>
          <Icon icon={CalendarPlus} />
          {t('reminderDaily.add')}
        </button>
        <p className="muted small">{t('reminderDaily.again')}</p>
      </form>
    </Sheet>
  )
}
