import { Pencil, X, ChevronLeft } from 'lucide-react'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { onBack } from '../back'
import { t } from '../i18n'

// Onderblad: schuift van onderen in, met een donkere laag erachter. Escape, de sluitknop of tikken op de laag sluit.

// Bladen kunnen genest zijn (een dag in het tripoverzicht): Escape sluit alleen het bovenste, en `sheet-open` blijft
// staan tot het laatste blad dicht is.
const openSheets: object[] = []

// Een blad wordt getekend in de bladlaag van zijn scherm (SheetHost), niet midden in het scherm dat het opende. Anders
// zat een blad met een eigen formulier ("Dag bewerken" vanuit Trip bewerken) in het formulier eronder: Opslaan
// verstuurde dan het buitenste formulier (door de CSP geblokkeerd) en er gebeurde niets. Zonder SheetHost (de eerste
// keer, ontgrendelen) staat het blad gewoon waar het geopend wordt.
const SheetHostContext = createContext<HTMLElement | null>(null)

/** De bladlaag van een scherm: bladen erbinnen komen hier, buiten elk formulier, en verbergen mee met het scherm. */
export function SheetHost({ children }: { children: ReactNode }) {
  const [layer] = useState(() => {
    const el = document.createElement('div')
    el.className = 'sheet-host'
    return el
  })
  const anchor = useRef<HTMLDivElement>(null)
  // Vóór de effecten van de bladen zelf (focus) in de pagina, zodat een blad dat meteen opent er al in staat.
  useLayoutEffect(() => {
    anchor.current?.appendChild(layer)
    return () => layer.remove()
  }, [layer])
  return (
    <SheetHostContext.Provider value={layer}>
      {children}
      <div ref={anchor} className="sheet-anchor" />
    </SheetHostContext.Provider>
  )
}

/**
 * `onEdit`: een leesweergave. Rechtsboven dan een potloodknop naar het bewerkscherm (verwijderen zit pas daar); zo
 * opent tikken op iets altijd eerst de weergave en verandert er niets per ongeluk.
 */
export function Sheet({
  title,
  onClose,
  onEdit,
  kicker,
  back,
  children,
}: {
  title: string
  onClose: () => void
  onEdit?: () => void
  /** Wat voor blad dit is ("Dag", "Trip"), klein boven de titel: zo is altijd duidelijk waar je staat. */
  kicker?: string
  /** Terug naar het blad waar je vandaan kwam (een trip die vanaf een dag geopend is: terug naar die dag). */
  back?: { label: string; onBack: () => void }
  children: ReactNode
}) {
  const host = useContext(SheetHostContext)
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const me = {}
    openSheets.push(me)
    document.body.classList.add('sheet-open')
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openSheets.at(-1) === me) close.current()
    }
    document.addEventListener('keydown', onKey)
    // De terugknop van Android sluit het bovenste blad (src/back.ts).
    const offBack = onBack(() => close.current())
    return () => {
      offBack()
      document.removeEventListener('keydown', onKey)
      openSheets.splice(openSheets.indexOf(me), 1)
      if (openSheets.length === 0) document.body.classList.remove('sheet-open')
      previous?.focus()
    }
  }, [])

  const layer = (
    // Opslaan in dit blad blijft in dit blad: een formulier van het scherm eronder krijgt het nooit (React laat
    // gebeurtenissen anders door de bladlaag heen naar boven gaan).
    <div className="sheet-layer" onSubmit={(e) => e.stopPropagation()}>
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
        {back && (
          <button type="button" className="btn link small sheet-back" onClick={back.onBack}>
            <Icon icon={ChevronLeft} />
            {back.label}
          </button>
        )}
        <header className="sheet-header">
          <h2>
            {kicker && <span className="sheet-kicker">{kicker}</span>}
            {title}
          </h2>
          {onEdit && (
            <button type="button" className="btn icon sheet-edit" aria-label={t('common.edit')} onClick={onEdit}>
              <Icon icon={Pencil} />
            </button>
          )}
          <button type="button" className="btn icon" aria-label={t('common.close')} onClick={onClose}>
            <Icon icon={X} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
  return host ? createPortal(layer, host) : layer
}
