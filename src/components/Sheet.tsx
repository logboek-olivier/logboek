import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'
import { t } from '../i18n'

// Onderblad: schuift van onderen in, met een donkere laag erachter. Escape, de sluitknop of tikken op de laag sluit.

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.classList.add('sheet-open')
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('sheet-open')
      previous?.focus()
    }
  }, [])

  return (
    <div className="sheet-layer">
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
        <header className="sheet-header">
          <h2>{title}</h2>
          <button type="button" className="btn icon" aria-label={t('common.close')} onClick={onClose}>
            <Icon icon={X} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
