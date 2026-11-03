import { SailedMap } from '../components/SailedMap'
import { BarChart3, Eye, EyeOff } from 'lucide-react'
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
import { careerInvestment } from '../model/expenses'
import { eurOf } from '../model/money'
import { instructorStats, moneyStats, periodFor, sailingStats, seasonStart, workStats, type PeriodKind, type Row } from '../model/stats'
import { ROLES, type BoatKind, type WeekType } from '../model/types'
import { nameWithCounter } from '../model/counters'
import { useCounters } from '../components/useCounters'
import type { Store } from '../storage/store'
import { todayIso } from '../basis/datum'

// Meer → Statistieken: de kerngetallen groot bovenaan, dan zeilen (nm per maand, de langste dagtocht en één verdeling
// tegelijk), de kaart, werk, geld (pas na "Toon bedragen") en instructeur, over dit jaar, dit seizoen, alles of een eigen
// periode. Alles afgeleid uit het logboek (src/model/stats.ts), grafieken in eigen SVG. Een onderdeel zonder gegevens in
// de periode staat er niet.

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
  const stays = useCollection(store, 'periods.json.enc')
  const index = useMemo(() => buildIndex(calendar, trips, legs, [], stays), [calendar, trips, legs, stays])

  const sailing = period ? sailingStats(trips, legs, settings, period) : null
  const work = useMemo(() => (period ? workStats(index, period, today) : null), [index, period?.from, period?.to, today])
  const money = period && showAmounts ? moneyStats(trips, legs, transactions, index, period, today) : null
  // Investering in de zeilcarrière in de periode: opleiding, uitrusting en de kosten van werk- en trainingstrips.
  const investment = careerInvestment(transactions, eurOf, period?.from, period?.to, trips, legs)
  const instructor = period ? instructorStats(students, effectiveCurricula(storedCurricula), trips, legs, period, lang) : null
  const season = kind === 'seizoen' ? seasonStart(trips, legs, today) : null
  const hasWork = !!work && work.werk + work.rust + work.reis + work.thuis + work.onbeschikbaar > 0
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
        <>
          {/* De kerngetallen groot bovenaan; de rest daaronder per onderwerp, één verdeling tegelijk. */}
          <dl className="stats-hero">
            <HeroStat label={t('stat.total')} value={formatNm(sailing.nm)} />
            <HeroStat label={t('stats.daysOnWater')} value={formatNumber(sailing.days)} />
            <HeroStat label={t('stat.trips')} value={formatNumber(sailing.trips)} />
            <HeroStat label={t('stat.nightHours')} value={formatHours(sailing.nightHours)} />
          </dl>
          <div className="section card card-body stack">
            <h2>{t('stats.sailing')}</h2>
            {sailing.perMonth.length > 1 && (
              <BarChart
                label={`${t(sailing.byYear ? 'stats.nmPerYear' : 'chart.nmPerMonth')}: ${sailing.perMonth.map((b) => `${sailing.byYear ? b.key : formatMonth(b.key)} ${formatNm(b.value)}`).join(', ')}`}
                groups={sailing.perMonth.map((b) => ({ key: b.key, label: sailing.byYear ? `’${b.key.slice(2)}` : formatMonthShort(b.key), values: [b.value] }))}
                format={(n) => formatNm(Math.round(n))}
                labelEvery={Math.max(1, Math.ceil(sailing.perMonth.length / 8))}
              />
            )}
            {sailing.longest && (
              <p className="stats-highlight">
                <span className="stats-highlight-label">{t('stats.longest')}</span>
                <strong>{formatNm(totalNm(sailing.longest))}</strong>
                <span>{[[sailing.longest.fromPlace, sailing.longest.toPlace].filter(Boolean).join(' → '), formatDate(sailing.longest.date)].filter(Boolean).join(' · ')}</span>
              </p>
            )}
            <Split
              label={t('stats.split')}
              options={[
                { key: 'rol', label: t('stats.splitRole'), rows: ROLES.filter((r) => sailing.byRole[r] > 0).map((r) => ({ key: r, label: roleLabel(r), value: sailing.byRole[r] })), format: formatNm },
                {
                  key: 'water',
                  label: t('stats.splitWater'),
                  rows: [
                    { key: 'inland', label: t('water.inland'), value: sailing.byWater.inland },
                    { key: 'sea', label: t('water.sea'), value: sailing.byWater.sea },
                    { key: 'tidal', label: t('water.tidal'), value: sailing.byWater.tidal },
                  ],
                  format: formatNm,
                },
                { key: 'boot', label: t('stats.splitBoat'), rows: sailing.byBoat, format: formatNm },
                { key: 'boottype', label: t('stats.splitKind'), rows: sailing.byKind.map((r) => ({ ...r, label: kindLabel(r.key) })), format: formatNm },
                { key: 'gebied', label: t('stats.splitArea'), rows: sailing.byArea.map((r) => ({ ...r, label: r.label || t('stats.noArea') })), format: formatNm },
                { key: 'plaatsen', label: t('stats.splitPlaces'), rows: sailing.topPlaces, format: (n) => t('stats.arrivals', { n }) },
                {
                  key: 'organisatie',
                  label: t('stats.splitOrg'),
                  rows: sailing.perOrganisation.some((o) => o.org !== '') ? sailing.perOrganisation.map((o) => ({ key: o.org || 'geen', label: `${o.org ? organisationLabel(o.org) : t('stats.noOrganisation')}${o.last ? ` · ${t('stats.upTo', { label: o.last })}` : ''}`, value: o.trips })) : [],
                  format: (n) => t('money.trips', { n }),
                },
              ]}
            />
          </div>
          {period && (
            <div className="section card card-body stack">
              <SailedMap legs={legs} places={places} from={period.from} to={period.to} />
            </div>
          )}
        </>
      )}

      {work && hasWork && (
        <div className="section card card-body stack">
          <h2>{t('stats.work')}</h2>
          {/* Altijd zes vakjes, zoals onder de agenda: het raster verspringt niet. */}
          <dl className="grid grid-3">
            <Stat label={t('dayType.werk')} value={formatNumber(work.werk)} />
            <Stat label={t('dayType.rust')} value={formatNumber(work.rust)} />
            <Stat label={t('dayType.reis')} value={formatNumber(work.reis)} />
            <Stat label={t('dayType.thuis')} value={formatNumber(work.thuis)} />
            <Stat label={t('dayType.onbeschikbaar')} value={formatNumber(work.onbeschikbaar)} />
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
                {investment.count > 0 && <Stat label={t('money.investment')} value={[formatMoney(investment.eur, 'EUR'), ...Object.entries(investment.other).map(([c, v]) => formatMoney(v, c))].join(' + ')} />}
              </dl>
              {money.best && money.worst && (
                <dl className="stack-sm best-worst">
                  <TripLine label={t('stats.best')} trip={nameWithCounter(money.best.trip, counters.get(money.best.trip.id))} eur={money.best.eur} perDay={money.best.perDay} />
                  <TripLine label={t('stats.worst')} trip={nameWithCounter(money.worst.trip, counters.get(money.worst.trip.id))} eur={money.worst.eur} perDay={money.worst.perDay} />
                </dl>
              )}
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
              <Split
                label={t('stats.split')}
                options={[
                  { key: 'trip', label: t('stats.splitTrip'), rows: money.perTrip.map((m) => ({ key: m.trip.id, label: nameWithCounter(m.trip, counters.get(m.trip.id)), value: m.eur })), format: (n) => formatMoney(n, 'EUR') },
                  { key: 'organisatie', label: t('stats.splitOrg'), rows: money.perOrganisation.map((o) => ({ key: o.org || 'geen', label: o.org ? organisationLabel(o.org) : t('stats.noOrganisation'), value: o.eur })), format: (n) => formatMoney(n, 'EUR') },
                  { key: 'gast', label: t('stats.splitGuest'), rows: money.perGuest.map((g) => ({ key: g.key, label: g.label, value: g.eur })), format: (n) => formatMoney(n, 'EUR') },
                  { key: 'land', label: t('stats.splitCountry'), rows: money.perCountry.map((g) => ({ key: g.key || 'geen', label: g.label || t('money.noCountry'), value: g.eur })), format: (n) => formatMoney(n, 'EUR') },
                  { key: 'soort', label: t('stats.splitTripType'), rows: money.perTripType.map((g) => ({ key: g.key, label: weekTypeLabel(g.key as WeekType), value: g.perGuest ?? 0 })), format: (n) => formatMoney(n, 'EUR') },
                ]}
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

/** Een kerngetal groot bovenaan. */
function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-hero-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

interface SplitOption {
  key: string
  label: string
  rows: Row[]
  format: (n: number) => string
}

/** Eén verdeling tegelijk (per rol, per boot, …) met knoppen erboven: minder lijsten onder elkaar. Opties zonder regels vallen weg. */
function Split({ label, options }: { label: string; options: SplitOption[] }) {
  const usable = options.map((o) => ({ ...o, rows: o.rows.filter((r) => r.value > 0).slice(0, TOP) })).filter((o) => o.rows.length > 0)
  const [chosen, setChosen] = useState<string | null>(null)
  if (usable.length === 0) return null
  const current = usable.find((o) => o.key === chosen) ?? usable[0]!
  return (
    <div className="stack-sm stats-split">
      {usable.length > 1 && (
        <div className="type-buttons" role="radiogroup" aria-label={label}>
          {usable.map((o) => (
            <button key={o.key} type="button" role="radio" aria-checked={o.key === current.key} className={`chip${o.key === current.key ? ' active' : ''}`} onClick={() => setChosen(o.key)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      <HBars label={current.label} rows={current.rows} format={current.format} />
    </div>
  )
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
