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

const GIVEN = ['清', '明', '月', '昭', '宁', '川', '景', '若', '云', '星', '岚', '舟', '言', '秋', '棠', '远', '辞', '微', '安', '澜']
const SURNAMES = ['林', '沈', '顾', '谢', '陆', '苏', '秦', '周', '江', '白', '楚', '叶', '许', '温', '沈']
const PLACES = ['雾港', '长安', '镜湖', '青崖', '归墟', '白石城', '星落原', '南烛镇', '临川', '沉舟渡']
const ORGANIZATIONS = ['观星局', '听潮司', '赤霄盟', '灰塔', '北境商会', '归藏院', '夜行者']
const JAPANESE = ['苍井', '神谷', '月岛', '白石', '高桥', '秋山', '桐生', '藤原']
const WESTERN = ['Alden', 'Mira', 'Rowan', 'Elian', 'Clara', 'Orion', 'Nora', 'Silas']
const FANTASY = ['艾尔', '塞拉', '诺瓦', '伊芙', '阿斯特', '维恩', '莱恩', '奥菲']
const SCIENCE = ['赫利俄斯', '天穹', '曙光', '远征', '银湾', '极星', '深空', '新纪元']

export interface FavoriteName {
  name: string
  category: NameCategory
  style: NameStyle
  createdAt: string
}

const FAVORITES_STORAGE_KEY = 'novelforge:name-favorites:v1'

function safeCount(count: number) {
  return Math.min(30, Math.max(1, Math.round(Number.isFinite(count) ? count : 6)))
}

function chineseCharacter(index: number, style: NameStyle) {
  const surname = SURNAMES[index % SURNAMES.length]
  const first = GIVEN[(index * 3 + (style === '仙侠' ? 5 : 0)) % GIVEN.length]
  const second = GIVEN[(index * 5 + 1 + (style === '武侠' ? 2 : 0)) % GIVEN.length]
  return style === '仙侠' ? '玄' + first + second : surname + first + second
}

function categoryName(category: NameCategory, index: number, style: NameStyle) {
  if (category === 'character') {
    if (['日式', '欧美', '西方奇幻'].includes(style)) {
      const pool = style === '日式' ? JAPANESE : style === '欧美' ? WESTERN : FANTASY
      return pool[index % pool.length] + (index >= pool.length ? String(index + 1) : '')
    }
    return chineseCharacter(index, style)
  }
  if (category === 'location' || category === 'city') {
    if (style === '科幻') return SCIENCE[index % SCIENCE.length] + (category === 'city' ? '城' : '站')
    if (style === '日式') return JAPANESE[index % JAPANESE.length] + (category === 'city' ? '町' : '境')
    if (style === '欧美') return WESTERN[index % WESTERN.length] + (category === 'city' ? ' City' : ' Land')
    if (style === '西方奇幻') return FANTASY[index % FANTASY.length] + (category === 'city' ? '城' : '境')
    return PLACES[index % PLACES.length] + (category === 'city' ? '城' : '')
  }
  if (category === 'country') {
    if (style === '科幻') return SCIENCE[index % SCIENCE.length] + '联邦'
    if (style === '欧美') return WESTERN[index % WESTERN.length] + 'ia'
    if (style === '西方奇幻') return FANTASY[index % FANTASY.length] + '王国'
    return ['北境', '东陆', '南曜', '西岚', '苍梧', '云州'][index % 6] + '国'
  }
  if (category === 'organization' || category === 'company') {
    if (style === '科幻') return SCIENCE[index % SCIENCE.length] + (category === 'company' ? '科技' : '舰队')
    if (style === '欧美') return WESTERN[index % WESTERN.length] + (category === 'company' ? ' Labs' : ' Guild')
    return ORGANIZATIONS[index % ORGANIZATIONS.length] + (category === 'company' ? '实业' : '')
  }
  if (category === 'ship') return (style === '科幻' ? SCIENCE[index % SCIENCE.length] : PLACES[index % PLACES.length]) + '号'
  if (category === 'planet') return (style === '科幻' ? SCIENCE[index % SCIENCE.length] : FANTASY[index % FANTASY.length]) + '星'
  if (category === 'weapon') return (style === '科幻' ? SCIENCE[index % SCIENCE.length] : GIVEN[index % GIVEN.length]) + (style === '武侠' || style === '仙侠' ? '刃' : '之刃')
  if (category === 'skill' || category === 'technique') return (style === '科幻' ? SCIENCE[index % SCIENCE.length] : GIVEN[index % GIVEN.length]) + (category === 'technique' ? '心法' : '术')
  return (style === '科幻' ? SCIENCE[index % SCIENCE.length] : GIVEN[index % GIVEN.length]) + '之' + (category === 'item' ? '物' : '器')
}

export function generateNames(category: NameCategory | EntityKind, count = 6, style: NameStyle = '中文现代') {
  const normalizedCategory = (category === 'world' ? 'organization' : category === 'foreshadowing' ? 'item' : category) as NameCategory
  const names: string[] = []
  for (let index = 0; index < safeCount(count); index += 1) {
    const candidate = categoryName(normalizedCategory, index, style)
    names.push(names.includes(candidate) ? candidate + (index + 1) : candidate)
  }
  return [...new Set(names)]
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
