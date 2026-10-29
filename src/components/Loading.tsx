import { LoaderCircle } from 'lucide-react'
import { Icon } from './Icon'
import { t } from '../i18n'

/** Laadscherm: hetzelfde anker als het opstartscherm (index.html), met wat er gebeurt eronder. */
export function Loading({ text = t('common.opening') }: { text?: string }) {
  return (
    <main className="app">
      <div className="loading" role="status">
        <img className="loading-icon" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="72" height="72" />
        <span className="loading-text">
          <Icon icon={LoaderCircle} className="spin" />
          {text}
        </span>
      </div>
    </main>
  )
}
