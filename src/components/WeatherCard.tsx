import { CloudSun } from 'lucide-react'
import { Component, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { formatMoment, formatNumber } from '../format'
import { t, useLang } from '../i18n'
import type { Trip } from '../model/types'
import { choosePoint, dayParts, downwindDeg, fetchedAtOf, getWeather, isStale, loadWeather, localDates, localHour, needsRefresh, subscribeWeather, tripPoints, upcoming, type Compass, type PartSummary } from '../model/weather'
import type { Store } from '../storage/store'
import { Icon } from './Icon'
import { useCollection } from './useCollection'

// Wind en weer op Vandaag: voor vandaag en morgen per dagdeel de wind (een pijltje dat met de wind meewijst, "uit O",
// knopen; geen windkracht), stoten, golven en neerslag bij de lopende trip, met de tijd van ophalen. Het weerpunt volgt
// de laatste plaats met pin, anders de eigen locatie (als GPS al is toegestaan), anders het gebied van de trip; Olivier
// kan zelf een ander punt kiezen (per apparaat onthouden). Alleen uit public/weather.json (zelfde origin, gebouwd door
// deploy.yml); zonder bestand of zonder punt in de buurt staat er niets.

const POINT_KEY = 'logboek-weerpunt'

function readChosen(): string | null {
  try {
    return localStorage.getItem(POINT_KEY)
  } catch {
    return null
  }
}

function writeChosen(id: string | null): void {
  try {
    if (id) localStorage.setItem(POINT_KEY, id)
    else localStorage.removeItem(POINT_KEY)
  } catch {
    // Niet te bewaren (privévenster): geldt tot herladen.
  }
}

/** De eigen locatie, alleen als GPS al is toegestaan (Vandaag vraagt nooit om toestemming). */
function useGrantedPosition(wanted: boolean): { lat: number; lon: number } | null {
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null)
  useEffect(() => {
    if (!wanted || !('geolocation' in navigator) || !navigator.permissions) return
    let live = true
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (!live || status.state !== 'granted') return
        navigator.geolocation.getCurrentPosition(
          (p) => live && setPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
          () => undefined,
          { maximumAge: 30 * 60_000, timeout: 10_000 },
        )
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [wanted])
  return pos
}

/** Pijltje dat met de wind meewijst (naar waar de wind heen gaat). */
function WindArrow({ dir }: { dir: Compass }) {
  return (
    <svg className="wind-arrow" viewBox="0 0 24 24" aria-hidden="true">
      <g transform={`rotate(${downwindDeg(dir)} 12 12)`}>
        <path d="M12 3v18M12 3l-5 6M12 3l5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}

function windLine(p: PartSummary): string {
  const range = p.windMin === p.windMax ? formatNumber(p.windMax!) : `${formatNumber(p.windMin!)}–${formatNumber(p.windMax!)}`
  return p.dir ? t('weather.windFrom', { dir: t(`weather.dir.${p.dir}`), range }) : t('weather.windKn', { range })
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

  const [chosen, setChosen] = useState<string | null>(readChosen)
  const pins = useMemo(() => tripPoints(trip, legs, places), [trip, legs, places])
  const gps = useGrantedPosition(pins.length === 0 && !chosen)
  const found = useMemo(() => choosePoint(file, { chosen, pins, gps, area: [trip.area, trip.base] }), [file, chosen, pins, gps, trip.area, trip.base])
  // Welk punt "Automatisch" zou kiezen (staat bij de keuze, ook als er zelf een ander punt gekozen is).
  const auto = useMemo(() => (chosen ? choosePoint(file, { pins, gps, area: [trip.area, trip.base] }) : found), [chosen, file, pins, gps, trip.area, trip.base, found])
  if (!file || !found) return null
  const { point, source } = found
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
      <div className="row weather-point">
        <span className="muted small grow">{t(`weather.source.${source}`)}</span>
        <select
            className="weather-point-choice"
            aria-label={t('weather.choosePoint')}
            value={chosen ?? ''}
            onChange={(e) => {
              const id = e.target.value || null
              writeChosen(id)
              setChosen(id)
            }}
          >
            <option value="">{auto ? t('weather.automaticPoint', { point: auto.point.name[lang] }) : t('weather.automatic')}</option>
            {file.points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name[lang]}
              </option>
            ))}
          </select>
      </div>
      {days.map((day) => (
        <div key={day.key} className="weather-day">
          <h3>{day.label}</h3>
          <ul className="weather-parts">
            {day.parts.map((p) => (
              <li key={p.part}>
                <span className="muted small">{t(`weather.part.${p.part}`)}</span>
                <span className="weather-main">
                  <strong className="weather-wind">
                    {p.dir && <WindArrow dir={p.dir} />}
                    {windLine(p)}
                  </strong>
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
