import { Anchor, Check, Plus, RefreshCw, Wind } from 'lucide-react'
import { Fragment, useState } from 'react'
import { formatWeekday } from '../format'

/** "zo 22" (korte weekdag en dag), voor het raster om te verplaatsen. */
function formatWeekdayShort(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'nl-NL', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
}
import { t, useLang } from '../i18n'
import { localized } from '../model/curricula'
import { blocksForWeek, elementsFor, lessonBlock, type ElementLabel, type LessonStudent } from '../model/lesweek'
import { draftLessonPlan, examGaps, movedBlock, planDay, redraftFrom, SLOTS, unplanned, withDayInput } from '../model/lesweek-plan'
import type { LessonPlanDay, LessonSlot, Trip } from '../model/types'
import type { Store } from '../storage/store'
import { lesblokAfvinken, lesplanningOpslaan } from '../domain/training'
import { todayIso } from '../basis/datum'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { Sheet } from './Sheet'

// Weekplanner van de lesweek (src/model/lesweek-plan.ts): één tik maakt een voorstel volgens de vaste regels; daarna
// per dag de wind en de steiger, per dagdeel de blokken (tik = bekijken, afvinken, verplaatsen of weghalen; + = blok
// erbij). "Nieuw voorstel vanaf vandaag" plant de rest van de week opnieuw, pas na een tik, met ongedaan maken.

const WIND_NEXT: Record<string, LessonPlanDay['wind'] | null> = { normaal: 'veel', veel: 'weinig', weinig: null }

