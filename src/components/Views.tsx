import { BookOpen, CalendarPlus, Check } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { formatDate, formatHours, formatMoney, formatNm } from '../format'
import { todayIso } from '../model/types'
import { t, useLang } from '../i18n'
import { kindLabel, roleLabel, sourceLabel } from '../i18n/labels'
import { nameWithCounter } from '../model/counters'
import { courseLabel, effectiveCurricula } from '../model/curricula'
import { totalNm } from '../model/derive'
import { guestLabel, participantName } from '../model/guests'
import { nextOccurrence, setDone } from '../model/reminders'
import { eurValue } from '../model/rates'
import { routeOf } from '../model/trip-route'
import type { Leg, Participant, Reminder, Transaction, Trip } from '../model/types'
import type { Store } from '../storage/store'
import { LegSheet, TransactionSheet, type Notify } from './EditSheets'
import { Icon } from './Icon'
import { ReminderSheet } from './ReminderSheet'
import { RouteMap } from './LazyMap'
import { Sheet } from './Sheet'
import { ParticipantSheet } from './TripSheets'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'

// Leesweergaven: tikken op iets opent eerst wat er staat; bewerken gaat via het potlood rechtsboven en verwijderen zit
// pas in het bewerkscherm (met 10 seconden ongedaan maken). Zo verandert er nooit iets per ongeluk.

export type ViewRow = [label: string, value: ReactNode | null | undefined | false]

