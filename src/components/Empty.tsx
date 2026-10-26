import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

/** Lege toestand: icoon, korte uitnodiging en eventueel één knop. */
export function Empty({ icon, children, action }: { icon: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon icon={icon} />
      <p>{children}</p>
      {action}
    </div>
  )
}
