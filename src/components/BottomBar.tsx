export type Tab = 'vandaag' | 'zeilen' | 'toevoegen' | 'geld'

export interface TabItem {
  id: Tab
  label: string
}

export function BottomBar({ tabs, active, onSelect }: { tabs: TabItem[]; active: Tab; onSelect: (tab: Tab) => void }) {
  return (
    <nav className="bottom-bar" aria-label="Hoofdnavigatie">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`tab${t.id === active ? ' active' : ''}${t.id === 'toevoegen' ? ' add' : ''}`}
          aria-current={t.id === active ? 'page' : undefined}
          aria-label={t.id === 'toevoegen' ? 'Toevoegen' : undefined}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