/** Label en waarde onder elkaar; lege waarden vallen weg. */
export function ViewRows({ rows }: { rows: readonly ViewRow[] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '')
  if (shown.length === 0) return null
  return (
    <dl className="view-rows">
      {shown.map(([label, value]) => (
        <div key={label} className="view-row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function waterLine(leg: Leg): string {
  const parts: string[] = []
  if (leg.nmSea > 0) parts.push(`${t('water.sea')} ${formatNm(leg.nmSea)}`)
  if (leg.nmTidal > 0) parts.push(`${t('water.tidal')} ${formatNm(leg.nmTidal)}`)
  if (leg.nmInland > 0) parts.push(`${t('water.inland')} ${formatNm(leg.nmInland)}`)
  return parts.length > 1 ? `${formatNm(totalNm(leg))} (${parts.join(' · ')})` : parts.length === 1 ? parts[0]! : formatNm(0)
}

/** Eén dag: route op de kaart, mijlen per watertype, nachturen, wind, boot, rol, trip en notitie. */
export function LegView({ store, leg, notify, onClose }: { store: Store; leg: Leg; notify: Notify; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const places = useCollection(store, 'places.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const counters = useCounters(store)
  // Na bewerken de nieuwste versie tonen (of niets meer als de dag is verwijderd).
  const current = useCollection(store, 'legs.json.enc').find((l) => l.id === leg.id) ?? leg
  if (editing) return <LegSheet store={store} leg={current} notify={notify} onClose={onClose} />
  const trip = trips.find((x) => x.id === current.tripId && x.deletedAt === null)
  const route = routeOf([current], places)
  const title = [current.fromPlace, current.toPlace].filter(Boolean).join(' → ') || formatDate(current.date)
  return (
    <Sheet title={title} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack view">
        <p className="muted">{formatDate(current.date)}</p>
        <RouteMap route={route} small />
        <ViewRows
          rows={[
            [t('week.nm'), waterLine(current)],
            [t('field.nightHours'), current.nightHours > 0 && formatHours(current.nightHours)],
            [t('field.wind'), current.windBft],
            [t('field.boat'), current.boat],
            [t('field.role'), roleLabel(current.role)],
            [t('field.week'), trip && nameWithCounter(trip, counters.get(trip.id))],
            [t('field.skipper'), current.skipperName],
            [t('field.coSkipper'), current.coSkipperName],
            [t('field.note'), current.notes],
          ]}
        />
      </div>
    </Sheet>
  )
}

/** Eén transactie: bedrag in euro en het origineel, soort, datum, trip, bron, van wie en notitie. */
export function TransactionView({ store, tx, notify, onClose }: { store: Store; tx: Transaction; notify: Notify; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const trips = useCollection(store, 'trips.json.enc')
  const counters = useCounters(store)
  const all = useCollection(store, 'transactions.json.enc')
  const current = all.find((x) => x.id === tx.id) ?? tx
  if (editing) return <TransactionSheet store={store} tx={current} notify={notify} onClose={onClose} />
  const trip = trips.find((x) => x.id === current.tripId && x.deletedAt === null)
  const value = eurValue(current)
  const amount =
    current.currency === 'EUR' || !value ? formatMoney(current.amount, current.currency) : `${formatMoney(value.eur, 'EUR')} (${formatMoney(current.amount, current.currency)}${value.provisional ? `, ${t('money.provisional')}` : ''})`
  return (
    <Sheet title={kindLabel(current.kind)} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack view">
        <p className="view-amount">{amount}</p>
        <ViewRows
          rows={[
            [t('field.date'), formatDate(current.date)],
            [t('field.week'), trip && nameWithCounter(trip, counters.get(trip.id))],
            [t('field.source'), sourceLabel(current.source)],
            [t('tip.from'), current.kind === 'fooi' && tipFromText(current, trip)],
            [t('costs.category'), current.kind === 'kosten' && current.category && t(`costCategory.${current.category}`)],
            [t('tipVia.label'), current.kind === 'fooi' && current.tipVia && `${t(`tipVia.${current.tipVia}`)}${current.depositedAt ? ` · ${t('tipVia.deposited', { date: formatDate(current.depositedAt) })}` : ''}`],
            [t('view.received'), typeof current.receivedEur === 'number' && formatMoney(current.receivedEur, 'EUR')],
            [t('payout.partLabel'), current.payoutId && t('payout.part', { n: all.filter((x) => x.payoutId === current.payoutId && x.deletedAt === null).length })],
            [t('field.note'), current.note],
          ]}
        />
      </div>
    </Sheet>
  )
}

function tipFromText(tx: Transaction, trip: Trip | undefined): string {
  const from = tx.tipFrom
  if (!from || from.kind === 'onbekend') return t('tip.unknown')
  if (from.kind === 'groep') return t('tip.group')
  const people = trip?.participants ?? []
  const names = from.participantIds.map((id) => people.find((p) => p.id === id)).filter((p): p is Participant => !!p)
  return names.length > 0 ? names.map((p) => participantName(p, people)).join(', ') : t('tip.unknown')
}

/** Eén termijn: wanneer, soort, herhalen en notitie; afronden met één tik, bewerken via het potlood. */
export function ReminderView({ store, reminder, notify, onClose }: { store: Store; reminder: Reminder; notify: Notify; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const current = useCollection(store, 'reminders.json.enc').find((r) => r.id === reminder.id) ?? reminder
  if (editing) return <ReminderSheet store={store} reminder={current} notify={notify} onClose={onClose} />
  return (
    <Sheet title={current.title} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack view">
        <ViewRows
          rows={[
            [t(current.kind === 'vervalt' ? 'reminder.dateExpiry' : 'reminder.dateDeadline'), formatDate(current.date)],
            [t('reminder.kind'), t(`reminderKind.${current.kind}`)],
            [t('reminder.repeat'), current.repeat && t(`reminderRepeat.${current.repeat}`)],
            [t('field.note'), current.note],
            [t('reminder.doneList'), current.doneAt && t('reminder.doneOn', { date: formatDate(current.doneAt) })],
          ]}
        />
        {!current.doneAt && (
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              const undo = await setDone(store, current, true, todayIso())
              onClose()
              notify(current.repeat ? t('reminder.nextTime', { date: formatDate(nextOccurrence(current)) }) : t('reminder.doneToast'), undo)
            }}
          >
            <Icon icon={Check} />
            {t('reminder.done')}
          </button>
        )}
      </div>
    </Sheet>
  )
}

/** Eén deelnemer: naam, land, kenmerk, niveau en cursus; met een cursus één tik naar de checklist van de student. */
export function ParticipantView({
  store,
  trip,
  participant,
  notify,
  onClose,
  onOpenStudent,
}: {
  store: Store
  trip: Trip
  participant: Participant
  notify: Notify
  onClose: () => void
  onOpenStudent?: (studentId: string) => void
}) {
  const lang = useLang()
  const [editing, setEditing] = useState(false)
  const curricula = effectiveCurricula(useCollection(store, 'curricula.json.enc'))
  const student = useCollection(store, 'students.json.enc').find((s) => s.id === participant.id && s.deletedAt === null)
  if (editing) return <ParticipantSheet store={store} trip={trip} participant={participant} notify={notify} onClose={onClose} />
  const course = curricula.find((c) => c.id === participant.curriculumId)
  const people = trip.participants ?? []
  return (
    <Sheet title={participantName(participant, people)} onClose={onClose} onEdit={() => setEditing(true)}>
      <div className="stack view">
        <ViewRows
          rows={[
            [t('guest.country'), participant.country],
            [t('guest.tag'), participant.tag],
            [t('students.level'), participant.level && t(`level.${participant.level}`)],
            [t('students.course'), course && courseLabel(course, lang)],
            [t('view.returning'), participant.guestId && participant.guestId !== participant.id && guestLabel(participant)],
          ]}
        />
        {student && onOpenStudent && (
          <button type="button" className="btn primary" onClick={() => onOpenStudent(student.id)}>
            <Icon icon={BookOpen} />
            {t('students.openChecklist')}
          </button>
        )}
      </div>
    </Sheet>
  )
}

/** Knop onder een leesweergave om iets nieuws toe te voegen (bijvoorbeeld een termijn op deze dag). */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn small" onClick={onClick}>
      <Icon icon={CalendarPlus} />
      {label}
    </button>
  )
}
