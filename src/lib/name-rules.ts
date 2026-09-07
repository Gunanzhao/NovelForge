import type { NameCategory, NameStyle } from './name-generator'

export interface NameRules {
  surname?: string
  length?: number
  required?: string
  excluded?: string
  suffix?: string
  series?: 'none' | 'family' | 'shared'
  shared?: string
  surnames?: string[]
  roots?: string[]
  banned?: string[]
  avoidNames?: readonly string[]
}

export const splitNameWords = (text: string) => [...new Set(text.split(/[\s,，、;；]+/u).map(word => word.trim()).filter(Boolean))]
const surnames = splitNameWords('林 沈 顾 谢 陆 苏 秦 周 江 白 楚 叶 许 温 陈 李 张 王 刘 赵 孙 杨 吴 郑 冯 韩 唐 宋 萧 程 方 傅 夏 钟 杜 孟 袁 何 乔 梁')
const roots: Record<NameStyle, string[]> = {
  中文现代: splitNameWords('安 宁 晨 嘉 思 亦 知 远 乐 明 予 舒 文 佳 以 可 立 语 心 允 向 博 维 卓 天 雨 欣 书 子 言'),
  中文古风: splitNameWords('清 昭 怀 若 云 景 岚 舟 秋 棠 辞 微 澜 月 照 疏 碧 溪 晚 望 南 寄 吟 墨 知 松 竹 鹤 弦 砚'),
  武侠: splitNameWords('凌 岳 铁 寒 峰 远 风 啸 孤 惊 云 行 霜 断 沧 逐 飞 傲 松 石 归 烈 长 鹤 追 破 剑 影 绝 锋'),
  仙侠: splitNameWords('玄 灵 青 太 玉 紫 碧 清 霄 瑶 洛 乾 元 虚 归 辰 曦 渊 司 羽 云 霜 月 星 隐 尘 苍 仙 望 凝'),
  日式: splitNameWords('春 夏 秋 冬 晴 雪 月 星 海 空 青 花 光 风 雨 朝 夕 千 白 森'),
  欧美: splitNameWords('Alden Mira Rowan Elian Clara Orion Nora Silas Elena Arthur Felix Iris Theo Ada Julian Lyra Hugo Alice Oscar Vera'),
  西方奇幻: splitNameWords('艾尔 塞拉 诺瓦 伊芙 阿斯特 维恩 莱恩 奥菲 瑟兰 洛恩 维拉 泰尔 卡拉 米瑞 奥伦 伊瑟 塔林 凯尔 希尔 阿兰'),
  科幻: splitNameWords('赫利俄斯 天穹 曙光 远征 银湾 极星 深空 新纪元 织女 猎户 天狼 光帆 黎明 回声 星环 脉冲 边界 引力 量子 零点'),
}
const westernSurnames = splitNameWords('Bennett Hayes Morgan Reed Ward Brooks Clarke Foster Gray Hart Lane Moore Parker Quinn Shaw Stone West Wood Bell Wells')
const japaneseSurnames = splitNameWords('苍井 神谷 月岛 白石 高桥 秋山 桐生 藤原 小林 山崎 中原 北川 水野 远山')
const japaneseGiven = splitNameWords('遥 凛 葵 莲 直树 真琴 和也 美咲 阳菜 翔太 结衣 千寻 琴音 悠人 明里 夏树')
const tails: Record<NameCategory, string[]> = {
  character: [], location: ['谷', '港', '岭', '原', '湖', '渡', '湾', '山'], city: ['城', '镇', '都', '府'],
  country: ['国', '王朝', '王国', '联邦'], organization: ['会', '盟', '局', '院', '司', '社'], company: ['科技', '实业', '传媒', '集团'],
  item: ['玉', '镜', '印', '珠', '匣', '卷'], weapon: ['剑', '刀', '枪', '弓', '戟', '刃'], skill: ['诀', '步', '式', '术', '掌', '指'],
  technique: ['心经', '真经', '心法', '法典', '秘录', '诀'], ship: ['号'], planet: ['星'],
}
const englishTails: Record<NameCategory, string[]> = {
  character: [], location: ['Vale', 'Bay', 'Ridge'], city: ['City', 'Town'], country: ['Kingdom', 'Republic'], organization: ['Order', 'Guild'],
  company: ['Labs', 'Works'], item: ['Relic', 'Seal'], weapon: ['Blade', 'Spear'], skill: ['Strike', 'Step'], technique: ['Codex', 'Art'], ship: ['Voyager', 'Runner'], planet: ['Prime', 'Terra'],
}

