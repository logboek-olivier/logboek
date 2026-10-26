import { Anchor, CalendarDays, Coins, LoaderCircle, Sailboat, Wallet, Waves } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { BarChart } from '../components/BarChart'
import { GoalSheet, type Notify } from '../components/EditSheets'
import { CopyErrorDetails } from '../components/ErrorDetails'
import { Icon } from '../components/Icon'
import { useSyncStatus } from '../components/SyncStatusLine'
import { useCollection } from '../components/useCollection'
import { formatDate, formatDateRange, formatMoney, formatMonth, formatNm, formatNumber } from '../format'
import { lastTrip, nmInYear, nmPerMonth, summarize } from '../model/derive'
import { monthSeries, recentTips, tipsPerWeek } from '../model/money'
import { UPDATE_APP_MESSAGE } from '../model/schema'
import { currentSettings, yearGoal } from '../model/settings'
import { todayIso } from '../model/types'
import { daysUntil, useSession } from '../session'
import { TOKEN_INVALID_MESSAGE, type Store } from '../storage/store'

// Vandaag: nm dit jaar met voortgang naar het jaardoel, nm totaal, fooi afgelopen 30 dagen, zeilgeld deze maand,
// laatste tocht. Kaarten met kleine grafieken. Omlaag trekken synchroniseert.

const TOKEN_WARNING_DAYS = 30
/** Zo ver omlaag trekken (px) start een sync. */
const PULL_THRESHOLD = 72

