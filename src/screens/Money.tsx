import { CalendarRange, ChevronRight, Coins, Receipt, Wallet } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import { BarChart } from '../components/BarChart'
import type { Notify } from '../components/EditSheets'
import { TransactionView } from '../components/Views'
import { SalaryOutlook } from '../components/SalaryOutlook'
import { MoneyPathSection } from '../components/MoneyPath'
import { PositionAndForecast, useMoneyPeriod } from '../components/Position'
import { PeriodPicker } from '../components/money-period'
import { DrillSheet, type DrillRequest } from '../components/DrillSheet'
import { ForecastModeSwitch, useForecastMode } from '../components/Scenario'
import { ScenarioPlanner } from '../components/ScenarioPlanner'
import { ExpectedTips } from '../components/ExpectedTips'
import { costsDrill, incomeDrill, investmentDrill, organisationDrill, reimbursedDrill, resultDrill } from '../domain/doorklik'
import { CostsSection } from '../components/Costs'
import { ActualCostsSection } from '../components/ActualCosts'
import { ClaimsSection } from '../components/Claims'
import { TaxYearSection } from '../components/TaxYear'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { formatDate, formatDateShort, formatMoney, formatMoneyShort, formatMonth, formatMonthShort } from '../format'
import { buildIndex } from '../model/calendar'
import { perOrganisation, perWorkday, tipReports, toCheck, transactionList } from '../domain/geldrapport'
import { aantalGastenZetten } from '../domain/trips'
import { TripOverviewSheet } from '../components/TripOverview'
import { Sheet } from '../components/Sheet'
import { weekTypeLabel } from '../components/WeekSheet'
import { booked } from '../domain/geldmodel'
import { MoneyConversionScreen, useNeedsConversion } from '../components/MoneyConversion'
import { EarlierSeasonSheet } from '../components/EarlierSeason'
import { useIsDemo } from '../components/DemoBar'
import { eurOf, isIncome, monthSeries, perMonth, tipsPerWeek, totals, type MoneyTotals } from '../model/money'
import { careerInvestment } from '../model/expenses'
import { stayName } from '../model/periods'
import { kindLabel, organisationLabel, sourceLabel } from '../i18n/labels'
import { eurValue, getRates, subscribeRates } from '../model/rates'
import { type Leg, type Transaction, type Trip } from '../model/types'
import type { Store } from '../storage/store'
import { t } from '../i18n'
import { monthEnd, todayIso } from '../basis/datum'

// Geld: alles in euro (ECB-koers van de transactiedatum, of het ontvangen eurobedrag), het originele bedrag klein
// eronder. Twee weergaven: Werkelijk (Mijn positie, kosten per maand, zeilgeld, uitbetalingen, declaraties, per werkdag,
// per organisatie, fooi, lijst per maand met bewerken) en Verwacht (vooruitblik netto waarde, verwacht salaris, vaste
// lasten en het gemiddelde per dagsoort).

type MoneyView = 'werkelijk' | 'verwacht'
/** Gekozen weergave in Geld, per apparaat (niet gesynct). */
const VIEW_KEY = 'logboek-geld-weergave'

function readView(): MoneyView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'verwacht' ? 'verwacht' : 'werkelijk'
  } catch {
    return 'werkelijk'
  }
}

export function Money({ store, notify, onAdd }: { store: Store; notify: Notify; onAdd: () => void }) {
  // Zolang het geld nog niet omgezet is (src/domain/geld-omzetten.ts), kloppen de bedragen niet: eerst omzetten.
  const needs = useNeedsConversion(store)
  const demo = useIsDemo()
  // "Later" toont Geld toch (voor deze keer), zodat Geld nooit vastzit als omzetten niet lukt.
  const [later, setLater] = useState(false)
  return needs && !demo && !later ? <MoneyConversionScreen store={store} notify={notify} onLater={() => setLater(true)} /> : <MoneyContent store={store} notify={notify} onAdd={onAdd} />
}

