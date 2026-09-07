import { ruleCandidates, type NameRules } from './name-rules'
import type { EntityKind } from './types'

export type NameCategory =
  | 'character' | 'location' | 'country' | 'city' | 'organization' | 'company'
  | 'item' | 'weapon' | 'skill' | 'technique' | 'ship' | 'planet'

export type NameStyle = '中文现代' | '中文古风' | '武侠' | '仙侠' | '日式' | '欧美' | '西方奇幻' | '科幻'

export const NAME_CATEGORIES: Array<{ id: NameCategory; label: string }> = [
  { id: 'character', label: '人物' }, { id: 'location', label: '地点' }, { id: 'country', label: '国家' },
  { id: 'city', label: '城市' }, { id: 'organization', label: '组织' }, { id: 'company', label: '公司' },
  { id: 'item', label: '物品' }, { id: 'weapon', label: '武器' }, { id: 'skill', label: '技能' },
  { id: 'technique', label: '功法' }, { id: 'ship', label: '舰船' }, { id: 'planet', label: '星球' },
]

export const NAME_STYLES: NameStyle[] = ['中文现代', '中文古风', '武侠', '仙侠', '日式', '欧美', '西方奇幻', '科幻']

export const NAME_CATEGORY_LABELS = Object.fromEntries(NAME_CATEGORIES.map((item) => [item.id, item.label])) as Record<NameCategory, string>

export interface FavoriteName {
  name: string
  category: NameCategory
  style: NameStyle
  createdAt: string
}

export interface GenerateNamesOptions extends NameRules {
  previousNames?: readonly string[]
  random?: () => number
}

const FAVORITES_STORAGE_KEY = 'novelforge:name-favorites:v1'

function safeCount(count: number) {
  return Math.min(30, Math.max(1, Math.round(Number.isFinite(count) ? count : 6)))
}

function shuffle<T>(values: readonly T[], random: () => number) {
  const shuffled = [...values]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const value = random()
    const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1 - Number.EPSILON) : 0
    const target = Math.floor(normalized * (index + 1))
    ;[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]
  }
  return shuffled
}

export function generateNames(
  category: NameCategory | EntityKind,
  count = 6,
  style: NameStyle = '中文现代',
  options: GenerateNamesOptions = {},
) {
  const normalizedCategory = (category === 'world' ? 'organization' : category === 'foreshadowing' ? 'item' : category) as NameCategory
  const requestedCount = safeCount(count)
  const excluded = new Set(options.previousNames ?? [])
  const candidates = shuffle(ruleCandidates(normalizedCategory, style, options), options.random ?? Math.random)
  return candidates.filter(name => !excluded.has(name)).slice(0, requestedCount)
}

export function categoryEntityKind(category: NameCategory): EntityKind {
  if (category === 'character') return 'character'
  if (category === 'location' || category === 'city' || category === 'country') return 'location'
  return 'world'
}

export function readFavoriteNames(): FavoriteName[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((item): item is FavoriteName => {
      if (!item || typeof item !== 'object') return false
      const value = item as Record<string, unknown>
      return typeof value.name === 'string' && typeof value.category === 'string' && typeof value.style === 'string' && typeof value.createdAt === 'string'
    }).slice(0, 100)
  } catch {
    return []
  }
}

export function writeFavoriteNames(favorites: FavoriteName[]) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites.slice(0, 100))) } catch { /* optional preference */ }
}

export function toggleFavoriteName(favorites: FavoriteName[], favorite: FavoriteName) {
  const exists = favorites.some((item) => item.name === favorite.name && item.category === favorite.category && item.style === favorite.style)
  return exists
    ? favorites.filter((item) => !(item.name === favorite.name && item.category === favorite.category && item.style === favorite.style))
    : [favorite, ...favorites].slice(0, 100)
}
