import { Pencil, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'
import { onBack } from '../back'
import { t } from '../i18n'

// Onderblad: schuift van onderen in, met een donkere laag erachter. Escape, de sluitknop of tikken op de laag sluit.

// Bladen kunnen genest zijn (een dag in het tripoverzicht): Escape sluit alleen het bovenste, en `sheet-open` blijft
// staan tot het laatste blad dicht is.
const openSheets: object[] = []

/**
 * `onEdit`: een leesweergave. Rechtsboven dan een potloodknop naar het bewerkscherm (verwijderen zit pas daar); zo
 * opent tikken op iets altijd eerst de weergave en verandert er niets per ongeluk.
 */
export function Sheet({ title, onClose, onEdit, children }: { title: string; onClose: () => void; onEdit?: () => void; children: ReactNode }) {
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

  return (
    <div className="sheet-layer">
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
        <header className="sheet-header">
          <h2>{title}</h2>
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
}
