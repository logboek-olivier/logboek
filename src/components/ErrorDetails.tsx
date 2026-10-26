import { Copy } from 'lucide-react'
import { useState } from 'react'
import { errorReport, lastError } from '../errors'
import { Icon } from './Icon'

/** Knop "Kopieer foutdetails" voor de laatst vastgelegde fout. Zonder klembord: de tekst verschijnt om te selecteren. */
export function CopyErrorDetails() {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const [text, setText] = useState('')

  async function copy() {
    const recorded = lastError()
    const report = recorded ? errorReport(recorded.error, recorded.screen, recorded.at) : errorReport(null, '-', new Date().toISOString())
    setText(report)
    try {
      await navigator.clipboard.writeText(report)
      setState('copied')
    } catch {
      setState('manual')
    }
  }

  return (
    <div className="error-details">
      <button type="button" className="btn link small" onClick={() => void copy()}>
        <Icon icon={Copy} />
        {state === 'copied' ? 'Gekopieerd' : 'Kopieer foutdetails'}
      </button>
      {state === 'manual' && (
        <textarea className="error-report" readOnly rows={8} value={text} aria-label="Foutdetails" onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  )
}
