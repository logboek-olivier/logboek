import { CheckCircle2, Download, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { formatNumber } from '../format'
import { getLang, t } from '../i18n'
import { areaStatus, autoAreaId, isOffline, makeOffline, removeOffline, subscribeOfflineMaps, type AreaStatus } from '../model/offline-maps'
import { loadOsmIndex, osmIndexUrl, type OsmArea, type OsmIndex } from '../model/osm'

// Meer → Kaarten: per vaargebied de grootte, of het offline beschikbaar is, en de knop om het offline te zetten of weer
// te verwijderen. Het gebied van de lopende trip zet de app vanzelf offline (src/model/offline-maps.ts).

function megabytes(bytes: number): string {
  return t('maps.size', { mb: formatNumber(Math.max(0.1, Math.round(bytes / 100_000) / 10)) })
}

export function Maps() {
  const [index, setIndex] = useState<OsmIndex | null | undefined>(undefined)
  const [status, setStatus] = useState<Record<string, AreaStatus>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [auto, setAuto] = useState(autoAreaId())
  const lang = getLang()

  async function refresh(idx: OsmIndex | null) {
    if (!idx) return
    const entries = await Promise.all(idx.areas.map(async (a) => [a.id, await areaStatus(a)] as const))
    setStatus(Object.fromEntries(entries))
  }

  useEffect(() => {
    let active = true
    void loadOsmIndex().then(async (idx) => {
      if (!active) return
      setIndex(idx)
      await refresh(idx)
    })
    // Het vanzelf offline zetten (lopende trip) kan intussen klaar zijn.
    const stop = subscribeOfflineMaps(() => {
      setAuto(autoAreaId())
      void loadOsmIndex().then(refresh)
    })
    return () => {
      active = false
      stop()
    }
  }, [])

  async function download(area: OsmArea) {
    setBusy(area.id)
    setFailed(null)
    try {
      // Vraag de browser de opslag te bewaren (geen netwerk; een geïnstalleerde app krijgt dat meestal direct).
      await navigator.storage?.persist?.().catch(() => false)
      await makeOffline(area, (s) => setStatus((current) => ({ ...current, [area.id]: s })), undefined, undefined, osmIndexUrl())
    } catch {
      setFailed(area.id)
    } finally {
      setBusy(null)
      await refresh(index ?? null)
    }
  }

  async function remove(area: OsmArea) {
    setBusy(area.id)
    try {
      await removeOffline(area)
    } finally {
      setBusy(null)
      await refresh(index ?? null)
    }
  }

  if (index === undefined) return null
  return (
    <section className="stack-lg">
      <header className="page-header">
        <h1>{t('maps.title')}</h1>
      </header>
      <p className="muted">{t('maps.hint')}</p>
      {!index ? (
        <p className="notice">{t('maps.noIndex')}</p>
      ) : (
        <ul className="rows maps-list">
          {index.areas.map((area) => {
            const s = status[area.id]
            const offline = s ? isOffline(s) : false
            const loading = busy === area.id
            const percent = s && s.total > 0 ? Math.floor((s.cached / s.total) * 100) : 0
            return (
              <li key={area.id} className="map-area">
                <div className="row-main">
                  <strong>{area.name[lang]}</strong>
                  <span className="muted small">
                    {typeof area.bytes === 'number' ? megabytes(area.bytes) : ''}
                    {typeof area.bytes === 'number' ? ' · ' : ''}
                    {loading ? t('maps.loading', { percent }) : offline ? t('maps.offline') : s && s.cached > 0 ? t('maps.partly', { percent }) : t('maps.notOffline')}
                  </span>
                  {auto === area.id && <span className="muted small">{t('maps.auto')}</span>}
                  {failed === area.id && <span className="notice small">{t('maps.failed')}</span>}
                </div>
                {loading ? (
                  <progress max={100} value={percent} aria-label={t('maps.progress', { name: area.name[lang] })} />
                ) : offline ? (
                  <div className="row">
                    <span className="map-area-done">
                      <Icon icon={CheckCircle2} />
                    </span>
                    <button type="button" className="btn small" onClick={() => void remove(area)} disabled={busy !== null}>
                      <Icon icon={Trash2} />
                      {t('maps.remove')}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn small primary" onClick={() => void download(area)} disabled={busy !== null}>
                    <Icon icon={Download} />
                    {t('maps.makeOffline')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
