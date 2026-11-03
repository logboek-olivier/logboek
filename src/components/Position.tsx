import { ChevronRight, Landmark, TrendingUp } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import { formatDate, formatDateShort, formatMoney, formatMoneyShort, formatMonth, formatMonthShort } from '../format'
import { getLang, t } from '../i18n'
import { isDebt } from '../model/accounts'
import { buildIndex, planningEnd, type CalendarIndex } from '../model/calendar'
import { nameWithCounter } from '../model/counters'
import { careerStart, earliestDate, effectivePreset, forecast, GROUP, netWorthChange, positionAt, resolvePeriod, type AccountRow, type Period, type PeriodPreset, type PositionInput, type Sum } from '../model/position'
import { dayAverages } from '../model/costs'
import { getRates, subscribeRates } from '../model/rates'
import { currentSettings } from '../model/settings'
import { type Account, type Settings } from '../model/types'
import type { Store } from '../storage/store'
import type { Notify } from './EditSheets'
import { Icon } from './Icon'
import { LineChart } from './LineChart'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'
import { usePeriodChoice } from './money-period'
import { beginsaldiInvoeren, standOpslaan } from '../domain/geld'
import { changeDrills, forecastDrills, receivableDrill } from '../domain/doorklik'
import { scenarioPlan } from '../model/scenario'
import { useActiveScenario, type ForecastMode } from './Scenario'
import { DrillSheet, type DrillRequest } from './DrillSheet'
import { instellingenOpslaan } from '../domain/instellingen'
import { parseStand } from '../basis/bedrag'
import { todayIso } from '../basis/datum'

// Geld → Mijn positie en de vooruitblik (src/model/position.ts). Een stand per rekening is hier in een paar seconden
// in te tikken (tik op de rekening); de import onder Meer → Rekeningen blijft optioneel.

