import { ChevronRight, Coins, Receipt, Wallet } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { BarChart } from '../components/BarChart'
import type { Notify } from '../components/EditSheets'
import { TransactionView } from '../components/Views'
import { SalaryOutlook } from '../components/SalaryOutlook'
import { MoneyPathSection } from '../components/MoneyPath'
import { PositionAndForecast } from '../components/Position'
import { CostsSection } from '../components/Costs'
import { ClaimsSection } from '../components/Claims'
import { TaxYearSection } from '../components/TaxYear'
import { Empty } from '../components/Empty'
import { Icon } from '../components/Icon'
import { useCollection } from '../components/useCollection'
import { formatDate, formatDateShort, formatMoney, formatMoneyShort, formatMonth, formatMonthShort } from '../format'
import { buildIndex, incomePerWorkday } from '../model/calendar'
import { tipsPerCountry, tipsPerGuest, tipsPerTrip, tipsPerTripType } from '../model/guests'
import { weekTypeLabel } from '../components/WeekSheet'
import { active } from '../model/derive'
import { eurOf, isIncome, monthSeries, perMonth, tipsPerWeek, totals, type MoneyTotals } from '../model/money'
import { groupOf, type TaxGroup } from '../model/tax-year'
import { careerInvestment } from '../model/expenses'
import { stayName } from '../model/periods'
import { kindLabel, organisationLabel, sourceLabel } from '../i18n/labels'
import { eurValue, getRates, subscribeRates } from '../model/rates'
import { todayIso, type Leg, type Transaction, type Trip, type WeekType } from '../model/types'
import type { Store } from '../storage/store'
import { t } from '../i18n'

// Geld: alles in euro (ECB-koers van de transactiedatum, of het ontvangen eurobedrag), het originele bedrag klein
// eronder. Zeilgeld per maand, per werkdag (uit de agenda), per bron, fooi per week (12 weken), lijst per maand met
// verwijderen. Geen netto waarde.

