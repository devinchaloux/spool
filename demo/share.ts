import { THEMES, DEFAULT_THEME, type ThemeName } from '../src'

// ── Sharing a file by its address ──
// Spool keeps nothing on a server: a link or an embed only names a file that
// whoever shares it has put online. These helpers turn a pasted address into
// one the browser can read, and the page's settings into a link or an embed.

/** What a link or an embed carries besides the file: the look and the sounds. */
export interface ShareSettings {
  theme: ThemeName
  /** One color per part, as #rrggbb; empty for the defaults. */
  colors: string[]
  /** One sound id per part; empty for the sounds the file suggests. */
  sounds: string[]
}

/**
 * The address to fetch for a pasted one. A GitHub file page and a Dropbox
 * share link are pages about the file, not the file, and neither lets another
 * site read it; each has a raw address that does.
 */
export function fileUrl(address: string): string {
  let url: URL
  try { url = new URL(address.trim()) } catch { return address.trim() }
  // github.com/<owner>/<repo>/blob/<ref>/<path> → raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
  const blob = url.hostname === 'github.com' && url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`
  if (url.hostname === 'www.dropbox.com' || url.hostname === 'dropbox.com') {
    url.hostname = 'dl.dropboxusercontent.com'
    url.searchParams.delete('dl')
    return url.toString()
  }
  return url.toString()
}

/** A file's name from its address, for the page and the embed's title. */
export function fileNameOf(address: string): string {
  try {
    const last = new URL(address).pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : address
  } catch { return address }
}

export async function fetchMei(address: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(fileUrl(address))
  } catch {
    // A network error and a host that won't let other sites read the file look
    // the same from here.
    throw new Error("Couldn't read the file at this address. Check that it's shared publicly.")
  }
  if (!res.ok) throw new Error(`Couldn't read the file at this address (error ${res.status}).`)
  return res.text()
}

// ── Links and embeds ──

const HEX = /^#?([0-9a-f]{6})$/i

// The query for a file and its settings. Commas stay readable: they separate
// one value per part, and a query may carry them as they are.
function query(address: string, s: ShareSettings): string {
  const params = new URLSearchParams({ src: address })
  if (s.theme !== DEFAULT_THEME) params.set('theme', s.theme)
  if (s.colors.length) params.set('colors', s.colors.map((c) => c.replace('#', '')).join(','))
  if (s.sounds.length) params.set('sounds', s.sounds.join(','))
  return params.toString().replace(/%2C/gi, ',')
}

/** A link that opens the file in Spool, set up as it is now. */
export function shareLink(origin: string, address: string, s: ShareSettings): string {
  return `${origin}/?${query(address, s)}`
}

/** The small player for a web page, as an iframe to paste. */
export function embedCode(origin: string, address: string, title: string, s: ShareSettings): string {
  const src = `${origin}/embed?${query(address, s)}`
  const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return `<iframe src="${attr(src)}" title="${attr(title)}" width="100%" height="340" style="border: 0; border-radius: 10px"></iframe>`
}

/** Reads what a link or an embed's address carries. Unknown values are ignored. */
export function readParams(search: string): { src: string | null } & ShareSettings {
  const p = new URLSearchParams(search)
  const theme = p.get('theme')
  const list = (key: string) => (p.get(key) ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  return {
    src: p.get('src'),
    theme: theme && theme in THEMES ? (theme as ThemeName) : DEFAULT_THEME,
    colors: list('colors').flatMap((c) => { const m = c.match(HEX); return m ? [`#${m[1].toLowerCase()}`] : [] }),
    sounds: list('sounds'),
  }
}
