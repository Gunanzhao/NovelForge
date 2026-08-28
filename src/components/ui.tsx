import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'

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

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-header"><div><p className="eyebrow">NOVELFORGE</p><h2>{title}</h2></div><IconButton icon={X} label="关闭" onClick={onClose} /></div>
      <div className="modal-body">{children}</div>
      {footer ? <div className="modal-footer">{footer}</div> : null}
    </div>
  </div>
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint ? <span className="field-hint">{hint}</span> : null}</label>
}
