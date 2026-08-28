import type { EntityKind } from './types'

const GIVEN = ['清', '明', '月', '昭', '宁', '川', '景', '若', '云', '星', '岚', '舟', '言', '秋', '棠', '远', '辞']
const SURNAMES = ['林', '沈', '顾', '谢', '陆', '苏', '秦', '周', '江', '白', '楚', '叶', '许', '温']
const PLACES = ['雾港', '长安', '镜湖', '青崖', '归墟', '白石城', '星落原', '南烛镇', '临川', '沉舟渡']
const ORGANIZATIONS = ['观星局', '听潮司', '赤霄盟', '灰塔', '北境商会', '归藏院', '夜行者']

export function generateNames(kind: EntityKind, count = 6) {
  const pool = kind === 'character'
    ? Array.from({ length: count }, (_, index) => SURNAMES[index % SURNAMES.length] + GIVEN[(index * 3) % GIVEN.length] + GIVEN[(index * 5 + 1) % GIVEN.length])
    : kind === 'location' ? PLACES.slice(0, count)
      : kind === 'world' ? ORGANIZATIONS.slice(0, count)
        : Array.from({ length: count }, (_, index) => '新' + GIVEN[index % GIVEN.length] + (kind === 'foreshadowing' ? '伏笔' : '条目'))
  return [...new Set(pool)]
}
