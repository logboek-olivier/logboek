import { SailedMap } from '../components/SailedMap'
import { BarChart3, Check, Circle, Eye, EyeOff } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { BarChart } from '../components/BarChart'
import { HBars } from '../components/HBars'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { organisationLabel, weekTypeLabel } from '../components/WeekSheet'
import { Empty } from '../components/Empty'
import { formatDate, formatDateRange, formatDateShort, formatHours, formatMoney, formatMoneyShort, formatMonth, formatMonthShort, formatNm, formatNumber } from '../format'
import { t, useLang } from '../i18n'
import { roleLabel } from '../i18n/labels'
import { buildIndex } from '../model/calendar'
import { effectiveCurricula } from '../model/curricula'
import { totalNm } from '../model/derive'
import { getRates, subscribeRates } from '../model/rates'
import { currentSettings } from '../model/settings'
import { instructorStats, moneyStats, periodFor, ryaYachtmasterOffshore, sailingStats, seasonStart, workStats, type PeriodKind, type Row } from '../model/stats'
import { ROLES, todayIso, type BoatKind, type WeekType } from '../model/types'
import { nameWithCounter } from '../model/counters'
import { useCounters } from '../components/useCounters'
import type { Store } from '../storage/store'

// Meer → Statistieken: zeilen, RYA Yachtmaster Offshore, werk, geld (pas na "Toon bedragen") en instructeur, over dit
// jaar, dit seizoen, alles of een eigen periode. Alles afgeleid uit het logboek (src/model/stats.ts), grafieken in eigen
// SVG. Een onderdeel zonder gegevens in de periode staat er niet.

const PERIODS: { kind: PeriodKind; label: 'stats.year' | 'stats.season' | 'stats.all' | 'stats.custom' }[] = [
  { kind: 'jaar', label: 'stats.year' },
  { kind: 'seizoen', label: 'stats.season' },
  { kind: 'alles', label: 'stats.all' },
  { kind: 'eigen', label: 'stats.custom' },
]

/** Hoogstens zoveel regels per lijst, zodat het scherm kort blijft. */
const TOP = 8

function kindLabel(key: string): string {
  return key === 'onbekend' ? t('stats.unknownKind') : t(`boatKind.${key as BoatKind}`)
}

