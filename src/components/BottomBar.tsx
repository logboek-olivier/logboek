import { Plus, Sailboat, Settings, Sun, Wallet, type LucideIcon } from 'lucide-react'
import { Icon } from './Icon'

export type Tab = 'vandaag' | 'zeilen' | 'toevoegen' | 'geld' | 'instellingen'

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'vandaag', label: 'Vandaag', icon: Sun },
  { id: 'zeilen', label: 'Zeilen', icon: Sailboat },
  { id: 'toevoegen', label: 'Toevoegen', icon: Plus },
  { id: 'geld', label: 'Geld', icon: Wallet },
  { id: 'instellingen', label: 'Instellingen', icon: Settings },
]

/** Vijf gelijke vakken; + in het midden als ronde knop. Raakvlak per vak minstens 48 px. */
export function BottomBar({ active, onSelect }: { active: Tab; onSelect: (tab: Tab) => void }) {
  return (
    <nav className="bottom-bar" aria-label="Hoofdnavigatie">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tab${t.id === active ? ' active' : ''}${t.id === 'toevoegen' ? ' add' : ''}`}
          aria-current={t.id === active ? 'page' : undefined}
          aria-label={t.label}
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
                {t.label}
              </span>
            </>
          )}
        </button>
      ))}
    </nav>
  )
}
