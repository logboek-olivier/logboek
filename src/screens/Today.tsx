import { useCollection } from '../components/useCollection'
import { formatDateRange, formatMoney, formatNm } from '../format'
import { lastTrip, nmInYear, summarize } from '../model/derive'
import { recentTips } from '../model/money'
import { todayIso } from '../model/types'
import type { Store } from '../storage/store'

// Vandaag: nm dit jaar, nm totaal, fooi afgelopen 30 dagen, laatste tocht. Meer kaarten volgen als de data bestaat.

export function Today({ store, onSettings }: { store: Store; onSettings: () => void }) {
  const legs = useCollection(store, 'legs.json.enc')
  const trips = useCollection(store, 'trips.json.enc')
  const transactions = useCollection(store, 'transactions.json.enc')
  const today = todayIso()
  const year = Number(today.slice(0, 4))
  const total = summarize(legs)
  const tips = recentTips(transactions, today)
  const last = lastTrip(trips, legs)

  return (
    <section className="stack">
      <header className="title-row">
        <h1>Vandaag</h1>
        <button className="btn icon" aria-label="Instellingen" onClick={onSettings}>
          ⚙
        </button>
      </header>
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