export function matchesNameRules(name: string, rules: NameRules): boolean {
  const normalized = name.trim().normalize('NFKC').toLocaleLowerCase()
  return Boolean(name.trim()) && (!rules.length || Array.from(name).length === rules.length)
    && (!rules.required || name.includes(rules.required.trim()))
    && (!rules.suffix || name.endsWith(rules.suffix.trim()))
    && !Array.from((rules.excluded ?? '').replace(/\s/gu, '')).some(char => name.includes(char))
    && !(rules.banned ?? []).some(word => word.trim() && normalized.includes(word.trim().normalize('NFKC').toLocaleLowerCase()))
    && !(rules.avoidNames ?? []).some(word => word.trim().normalize('NFKC').toLocaleLowerCase() === normalized)
}

// Exhaust a finite, natural combination pool. Never invent numbered fillers when constraints are too strict.
export function ruleCandidates(category: NameCategory, style: NameStyle, rules: NameRules): string[] {
  const pool = rules.roots?.length ? rules.roots : roots[style]
  const family = rules.surname?.trim() ? [rules.surname.trim()] : rules.surnames?.length ? rules.surnames : style === '日式' ? japaneseSurnames : style === '欧美' ? westernSurnames : surnames
  const shared = rules.shared?.trim() ?? ''
  const candidates = new Set<string>()
  const add = (value: string) => { if (matchesNameRules(value, rules)) candidates.add(value) }
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = 0; j < pool.length; j += 1) {
      if (category === 'character') {
        for (const surname of family) {
          const familyName = rules.series === 'family' ? family[0] : surname
          if (style === '欧美') {
            add([rules.required || pool[i], rules.series === 'family' ? shared : '', familyName].filter(Boolean).join(' '))
          } else if (style === '日式') {
            add(familyName + (rules.series === 'family' ? shared : '') + (rules.required || (rules.roots?.length ? pool[j] : japaneseGiven[j % japaneseGiven.length])))
          } else if (style === '西方奇幻' && !rules.surname) {
            add((rules.series === 'shared' ? shared : '') + (rules.required || pool[i]) + pool[j])
          } else {
            const prefix = familyName + (rules.series === 'family' || rules.series === 'shared' ? shared : '')
            const stem = rules.required?.trim() || pool[i]
            add(prefix + stem)
            add(prefix + stem + pool[j])
          }
        }
      } else {
        let endings = style === '欧美' ? englishTails[category] : tails[category]
        if (style === '武侠' || style === '仙侠') {
          if (category === 'organization') endings = ['宗', '门', '阁', '庄', '盟', '宫']
        } else if (style === '科幻') {
          if (category === 'organization') endings = ['舰队', '联合体', '研究院']
          if (category === 'location') endings = ['空间站', '星域', '基地']
          if (category === 'weapon') endings = ['脉冲炮', '光刃', '粒子枪']
        }
        if (rules.suffix?.trim()) endings = [rules.suffix.trim()]
        for (const ending of endings) {
          const prefix = rules.series === 'shared' ? shared : ''
          const first = rules.required?.trim() || pool[i]
          const join = style === '欧美' ? ' ' : ''
          const stem = [prefix, first, pool[j]].filter(Boolean).join(join)
          add(stem.endsWith(ending) ? stem : stem + join + ending)
          const short = [prefix, first].filter(Boolean).join(join)
          add(short.endsWith(ending) ? short : short + join + ending)
        }
      }
    }
  }
  return [...candidates]
}