function usePositionInput(store: Store): PositionInput {
  const accounts = useCollection(store, 'accounts.json.enc')
  const balances = useCollection(store, 'balances.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const legs = useCollection(store, 'legs.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const claims = useCollection(store, 'claims.json.enc')
  const rates = useSyncExternalStore(subscribeRates, getRates)
  return useMemo(() => ({ accounts, balances, trips, legs, transactions, rates, claims }), [accounts, balances, trips, legs, transactions, rates, claims])
}

/** € 1.234,00 plus wat zonder koers apart blijft ("+ $ 20,00"). */
function sumText(sum: Sum): string {
  const parts = [formatMoney(sum.eur, 'EUR'), ...Object.entries(sum.other).map(([c, v]) => formatMoney(v, c))]
  return parts.join(' + ') + (sum.provisional ? ` (${t('money.provisional')})` : '')
}

function signed(n: number): string {
  if (Math.round(n * 100) === 0) return formatMoney(0, 'EUR')
  return `${n >= 0 ? '+' : '−'}${formatMoney(Math.abs(n), 'EUR')}`
}

/**
 * De periode bovenaan Geld (snelkeuze of zelf van en tot, per apparaat onthouden), voor alle bedragen in Geld: Mijn
 * positie, de vooruitblik, de totalen, kosten per maand, per organisatie en de transacties.
 */
export function useMoneyPeriod(store: Store): { period: Period; hasData: boolean; preset: PeriodPreset; careerSet: boolean } {
  const input = usePositionInput(store)
  const settingsRecords = useCollection(store, 'settings.json.enc')
  const settings = useMemo(() => currentSettings(settingsRecords), [settingsRecords])
  const calendar = useCollection(store, 'calendar.json.enc')
  const stays = useCollection(store, 'periods.json.enc')
  const index = useMemo(() => buildIndex(calendar, input.trips, input.legs, [], stays), [calendar, input.trips, input.legs, stays])
  const choice = usePeriodChoice()
  const today = todayIso()
  const period = useMemo(() => resolvePeriod(choice, settings, today, planningEnd(index), earliestDate(input)), [choice, settings, today, index, input])
  const hasData = input.accounts.some((a) => a.deletedAt === null) || input.trips.some((x) => x.deletedAt === null) || input.transactions.some((x) => x.deletedAt === null)
  return { period, hasData, preset: effectivePreset(choice, settings), careerSet: careerStart(settings) !== null }
}

/** Mijn positie (Werkelijk) of de vooruitblik (Verwacht), in de periode bovenaan Geld. */
export function PositionAndForecast({ store, notify, part, period, preset = 'carriere', mode = 'gepland' }: { store: Store; notify: Notify; /** Werkelijk: Mijn positie; Verwacht: de vooruitblik. */ part: 'werkelijk' | 'verwacht'; period: Period; preset?: PeriodPreset; mode?: ForecastMode }) {
  const input = usePositionInput(store)
  const settingsRecords = useCollection(store, 'settings.json.enc')
  const settings = useMemo(() => currentSettings(settingsRecords), [settingsRecords])
  const calendar = useCollection(store, 'calendar.json.enc')
  const stays = useCollection(store, 'periods.json.enc')
  const index = useMemo(() => buildIndex(calendar, input.trips, input.legs, [], stays), [calendar, input.trips, input.legs, stays])
  return part === 'werkelijk' ? <PositionSection store={store} notify={notify} input={input} period={period} /> : <ForecastSection store={store} notify={notify} input={input} settings={settings} index={index} period={period} preset={preset} mode={mode} />
}

function PositionSection({ store, notify, input, period }: { store: Store; notify: Notify; input: PositionInput; period: Period }) {
  const counters = useCounters(store)
  const [stand, setStand] = useState<Account | null>(null)
  const [drill, setDrill] = useState<DrillRequest | null>(null)
  const [starting, setStarting] = useState<{ date: string; accounts: Account[] } | null>(null)
  const today = todayIso()
  // Alleen opnieuw rekenen als de gegevens veranderen (niet bij elke render): over alle trips en transacties.
  const now = useMemo(() => positionAt(input, today), [input, today])
  // De verandering in de gekozen periode, tot en met vandaag (de toekomst staat in de vooruitblik).
  const change = useMemo(() => netWorthChange(input, period, today), [input, period, today])
  const hasAccounts = input.accounts.some((a) => a.deletedAt === null)
  const empty = !hasAccounts && now.receivable.length === 0 && now.claims.length === 0
  if (empty) return null

  const accountRows = (rows: AccountRow[]) =>
    rows.map((row) => (
      <li key={row.account.id}>
        <button type="button" className="row position-account" onClick={() => setStand(row.account)}>
          <span className="grow">
            {row.account.name}
            <span className="muted small"> · {row.balance ? formatDate(row.balance.date) : t('position.noStand')}</span>
          </span>
          <span className="num">{row.balance ? formatMoney(row.balance.amount, row.account.currency) : '–'}</span>
          <Icon icon={ChevronRight} />
        </button>
      </li>
    ))
  const range = change.to > change.from && change.to === today ? t('position.since', { date: formatDate(change.from) }) : t('position.between', { from: formatDate(change.from), to: formatDate(change.to) })
  const drillPeriod = t('drill.period', { from: formatDate(change.from), to: formatDate(change.to) })
  const openPart = (part: 'sailing' | 'receivable' | 'value' | 'debts' | 'other') => {
    if (change.state !== 'bekend') return
    const drills = changeDrills(change, input.transactions, input.trips, input.rates)
    const at = (date: string) => t('position.receivableAt', { date: formatDate(date) })
    setDrill(
      part === 'sailing'
        ? { title: t('position.partSailing'), drill: drills.sailing, period: drillPeriod, hint: t('drill.sailingHint', { from: formatDate(change.from) }), signed: true }
        : part === 'receivable'
          ? { title: t('position.partReceivable'), drill: drills.receivable, period: drillPeriod, hint: t('drill.receivableHint'), labels: { eind: at(change.to), begin: at(change.from) }, signed: true }
          : part === 'value'
            ? { title: t('position.partValue'), drill: drills.value, period: drillPeriod, hint: t('drill.valueHint'), signed: true }
            : part === 'debts'
              ? { title: t('position.partDebts'), drill: drills.debts, period: drillPeriod, hint: t('drill.debtsHint'), signed: true }
              : { title: t('position.partOther'), drill: drills.other, period: drillPeriod, hint: t('drill.otherHint'), signed: true },
    )
  }

  return (
    <div className="section card card-body stack-sm position">
      <div className="section-head">
        <h2>
          <Icon icon={Landmark} />
          {t('position.title')}
        </h2>
      </div>
      <dl className="position-groups">
        <PositionGroup label={t('position.bank')} sum={now.totals.bank} show={now.bank.length > 0}>
          <ul className="plain-list">{accountRows(now.bank)}</ul>
        </PositionGroup>
        <PositionGroup label={t('position.cash')} sum={now.totals.cash} show={now.cashAccounts.length > 0}>
          <ul className="plain-list">{accountRows(now.cashAccounts)}</ul>
        </PositionGroup>
        <PositionGroup
          label={t('position.receivable')}
          sum={now.totals.receivable}
          show={now.receivable.length > 0 || now.claims.length > 0}
          onOpen={() => setDrill({ title: t('position.receivable'), drill: receivableDrill(now, input.trips, input.rates), hint: t('drill.receivableNowHint', { date: formatDate(today) }) })}
        >
          <ul className="plain-list">
            {now.receivable.map((r) => (
              <li key={r.tx.id} className="row muted small">
                <span className="grow">{t('position.salaryOf', { trip: nameWithCounter(r.trip, counters.get(r.trip.id)) })}</span>
                <span className="num">{formatMoney(r.amount, r.currency)}</span>
              </li>
            ))}
            {now.claims.map((c) => (
              <li key={c.id} className="row muted small">
                <span className="grow">{t('position.claimOf', { date: formatDate(c.date) })}</span>
                <span className="num">{formatMoney(c.amount!, c.currency!)}</span>
              </li>
            ))}
          </ul>
        </PositionGroup>
        <PositionGroup label={t('position.investments')} sum={now.totals.investments} show={now.investments.length > 0}>
          <ul className="plain-list">{accountRows(now.investments)}</ul>
        </PositionGroup>
        <PositionGroup label={t('position.assets')} sum={now.totals.assets} show={now.assets.length > 0}>
          <ul className="plain-list">{accountRows(now.assets)}</ul>
        </PositionGroup>
        <PositionGroup label={t(now.debts.every((r) => r.account.provider === 'duo') ? 'position.studentDebt' : 'position.debts')} sum={now.totals.debts} show={now.debts.length > 0}>
          <ul className="plain-list">{accountRows(now.debts)}</ul>
        </PositionGroup>
      </dl>
      <div className="position-totals stack-sm">
        <p className="row">
          <strong className="grow">{t('position.netAll')}</strong>
          <strong className={`num ${now.totals.net.eur >= 0 ? 'positive' : 'negative'}`}>{sumText(now.totals.net)}</strong>
        </p>
        {change.state === 'bekend' && (
          <>
            <p className="row">
              <span className="grow">{range}</span>
              <strong className={`num ${change.change >= 0 ? 'positive' : 'negative'}`}>{signed(change.change)}</strong>
            </p>
            <ul className="plain-list change-parts">
              {(
                [
                  ['sailing', t('position.partSailing'), change.sailing],
                  ['receivable', t('position.partReceivable'), change.receivable],
                  ['value', t('position.partValue'), change.value],
                  ['debts', t('position.partDebts'), change.debts],
                  ['other', t('position.partOther'), change.other],
                ] as const
              )
                // Regels zonder rekeningen van die soort (geen beleggingen, geen schulden) blijven weg; de som sluit toch.
                .filter(([part]) => (part === 'value' ? change.accounts.some((a) => ['investments', 'assets'].includes(GROUP[a.account.kind] ?? 'bank')) : part === 'debts' ? change.accounts.some((a) => GROUP[a.account.kind] === 'debts') : true))
                .map(([part, label, eur]) => (
                <li key={part}>
                  <button type="button" className="row change-part" onClick={() => openPart(part)}>
                    <span className="grow small">{label}</span>
                    <span className="num small">{signed(eur)}</span>
                    <Icon icon={ChevronRight} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted small">{t('position.sinceHint')}</p>
          </>
        )}
        {change.state === 'onbekend' && (
          <div className="notice stack-sm change-unknown" role="status">
            <p>{t('position.changeUnknown', { date: formatDate(change.from), accounts: change.missing.map((a) => a.name).join(', ') })}</p>
            <button type="button" className="btn" onClick={() => setStarting({ date: change.from, accounts: change.missing })}>
              {t('position.enterStart')}
            </button>
          </div>
        )}
        {change.state === 'geen-koers' && <p className="muted small">{t('position.changeNoRate')}</p>}
        {change.state === 'toekomst' && today < change.from && <p className="muted small">{t('position.periodFuture', { date: formatDate(change.from) })}</p>}
      </div>
      {!hasAccounts && <p className="muted small">{t('position.onlyReceivable')}</p>}
      {stand && <QuickStandSheet store={store} account={stand} notify={notify} onClose={() => setStand(null)} />}
      {drill && <DrillSheet store={store} notify={notify} request={drill} onClose={() => setDrill(null)} />}
      {starting && <StartBalanceSheet store={store} notify={notify} date={starting.date} accounts={starting.accounts} onClose={() => setStarting(null)} />}
    </div>
  )
}

/** Beginsaldo invoeren: per rekening één bedrag, op de begindag van de periode. */
function StartBalanceSheet({ store, notify, date, accounts, onClose }: { store: Store; notify: Notify; date: string; accounts: readonly Account[]; onClose: () => void }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const parsed = accounts.map((account) => ({ account, text: (amounts[account.id] ?? '').trim(), value: parseStand(amounts[account.id] ?? '', getLang()) }))
  const filled = parsed.filter((p) => p.text !== '')
  const valid = filled.length > 0 && filled.every((p) => p.value !== null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      const { undo } = await beginsaldiInvoeren(
        store,
        filled.map((p) => ({ account: p.account, amount: p.value! })),
        date,
      )
      onClose()
      notify(t('position.startSaved'), undo)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title={t('position.startTitle', { date: formatDate(date) })} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {parsed.map((p) => (
          <label key={p.account.id}>
            {p.account.name} ({p.account.currency})
            <input
              className="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amounts[p.account.id] ?? ''}
              aria-invalid={p.text !== '' && p.value === null}
              onChange={(e) => setAmounts((prev) => ({ ...prev, [p.account.id]: e.target.value }))}
            />
          </label>
        ))}
        <p className="muted small">{t('position.startHint', { date: formatDate(date) })}</p>
        <button className="btn primary" type="submit" disabled={!valid || busy}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}

function PositionGroup({ label, sum, show, onOpen, children }: { label: string; sum: Sum; show: boolean; /** Doorklikken naar de posten. */ onOpen?: () => void; children: React.ReactNode }) {
  if (!show) return null
  return (
    <div className="position-group stack-sm">
      {onOpen ? (
        // Label en bedrag openen allebei de posten (een definitielijst mag geen knop om label en bedrag samen hebben).
        <div className="row position-group-head">
          <dt className="grow">
            <button type="button" className="tap-row" onClick={onOpen}>
              {label}
            </button>
          </dt>
          <dd className="num">
            <button type="button" className="tap-row num" onClick={onOpen} tabIndex={-1} aria-hidden="true">
              {sumText(sum)}
              <Icon icon={ChevronRight} />
            </button>
          </dd>
        </div>
      ) : (
        <div className="row">
          <dt className="grow">{label}</dt>
          <dd className="num">{sumText(sum)}</dd>
        </div>
      )}
      {children}
    </div>
  )
}

/** Een stand van vandaag in een paar seconden: alleen het bedrag. */
function QuickStandSheet({ store, account, notify, onClose }: { store: Store; account: Account; notify: Notify; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const value = parseStand(amount, getLang())
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (value === null || busy) return
    setBusy(true)
    try {
      const { result: written } = await standOpslaan(store, account, todayIso(), value)
      onClose()
      notify(written ? t('accounts.standSaved') : t('accounts.standNewer'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title={t('position.standTitle', { name: account.name })} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t(isDebt(account) ? 'accounts.debtAmount' : 'accounts.standAmount')} ({account.currency})
          <input className="amount" type="text" inputMode="decimal" autoComplete="off" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <p className="muted small">{t('position.standHint', { date: formatDate(todayIso()) })}</p>
        <button className="btn primary" type="submit" disabled={value === null || busy}>
          {t('accounts.updateStand')}
        </button>
      </form>
    </Sheet>
  )
}

/**
 * Vooruitblik (Verwacht): de som zichtbaar en sluitend, elke regel te tikken: netto waarde vandaag + salaris + geschatte
 * fooien (+ scenario-inkomen) − kosten = netto waarde op de einddatum; daaronder de grafiek (gemeten doorgetrokken,
 * verwacht gestippeld). Bij Scenario loopt de vooruitblik door tot het einde van het scenario (behalve bij een zelf gekozen
 * einddatum).
 */
function ForecastSection({ store, notify, input, settings, index, period, preset, mode }: { store: Store; notify: Notify; input: PositionInput; settings: Settings; index: CalendarIndex; period: Period; preset: PeriodPreset; mode: ForecastMode }) {
  const fixed = useCollection(store, 'fixedcosts.json.enc')
  const scenario = useActiveScenario(store)
  const [drill, setDrill] = useState<DrillRequest | null>(null)
  const today = todayIso()
  const pEnd = planningEnd(index)
  const plan = useMemo(() => (mode === 'scenario' && scenario ? scenarioPlan(scenario, pEnd, today) : null), [mode, scenario, pEnd, today])
  const lastDay = plan?.end ?? null
  // Scenario: tot het einde van het scenario, behalve als de gebruiker zelf een einddatum koos.
  const extended = !!lastDay && lastDay > period.to && preset !== 'eigen'
  const range = useMemo(() => (extended && lastDay ? { from: period.from, to: lastDay } : period), [extended, lastDay, period])
  // Kosten: vaste lasten en per dagsoort het eigen gemiddelde (of het standaardbedrag) van de variabele kosten. Alleen
  // opnieuw rekenen als de gegevens veranderen (de vooruitblik loopt over alle trips, dagen en transacties).
  const f = useMemo(() => {
    const averages = dayAverages(input.transactions, index, today, settings)
    return forecast(input, settings, today, pEnd, 6, { fixed, averages, index }, range, plan)
  }, [input, index, today, settings, fixed, range, plan, pEnd])
  // Niets te tonen: geen posten, geen gemeten maand en niets zonder koers (dan wel de melding dat een koers ontbreekt).
  if (f.items.length === 0 && f.months.every((m) => m.eur === null) && Object.keys(f.other).length === 0 && Object.keys(f.now.other).length === 0) return null
  const hasAccounts = input.accounts.some((a) => a.deletedAt === null)
  // Maanden zonder gegevens aan het begin laten we weg (vóór de eerste stand is er niets te tekenen).
  const first = f.months.findIndex((m) => m.eur !== null)
  const months = first > 0 ? f.months.slice(first) : f.months
  const periodText = t('drill.period', { from: formatDate(today), to: formatDate(range.to) })
  const open = (line: 'start' | 'salary' | 'tips' | 'scenario' | 'costs' | 'oneOffs' | 'growth') => {
    const drills = forecastDrills(f, positionAt(input, today), input.trips, input.rates)
    const requests: Record<typeof line, DrillRequest> = {
      start: { title: t('forecast.lineStart'), drill: drills.start, hint: t('forecast.startHint', { date: formatDate(today) }), signed: true },
      salary: { title: t('forecast.lineSalary'), drill: drills.salary, period: periodText, hint: t('forecast.salaryHint'), signed: true },
      tips: { title: t('forecast.lineTips'), drill: drills.tips, period: periodText, hint: t('forecast.tipsHint'), signed: true },
      scenario: { title: t('forecast.lineScenario'), drill: drills.scenario, period: periodText, hint: t('forecast.scenarioIncomeHint'), signed: true },
      costs: { title: t('forecast.lineCosts'), drill: drills.costs, period: periodText, hint: t('forecast.costsHint'), signed: true },
      oneOffs: { title: t('forecast.lineOneOffs'), drill: drills.oneOffs, period: periodText, hint: t('forecast.oneOffsHint'), signed: true },
      growth: { title: t('forecast.lineGrowth'), drill: drills.growth, period: periodText, hint: t('forecast.growthHint'), signed: true },
    }
    setDrill(requests[line])
  }
  const lines = f.lines
  return (
    <div className="section card card-body stack-sm forecast">
      <div className="section-head">
        <h2>
          <Icon icon={TrendingUp} />
          {t('forecast.title')}
        </h2>
      </div>
      {f.endEur !== null ? <p className="forecast-end">{t('forecast.endOn', { date: formatDate(range.to), amount: formatMoney(f.endEur, 'EUR') })}</p> : <p className="muted small">{t('forecast.noRate')}</p>}
      {lines && (
        <ul className="plain-list forecast-sum">
          {(
            [
              ['start', t('forecast.lineStart'), lines.start, false],
              ['salary', t('forecast.lineSalary'), lines.salary, true],
              ['tips', t('forecast.lineTips'), lines.tips, true],
              ...(mode === 'scenario' ? ([['scenario', t('forecast.lineScenario'), lines.scenario, true]] as const) : []),
              ['costs', t('forecast.lineCosts'), lines.costs, true],
              ...(mode === 'scenario' ? ([['oneOffs', t('forecast.lineOneOffs'), lines.oneOffs, true], ['growth', t('forecast.lineGrowth'), lines.growth, true]] as const) : []),
            ] as const
          ).map(([key, label, eur, isPart]) => (
            <li key={key}>
              <button type="button" className="row change-part" onClick={() => open(key)}>
                <span className="grow small">{label}</span>
                <span className={`num small${key === 'start' && eur < 0 ? ' negative' : ''}`}>{isPart ? signed(eur) : formatMoney(eur, 'EUR')}</span>
                <Icon icon={ChevronRight} />
              </button>
            </li>
          ))}
          <li className="row forecast-total">
            <strong className="grow small">{t('forecast.lineEnd', { date: formatDate(range.to) })}</strong>
            <strong className={`num small ${lines.end >= 0 ? 'positive' : 'negative'}`}>{formatMoney(lines.end, 'EUR')}</strong>
          </li>
        </ul>
      )}
      {lines && <p className="muted small">{t('forecast.sumHint')}</p>}
      {lines && plan && plan.assumptions.investPct > 0 && <p className="muted small">{t('forecast.invested', { amount: formatMoney(lines.invested, 'EUR'), pct: String(plan.assumptions.investPct), end: formatMoney(lines.investmentsEnd, 'EUR') })}</p>}
      {!hasAccounts && <p className="muted small">{t('position.onlyReceivable')}</p>}
      {extended && lastDay && <p className="muted small">{t('forecast.toScenarioEnd', { date: formatDate(lastDay) })}</p>}
      {!extended && lastDay && range.to < lastDay && <p className="muted small">{t('forecast.scenarioCut', { date: formatDate(lastDay) })}</p>}
      {lastDay && lastDay < range.to && <p className="muted small">{t('forecast.scenarioEnds', { date: formatDate(lastDay) })}</p>}
      {f.costsUnknown && <p className="muted small">{t('forecast.costsUnknown')}</p>}
      <LineChart
        points={months.map((m) => ({ key: m.date ?? m.month, label: m.date ? formatDateShort(m.date) : formatMonthShort(m.month), value: m.eur, future: m.future }))}
        label={`${t('forecast.chart')}: ${months.map((m) => `${m.date ? formatDate(m.date) : formatMonth(m.month)} ${m.eur === null ? '–' : formatMoney(m.eur, 'EUR')}${m.future ? ` (${t('forecast.expected')})` : ''}`).join(', ')}`}
        format={(n) => formatMoneyShort(n)}
        labelEvery={months.length > 8 ? Math.ceil(months.length / 6) : 1}
      />
      <ul className="legend">
        <li>
          <span className="swatch line" /> {t('forecast.measured')}
        </li>
        <li>
          <span className="swatch line dashed" /> {t('forecast.expected')}
        </li>
      </ul>
      {Object.entries(f.other).map(([c, v]) => (
        <p key={c} className="muted small">
          {t('money.noRateFor', { currency: c })}: {formatMoney(v, c)}
        </p>
      ))}
      {drill && <DrillSheet store={store} notify={notify} request={drill} onClose={() => setDrill(null)} />}
    </div>
  )
}

/** Instellingen → Start zeilcarrière: de datum voor "Sinds …" in Mijn positie. */
export function CareerStartSheet({ store, notify, onClose }: { store: Store; notify: Notify; onClose: () => void }) {
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const [date, setDate] = useState(careerStart(settings) ?? '')
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok) return
    await instellingenOpslaan(store, { careerStart: date })
    onClose()
    notify(t('toast.saved'))
  }
  return (
    <Sheet title={t('position.careerStart')} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label>
          {t('position.careerStartDate')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <p className="muted small">{t('position.careerStartHint')}</p>
        <button className="btn primary" type="submit" disabled={!ok}>
          {t('common.save')}
        </button>
      </form>
    </Sheet>
  )
}