export function Today({
  store,
  notify,
  onSettings,
  onAdd,
}: {
  store: Store
  notify: Notify
  onSettings: () => void
  onAdd: () => void
}) {
  const session = useSession()
  const legs = useCollection(store, 'legs.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const settings = currentSettings(useCollection(store, 'settings.json.enc'))
  const status = useSyncStatus(store)
  const [goalOpen, setGoalOpen] = useState(false)
  const pull = usePullToSync(() => void store.sync())
  const today = todayIso()
  const year = Number(today.slice(0, 4))
  const total = summarize(legs)
  const tips = recentTips(transactions, today)
  const weeks = tipsPerWeek(transactions, today)
  const months = nmPerMonth(legs, today)
  const money = monthSeries(transactions, today, 6)
  const thisMonth = money[money.length - 1]!
  const last = lastTrip(trips, legs)
  const nmYear = nmInYear(legs, year)
  const goal = yearGoal(settings)
  const share = Math.min(1, nmYear / goal)
  const tokenDays = daysUntil(session.tokenExpiresAt, today)
  const tokenInvalid = status.kind === 'error' && status.message === TOKEN_INVALID_MESSAGE

  return (
    <section className="stack" onTouchStart={pull.onTouchStart} onTouchMove={pull.onTouchMove} onTouchEnd={pull.onTouchEnd}>
      <div className="pull-indicator" ref={pull.indicator} aria-hidden="true">
        <Icon icon={LoaderCircle} className={status.kind === 'syncing' ? 'spin' : ''} />
        <span>{pull.ready ? 'Loslaten om te synchroniseren' : 'Omlaag trekken om te synchroniseren'}</span>
      </div>
      <header className="page-header">
        <h1>Vandaag</h1>
      </header>
      {tokenInvalid && (
        <Notice
          text="Token verlopen of ingetrokken. Wijzigingen blijven bewaard tot er een geldige token is."
          onSettings={onSettings}
        />
      )}
      {status.kind === 'error' && !tokenInvalid && (
        <div className="notice error-block" role="alert">
          <span>
            {status.message.startsWith('Synchroniseren') ? status.message : `Synchroniseren mislukt: ${status.message}`}. Wijzigingen
            blijven op dit apparaat bewaard.
          </span>
          {status.message !== UPDATE_APP_MESSAGE && <CopyErrorDetails />}
        </div>
      )}
      {!tokenInvalid && tokenDays !== null && tokenDays <= TOKEN_WARNING_DAYS && session.tokenExpiresAt && (
        <Notice
          text={
            tokenDays < 0
              ? `Token is verlopen op ${formatDate(session.tokenExpiresAt)}.`
              : tokenDays === 0
                ? 'Token verloopt vandaag.'
                : `Token verloopt op ${formatDate(session.tokenExpiresAt)} (over ${tokenDays} ${tokenDays === 1 ? 'dag' : 'dagen'}).`
          }
          onSettings={onSettings}
        />
      )}
      <button
        className="stat hero goal"
        onClick={() => setGoalOpen(true)}
        aria-label={`nm in ${year}: ${formatNm(nmYear)}, ${formatNumber(Math.round(share * 100))}% van het jaardoel ${formatNm(goal)} · Jaardoel wijzigen`}
      >
        <span className="stat-label">
          <Icon icon={CalendarDays} />
          nm in {year}
        </span>
        <span className="stat-value">{formatNm(nmYear)}</span>
        <span className="small muted">
          {formatNumber(Math.round(share * 100))}% van {formatNm(goal)}
          {nmYear < goal ? ` · nog ${formatNm(Math.round((goal - nmYear) * 10) / 10)}` : ' · jaardoel gehaald'}
        </span>
        <span
          className="progress"
          role="progressbar"
          aria-label="Voortgang jaardoel"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={nmYear}
        >
          <span className="progress-fill" ref={(el) => setWidth(el, share)} />
        </span>
      </button>
      <dl className="grid">
        <Card icon={Waves} label="nm totaal" value={formatNm(total.nm)}>
          <BarChart
            compact
            height={40}
            label={`nm per maand: ${months.map((m) => `${formatMonth(m.month)} ${formatNm(m.nm)}`).join(', ')}`}
            groups={months.map((m) => ({ key: m.month, label: '', values: [m.nm] }))}
            format={formatNm}
          />
        </Card>
        <Card
          icon={Coins}
          label="Fooi 30 dagen"
          value={formatMoney(tips.eur, 'EUR')}
          extra={Object.entries(tips.other).map(([c, v]) => `+ ${formatMoney(v, c)}`)}
        >
          <BarChart
            compact
            height={40}
            label={`Fooi per week: ${weeks.map((w) => formatMoney(w.eur, 'EUR')).join(', ')}`}
            groups={weeks.map((w) => ({ key: w.weekStart, label: '', values: [w.eur] }))}
            format={(n) => formatMoney(n, 'EUR')}
          />
        </Card>
        <Card
          icon={Wallet}
          label={`Zeilgeld ${formatMonth(thisMonth.month)}`}
          value={formatMoney(thisMonth.balanceEur, 'EUR')}
          extra={[`+${formatMoney(thisMonth.incomeEur, 'EUR')} · −${formatMoney(thisMonth.costsEur, 'EUR')}`]}
          wide
        >
          <BarChart
            compact
            height={40}
            label={`Inkomsten en kosten per maand: ${money.map((m) => `${formatMonth(m.month)} in ${formatMoney(m.incomeEur, 'EUR')}, uit ${formatMoney(m.costsEur, 'EUR')}`).join('; ')}`}
            groups={money.map((m) => ({ key: m.month, label: '', values: [m.incomeEur, m.costsEur] }))}
            format={(n) => formatMoney(n, 'EUR')}
          />
        </Card>
        {last ? (
          <Card
            icon={Sailboat}
            label="Laatste tocht"
            value={last.trip.name}
            extra={[`${formatDateRange(last.startDate, last.endDate)} · ${formatNm(last.nm)}`]}
            wide
          />
        ) : (
          <div className="stat wide">
            <dt>
              <Icon icon={Anchor} />
              Laatste tocht
            </dt>
            <dd className="small muted">Nog geen dagen. Voeg een dag toe of importeer de mijlenregistratie bij Zeilen.</dd>
            <dd className="small">
              <button className="btn link" onClick={onAdd}>
                Dag toevoegen
              </button>
            </dd>
          </div>
        )}
      </dl>
      {goalOpen && <GoalSheet store={store} current={goal} onClose={() => setGoalOpen(false)} notify={notify} />}
    </section>
  )
}

/** Breedte via CSSOM (de CSP staat geen inline style-attributen toe, wel element.style). */
function setWidth(el: HTMLElement | null, share: number) {
  if (el) el.style.width = `${Math.round(share * 1000) / 10}%`
}

/** Omlaag trekken bovenaan de pagina; ver genoeg en loslaten = synchroniseren. */
function usePullToSync(onSync: () => void) {
  const start = useRef<number | null>(null)
  const distance = useRef(0)
  const indicator = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  const setHeight = (px: number) => {
    if (indicator.current) indicator.current.style.height = `${px}px`
  }

  return {
    indicator,
    ready,
    onTouchStart(e: TouchEvent) {
      start.current = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0]!.clientY : null
      distance.current = 0
    },
    onTouchMove(e: TouchEvent) {
      if (start.current === null) return
      distance.current = Math.max(0, e.touches[0]!.clientY - start.current)
      // Weerstand: de indicator groeit langzamer dan de vinger.
      setHeight(Math.min(56, distance.current / 2))
      setReady(distance.current >= PULL_THRESHOLD)
    },
    onTouchEnd() {
      if (start.current !== null && distance.current >= PULL_THRESHOLD) onSync()
      start.current = null
      distance.current = 0
      setHeight(0)
      setReady(false)
    },
  }
}

function Notice({ text, onSettings }: { text: string; onSettings: () => void }) {
  return (
    <div className="notice" role="alert">
      <span>{text}</span>
      <button className="btn link" onClick={onSettings}>
        Token vervangen
      </button>
    </div>
  )
}

function Card({
  icon,
  label,
  value,
  extra = [],
  wide = false,
  children,
}: {
  icon: LucideIcon
  label: string
  value: string
  extra?: string[]
  wide?: boolean
  children?: ReactNode
}) {
  return (
    <div className={`stat${wide ? ' wide' : ''}`}>
      <dt>
        <Icon icon={icon} />
        {label}
      </dt>
      <dd>{value}</dd>
      {extra.map((e) => (
        <dd key={e} className="small muted">
          {e}
        </dd>
      ))}
      {children}
    </div>
  )
}
