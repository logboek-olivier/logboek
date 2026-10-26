import { Check } from 'lucide-react'
import { useEffect } from 'react'
import { Icon } from './Icon'

/** Korte bevestiging onderaan; verdwijnt vanzelf. */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDone, 2500)
    return () => clearTimeout(timer)
  }, [message, onDone])
  if (!message) return null
  return (
    <div className="toast" role="status">
      <Icon icon={Check} />
      <span>{message}</span>
    </div>
  )
}
