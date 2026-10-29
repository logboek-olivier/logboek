import { Image as ImageIcon, Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatDateRangeShort, formatNm } from '../format'
import { t } from '../i18n'
import { nameWithCounter } from '../model/counters'
import { routeOf } from '../model/trip-route'
import type { Trip } from '../model/types'
import { weekView } from '../model/weeks'
import { shareOrDownload } from '../share'
import type { Store } from '../storage/store'
import { boatLine } from './boat-line'
import { Icon } from './Icon'
import { RouteMap } from './LazyMap'
import { Sheet } from './Sheet'
import { useCollection } from './useCollection'
import { useCounters } from './useCounters'

// Trip delen als afbeelding (PNG, via het deelmenu of downloaden) of als PDF (printfunctie): de route op de kaart, de
// teller en naam, de periode, nm, dagen en de boot. Nooit namen van deelnemers en nooit bedragen. Alles wordt op het
// apparaat gemaakt; er gaat niets naar buiten tenzij Olivier zelf een app kiest (beveiligingsregel 2).

const W = 1080
const H = 1350
const PAD = 64
const MAP_TOP = 300
const MAP_H = 760

export interface TripCardInfo {
  title: string
  period: string
  stats: string
  boat: string
  /** OpenStreetMap-data in beeld: dan de naamsvermelding op de afbeelding (ODbL). */
  osm: boolean
}

/** Neemt de berekende stijl (vulling, lijn, letter) over als attributen, zodat de SVG ook los van app.css klopt. */
function inlineStyles(source: SVGSVGElement, target: SVGSVGElement): void {
  const from = [source, ...Array.from(source.querySelectorAll<SVGElement>('*'))]
  const to = [target, ...Array.from(target.querySelectorAll<SVGElement>('*'))]
  const props = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linejoin', 'stroke-linecap', 'opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'paint-order', 'display', 'visibility']
  from.forEach((el, i) => {
    const copy = to[i]
    if (!copy) return
    const style = getComputedStyle(el)
    for (const p of props) {
      const v = style.getPropertyValue(p)
      if (v) copy.setAttribute(p, v)
    }
    copy.removeAttribute('class')
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('afbeelding niet te laden'))
    img.src = url
  })
}

/** Tekst die niet breder mag dan `max`: kleiner maken tot hij past. */
function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, max: number): void {
  let s = size
  do {
    ctx.font = `${weight} ${s}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
    s -= 2
  } while (ctx.measureText(text).width > max && s > 18)
}

/** De kaart van de trip (een SVG in beeld) met de gegevens als PNG van 1080 × 1350. */
export async function tripCardPng(mapSvg: SVGSVGElement | null, info: TripCardInfo, dark: boolean): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas niet beschikbaar')
  const bg = dark ? '#0b1a2b' : '#f6f3ec'
  const text = dark ? '#e7edf3' : '#12263f'
  const muted = dark ? '#9cadbf' : '#5b6a7c'
  const accent = dark ? '#4cc3a6' : '#1a7f6e'
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = text
  fitText(ctx, info.title, 700, 64, W - 2 * PAD)
  ctx.fillText(info.title, PAD, 140)
  ctx.fillStyle = muted
  fitText(ctx, info.period, 500, 36, W - 2 * PAD)
  ctx.fillText(info.period, PAD, 200)
  if (mapSvg) {
    const copy = mapSvg.cloneNode(true) as SVGSVGElement
    inlineStyles(mapSvg, copy)
    const vb = mapSvg.viewBox.baseVal
    copy.setAttribute('width', String(W - 2 * PAD))
    copy.setAttribute('height', String(MAP_H))
    copy.setAttribute('preserveAspectRatio', 'xMidYMid slice')
    if (vb && vb.width > 0) copy.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`)
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
    try {
      const img = await loadImage(url)
      ctx.save()
      const r = 32
      const x = PAD
      const y = MAP_TOP
      const w = W - 2 * PAD
      ctx.beginPath()
      ctx.roundRect(x, y, w, MAP_H, r)
      ctx.clip()
      ctx.drawImage(img, x, y, w, MAP_H)
      ctx.restore()
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  if (info.osm) {
    ctx.fillStyle = muted
    ctx.font = `500 22px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
    const attribution = t('map.osmAttribution')
    ctx.fillText(attribution, W - PAD - ctx.measureText(attribution).width - 16, MAP_TOP + MAP_H - 18)
  }
  ctx.fillStyle = text
  fitText(ctx, info.stats, 700, 52, W - 2 * PAD)
  ctx.fillText(info.stats, PAD, MAP_TOP + MAP_H + 100)
  ctx.fillStyle = muted
  fitText(ctx, info.boat, 500, 34, W - 2 * PAD)
  ctx.fillText(info.boat, PAD, MAP_TOP + MAP_H + 160)
  ctx.fillStyle = accent
  ctx.font = `700 30px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
  ctx.fillText('Logboek', PAD, H - PAD)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('geen afbeelding'))), 'image/png'))
}

/** Blad "Trip delen": voorbeeld van de kaart, en delen als afbeelding of afdrukken als PDF. */
export function TripShareSheet({ store, trip, onClose }: { store: Store; trip: Trip; onClose: () => void }) {
  const legs = useCollection(store, 'legs.json.enc')
  const places = useCollection(store, 'places.json.enc')
  const counters = useCounters(store)
  const view = weekView(trip, legs)
  const route = routeOf(view.legs, places)
  const title = nameWithCounter(trip, counters.get(trip.id))
  const info: TripCardInfo = {
    title,
    period: view.startDate && view.endDate ? formatDateRangeShort(view.startDate, view.endDate) : '',
    stats: [formatNm(route.nm), t('unit.days', { n: route.days })].join(' · '),
    boat: boatLine(trip, view.boat),
    osm: false,
  }
  const preview = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [print, setPrint] = useState<string | null>(null)

  useEffect(() => {
    if (!print) return
    window.print()
  }, [print])
  useEffect(() => () => {
    if (print) URL.revokeObjectURL(print)
  }, [print])

  async function png(): Promise<Blob> {
    const svg = preview.current?.querySelector<SVGSVGElement>('.sea-map-canvas svg') ?? null
    const osm = !!preview.current?.querySelector('.map-attribution')
    return tripCardPng(svg, { ...info, osm }, window.matchMedia?.('(prefers-color-scheme: dark)').matches === true)
  }

  return (
    <Sheet title={t('tripShare.title')} onClose={onClose}>
      <div className="stack trip-share">
        <div className="card trip-share-card" ref={preview}>
          <strong className="trip-share-name">{info.title}</strong>
          {info.period && <span className="muted">{info.period}</span>}
          <RouteMap route={route} small />
          <span className="trip-share-stats">{info.stats}</span>
          {info.boat && <span className="muted">{info.boat}</span>}
        </div>
        <p className="muted small">{t('tripShare.hint')}</p>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const blob = await png()
              await shareOrDownload(new File([blob], `${t('tripShare.file')}.png`, { type: 'image/png' }), info.title)
            } finally {
              setBusy(false)
            }
          }}
        >
          <Icon icon={ImageIcon} />
          {t('tripShare.image')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const blob = await png()
              setPrint(URL.createObjectURL(blob))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Icon icon={Printer} />
          {t('tripShare.pdf')}
        </button>
      </div>
      {print &&
        createPortal(
          <div className="print-root trip-share-print">
            <img src={print} alt={info.title} />
          </div>,
          document.body,
        )}
    </Sheet>
  )
}