export function LessonPlanner({ store, trip, students, labels, notify }: { store: Store; trip: Trip; students: LessonStudent[]; labels: Set<ElementLabel>; notify: Notify }) {
  const lang = useLang()
  const today = todayIso()
  const [open, setOpen] = useState<{ id: string; date: string; slot: LessonSlot } | null>(null)
  const [adding, setAdding] = useState<{ date: string; slot: LessonSlot } | null>(null)
  const days = trip.lessonPlan?.days ?? []
  const title = (id: string) => localized(lessonBlock(id)!.title, lang)

  async function save(next: LessonPlanDay[], message?: string) {
    const undo = await lesplanningOpslaan(store, trip.id, next)
    if (message) notify(message, undo)
  }

  if (!trip.startDate) return null
  if (days.length === 0) {
    return (
      <button type="button" className="btn primary" onClick={() => void save(draftLessonPlan(trip, students), t('lessonPlan.made'))}>
        {t('lessonPlan.make')}
      </button>
    )
  }

  const gaps = examGaps(days, trip.lessonChecks, students, trip)
  const missing = unplanned(days, students, trip).filter((id) => !trip.lessonChecks?.[id])
  const plannedIds = new Set(days.flatMap((d) => SLOTS.flatMap((slot) => d[slot])))
  const allWeek = blocksForWeek(students, trip).filter((b) => (b.section === 'kort' || b.section === 'doorlopend') && !plannedIds.has(b.id))

  return (
    <div className="stack-sm lesson-plan">
      {gaps.map((g) => (
        <p key={g.course} className="small negative">
          {t('lessonPlan.examGap', { course: g.course, blocks: g.blocks.map(title).join(', ') })}
        </p>
      ))}
      {missing.length > 0 && <p className="small muted">{t('lessonPlan.unplanned', { blocks: missing.map(title).join(', ') })}</p>}
      {days.map((day) => {
        const wind = day.wind ?? 'normaal'
        return (
          <div key={day.date} className={`card lesson-day${day.date === today ? ' today' : ''}`}>
            <div className="lesson-day-head">
              <span className="lesson-day-date">{formatWeekday(day.date, lang)}</span>
              <button type="button" className="btn icon" aria-label={t('lessonPlan.addAria', { day: formatWeekday(day.date, lang) })} onClick={() => setAdding({ date: day.date, slot: 'ochtend' })}>
                <Icon icon={Plus} />
              </button>
              <span className="lesson-day-inputs">
              <button
                type="button"
                className={`chip small${wind !== 'normaal' ? ' active' : ''}`}
                aria-label={t('lessonPlan.windAria', { wind: t(`lessonPlan.wind.${wind}`) })}
                onClick={() => void save(withDayInput(days, day.date, { wind: WIND_NEXT[wind] }))}
              >
                <Icon icon={Wind} />
                {t(`lessonPlan.wind.${wind}`)}
              </button>
              <button type="button" className={`chip small${day.dock ? ' active' : ''}`} aria-pressed={!!day.dock} onClick={() => void save(withDayInput(days, day.date, { dock: !day.dock }))}>
                <Icon icon={Anchor} />
                {t('lessonPlan.dock')}
              </button>
              </span>
            </div>
            {SLOTS.filter((slot) => day[slot].length > 0).map((slot) => (
              <div key={slot} className="lesson-slot">
                <span className="lesson-slot-label small muted">{t(`lessonPlan.slot.${slot}`)}</span>
                <span className="lesson-slot-blocks">
                  {day[slot].map((id) => {
                    const done = !!trip.lessonChecks?.[id]
                    return (
                      <button key={id} type="button" className={`chip small lesson-chip${done ? ' done' : ''}`} onClick={() => setOpen({ id, date: day.date, slot })}>
                        {done && <Icon icon={Check} />}
                        {title(id)}
                      </button>
                    )
                  })}
                </span>
              </div>
            ))}
          </div>
        )
      })}
      {allWeek.length > 0 && <p className="small muted">{t('lessonPlan.allWeek', { blocks: allWeek.map((b) => localized(b.title, lang)).join(', ') })}</p>}
      <button type="button" className="btn" onClick={() => void save(redraftFrom(days, trip, students, today), t('lessonPlan.redrafted'))}>
        <Icon icon={RefreshCw} />
        {t('lessonPlan.redraft')}
      </button>

      {open && (
        <PlanBlockSheet
          trip={trip}
          days={days}
          at={open}
          labels={labels}
          onToggle={() => void lesblokAfvinken(store, trip.id, open.id)}
          onMove={(to) => {
            void save(movedBlock(days, open.id, open, to), to ? undefined : t('lessonPlan.removed'))
            setOpen(null)
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {adding && (
        <Sheet title={t('lessonPlan.add')} onClose={() => setAdding(null)}>
          <div className="segments small" role="radiogroup" aria-label={t('lessonPlan.add')}>
            {SLOTS.map((slot) => (
              <button key={slot} type="button" role="radio" aria-checked={adding.slot === slot} className={`segment${adding.slot === slot ? ' active' : ''}`} onClick={() => setAdding({ ...adding, slot })}>
                {t(`lessonPlan.slot.${slot}`)}
              </button>
            ))}
          </div>
          <ul className="rows">
            {blocksForWeek(students, trip)
              .filter((b) => !days.find((d) => d.date === adding.date)![adding.slot].includes(b.id))
              .map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className="row-button"
                    onClick={() => {
                      void save(movedBlock(days, b.id, { date: '', slot: adding.slot }, adding))
                      setAdding(null)
                    }}
                  >
                    <span className="row-main">
                      <span>
                        <span className="lesson-code">{b.section === 'examen' ? '' : `${b.id} `}</span>
                        {localized(b.title, lang)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </Sheet>
      )}
    </div>
  )
}

function PlanBlockSheet({ trip, days, at, labels, onToggle, onMove, onClose }: { trip: Trip; days: LessonPlanDay[]; at: { id: string; date: string; slot: LessonSlot }; labels: Set<ElementLabel>; onToggle: () => void; onMove: (to: { date: string; slot: LessonSlot } | null) => void; onClose: () => void }) {
  const lang = useLang()
  const block = lessonBlock(at.id)!
  const done = !!trip.lessonChecks?.[at.id]
  const elements = elementsFor(block, labels)
  return (
    <Sheet title={localized(block.title, lang)} onClose={onClose}>
      <div className="stack">
        {elements.length > 0 && (
          <ul className="lesson-elements">
            {elements.map((e, i) => (
              <li key={i}>
                {localized(e.text, lang)}
                {e.label && e.label !== 'mono' && <span className="lesson-label">{e.label === 'star' ? '★' : e.label}</span>}
              </li>
            ))}
          </ul>
        )}
        <button type="button" className={`btn${done ? '' : ' primary'}`} onClick={onToggle}>
          <Icon icon={Check} />
          {done ? t('lessonPlan.undone') : t('lessonPlan.done')}
        </button>
        <div className="stack-sm">
          <p className="small muted">{t('lessonPlan.move')}</p>
          <div className="lesson-move-grid" role="group" aria-label={t('lessonPlan.move')}>
            <span />
            {SLOTS.map((slot) => (
              <span key={slot} className="small muted lesson-move-head">
                {t(`lessonPlan.slotShort.${slot}`)}
              </span>
            ))}
            {days.map((d) => (
              <Fragment key={d.date}>
                <span className="small lesson-move-day">{formatWeekdayShort(d.date, lang)}</span>
                {SLOTS.map((slot) => {
                  const here = d.date === at.date && slot === at.slot
                  return (
                    <button
                      key={slot}
                      type="button"
                      className={`lesson-move-cell${here ? ' here' : ''}`}
                      aria-pressed={here}
                      aria-label={`${formatWeekday(d.date, lang)} · ${t(`lessonPlan.slot.${slot}`)}`}
                      onClick={() => !here && onMove({ date: d.date, slot })}
                    >
                      {d[slot].length > 0 ? d[slot].length : ''}
                    </button>
                  )
                })}
              </Fragment>
            ))}
          </div>
        </div>
        <div className="lesson-remove">
          <button type="button" className="btn danger" onClick={() => onMove(null)}>
            {t('lessonPlan.remove')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/** Vandaag: de blokken van de lesplanning van vandaag per dagdeel; één tik = afvinken (geen namen, studenten kijken mee). */
export function LessonToday({ store, trip, today }: { store: Store; trip: Trip; today: string }) {
  const lang = useLang()
  const day = planDay(trip.lessonPlan, today)
  if (!day || SLOTS.every((slot) => day[slot].length === 0)) return null
  return (
    <div className="card card-body stack-sm lesson-today">
      <h2>{t('lessonPlan.today')}</h2>
      {SLOTS.filter((slot) => day[slot].length > 0).map((slot) => (
        <div key={slot} className="stack-sm">
          <p className="small muted">{t(`lessonPlan.slot.${slot}`)}</p>
          <ul className="check-items">
            {day[slot].map((id) => {
              const on = !!trip.lessonChecks?.[id]
              return (
                <li key={id}>
                  <button type="button" role="checkbox" aria-checked={on} className={`check-item${on ? ' on' : ''}`} onClick={() => void lesblokAfvinken(store, trip.id, id)}>
                    <span className="check-box">{on && <Icon icon={Check} />}</span>
                    <span>{localized(lessonBlock(id)!.title, lang)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
