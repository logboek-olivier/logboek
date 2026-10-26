import { LoaderCircle } from 'lucide-react'
import { Icon } from './Icon'

export function Loading({ text = 'Logboek openen…' }: { text?: string }) {
  return (
    <main className="app">
      <div className="loading" role="status">
        <Icon icon={LoaderCircle} className="spin" />
        <span>{text}</span>
      </div>
    </main>
  )
}
