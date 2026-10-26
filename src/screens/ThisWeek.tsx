import { CalendarPlus, ChevronRight, Eye, EyeOff, Pencil, Users } from 'lucide-react'
import { useCallback, useState, useSyncExternalStore } from 'react'
import type { Notify } from '../components/EditSheets'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { CloseWeekSheet, organisationLabel, WeekSheet, weekTypeLabel } from '../components/WeekSheet'
import { formatDate, formatDateRange, formatMoney, formatNm } from '../format'
import { t, useLang } from '../i18n'
import { courseLabel, effectiveCurricula } from '../model/curricula'
import { totalNm } from '../model/derive'
import { totals } from '../model/money'
import { eurValue, getRates, subscribeRates } from '../model/rates'
import { currentSettings } from '../model/settings'
import { todayIso } from '../model/types'
import { activeWeek, needsClosing, weekView } from '../model/weeks'
import type { Store } from '../storage/store'
import { PlansView } from './Planning'
import { StudentsView } from './Students'

// Deze week: kop (tikken = bewerken), deelnemers, planning (bij training geven), checklists per deelnemer,
// gezeilde dagen met nm-totaal, en fooien en kosten van de week, standaard verborgen achter "Toon bedragen".

export function ThisWeek({ store, notify }: { store: Store; notify: Notify }) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const stored = useCollection(store, 'curricula.json.enc')
  const curricula = effectiveCurricula(stored)
  const lang = useLang()
  const [sheet, setSheet] = useState<'new' | 'edit' | 'close' | null>(null)
  // Een open planning of student vult het hele scherm; de andere onderdelen wijken dan.
  const [planOpen, setPlanOpen] = useState(false)
  const [studentOpen, setStudentOpen] = useState(false)
  const onPlanDetail = useCallback((open: boolean) => setPlanOpen(open), [])
  const onStudentDetail = useCallback((open: boolean) => setStudentOpen(open), [])
  const week = activeWeek(trips, settings)

  if (!week) {
    return (
      <section className="stack-lg">
        <header className="page-header">
          <h1>{t('nav.week')}</h1>
        </header>
        <Empty
          icon={CalendarPlus}
          action={
            <button className="btn primary" onClick={() => setSheet('new')}>
              {t('week.new')}
            </button>
          }
        >
          {t('week.noActive')}
        </Empty>
        {sheet === 'new' && <WeekSheet store={store} trip={null} notify={notify} onClose={() => setSheet(null)} />}
      </section>
    )
  }

  const view = weekView(week, legs)
  const detail = planOpen || studentOpen
  const participants = week.participants ?? []

  return (
    <section className="stack-lg this-week">
      {!detail && (
        <>
          <header className="page-header">
            <h1>{t('nav.week')}</h1>
          </header>
          <button className="card week-head" onClick={() => setSheet('edit')} aria-label={`${t('week.edit')}: ${week.name}`}>
            <span className="week-head-title">
              <span>{week.name}</span>
              <Icon icon={Pencil} />
            </span>
            <span className="muted small">
              {[weekTypeLabel(view.type), view.startDate ? formatDateRange(view.startDate, view.endDate) : ''].filter(Boolean).join(' · ')}
            </span>
            <span className="muted small">{[view.boat, week.area, week.organisation ? organisationLabel(week.organisation) : ''].filter(Boolean).join(' · ')}</span>
          </button>
          {needsClosing(view, todayIso()) && (
            <div className="notice">
              <p className="small">{t('week.closePrompt', { name: week.name })}</p>
              <button className="btn small primary" onClick={() => setSheet('close')}>
                {t('week.close')}
              </button>
            </div>
          )}
          <div className="section">
            <h2>{t('week.participants')}</h2>
            {participants.length === 0 ? (
              <p className="muted">
                {t('week.noParticipants')}{' '}
                <button className="btn link inline" onClick={() => setSheet('edit')}>
                  {t('week.addParticipants')}
                </button>
              </p>
            ) : (
              <ul className="participant-chips">
                {participants.map((p) => {
                  const course = curricula.find((c) => c.id === p.curriculumId)
                  return (
                    <li key={p.id} className="chip-static">
                      <Icon icon={Users} />
                      <span>{p.firstName}</span>
                      {(p.level || course) && (
                        <span className="muted small">{[p.level ? t(`level.${p.level}`) : '', course ? courseLabel(course, lang) : ''].filter(Boolean).join(' · ')}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}
      {view.type === 'training-geven' && !studentOpen && (
        <div className="section">
          {!planOpen && <h2>{t('plan.list')}</h2>}
          <PlansView store={store} notify={notify} curricula={curricula} week={week} onDetail={onPlanDetail} />
        </div>
      )}
      {!planOpen && (participants.some((p) => p.curriculumId) || view.type === 'training-geven') && (
        <div className="section">
          {!studentOpen && <h2>{t('week.checklists')}</h2>}
          <StudentsView store={store} notify={notify} curricula={curricula} scope={{ kind: 'week', week }} onDetail={onStudentDetail} />
        </div>
      )}
      {!detail && (
        <>
          <SailedDays legs={view.legs} nm={view.nm} />
          <WeekMoney store={store} weekId={week.id} />
        </>
      )}
      {sheet === 'edit' && <WeekSheet store={store} trip={week} notify={notify} onClose={() => setSheet(null)} />}
      {sheet === 'close' && <CloseWeekSheet store={store} trip={week} notify={notify} onClose={() => setSheet(null)} />}
    </section>
  )
}

function SailedDays({ legs, nm }: { legs: ReturnType<typeof weekView>['legs']; nm: number }) {
  return (
    <div className="section">
      <div className="section-head">
        <h2>{t('week.sailedDays')}</h2>
        <span className="num">{formatNm(nm)}</span>
      </div>
      {legs.length === 0 ? (
        <p className="muted">{t('week.noDays')}</p>
      ) : (
        <ul className="rows">
          {legs.map((leg) => (
            <li key={leg.id} className="row-item">
              <span className="row-main">
                <span>{[leg.fromPlace, leg.toPlace].filter(Boolean).join(' → ')}</span>
                <span className="muted small">{formatDate(leg.date)}</span>
              </span>
              <span className="row-value">{formatNm(totalNm(leg))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Fooien en kosten van de week in euro, verborgen tot Olivier op "Toon bedragen" tikt (studenten kijken mee). */
function WeekMoney({ store, weekId }: { store: Store; weekId: string }) {
  const transactions = useCollection(store, 'transactions.json.enc').filter((tx) => tx.deletedAt === null && tx.tripId === weekId)
  useSyncExternalStore(subscribeRates, getRates)
  const [shown, setShown] = useState(false)
  if (transactions.length === 0) return null
  const sum = totals(transactions)
  const provisional = transactions.some((tx) => eurValue(tx)?.provisional)
  return (
    <div className="section">
      <div className="section-head">
        <h2>{t('week.money')}</h2>
        <button className="btn link small" onClick={() => setShown(!shown)} aria-pressed={shown}>
          <Icon icon={shown ? EyeOff : Eye} />
          {t(shown ? 'week.hideAmounts' : 'week.showAmounts')}
        </button>
      </div>
      {shown ? (
        <>
          <dl className="grid">
            <div className="stat">
              <dt>{t('week.income')}</dt>
              <dd>{formatMoney(sum.incomeEur, 'EUR')}</dd>
            </div>
            <div className="stat">
              <dt>{t('week.costs')}</dt>
              <dd>{formatMoney(sum.costsEur, 'EUR')}</dd>
            </div>
          </dl>
          {Object.entries(sum.other).map(([c, v]) => (
            <p key={c} className="muted small">
              {t('money.noRateFor', { currency: c })}: +{formatMoney(v.income, c)} −{formatMoney(v.costs, c)}
            </p>
          ))}
          {provisional && <p className="muted small">{t('money.provisionalHint')}</p>}
        </>
      ) : (
        <p className="muted small">
          <Icon icon={ChevronRight} />
          {t('week.amountsHidden', { n: transactions.length })}
        </p>
      )}
    </div>
  )
}
