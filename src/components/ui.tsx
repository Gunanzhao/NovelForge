import { useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { cn, formatDate } from '../lib/utils'

export function Button({ className, variant = 'solid', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'solid' | 'ghost' | 'outline' | 'danger' }) {
  return <button className={cn('button', 'button-' + variant, className)} {...props} />
}

export function IconButton({ icon: Icon, label, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return <button className={cn('icon-button', className)} aria-label={label} title={label} {...props}><Icon size={16} strokeWidth={1.8} /></button>
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('text-input', className)} {...props} />
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={cn('panel', className)} {...props} />
}

export function RecordSaveStatus({ updatedAt, busy }: { updatedAt?: string; busy: boolean }) {
  return <span className="record-save-status" role="status">{busy ? '正在保存…' : updatedAt ? '上次保存 ' + formatDate(updatedAt) : '新条目，保存后加入项目'}</span>
}

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]')).filter(element => !element.closest('[hidden],[inert]'))
    if (!dialog.contains(document.activeElement)) (dialog.querySelector<HTMLElement>('.modal-body input,.modal-body textarea') ?? focusable()[0])?.focus()
    const key = (event: KeyboardEvent) => {
      if (dialog.closest('[hidden],[inert]') || Array.from(document.querySelectorAll('[role="dialog"]')).filter(item => !item.closest('[hidden],[inert]')).at(-1) !== dialog) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = focusable(), first = items[0], last = items.at(-1)
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus() }
  }, [open])
  if (!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={dialogRef} className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-header"><div><p className="eyebrow">NOVELFORGE</p><h2>{title}</h2></div><IconButton icon={X} label="关闭" onClick={onClose} /></div>
      <div className="modal-body">{children}</div>
      {footer ? <div className="modal-footer">{footer}</div> : null}
    </div>
  </div>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint ? <span className="field-hint">{hint}</span> : null}</label>
}
