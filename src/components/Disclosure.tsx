import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

/** Keep content mounted so collapsing a form never discards its draft. */
export function Disclosure({ title, meta, storageKey, defaultOpen = false, className = '', children }: {
  title: string; meta?: ReactNode; storageKey?: string; defaultOpen?: boolean; className?: string; children: ReactNode
}) {
  const [open, setOpen] = useState(() => {
    try { const saved = storageKey && localStorage.getItem('novelforge:disclosure:' + storageKey); if (saved === 'true' || saved === 'false') return saved === 'true' } catch { /* Optional preference. */ }
    return defaultOpen
  })
  return <details className={'disclosure ' + className} open={open} onToggle={event => {
    const next = event.currentTarget.open
    setOpen(next)
    if (storageKey) try { localStorage.setItem('novelforge:disclosure:' + storageKey, String(next)) } catch { /* Optional preference. */ }
  }}><summary><ChevronRight size={13} /><span>{title}</span>{meta !== undefined ? <small>{meta}</small> : null}</summary><div className="disclosure-body">{children}</div></details>
}
