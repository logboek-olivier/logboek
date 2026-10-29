import { Check } from 'lucide-react'
import { useEffect } from 'react'
import { Icon } from './Icon'

/** Zo lang blijft "Verwijderd · Ongedaan maken" staan. */
export const UNDO_MS = 10_000

export interface ToastMessage {
  text: string
  /** Bijvoorbeeld "Ongedaan maken"; de melding blijft dan 10 seconden staan. */
  action?: { label: string; run: () => void }
  /** Telt op bij elke melding, zodat dezelfde tekst twee keer na elkaar opnieuw verschijnt. */
  id: number
}

/** Korte bevestiging onderaan; verdwijnt vanzelf (2,5 seconden, met ongedaan maken 10 seconden). */
export function Toast({ message, onDone }: { message: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDone, message.action ? UNDO_MS : 2500)
    return () => clearTimeout(timer)
  }, [message, onDone])
  if (!message) return null
  return (
    <div className="toast" role="status">
      <Icon icon={Check} />
      <span>{message.text}</span>
      {message.action && (
        <button
          className="toast-action"
          onClick={() => {
            message.action?.run()
            onDone()
          }}
        >
          {message.action.label}
        </button>
      )}
    </div>
  )
}