function MoneyContent({ store, notify, onAdd }: { store: Store; notify: Notify; onAdd: () => void }) {
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [season, setSeason] = useState(false)
  // Opnieuw tekenen zodra de koersen geladen zijn.
  useSyncExternalStore(subscribeRates, getRates)
  const transactions = useCollection(store, 'transactions.json.enc')
  // De periode bovenaan Geld geldt voor alle bedragen: de totalen, kosten per maand, per organisatie en de transacties.
  const { period, hasData, preset, careerSet } = useMoneyPeriod(store)
  const mode = useForecastMode()
  const [drill, setDrill] = useState<DrillRequest | null>(null)
  const periodText = t('drill.period', { from: formatDate(period.from), to: formatDate(period.to) })
  // Alleen echt geld (geen verwacht salaris): dezelfde transacties als per organisatie, per werkdag en het jaaroverzicht
  // (src/domain/geldrapport.ts).
  const everything = transactionList(transactions)
  const live = transactionList(transactions, period)
  const today = todayIso()
  const all = totals(live)
  const months = perMonth(live)

  const weeks = tipsPerWeek(everything, today)
  const series = monthSeries(everything, today)
  const weekOther = mergeOther(weeks.map((w) => w.other))
  // Per werkdag: verdiend per maand gedeeld door de werkdagen in de agenda.
  const calendar = useCollection(store, 'calendar.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const stays = useCollection(store, 'periods.json.enc')
  const index = useMemo(() => buildIndex(calendar, trips, legs, [], stays), [calendar, trips, legs, stays])
  // Per organisatie (de organisatie van de periode, docs/PERIODEMODEL.md) en de naam van de periode bij elke regel.
  const tripMap = useMemo(() => new Map(trips.filter((x) => x.deletedAt === null).map((x) => [x.id, x])), [trips])
  const stayMap = useMemo(() => new Map(stays.filter((x) => x.deletedAt === null).map((x) => [x.id, x])), [stays])
  const groups = useMemo(() => perOrganisation(transactions, trips, period), [transactions, trips, period])
  const periodName = (tx: Transaction) => {
    if (!tx.tripId && tx.season) return t('tripPicker.seasonLabel', { org: organisationLabel(tx.season.org), year: tx.season.year })
    const trip = tx.tripId ? tripMap.get(tx.tripId) : undefined
    if (trip) return trip.name
    const stay = tx.tripId ? stayMap.get(tx.tripId) : undefined
    return stay ? stayName(stay) : ''
  }
  const investment = careerInvestment(live, eurOf, undefined, undefined, trips, legs)
  const workdays = perWorkday(index, transactions, today).filter((m) => m.workdays > 0 || m.eur > 0)
  const checks = useMemo(() => toCheck(transactions, trips), [transactions, trips])
  const [checkTrip, setCheckTrip] = useState<Trip | null>(null)
  const [tipView, setTipView] = useState<TipView>('gast')
  const [view, setView] = useState<MoneyView>(readView)
  const chooseView = (next: MoneyView) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Geen opslag: dan alleen voor nu.
    }
  }

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('nav.money')}</h1>
        <button type="button" className="btn small" onClick={() => setSeason(true)}>
          <Icon icon={CalendarRange} />
          {t('earlier.button')}
        </button>
      </header>
      {/* Te controleren: alleen als er iets is; signaleert, past niets aan. Tik = naar die tocht. */}
      {checks.length > 0 && (
        <div className="notice to-check stack-sm" role="status">
          <h2 className="small-heading">{t('check.title')}</h2>
          <ul className="plain-list">
            {checks.map((c) => (
              <li key={`${c.kind}:${c.trip.id}`}>
                <button type="button" className="btn link" onClick={() => setCheckTrip(c.trip)}>
                  {c.kind === 'meerdere' ? t('check.multiple', { trip: c.trip.name, n: c.count }) : t('check.noAmount', { trip: c.trip.name })}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Twee weergaven: Werkelijk (wat er gebeurd is) en Verwacht (de toekomst), per apparaat onthouden. */}
      <div className="segments money-view" role="tablist" aria-label={t('money.view')}>
        {(['werkelijk', 'verwacht'] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={`segment${view === v ? ' active' : ''}`} onClick={() => chooseView(v)}>
            {t(v === 'werkelijk' ? 'money.actual' : 'money.expected')}
          </button>
        ))}
      </div>
      {/* Bovenaan Verwacht: Gepland of Scenario. */}
      {view === 'verwacht' && <ForecastModeSwitch />}
      {hasData && !(view === 'verwacht' && mode === 'scenario') && <PeriodPicker period={period} preset={preset} careerSet={careerSet} />}
      {/* Scenario: het eigen stappenplan met zijn rapport, los van de planning (die is daar alleen een voorstel). */}
      {view === 'verwacht' && mode === 'scenario' && <ScenarioPlanner store={store} notify={notify} today={today} />}
      {view === 'verwacht' && mode === 'gepland' && (
        <>
          <PositionAndForecast store={store} notify={notify} part="verwacht" period={period} />
          <ExpectedTips store={store} notify={notify} />
          <SalaryOutlook store={store} />
          <CostsSection store={store} notify={notify} />
        </>
      )}
      {view === 'werkelijk' && everything.length === 0 && (
        <Empty
          icon={Wallet}
          action={
            <button className="btn primary" onClick={onAdd}>
              {t('money.addTip')}
            </button>
          }
        >
          {t('money.empty')}
        </Empty>
      )}
      {view === 'werkelijk' && <PositionAndForecast store={store} notify={notify} part="werkelijk" period={period} />}
      {view === 'werkelijk' && <ActualCostsSection store={store} period={period} onDrill={setDrill} />}
      {view === 'werkelijk' && <ClaimsSection store={store} notify={notify} />}
      {view === 'werkelijk' && everything.length === 0 && <MoneyPathSection store={store} notify={notify} />}
      {view === 'werkelijk' && everything.length > 0 && (
        <>
          {/* Elk bedrag opent de posten eronder in de periode bovenaan (src/domain/doorklik.ts). */}
          <dl className="grid">
            <Stat
              label={t('money.result')}
              value={formatMoney(all.balanceEur, 'EUR')}
              tone={all.balanceEur >= 0 ? 'positive' : 'negative'}
              hero
              onOpen={() => setDrill({ title: t('money.result'), drill: resultDrill(transactions, trips, period), period: periodText, hint: t('money.resultHint') })}
            />
            <Stat label={t('money.income')} value={formatMoney(all.incomeEur, 'EUR')} onOpen={() => setDrill({ title: t('money.income'), drill: incomeDrill(transactions, trips, period), period: periodText, hint: t('drill.incomeHint'), byYear: true })} />
            <Stat label={t('money.costs')} value={formatMoney(all.costsEur, 'EUR')} onOpen={() => setDrill({ title: t('money.costs'), drill: costsDrill(transactions, trips, period), period: periodText, hint: t('drill.costsHint') })} />
            {all.reimbursedEur > 0 && <Stat label={t('money.reimbursed')} value={formatMoney(all.reimbursedEur, 'EUR')} onOpen={() => setDrill({ title: t('money.reimbursed'), drill: reimbursedDrill(transactions, trips, period), period: periodText, hint: t('drill.reimbursedHint') })} />}
            {investment.count > 0 && (
              <Stat
                label={t('money.investment')}
                value={[formatMoney(investment.eur, 'EUR'), ...Object.entries(investment.other).map(([c, v]) => formatMoney(v, c))].join(' + ')}
                onOpen={() => setDrill({ title: t('money.investment'), drill: investmentDrill(transactions, trips, period, legs), period: periodText, hint: t('drill.investmentHint') })}
              />
            )}
            <OtherStat other={all.other} />
          </dl>

          <MoneyPathSection store={store} notify={notify} />

          <TaxYearSection store={store} onDrill={setDrill} />

          <div className="section card card-body">
            <div className="section-head">
              <h2>{t('chart.tipsPerWeek')}</h2>
              <span className="muted">{t('chart.weeks12')}</span>
            </div>
            <BarChart
              label={`${t('chart.tipsPerWeek')}: ${weeks.map((w) => `${formatDateShort(w.weekStart)} ${formatMoney(w.eur, 'EUR')}`).join(', ')}`}
              groups={weeks.map((w) => ({
                key: w.weekStart,
                label: formatDateShort(w.weekStart).replace('.', ''),
                values: [w.eur],
              }))}
              format={(n) => formatMoneyShort(n)}
              labelEvery={3}
            />
            {Object.keys(weekOther).length > 0 && (
              <p className="muted small">
                {t('money.notInChart')}{' '}
                {Object.entries(weekOther)
                  .map(([c, v]) => formatMoney(v, c))
                  .join(', ')}
              </p>
            )}
          </div>

          <div className="section card card-body">
            <div className="section-head">
              <h2>{t('money.perMonth')}</h2>
              <span className="muted">EUR</span>
            </div>
            <BarChart
              label={`${t('chart.incomeCosts')}: ${series.map((m) => `${formatMonth(m.month)} +${formatMoney(m.incomeEur, 'EUR')}, −${formatMoney(m.costsEur, 'EUR')}`).join('; ')}`}
              groups={series.map((m) => ({ key: m.month, label: formatMonthShort(m.month), values: [m.incomeEur, m.costsEur] }))}
              format={(n) => formatMoneyShort(n)}
              labelEvery={2}
            />
            <ul className="legend">
              <li>
                <span className="swatch" /> {t('money.income')}
              </li>
              <li>
                <span className="swatch s2" /> {t('money.costs')}
              </li>
            </ul>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('money.month')}</th>
                  <th className="num">{t('money.in')}</th>
                  <th className="num">{t('money.out')}</th>
                  <th className="num">{t('money.monthResult')}</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month}>
                    <td>
                      {formatMonthShort(m.month)} {m.month.slice(0, 4)}
                      <OtherLine other={m.other} />
                    </td>
                    {(
                      [
                        ['in', m.incomeEur, incomeDrill, t('money.income')],
                        ['out', m.costsEur, costsDrill, t('money.costs')],
                        ['result', m.balanceEur, resultDrill, t('money.result')],
                      ] as const
                    ).map(([key, eur, make, label]) => {
                      // De maand binnen de periode bovenaan (de tabel telt alleen wat in beide valt).
                      const within = { from: `${m.month}-01` > period.from ? `${m.month}-01` : period.from, to: monthEnd(m.month) < period.to ? monthEnd(m.month) : period.to }
                      const title = `${label} · ${formatMonth(m.month)}`
                      return (
                        <td key={key} className={`num${key === 'result' ? (eur >= 0 ? ' positive' : ' negative') : ''}`}>
                          <button type="button" className="tap-cell" aria-label={`${title}: ${formatMoney(eur, 'EUR')}`} onClick={() => setDrill({ title, drill: make(transactions, trips, within), period: t('drill.period', { from: formatDate(within.from), to: formatDate(within.to) }) })}>
                            {formatMoney(eur, 'EUR')}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {workdays.length > 0 && (
            <div className="section card card-body">
              <div className="section-head">
                <h2>{t('money.perWorkday')}</h2>
                <span className="muted">EUR</span>
              </div>
              <table className="table workday-table">
                <thead>
                  <tr>
                    <th>{t('money.month')}</th>
                    <th className="num">{t('money.workdays')}</th>
                    <th className="num">{t('money.income')}</th>
                    <th className="num">{t('money.perDay')}</th>
                  </tr>
                </thead>
                <tbody>
                  {workdays.map((m) => (
                    <tr key={m.month}>
                      <td>
                        {formatMonthShort(m.month)} {m.month.slice(0, 4)}
                      </td>
                      <td className="num">{m.workdays}</td>
                      <td className="num">{formatMoney(m.eur, 'EUR')}</td>
                      <td className="num">{m.perWorkday === null ? '–' : formatMoney(m.perWorkday, 'EUR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <TipOverview store={store} notify={notify} trips={trips} transactions={transactions} legs={legs} view={tipView} onView={setTipView} />

          <div className="section">
            <h2>{t('money.perOrganisation')}</h2>
            <ul className="rows">
              {groups.map((s) => {
                const name = s.group === 'delivery' ? sourceLabel('delivery') : organisationLabel(s.group)
                return (
                  <li key={s.group}>
                    <button type="button" className="row-item" onClick={() => setDrill({ title: `${t('money.perOrganisation')}: ${name}`, drill: organisationDrill(transactions, trips, s.group, period), period: periodText, hint: t('drill.organisationHint') })}>
                      <div className="row-main">
                        <span className="row-title">{name}</span>
                        <OtherLine other={s.other} />
                      </div>
                      <span className="row-value">
                        <span className="positive">+{formatMoney(s.incomeEur, 'EUR')}</span>
                        <br />
                        <span className="muted">−{formatMoney(s.costsEur, 'EUR')}</span>
                      </span>
                      <Icon icon={ChevronRight} className="chevron" />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="section">
            <h2>{t('money.transactions')}</h2>
            {months.map((m) => (
              <div key={m.month} className="group">
                <h3 className="group-head">
                  <span>{formatMonth(m.month)}</span>
                  <span className="num">{formatMoney(m.balanceEur, 'EUR')}</span>
                </h3>
                <ul className="rows">
                  {live
                    .filter((tx) => tx.date.startsWith(m.month))
                    .map((tx) => (
                      <li key={tx.id} className="tx">
                        <button
                          className="row-item"
                          aria-label={`${tx.note ?? kindLabel(tx.kind)}, ${formatDate(tx.date)}, ${amountLabel(tx)} · ${t('tx.open')}`}
                          onClick={() => setEditing(tx)}
                        >
                          <span className={`row-icon${isIncome(tx.kind) ? '' : ' cost'}`}>
                            <Icon icon={isIncome(tx.kind) ? Coins : Receipt} />
                          </span>
                          <div className="row-main">
                            <span className="row-title">{tx.note ?? kindLabel(tx.kind)}</span>
                            <span className="muted">
                              {formatDateShort(tx.date)}
                              {tx.note ? ` · ${kindLabel(tx.kind)}` : ''}
                              {periodName(tx) ? ` · ${periodName(tx)}` : ''}
                            </span>
                          </div>
                          <TxAmount tx={tx} />
                          <Icon icon={ChevronRight} className="chevron" />
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
      {editing && <TransactionView store={store} tx={editing} onClose={() => setEditing(null)} notify={notify} />}
      {drill && <DrillSheet store={store} notify={notify} request={drill} onClose={() => setDrill(null)} />}
      {season && <EarlierSeasonSheet store={store} notify={notify} onClose={() => setSeason(false)} />}
      {checkTrip && <TripOverviewSheet key={checkTrip.id} store={store} trip={checkTrip} notify={notify} onClose={() => setCheckTrip(null)} />}
    </section>
  )
}

type TipView = 'gast' | 'trip' | 'soort' | 'land'

const TIP_VIEWS: { view: TipView; label: Parameters<typeof t>[0] }[] = [
  { view: 'gast', label: 'money.tipsByGuest' },
  { view: 'trip', label: 'money.tipsByTrip' },
  { view: 'soort', label: 'money.tipsByType' },
  { view: 'land', label: 'money.tipsByCountry' },
]

/**
 * Fooi per gast, gemiddeld per gast per tocht, per soort tocht (per organisatie, zodat Yacht Week en Sailing Virgins
 * naast elkaar staan) en per land (alleen fooien bij een tocht). Elke tocht met fooien staat erin; zonder bekend aantal
 * gasten staat er "—" met een tik om het aantal in te vullen. Weergaven zonder regels zijn niet te kiezen.
 */
function TipOverview({ store, notify, trips, transactions, legs, view, onView }: { store: Store; notify: Notify; trips: readonly Trip[]; transactions: readonly Transaction[]; legs: readonly Leg[]; view: TipView; onView: (view: TipView) => void }) {
  const reports = useMemo(() => tipReports(trips, transactions, legs), [trips, transactions, legs])
  const [asking, setAsking] = useState<Trip | null>(null)
  const all: Record<TipView, { key: string; label: string; detail: string; eur: number; perGuest: number | null; trip?: Trip }[]> = {
    gast: reports.perGuest.map((g) => ({ key: g.key, label: g.label, detail: t('money.trips', { n: g.trips }), eur: g.eur, perGuest: null })),
    trip: reports.perTrip.map((x) => ({ key: x.trip.id, label: x.trip.name, detail: x.guests > 0 ? t('money.guestsCount', { n: x.guests }) : t('money.guestsUnknown'), eur: x.eur, perGuest: x.perGuest, trip: x.trip })),
    soort: reports.perType.map((g) => ({ key: g.key, label: g.org ? `${organisationLabel(g.org)} · ${weekTypeLabel(g.type)}` : weekTypeLabel(g.type), detail: t('money.trips', { n: g.trips }), eur: g.eur, perGuest: g.perGuest })),
    // Alleen gasten zonder land: geen overzicht per land.
    land: reports.perCountry.some((g) => g.key !== '') ? reports.perCountry.map((g) => ({ key: g.key, label: g.label || t('money.noCountry'), detail: t('money.guestsCount', { n: g.guests }), eur: g.eur, perGuest: g.perGuest })) : [],
  }
  const views = TIP_VIEWS.filter((v) => all[v.view].length > 0)
  if (views.length === 0) return null
  const shown = all[view].length > 0 ? view : views[0]!.view
  const rows = all[shown]
  const noRate = booked(transactions).some((tx) => tx.kind === 'fooi' && tx.tripId && eurOf(tx) === null)
  return (
    <div className="section card card-body tip-overview">
      <div className="section-head">
        <h2>{t('money.tipsGuests')}</h2>
        <span className="muted">EUR</span>
      </div>
      {views.length > 1 && (
        <div className="segments small" role="radiogroup" aria-label={t('money.tipsGuests')}>
          {views.map((v) => (
            <button key={v.view} type="button" role="radio" aria-checked={shown === v.view} className={`segment${shown === v.view ? ' active' : ''}`} onClick={() => onView(v.view)}>
              {t(v.label)}
            </button>
          ))}
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>{t(TIP_VIEWS.find((v) => v.view === shown)!.label)}</th>
            <th className="num">{t('money.tips')}</th>
            {shown !== 'gast' && <th className="num">{t('money.perGuest')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                {r.label}
                <br />
                <span className="muted small">{r.detail}</span>
              </td>
              <td className="num">{formatMoney(r.eur, 'EUR')}</td>
              {shown !== 'gast' && (
                <td className="num">
                  {r.perGuest !== null ? (
                    formatMoney(r.perGuest, 'EUR')
                  ) : r.trip ? (
                    <button type="button" className="btn link small" aria-label={t('money.setGuests', { trip: r.trip.name })} onClick={() => setAsking(r.trip!)}>
                      —
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {noRate && <p className="muted small">{t('money.tipsNoRate')}</p>}
      {asking && <GuestCountSheet store={store} notify={notify} trip={asking} onClose={() => setAsking(null)} />}
    </div>
  )
}

/** "Aantal gasten" van een tocht invullen (alleen een getal, geen namen). */
function GuestCountSheet({ store, notify, trip, onClose }: { store: Store; notify: Notify; trip: Trip; onClose: () => void }) {
  const [count, setCount] = useState(trip.guestCount ? String(trip.guestCount) : '')
  const n = Number(count)
  const valid = count.trim() !== '' && Number.isInteger(n) && n > 0 && n <= 500
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    const undo = await aantalGastenZetten(store, trip.id, n)
    onClose()
    notify(t('toast.saved'), undo)
  }
  return (
    <Sheet title={t('money.guestsTitle', { trip: trip.name })} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)}>
        <label>
          {t('week.guestCount')}
          <input type="number" inputMode="numeric" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
        <button className="btn primary" type="submit" disabled={!valid}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}

function TxAmount({ tx }: { tx: Transaction }) {
  const value = eurValue(tx)
  const sign = isIncome(tx.kind) ? '+' : '−'
  return (
    <span className={`row-value tx-amount ${isIncome(tx.kind) ? 'positive' : ''}`}>
      <span>
        {sign}
        {value ? formatMoney(value.eur, 'EUR') : formatMoney(tx.amount, tx.currency)}
      </span>
      {tx.currency !== 'EUR' && (
        <span className="muted small">
          {value ? formatMoney(tx.amount, tx.currency) : t('money.noRateShort')}
          {value?.provisional ? ` · ${t('money.provisional')}` : ''}
        </span>
      )}
    </span>
  )
}

function amountLabel(tx: Transaction): string {
  const value = eurValue(tx)
  if (!value || tx.currency === 'EUR') return formatMoney(tx.amount, tx.currency)
  return `${formatMoney(value.eur, 'EUR')} (${formatMoney(tx.amount, tx.currency)}${value.provisional ? `, ${t('money.provisional')}` : ''})`
}

function mergeOther(list: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const other of list) for (const [c, v] of Object.entries(other)) out[c] = (out[c] ?? 0) + v
  return out
}

function Stat({
  label,
  value,
  tone,
  hero = false,
  onOpen,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative'
  hero?: boolean
  /** Doorklikken naar de posten eronder. */
  onOpen?: () => void
}) {
  if (!onOpen)
    return (
      <div className={`stat${hero ? ' hero wide' : ''}`}>
        <dt>{label}</dt>
        <dd className={tone}>{value}</dd>
      </div>
    )
  // Het hele vakje opent de posten: de knop staat in het label en beslaat het hele vakje (CSS .stat-button).
  return (
    <div className={`stat tap${hero ? ' hero wide' : ''}`}>
      <dt>
        <button type="button" className="stat-button" aria-label={`${label}: ${value}`} onClick={onOpen}>
          {label}
        </button>
      </dt>
      <dd className={tone}>
        {value}
        <Icon icon={ChevronRight} className="chevron" />
      </dd>
    </div>
  )
}

function OtherStat({ other }: { other: MoneyTotals['other'] }) {
  const entries = Object.entries(other)
  if (entries.length === 0) return null
  return (
    <div className="stat wide">
      <dt>{t('money.otherCurrencies')}</dt>
      <dd className="small">
        {entries.map(([c, v]) => (
          <span key={c}>
            {v.income > 0 && `+${formatMoney(v.income, c)} `}
            {v.costs > 0 && `−${formatMoney(v.costs, c)} `}
          </span>
        ))}
      </dd>
    </div>
  )
}

function OtherLine({ other }: { other: MoneyTotals['other'] }) {
  const entries = Object.entries(other)
  if (entries.length === 0) return null
  return (
    <div className="muted small">
      {entries.map(([c, v]) => (
        <span key={c}>
          {v.income > 0 && `+${formatMoney(v.income, c)} `}
          {v.costs > 0 && `−${formatMoney(v.costs, c)} `}
        </span>
      ))}
    </div>
  )
}
