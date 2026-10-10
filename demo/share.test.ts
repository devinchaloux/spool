import { describe, expect, it } from 'vitest'
import { embedCode, fileNameOf, fileUrl, readParams, shareLink } from './share'

describe('fileUrl', () => {
  it('turns a GitHub file page into its raw address', () => {
    expect(fileUrl('https://github.com/o/r/blob/main/music/a b.mei')).toBe('https://raw.githubusercontent.com/o/r/main/music/a%20b.mei')
  })
  it('turns a Dropbox share link into its download address', () => {
    expect(fileUrl('https://www.dropbox.com/scl/fi/x/song.mei?rlkey=k&dl=0')).toBe('https://dl.dropboxusercontent.com/scl/fi/x/song.mei?rlkey=k')
  })
  it('leaves any other address as it is', () => {
    expect(fileUrl(' https://example.org/a.mei ')).toBe('https://example.org/a.mei')
  })
})

describe('links and embeds', () => {
  const s = { theme: 'paper' as const, colors: ['#FF5CA0', '#4aa8ff'], sounds: ['piano', 'acid-bass'] }

  it('round-trips the settings through a link', () => {
    const link = shareLink('https://spool.example', 'https://example.org/a.mei', s)
    const back = readParams(new URL(link).search)
    expect(back).toEqual({ src: 'https://example.org/a.mei', theme: 'paper', colors: ['#ff5ca0', '#4aa8ff'], sounds: ['piano', 'acid-bass'] })
  })

  it('leaves defaults out of the link', () => {
    expect(shareLink('https://spool.example', 'https://example.org/a.mei', { theme: 'studio', colors: [], sounds: [] }))
      .toBe('https://spool.example/?src=https%3A%2F%2Fexample.org%2Fa.mei')
  })

  it('escapes the embed code', () => {
    const code = embedCode('https://spool.example', 'https://example.org/a.mei', 'A "quoted" title', s)
    expect(code).toContain('src="https://spool.example/embed?src=https%3A%2F%2Fexample.org%2Fa.mei&amp;theme=paper')
    expect(code).toContain('title="A &quot;quoted&quot; title"')
  })

  it('ignores values it does not know', () => {
    expect(readParams('?theme=nope&colors=red,123456')).toMatchObject({ src: null, theme: 'studio', colors: ['#123456'] })
  })

  it('names a file from its address', () => {
    expect(fileNameOf('https://example.org/music/Erlk%C3%B6nig.mei')).toBe('Erlkönig.mei')
  })
})