export function Money({ store, notify, onAdd }: { store: Store; notify: Notify; onAdd: () => void }) {
  const [editing, setEditing] = useState<Transaction | null>(null)
  // Opnieuw tekenen zodra de koersen geladen zijn.
  useSyncExternalStore(subscribeRates, getRates)
  const transactions = useCollection(store, 'transactions.json.enc')
  const live = active(transactions).sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : a.updatedAt < b.updatedAt ? 1 : -1,
  )
  const today = todayIso()
  const all = totals(live)
  const months = perMonth(live)

  const weeks = tipsPerWeek(live, today)
  const series = monthSeries(live, today)
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
  const groups = useMemo(() => {
    const map = new Map<TaxGroup, Transaction[]>()
    for (const tx of live) map.set(groupOf(tx, tripMap), [...(map.get(groupOf(tx, tripMap)) ?? []), tx])
    return [...map.entries()].map(([group, txs]) => ({ group, ...totals(txs) })).sort((a, b) => b.incomeEur - a.incomeEur)
  }, [live, tripMap])
  const periodName = (tx: Transaction) => {
    const trip = tx.tripId ? tripMap.get(tx.tripId) : undefined
    if (trip) return trip.name
    const stay = tx.tripId ? stayMap.get(tx.tripId) : undefined
    return stay ? stayName(stay) : ''
  }
  const investment = careerInvestment(live, eurOf)
  const workdays = incomePerWorkday(index, live, today).filter((m) => m.workdays > 0 || m.eur > 0)
  const [tipView, setTipView] = useState<TipView>('gast')

  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('nav.money')}</h1>
      </header>
      {live.length === 0 && (
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
      <PositionAndForecast store={store} notify={notify} />
      <CostsSection store={store} notify={notify} />
      <ClaimsSection store={store} notify={notify} />
      {live.length === 0 && <MoneyPathSection store={store} notify={notify} />}
      {live.length === 0 && <SalaryOutlook store={store} />}
      {live.length > 0 && (
        <>
          <dl className="grid">
            <Stat
              label={t('money.result')}
              value={formatMoney(all.balanceEur, 'EUR')}
              tone={all.balanceEur >= 0 ? 'positive' : 'negative'}
              hero
            />
            <Stat label={t('money.income')} value={formatMoney(all.incomeEur, 'EUR')} />
            <Stat label={t('money.costs')} value={formatMoney(all.costsEur, 'EUR')} />
            {all.reimbursedEur > 0 && <Stat label={t('money.reimbursed')} value={formatMoney(all.reimbursedEur, 'EUR')} />}
            {investment.count > 0 && <Stat label={t('money.investment')} value={formatMoney(investment.eur, 'EUR')} />}
            <OtherStat other={all.other} />
          </dl>
          <p className="muted small">{t('money.resultHint')}</p>

          <MoneyPathSection store={store} notify={notify} />

          <SalaryOutlook store={store} />

          <TaxYearSection store={store} />

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
                    <td className="num">{formatMoney(m.incomeEur, 'EUR')}</td>
                    <td className="num">{formatMoney(m.costsEur, 'EUR')}</td>
                    <td className={`num ${m.balanceEur >= 0 ? 'positive' : 'negative'}`}>{formatMoney(m.balanceEur, 'EUR')}</td>
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
              <p className="muted small">{t('money.perWorkdayHint')}</p>
            </div>
          )}

          <TipOverview trips={trips} transactions={live} legs={legs} view={tipView} onView={setTipView} />

          <div className="section">
            <h2>{t('money.perOrganisation')}</h2>
            <ul className="rows">
              {groups.map((s) => (
                <li key={s.group} className="row-item">
                  <div className="row-main">
                    <span className="row-title">{s.group === 'delivery' ? sourceLabel('delivery') : organisationLabel(s.group)}</span>
                    <OtherLine other={s.other} />
                  </div>
                  <span className="row-value">
                    <span className="positive">+{formatMoney(s.incomeEur, 'EUR')}</span>
                    <br />
                    <span className="muted">−{formatMoney(s.costsEur, 'EUR')}</span>
                  </span>
                </li>
              ))}
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
 * Fooi per gast, gemiddeld per gast per trip, per soort trip en per land (alleen fooien met een trip). Weergaven zonder
 * regels zijn niet te kiezen; zonder enige fooi bij een trip met deelnemers staat het blok er niet.
 */
function TipOverview({ trips, transactions, legs, view, onView }: { trips: readonly Trip[]; transactions: readonly Transaction[]; legs: readonly Leg[]; view: TipView; onView: (view: TipView) => void }) {
  const perTrip = tipsPerTrip(trips, transactions, legs).filter((x) => x.guests > 0)
  const countries = tipsPerCountry(trips, transactions)
  const all: Record<TipView, { key: string; label: string; detail: string; eur: number; perGuest: number | null }[]> = {
    gast: tipsPerGuest(trips, transactions).map((g) => ({ key: g.key, label: g.label, detail: t('money.trips', { n: g.trips }), eur: g.eur, perGuest: null })),
    trip: perTrip.map((x) => ({ key: x.trip.id, label: x.trip.name, detail: t('money.guestsCount', { n: x.guests }), eur: x.eur, perGuest: x.perGuest })),
    soort: tipsPerTripType(perTrip).map((g) => ({ key: g.key, label: weekTypeLabel(g.key as WeekType), detail: t('money.trips', { n: g.trips }), eur: g.eur, perGuest: g.perGuest })),
    // Alleen gasten zonder land: geen overzicht per land.
    land: countries.some((g) => g.key !== '') ? countries.map((g) => ({ key: g.key, label: g.label || t('money.noCountry'), detail: t('money.guestsCount', { n: g.guests }), eur: g.eur, perGuest: g.perGuest })) : [],
  }
  const views = TIP_VIEWS.filter((v) => all[v.view].length > 0)
  if (views.length === 0) return null
  const shown = all[view].length > 0 ? view : views[0]!.view
  const rows = all[shown]
  const noRate = active(transactions).some((tx) => tx.kind === 'fooi' && tx.tripId && eurOf(tx) === null)
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
              {shown !== 'gast' && <td className="num">{r.perGuest === null ? '–' : formatMoney(r.perGuest, 'EUR')}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{t('money.tipsHint')}</p>
      {noRate && <p className="muted small">{t('money.tipsNoRate')}</p>}
    </div>
  )
}

/** Bedrag in euro, het originele bedrag klein eronder (met "voorlopig" als de koers nog niet definitief is). */
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
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative'
  hero?: boolean
}) {
  return (
    <div className={`stat${hero ? ' hero wide' : ''}`}>
      <dt>{label}</dt>
      <dd className={tone}>{value}</dd>
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
