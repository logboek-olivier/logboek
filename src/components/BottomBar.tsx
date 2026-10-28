import { CalendarDays, CalendarRange, CircleEllipsis, Plus, Sun, type LucideIcon } from 'lucide-react'
import { t, type MessageKey } from '../i18n'
import { Icon } from './Icon'

export type Tab = 'vandaag' | 'week' | 'toevoegen' | 'agenda' | 'meer'

const TABS: { id: Tab; label: MessageKey; icon: LucideIcon }[] = [
  { id: 'vandaag', label: 'nav.today', icon: Sun },
  { id: 'week', label: 'nav.week', icon: CalendarRange },
  { id: 'toevoegen', label: 'nav.add', icon: Plus },
  { id: 'agenda', label: 'nav.calendar', icon: CalendarDays },
  { id: 'meer', label: 'nav.more', icon: CircleEllipsis },
]

/**
 * Vijf gelijke vakken; + in het midden als ronde knop. Raakvlak per vak minstens 48 px.
 * `hidden`: vakken waarvan het scherm nog niet bestaat blijven leeg (geen "binnenkort"), zodat + in het midden blijft.
 */
export function BottomBar({ active, onSelect, hidden = [] }: { active: Tab; onSelect: (tab: Tab) => void; hidden?: Tab[] }) {
  return (
    <nav className="bottom-bar" aria-label={t('nav.main')}>
      {TABS.map((tab) =>
        hidden.includes(tab.id) ? (
          <span key={tab.id} aria-hidden="true" />
        ) : (
          <button
            key={tab.id}
            className={`tab${tab.id === active ? ' active' : ''}${tab.id === 'toevoegen' ? ' add' : ''}`}
            aria-current={tab.id === active ? 'page' : undefined}
            aria-label={t(tab.label)}
            onClick={() => onSelect(tab.id)}
          >
            {tab.id === 'toevoegen' ? (
              <span className="add-circle">
                <Icon icon={tab.icon} />
              </span>
            ) : (
              <>
                <Icon icon={tab.icon} />
                <span className="tab-label" aria-hidden="true">
                  {t(tab.label)}
                </span>
              </>
            )}
          </button>
        ),
      )}
    </nav>
  )
}
