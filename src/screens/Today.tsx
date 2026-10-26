import { useSyncStatus } from '../components/SyncStatusLine'
import { useCollection } from '../components/useCollection'
import { formatDate, formatDateRange, formatMoney, formatNm } from '../format'
import { lastTrip, nmInYear, summarize } from '../model/derive'
import { recentTips } from '../model/money'
import { todayIso } from '../model/types'
import { daysUntil, useSession } from '../session'
import { TOKEN_INVALID_MESSAGE, type Store } from '../storage/store'

// Vandaag: nm dit jaar, nm totaal, fooi afgelopen 30 dagen, laatste tocht. Meer kaarten volgen als de data bestaat.

const TOKEN_WARNING_DAYS = 30

export function Today({ store, onSettings }: { store: Store; onSettings: () => void }) {
  const session = useSession()
  const legs = useCollection(store, 'legs.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const status = useSyncStatus(store)
  const today = todayIso()
  const year = Number(today.slice(0, 4))
  const total = summarize(legs)
  const tips = recentTips(transactions, today)
  const last = lastTrip(trips, legs)
  const tokenDays = daysUntil(session.tokenExpiresAt, today)
  const tokenInvalid = status.kind === 'error' && status.message === TOKEN_INVALID_MESSAGE

  return (
    <section className="stack">
      <header className="title-row">
        <h1>Vandaag</h1>
        <button className="btn icon" aria-label="Instellingen" onClick={onSettings}>
          ⚙
        </button>
      </header>
      {tokenInvalid && (
        <Notice text="Token verlopen of ingetrokken. Wijzigingen blijven bewaard tot er een geldige token is." onSettings={onSettings} />
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
      <dl className="grid">
        <Card label={`nm in ${year}`} value={formatNm(nmInYear(legs, year))} />
        <Card label="nm totaal" value={formatNm(total.nm)} />
        <Card
          label="Fooi afgelopen 30 dagen"
          value={formatMoney(tips.eur, 'EUR')}
          extra={Object.entries(tips.other).map(([c, v]) => `+ ${formatMoney(v, c)}`)}
        />
        {last ? (
          <Card
            label="Laatste tocht"
            value={last.trip.name}
            extra={[`${formatDateRange(last.startDate, last.endDate)} · ${formatNm(last.nm)}`]}
          />
        ) : (
          <Card label="Laatste tocht" value="–" extra={['Nog geen dagen']} />
        )}
      </dl>
    </section>
  )
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

function Card({ label, value, extra = [] }: { label: string; value: string; extra?: string[] }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {extra.map((e) => (
        <dd key={e} className="small muted">
          {e}
        </dd>
      ))}
    </div>
  )
}
