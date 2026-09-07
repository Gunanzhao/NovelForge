import { NAME_CATEGORIES, NAME_STYLES, type NameCategory, type NameStyle } from './name-generator'
import type { NameRules } from './name-rules'

export interface NameCandidate { name: string; category: NameCategory; style: NameStyle; explanation?: string }
export interface NameBatch { id: string; createdAt: string; items: NameCandidate[] }
export interface NamePreset { id: string; title: string; category: NameCategory; style: NameStyle; rules: NameRules }
export interface NameWorkspace { history: NameBatch[]; presets: NamePreset[]; surnames: string[]; roots: string[]; banned: string[] }
const validCategory = (value: unknown): value is NameCategory => NAME_CATEGORIES.some(item => item.id === value)
const validStyle = (value: unknown): value is NameStyle => NAME_STYLES.includes(value as NameStyle)
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
const words = (value: unknown) => Array.isArray(value) ? value.filter((word): word is string => typeof word === 'string' && !!word.trim()).map(word => word.trim().slice(0, 40)).slice(0, 80) : []
export const nameKey = (name: string) => name.trim().normalize('NFKC').toLocaleLowerCase()
export function validCandidate(value: unknown): value is NameCandidate {
  return object(value) && typeof value.name === 'string' && !!value.name.trim() && value.name.length <= 100 && validCategory(value.category) && validStyle(value.style)
}
export function sanitizeRules(value: unknown): NameRules {
  if (!object(value)) return {}
  const result: NameRules = {}
  for (const key of ['surname', 'required', 'excluded', 'suffix', 'shared'] as const) if (typeof value[key] === 'string') result[key] = value[key].slice(0, 40)
  if (typeof value.length === 'number' && value.length >= 1 && value.length <= 60) result.length = Math.round(value.length)
  if (value.series === 'none' || value.series === 'family' || value.series === 'shared') result.series = value.series
  return result
}
export function readNameWorkspace(projectPath: string): NameWorkspace {
  const empty: NameWorkspace = { history: [], presets: [], surnames: [], roots: [], banned: [] }
  try {
    const value: unknown = JSON.parse(localStorage.getItem('novelforge:name-workspace:v1:' + projectPath) ?? '{}')
    if (!object(value)) return empty
    empty.surnames = words(value.surnames); empty.roots = words(value.roots); empty.banned = words(value.banned)
    if (Array.isArray(value.history)) empty.history = value.history.filter(item => object(item) && typeof item.id === 'string' && typeof item.createdAt === 'string' && Array.isArray(item.items)).slice(0, 50).map(item => ({ id: item.id, createdAt: item.createdAt, items: item.items.filter(validCandidate).slice(0, 30) }))
    if (Array.isArray(value.presets)) empty.presets = value.presets.filter(item => object(item) && typeof item.id === 'string' && typeof item.title === 'string' && validCategory(item.category) && validStyle(item.style)).slice(0, 20).map(item => ({ id: item.id, title: item.title.slice(0, 80), category: item.category, style: item.style, rules: sanitizeRules(item.rules) }))
  } catch { /* Recover optional naming preferences without affecting manuscript data. */ }
  return empty
}
export function writeNameWorkspace(projectPath: string, value: NameWorkspace) {
  localStorage.setItem('novelforge:name-workspace:v1:' + projectPath, JSON.stringify(value))
}
export function parseAiNames(content: string, category: NameCategory, style: NameStyle): NameCandidate[] {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
  const parsed: unknown = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) throw new Error('AI 返回格式不正确，请重新生成。')
  const seen = new Set<string>()
  return parsed.filter(item => object(item) && typeof item.name === 'string' && item.name.trim() && item.name.length <= 100).map(item => ({ name: item.name.trim(), explanation: typeof item.explanation === 'string' ? item.explanation.slice(0, 600) : '', category, style })).filter(item => {
    const key = nameKey(item.name)
    if (seen.has(key)) return false
    seen.add(key); return true
  }).slice(0, 30)
}