export function Stats({ store }: { store: Store }) {
  const lang = useLang()
  useSyncExternalStore(subscribeRates, getRates)
  const today = todayIso()
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const places = useCollection(store, 'places.json.enc')
  const calendar = useCollection(store, 'calendar.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const students = useCollection(store, 'students.json.enc')
  const storedCurricula = useCollection(store, 'curricula.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const counters = useCounters(store)
  const [kind, setKind] = useState<PeriodKind>('jaar')
  const [custom, setCustom] = useState({ from: `${today.slice(0, 4)}-01-01`, to: today })
  const [showAmounts, setShowAmounts] = useState(false)
  const period = periodFor(kind, today, { trips, legs, calendar }, custom)
  const index = useMemo(() => buildIndex(calendar, trips, legs), [calendar, trips, legs])

  const sailing = period ? sailingStats(trips, legs, settings, period) : null
  const rya = ryaYachtmasterOffshore(legs)
  const work = useMemo(() => (period ? workStats(index, period, today) : null), [index, period?.from, period?.to, today])
  const money = period && showAmounts ? moneyStats(trips, legs, transactions, index, period, today) : null
  const instructor = period ? instructorStats(students, effectiveCurricula(storedCurricula), trips, legs, period, lang) : null
  const season = kind === 'seizoen' ? seasonStart(trips, legs, today) : null
  const hasWork = !!work && work.werk + work.rust + work.reis + work.thuis > 0
  const hasMoney = transactions.some((tx) => tx.deletedAt === null && !!period && period.from <= tx.date && tx.date <= period.to)
  const nothing = !sailing?.days && !hasWork && !hasMoney && !instructor?.students

  return (
    <section className="stack-lg stats">
      <header className="page-header">
        <h1>{t('nav.stats')}</h1>
      </header>
      <div className="stack">
        <div className="segments small" role="radiogroup" aria-label={t('stats.period')}>
          {PERIODS.map((p) => (
            <button key={p.kind} type="button" role="radio" aria-checked={kind === p.kind} className={`segment${kind === p.kind ? ' active' : ''}`} onClick={() => setKind(p.kind)}>
              {t(p.label)}
            </button>
          ))}
        </div>
        {kind === 'eigen' && (
          <div className="two">
            <label>
              {t('stats.from')}
              <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </label>
            <label>
              {t('stats.to')}
              <input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </label>
          </div>
        )}
        {period ? (
          <p className="muted small">{season ? t('stats.seasonSince', { date: formatDate(season) }) : formatDateRange(period.from, period.to)}</p>
        ) : (
          <p className="error small">{t('stats.invalidPeriod')}</p>
        )}
      </div>

      {period && nothing && <Empty icon={BarChart3}>{t('stats.empty')}</Empty>}

      {sailing && sailing.days > 0 && (
        <div className="section card card-body stack">
          <h2>{t('stats.sailing')}</h2>
          <dl className="grid grid-3">
            <Stat label={t('stat.total')} value={formatNm(sailing.nm)} />
            <Stat label={t('stats.daysOnWater')} value={formatNumber(sailing.days)} />
            <Stat label={t('stat.trips')} value={formatNumber(sailing.trips)} />
            <Stat label={t('stat.nightHours')} value={formatHours(sailing.nightHours)} />
          </dl>
          {sailing.perMonth.length > 1 && (
            <>
              <h3>{t(sailing.byYear ? 'stats.nmPerYear' : 'chart.nmPerMonth')}</h3>
              <BarChart
                label={`${t(sailing.byYear ? 'stats.nmPerYear' : 'chart.nmPerMonth')}: ${sailing.perMonth.map((b) => `${sailing.byYear ? b.key : formatMonth(b.key)} ${formatNm(b.value)}`).join(', ')}`}
                groups={sailing.perMonth.map((b) => ({ key: b.key, label: sailing.byYear ? `’${b.key.slice(2)}` : formatMonthShort(b.key), values: [b.value] }))}
                format={(n) => formatNm(Math.round(n))}
                labelEvery={Math.max(1, Math.ceil(sailing.perMonth.length / 8))}
              />
            </>
          )}
          <Breakdown title={t('stats.byRole')} rows={ROLES.filter((r) => sailing.byRole[r] > 0).map((r) => ({ key: r, label: roleLabel(r), value: sailing.byRole[r] }))} format={formatNm} />
          <Breakdown
            title={t('stats.byWater')}
            rows={[
              { key: 'inland', label: t('water.inland'), value: sailing.byWater.inland },
              { key: 'sea', label: t('water.sea'), value: sailing.byWater.sea },
              { key: 'tidal', label: t('water.tidal'), value: sailing.byWater.tidal },
            ].filter((r) => r.value > 0)}
            format={formatNm}
          />
          <Breakdown title={t('stats.byBoat')} rows={sailing.byBoat} format={formatNm} />
          <Breakdown title={t('stats.byKind')} rows={sailing.byKind.map((r) => ({ ...r, label: kindLabel(r.key) }))} format={formatNm} />
          <Breakdown title={t('stats.byArea')} rows={sailing.byArea.map((r) => ({ ...r, label: r.label || t('stats.noArea') }))} format={formatNm} />
          {sailing.longest && (
            <div className="stack-sm">
              <h3>{t('stats.longest')}</h3>
              <p className="small">
                {[formatNm(totalNm(sailing.longest)), [sailing.longest.fromPlace, sailing.longest.toPlace].filter(Boolean).join(' → '), formatDate(sailing.longest.date)].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}
          <Breakdown title={t('stats.topPlaces')} rows={sailing.topPlaces} format={(n) => t('stats.arrivals', { n })} />
          {period && <SailedMap legs={legs} places={places} from={period.from} to={period.to} />}
          {sailing.perOrganisation.some((o) => o.org !== '') && (
            <Breakdown
              title={t('stats.perOrganisation')}
              rows={sailing.perOrganisation.map((o) => ({ key: o.org || 'geen', label: `${o.org ? organisationLabel(o.org) : t('stats.noOrganisation')}${o.last ? ` · ${t('stats.upTo', { label: o.last })}` : ''}`, value: o.trips }))}
              format={(n) => t('money.trips', { n })}
            />
          )}
        </div>
      )}

      {rya.some((item) => item.value > 0) && (
        <div className="section card card-body stack">
          <h2>{t('stats.rya')}</h2>
          <ul className="rya-list">
            {rya.map((item) => (
              <li key={item.id} className={item.done ? 'done' : ''}>
                <Icon icon={item.done ? Check : Circle} />
                <span className="rya-text">
                  <span>{t(`rya.${item.id}`, { value: item.id === 'mijlen' ? formatNm(item.value) : formatNumber(item.value), target: item.id === 'mijlen' ? formatNm(item.target) : formatNumber(item.target) })}</span>
                  <svg className="hbar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
                    <rect className="hbar-track" x={0} y={0} width={100} height={4} rx={2} />
                    <rect className="hbar-fill" x={0} y={0} width={Math.min(100, (item.value / item.target) * 100)} height={4} rx={2} />
                  </svg>
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">{t('stats.ryaHint')}</p>
        </div>
      )}

      {work && hasWork && (
        <div className="section card card-body stack">
          <h2>{t('stats.work')}</h2>
          <dl className="grid grid-3">
            <Stat label={t('dayType.werk')} value={formatNumber(work.werk)} />
            <Stat label={t('dayType.rust')} value={formatNumber(work.rust)} />
            <Stat label={t('dayType.reis')} value={formatNumber(work.reis)} />
            <Stat label={t('dayType.thuis')} value={formatNumber(work.thuis)} />
            <Stat label={t('stats.workShare')} value={percent(work.share)} />
          </dl>
          {work.months.length > 1 && work.months.length <= 24 && (
            <>
              <h3>{t('stats.workPerMonth')}</h3>
              <BarChart
                label={`${t('stats.workPerMonth')}: ${work.months.map((m) => `${formatMonth(m.month)} ${m.werk}`).join(', ')}`}
                groups={work.months.map((m) => ({ key: m.month, label: formatMonthShort(m.month), values: [m.werk] }))}
                format={(n) => formatNumber(Math.round(n))}
                labelEvery={Math.max(1, Math.ceil(work.months.length / 8))}
              />
            </>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>{t('money.month')}</th>
                <th className="num">{t('dayType.werk')}</th>
                <th className="num">{t('dayType.rust')}</th>
                <th className="num">{t('dayType.reis')}</th>
                <th className="num">{t('dayType.thuis')}</th>
              </tr>
            </thead>
            <tbody>
              {[...work.months].reverse().filter((m) => m.werk + m.rust + m.reis + m.thuis > 0).map((m) => (
                <tr key={m.month}>
                  <td>
                    {formatMonthShort(m.month)} {m.month.slice(0, 4)}
                  </td>
                  <td className="num">{m.werk}</td>
                  <td className="num">{m.rust}</td>
                  <td className="num">{m.reis}</td>
                  <td className="num">{m.thuis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {period && hasMoney && (
        <div className="section card card-body stack">
          <div className="section-head">
            <h2>{t('stats.money')}</h2>
            <button className="btn link small" aria-pressed={showAmounts} onClick={() => setShowAmounts(!showAmounts)}>
              <Icon icon={showAmounts ? EyeOff : Eye} />
              {t(showAmounts ? 'week.hideAmounts' : 'week.showAmounts')}
            </button>
          </div>
          {money && (
            <>
              <dl className="grid grid-3">
                <Stat label={t('stats.earned')} value={formatMoney(money.earned, 'EUR')} />
                <Stat label={t('money.workdays')} value={formatNumber(money.workdays)} />
                <Stat label={t('money.perWorkday')} value={money.perWorkday === null ? '–' : formatMoney(money.perWorkday, 'EUR')} />
              </dl>
              {money.best && money.worst && (
                <dl className="stack-sm best-worst">
                  <TripLine label={t('stats.best')} trip={nameWithCounter(money.best.trip, counters.get(money.best.trip.id))} eur={money.best.eur} perDay={money.best.perDay} />
                  <TripLine label={t('stats.worst')} trip={nameWithCounter(money.worst.trip, counters.get(money.worst.trip.id))} eur={money.worst.eur} perDay={money.worst.perDay} />
                  <p className="muted small">{t('stats.bestHint')}</p>
                </dl>
              )}
              <Breakdown title={t('stats.perTrip')} rows={money.perTrip.map((m) => ({ key: m.trip.id, label: nameWithCounter(m.trip, counters.get(m.trip.id)), value: m.eur }))} format={(n) => formatMoney(n, 'EUR')} />
              <Breakdown
                title={t('stats.perOrgMoney')}
                rows={[
                  ...money.perOrganisation.map((o) => ({ key: o.org || 'geen', label: o.org ? organisationLabel(o.org) : t('stats.noOrganisation'), value: o.eur })),
                  ...(money.withoutTrip > 0 ? [{ key: 'zonder-trip', label: t('stats.withoutTrip'), value: money.withoutTrip }] : []),
                ]}
                format={(n) => formatMoney(n, 'EUR')}
              />
              {money.tipsPerWeek.some((w) => w.eur > 0) && (
                <>
                  <h3>{t('chart.tipsPerWeek')}</h3>
                  <BarChart
                    label={`${t('chart.tipsPerWeek')}: ${money.tipsPerWeek.map((w) => `${formatDateShort(w.weekStart)} ${formatMoney(w.eur, 'EUR')}`).join(', ')}`}
                    groups={money.tipsPerWeek.map((w) => ({ key: w.weekStart, label: formatDateShort(w.weekStart), values: [w.eur] }))}
                    format={(n) => formatMoneyShort(n)}
                    labelEvery={Math.max(1, Math.ceil(money.tipsPerWeek.length / 4))}
                  />
                </>
              )}
              <Breakdown title={t('money.tipsByGuest')} rows={money.perGuest.map((g) => ({ key: g.key, label: g.label, value: g.eur }))} format={(n) => formatMoney(n, 'EUR')} />
              <Breakdown title={t('money.tipsByCountry')} rows={money.perCountry.map((g) => ({ key: g.key || 'geen', label: g.label || t('money.noCountry'), value: g.eur }))} format={(n) => formatMoney(n, 'EUR')} />
              <Breakdown
                title={`${t('money.tipsByType')} · ${t('money.perGuest').toLowerCase()}`}
                rows={money.perTripType.map((g) => ({ key: g.key, label: weekTypeLabel(g.key as WeekType), value: g.perGuest ?? 0 }))}
                format={(n) => formatMoney(n, 'EUR')}
              />
            </>
          )}
        </div>
      )}

      {instructor && instructor.students > 0 && (
        <div className="section card card-body stack">
          <h2>{t('stats.instructor')}</h2>
          <dl className="grid grid-3">
            <Stat label={t('stats.students')} value={formatNumber(instructor.students)} />
            <Stat label={t('stats.exams')} value={formatNumber(instructor.perCourse.reduce((n, c) => n + c.exams, 0))} />
            <Stat label={t('stats.passRate')} value={passRate(instructor.perCourse.reduce((n, c) => n + c.passed, 0), instructor.perCourse.reduce((n, c) => n + c.exams, 0))} />
          </dl>
          <table className="table">
            <thead>
              <tr>
                <th>{t('stats.course')}</th>
                <th className="num">{t('stats.students')}</th>
                <th className="num">{t('stats.passRate')}</th>
              </tr>
            </thead>
            <tbody>
              {instructor.perCourse.map((c) => (
                <tr key={c.curriculumId}>
                  <td className="keep-case">{c.label || '–'}</td>
                  <td className="num">{c.students}</td>
                  <td className="num">{c.exams > 0 ? `${passRate(c.passed, c.exams)} (${c.passed}/${c.exams})` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Breakdown title={t('stats.topTopics')} rows={instructor.topTopics} format={(n) => t('stats.topicCount', { n })} />
        </div>
      )}
    </section>
  )
}

/** Aandeel als percentage; onder 1% maar niet nul: "< 1%". */
function percent(share: number | null): string {
  if (share === null) return '–'
  if (share > 0 && share < 0.01) return '< 1%'
  return `${formatNumber(Math.round(share * 100))}%`
}

function passRate(passed: number, exams: number): string {
  return exams > 0 ? `${formatNumber(Math.round((passed / exams) * 100))}%` : '–'
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function TripLine({ label, trip, eur, perDay }: { label: string; trip: string; eur: number; perDay: number | null }) {
  return (
    <div className="trip-line">
      <dt className="muted small">{label}</dt>
      <dd>
        <span>{trip}</span>
        <span className="muted small">{[formatMoney(eur, 'EUR'), perDay === null ? '' : t('stats.perDay', { amount: formatMoney(perDay, 'EUR') })].filter(Boolean).join(' · ')}</span>
      </dd>
    </div>
  )
}

/** Een kop met een lijst staven; niets zonder regels, hoogstens TOP regels. */
function Breakdown({ title, rows, format }: { title: string; rows: Row[]; format: (n: number) => string }) {
  const shown = rows.filter((r) => r.value > 0).slice(0, TOP)
  if (shown.length === 0) return null
  return (
    <div className="stack-sm">
      <h3>{title}</h3>
      <HBars label={title} rows={shown} format={format} />
    </div>
  )
}
