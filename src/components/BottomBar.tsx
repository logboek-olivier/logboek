import { Plus, Sailboat, Settings, Sun, Wallet, type LucideIcon } from 'lucide-react'
import { Icon } from './Icon'
import { t as translateLabel, type MessageKey } from '../i18n'

export type Tab = 'vandaag' | 'zeilen' | 'toevoegen' | 'geld' | 'instellingen'

const TABS: { id: Tab; label: MessageKey; icon: LucideIcon }[] = [
  { id: 'vandaag', label: 'nav.today', icon: Sun },
  { id: 'zeilen', label: 'nav.sailing', icon: Sailboat },
  { id: 'toevoegen', label: 'nav.add', icon: Plus },
  { id: 'geld', label: 'nav.money', icon: Wallet },
  { id: 'instellingen', label: 'nav.settings', icon: Settings },
]

/** Vijf gelijke vakken; + in het midden als ronde knop. Raakvlak per vak minstens 48 px. */
export function BottomBar({ active, onSelect }: { active: Tab; onSelect: (tab: Tab) => void }) {
  return (
    <nav className="bottom-bar" aria-label={translateLabel('nav.main')}>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tab${t.id === active ? ' active' : ''}${t.id === 'toevoegen' ? ' add' : ''}`}
          aria-current={t.id === active ? 'page' : undefined}
          aria-label={translateLabel(t.label)}
          onClick={() => onSelect(t.id)}
        >
          {t.id === 'toevoegen' ? (
            <span className="add-circle">
              <Icon icon={t.icon} />
            </span>
          ) : (
            <>
              <Icon icon={t.icon} />
              <span className="tab-label" aria-hidden="true">
                {translateLabel(t.label)}
              </span>
            </>
          )}
        </button>
      ))}
    </nav>
  )
}
