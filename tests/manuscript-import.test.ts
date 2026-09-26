import { describe, expect, it } from 'vitest'
import { decodeManuscript, detectImportBoundaries, splitManuscript, validateImportChapters } from '../src/lib/manuscript-import'

describe('manuscript import preview', () => {
  it('decodes UTF-8 and UTF-16 BOMs without replacement or inconsistent overrides', () => {
    expect(decodeManuscript(new TextEncoder().encode('第一章\r\n正文🌙'))).toEqual({ text: '第一章\r\n正文🌙', encoding: 'utf-8' })
    expect(decodeManuscript(Uint8Array.from([0xff, 0xfe, 0x2d, 0x4e]))).toEqual({ text: '中', encoding: 'utf-16le' })
    expect(decodeManuscript(Uint8Array.from([0xfe, 0xff, 0x4e, 0x2d]))).toEqual({ text: '中', encoding: 'utf-16be' })
    expect(() => decodeManuscript(Uint8Array.from([0xff, 0xfe, 0x2d, 0x4e]), 'utf-8')).toThrow('BOM')
    expect(() => decodeManuscript(Uint8Array.from([0xff, 0xfe, 0x2d]))).toThrow('解码')
  })
  it('requires explicit legacy encoding and rejects binary or empty input', () => {
    const gb = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4])
    expect(() => decodeManuscript(gb)).toThrow('解码')
    expect(decodeManuscript(gb, 'gb18030').text).toBe('中文')
    expect(() => decodeManuscript(Uint8Array.from([65, 0, 66]))).toThrow('控制字符')
    expect(() => decodeManuscript(new Uint8Array())).toThrow('为空')
  })
  it('skips metadata, fenced code, quotes and indented code', () => {
    const text = '---\n# metadata\n---\n前言\n```md\n# fake\n```\n    # code\n> # quote\n# 第一章 初见\r\n正文\r\n第二章 相逢\n正文\nChapter 3: End\n正文'
    const boundaries = detectImportBoundaries(text)
    expect(boundaries.map(item => item.title)).toEqual(['第一章 初见', '第二章 相逢', 'Chapter 3: End'])
    const chapters = splitManuscript(text, boundaries, '原稿')
    expect(chapters[0].title).toBe('原稿 · 开篇')
    expect(chapters.map(item => item.content).join('')).toBe(text)
  })
  it('supports selected and manually inserted line boundaries without losing text', () => {
    const text = '第一章 开始\n正文🌙\n第二章 继续\n后文\n自定义分章\n结尾'
    const found = detectImportBoundaries(text)
    const merged = splitManuscript(text, [found[0]], '稿件')
    expect(merged).toEqual([{ title: '第一章 开始', content: text }])
    const manual = splitManuscript(text, [...found, { offset: text.indexOf('自定义'), line: 5, title: '自定义章' }], '稿件')
    expect(manual).toHaveLength(3)
    expect(manual.map(item => item.content).join('')).toBe(text)
    expect(splitManuscript(text, [], '整本')[0].content).toBe(text)
    expect(() => splitManuscript(text, [found[0], found[0]], '稿件')).toThrow('分章位置')
    expect(() => splitManuscript(text, [{ offset: 2, line: 1, title: '错误' }], '稿件')).toThrow('分章位置')
  })
  it('blocks existing and preview title collisions before creation', () => {
    expect(() => validateImportChapters([{ title: ' 新章 ', content: '正文' }], ['新章'])).toThrow('同名')
    expect(() => validateImportChapters([{ title: '新章', content: '甲' }, { title: '新章', content: '乙' }], [])).toThrow('同名')
    expect(() => validateImportChapters([{ title: '', content: '正文' }], [])).toThrow('名称')
    expect(() => validateImportChapters([{ title: '新章', content: '正文' }], ['第一章'])).not.toThrow()
  })
})
