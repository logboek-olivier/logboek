import { LoaderCircle } from 'lucide-react'
import { Icon } from './Icon'
import { t } from '../i18n'

export function Loading({ text = t('common.opening') }: { text?: string }) {
  return (
    <main className="app">
      <div className="loading" role="status">
        <Icon icon={LoaderCircle} className="spin" />
        <span>{text}</span>
      </div>
    </main>
  )
}
