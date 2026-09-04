import { useState } from 'react'
import { Copy, Heart, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from 'lucide-react'
import {
  categoryEntityKind, generateNames, NAME_CATEGORIES, NAME_CATEGORY_LABELS, NAME_STYLES,
  readFavoriteNames, toggleFavoriteName, writeFavoriteNames,
} from '../lib/name-generator'
import type { FavoriteName, NameCategory, NameStyle } from '../lib/name-generator'
import { useAppStore } from '../stores/app-store'
import { Button, IconButton, TextInput } from './ui'

export function NameGenerator() {
  const projectPath = useAppStore((state) => state.projectPath)
  const saveEntity = useAppStore((state) => state.saveEntity)
  const selectEntity = useAppStore((state) => state.selectEntity)
  const setError = useAppStore((state) => state.setError)
  const [category, setCategory] = useState<NameCategory>('character')
  const [style, setStyle] = useState<NameStyle>('中文现代')
  const [count, setCount] = useState('6')
  const [names, setNames] = useState<string[]>([])
  const [favorites, setFavorites] = useState<FavoriteName[]>(() => readFavoriteNames())
  const [busy, setBusy] = useState(false)

  function generate() {
    setNames((previousNames) => generateNames(category, Number(count) || 6, style, { previousNames }))
  }

  function favorite(name: string) {
    const next = toggleFavoriteName(favorites, { name, category, style, createdAt: new Date().toISOString() })
    setFavorites(next)
    writeFavoriteNames(next)
  }

  async function create(name: string) {
    if (!projectPath) return
    setBusy(true)
    try {
      const kind = categoryEntityKind(category)
      await saveEntity({
        projectPath, kind, id: null, title: name,
        content: { summary: '由 NovelForge 本地规则生成，可继续编辑。', category: NAME_CATEGORY_LABELS[category], style },
        tags: ['待完善', NAME_CATEGORY_LABELS[category]],
      })
      selectEntity(kind)
    } catch (error) { setError(error) } finally { setBusy(false) }
  }

  return <div className="name-generator">
    <div className="panel-title"><h3>名字生成器</h3><Wand2 size={14} color="var(--accent)" /></div>
    <div className="name-generator-controls"><select className="select-input" value={category} onChange={(event) => setCategory(event.target.value as NameCategory)} aria-label="名字类型">{NAME_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><select className="select-input" value={style} onChange={(event) => setStyle(event.target.value as NameStyle)} aria-label="名字风格">{NAME_STYLES.map((item) => <option key={item} value={item}>{item}</option>)}</select><TextInput type="number" min="1" max="30" value={count} onChange={(event) => setCount(event.target.value)} aria-label="生成数量" /><Button variant="outline" onClick={generate}><Sparkles size={13} />生成</Button></div>
    {names.length ? <div className="name-suggestions">{names.map((name) => { const isFavorite = favorites.some((item) => item.name === name && item.category === category && item.style === style); return <div className="name-suggestion" key={name}><span>{name}</span><span><IconButton icon={Copy} label={'复制' + name} onClick={() => void navigator.clipboard?.writeText(name)} /><IconButton icon={Heart} label={isFavorite ? '取消收藏' + name : '收藏' + name} className={isFavorite ? 'active' : ''} onClick={() => favorite(name)} /><button className="name-create" disabled={busy} onClick={() => void create(name)}><Plus size={11} />建档</button></span></div> })}</div> : <span className="field-hint" style={{ display: 'block', marginTop: 8 }}>本地规则生成，不需要 API Key；可批量生成、复制、收藏或直接建档。</span>}
    <div className="name-generator-footer"><Button variant="ghost" onClick={generate}><RefreshCw size={12} />重新生成</Button>{favorites.length ? <span><Heart size={11} />已收藏 {favorites.length} 个</span> : null}<Button variant="ghost" disabled={!favorites.length} onClick={() => { setFavorites([]); writeFavoriteNames([]) }}><Trash2 size={12} />清空收藏</Button></div>
  </div>
}
