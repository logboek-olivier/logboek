import { CloudSun } from 'lucide-react'
import { Component, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { formatMoment, formatNumber } from '../format'
import { t, useLang } from '../i18n'
import type { Trip } from '../model/types'
import { beaufort, dayParts, fetchedAtOf, getWeather, isStale, loadWeather, localDates, localHour, needsRefresh, pointNear, subscribeWeather, tripPoints, upcoming, type PartSummary } from '../model/weather'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { useCollection } from './useCollection'

// Wind en weer op Vandaag: voor vandaag en morgen per dagdeel de wind (richting, knopen, Beaufort, stoten), de golven
// en de neerslag bij de lopende trip, met de tijd van ophalen. Alleen uit public/weather.json (zelfde origin, gebouwd
// door deploy.yml); zonder bestand, zonder pins of buiten de vaste gebieden staat er niets.

function windLine(p: PartSummary): string {
  const range = p.windMin === p.windMax ? formatNumber(p.windMax!) : `${formatNumber(p.windMin!)}–${formatNumber(p.windMax!)}`
  return t('weather.wind', { dir: p.dir ? t(`weather.dir.${p.dir}`) : '', range, bft: beaufort(p.windMax!) }).trim()
}

function detailLine(p: PartSummary): string {
  return [
    p.gust !== null && p.gust > (p.windMax ?? 0) ? t('weather.gust', { kn: formatNumber(p.gust) }) : '',
    p.wave !== null ? t('weather.wave', { m: formatNumber(p.wave) }) : '',
    p.rain === null ? '' : p.rain > 0 ? t('weather.rain', { mm: formatNumber(p.rain) }) : t('weather.dry'),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Een fout in de weerkaart (bijvoorbeeld door een vreemd bestand) laat de rest van Vandaag gewoon werken. */
export class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function WeatherCard(props: { store: Store; trip: Trip }) {
  return (
    <QuietBoundary>
      <WeatherCardInner {...props} />
    </QuietBoundary>
  )
}

function WeatherCardInner({ store, trip }: { store: Store; trip: Trip }) {
  const lang = useLang()
  const file = useSyncExternalStore(subscribeWeather, getWeather)
  const legs = useCollection(store, 'legs.json.enc')
  const places = useCollection(store, 'places.json.enc')

  // Ophalen bij openen, en opnieuw als de app terugkomt en de verwachting in het geheugen ouder is dan een paar uur.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && needsRefresh(getWeather())) void loadWeather()
    }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])

  const point = useMemo(() => pointNear(file, tripPoints(trip, legs, places)), [file, trip, legs, places])
  if (!file || !point) return null
  const [today, tomorrow] = localDates(point)
  const days = [
    // Van vandaag alleen de dagdelen die nog komen.
    { key: 'today', label: t('weather.today'), parts: upcoming(dayParts(point, today), localHour(point)) },
    { key: 'tomorrow', label: t('weather.tomorrow'), parts: dayParts(point, tomorrow) },
  ].filter((d) => d.parts.length > 0)
  if (days.length === 0) return null
  const fetchedAt = fetchedAtOf(file, point)
  const fetchedText = formatMoment(fetchedAt)
  const stale = isStale(fetchedAt)

  return (
    <section className="card card-body weather-card stack-sm" aria-label={t('weather.title', { area: point.name[lang] })}>
      <h2>
        <Icon icon={CloudSun} />
        {t('weather.title', { area: point.name[lang] })}
      </h2>
      {days.map((day) => (
        <div key={day.key} className="weather-day">
          <h3>{day.label}</h3>
          <ul className="weather-parts">
            {day.parts.map((p) => (
              <li key={p.part}>
                <span className="muted small">{t(`weather.part.${p.part}`)}</span>
                <span className="weather-main">
                  <strong>{windLine(p)}</strong>
                  <span className="muted small">{detailLine(p)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className={`small ${stale ? 'weather-stale' : 'muted'}`}>{t(stale ? 'weather.stale' : 'weather.fetched', { at: fetchedText })}</p>
    </section>
  )
}
