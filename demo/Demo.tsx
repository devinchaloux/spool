import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { MeiPianoRoll, THEMES, NOTE_COLORS, noteColorFor, partColors, parseNative, rollToSvg, svgToPng, downloadBlob, type MeiScore, type ThemeName } from '../src'
import { EXAMPLE_MEI } from './example'
import { embedCode, fetchMei, fileNameOf, readParams, shareLink, type ShareSettings } from './share'
import { DEFAULT_FILE, ISSUES_URL, SAMPLES_URL, SITE_TOKENS } from './site'

// ── Demo page ──
// A studio page: a side panel for the file and the look, and tabs for the full
// player, sharing (a link, or the compact player as an embed for a web page)
// and the image maker. A file opened from the computer never leaves the
// browser; one opened from an address stays where its owner put it. Text follows the house rule: say what a control
// does in as few words as that takes, and put anything more in a tooltip.

type Tab = 'player' | 'share' | 'image'
const TABS: { id: Tab; label: string; tip?: string }[] = [
  { id: 'player', label: 'Player' },
  { id: 'share', label: 'Share', tip: 'A link to this file, or a player for your own web page' },
  { id: 'image', label: 'Image' },
]

// A link to Spool can name a file and its settings (demo/share.ts); without
// one, Spool opens the default file.
const START = readParams(window.location.search)
const FIRST = START.src ?? DEFAULT_FILE.url

export default function Demo() {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState(fileNameOf(FIRST))
  // Bumped for every file opened, so each starts a fresh player.
  const [fileKey, setFileKey] = useState(0)
  // Where the open file is online, if it was opened from an address: what a
  // link or an embed names. Empty for a file from the computer.
  const [address, setAddress] = useState(FIRST)
  const [loading, setLoading] = useState<{ busy: boolean; error: string }>({ busy: true, error: '' })
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [dragging, setDragging] = useState(false)
  const [theme, setTheme] = useState<ThemeName>(START.theme)
  // One color per part; null means the default (the theme's own color for the
  // first part, a quick-pick color for the others).
  const [colors, setColors] = useState<(string | null)[]>(START.colors.length ? START.colors : [null])
  const [colorPart, setColorPart] = useState(0)
  // Each part's sound as last chosen in a player, so the shared player plays
  // what the player was set to. Undefined: the sounds the file suggests.
  const [sounds, setSounds] = useState<string[] | undefined>(START.sounds.length ? START.sounds : undefined)
  const [tab, setTab] = useState<Tab>('player')
  // Read here as well as in the player, so the page header and the image maker
  // have the score whichever tab is open.
  const score = useMemo<MeiScore | null>(() => {
    try { return parseNative(text) } catch { return null }
  }, [text])
  const partCount = Math.max(score?.parts.length ?? 1, 1)
  const noteColor = colors[0] ?? THEMES[theme].note
  const defaults = partColors(partCount, THEMES[theme], noteColor)
  const shownColors = defaults.map((c, i) => colors[i] ?? c)
  const by = score ? byline(score) : ''

  // A new file: the first part's color carries over, as the note color; the
  // rest and the sounds belong to the old file's parts.
  const show = (newText: string, name: string, at: string) => {
    setText(newText)
    setFileName(name)
    setAddress(at)
    setFileKey((k) => k + 1)
    setColors((c) => [c[0]])
    setColorPart(0)
    setSounds(undefined)
  }
  const open = async (file: File | undefined) => {
    if (!file) return
    show(await file.text(), file.name, '')
    setLoading({ busy: false, error: '' })
  }
  const openAddress = async (at: string) => {
    if (!at.trim()) return
    setLoading({ busy: true, error: '' })
    try {
      show(await fetchMei(at), fileNameOf(at.trim()), at.trim())
      setLoading({ busy: false, error: '' })
      setLinkOpen(false)
    } catch (e) {
      setLoading({ busy: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  // The first file: the one a link names, keeping its settings, else the
  // default. If it can't be read, the built-in example stands in; a missing
  // default is no fault of the listener's, so it says nothing.
  useEffect(() => {
    fetchMei(FIRST).then(
      (t) => { setText(t); setLoading({ busy: false, error: '' }) },
      (e: Error) => { setText(EXAMPLE_MEI); setFileName('Example'); setAddress(''); setLoading({ busy: false, error: START.src ? e.message : '' }) },
    )
  }, [])
  const settings: ShareSettings = {
    theme,
    colors: colors.some(Boolean) ? shownColors : [],
    sounds: sounds ?? [],
  }
  const setPartColor = (c: string | null) => setColors((prev) => {
    const next = [...prev]
    next[colorPart] = c
    return next
  })

  return (
    <div
      className={'studio' + (dragging ? ' studio-drop' : '')}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); open(e.dataTransfer.files[0]) }}
    >
      <style>{CSS}</style>
      <aside className="studio-side">
        <h1>Spool <span className="studio-alpha" title="Early and changing often. The player lists anything in a file it can't show.">Alpha</span></h1>
        <label className="studio-open" title="Or drop a file anywhere on the page">
          Open MEI file
          <input type="file" accept=".mei,.xml" hidden onChange={(e) => open(e.target.files?.[0])} />
        </label>
        {linkOpen ? (
          <form className="studio-link" onSubmit={(e) => { e.preventDefault(); openAddress(linkDraft) }}>
            <input
              className="studio-field"
              type="url"
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              placeholder="File address"
              aria-label="File address"
              title="A GitHub or Dropbox link works, or any address that lets other sites read the file."
              autoFocus
            />
            <button className="studio-button" type="submit" disabled={loading.busy}>Open</button>
          </form>
        ) : (
          <button className="studio-text-button" onClick={() => setLinkOpen(true)}>Open from a link</button>
        )}
        <div className="studio-file">{loading.busy ? 'Loading…' : fileName}</div>
        {loading.error && <div className="studio-error" role="alert">{loading.error}</div>}
        {address === DEFAULT_FILE.url && !loading.busy && (
          <div className="studio-credit">
            Encoding: <a href={DEFAULT_FILE.creditUrl} target="_blank" rel="noopener" title="The Renaissance Imitation Mass Project. Shared under CC BY-NC 4.0: free to use with credit, not commercially.">CRIM Project</a>
          </div>
        )}

        <section>
          <h2>Look</h2>
          <select className="studio-field" value={theme} onChange={(e) => setTheme(e.target.value as ThemeName)} aria-label="Theme" title="Theme">
            {Object.keys(THEMES).map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </select>
          {partCount > 1 && score && (
            <div className="studio-parts" role="group" aria-label="Part to color">
              {score.parts.map((p, i) => (
                <button key={i} className="studio-part" aria-pressed={colorPart === i} title="Color this part" onClick={() => setColorPart(i)}>
                  <span className="studio-part-swatch" style={{ background: shownColors[i] }} />
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <ColorPicker theme={theme} value={colors[colorPart] ?? null} fallback={defaults[Math.min(colorPart, partCount - 1)]} onChange={setPartColor} />
        </section>
        <a className="studio-issue" href={ISSUES_URL} target="_blank" rel="noopener" title="Report a bug or suggest an improvement on GitHub">Report an issue</a>
      </aside>

      <main className="studio-main">
        <nav className="studio-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} title={t.tip} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
          <span className="studio-spacer" />
          {score && (
            <span className="studio-meta">
              {score.title || fileName}{by ? ` · ${by}` : ''} · {score.bars.length} bars{score.parts.length > 1 ? ` · ${score.parts.length} parts` : ''} · {score.meterCount}/{score.meterUnit}
            </span>
          )}
        </nav>

        {/* Only the open tab is mounted: each player has its own sound, and two
            must never play at once. key: a new file starts a fresh player. */}
        {tab === 'player' && text && (
          <MeiPianoRoll key={fileKey} meiText={text} height={420} theme={theme} partColors={shownColors} header={false} partSounds={sounds} onPartSoundsChange={setSounds} samplesUrl={SAMPLES_URL} />
        )}
        {tab === 'share' && text && (
          <Share
            address={address}
            title={`${score?.title || fileName} · Spool`}
            settings={settings}
            player={<MeiPianoRoll key={fileKey} meiText={text} height={300} theme={theme} partColors={shownColors} variant="compact" partSounds={sounds} onPartSoundsChange={setSounds} samplesUrl={SAMPLES_URL} />}
            onAddress={openAddress}
            busy={loading.busy}
          />
        )}
        {tab === 'image' && score && <ImageMaker score={score} theme={theme} partColors={shownColors} />}
        {tab === 'image' && !score && text && <p className="studio-muted">This file couldn't be read.</p>}
      </main>
    </div>
  )
}

// ── Note color: quick picks and a custom color ──

// `fallback` is the color shown when none is chosen; picking it clears the choice.
function ColorPicker({ theme, value, fallback, onChange }: { theme: ThemeName; value: string | null; fallback: string; onChange: (c: string | null) => void }) {
  const t = THEMES[theme]
  const swatch = (bg: string, selected: boolean): CSSProperties => ({
    background: bg,
    boxShadow: selected ? '0 0 0 2px var(--surface), 0 0 0 4px var(--text-strong)' : 'none',
  })
  return (
    <div className="studio-swatches" role="group" aria-label="Note color">
      {NOTE_COLORS.map((c) => {
        const hex = noteColorFor(c, t)
        // Picking the default clears the override, so the notes follow the
        // theme again when it changes.
        return <button key={c.name} className="studio-swatch" style={swatch(hex, (value ?? fallback) === hex)} title={c.name} aria-label={c.name} onClick={() => onChange(hex === fallback ? null : hex)} />
      })}
      <input
        type="color"
        className="studio-custom"
        title="Custom color"
        aria-label="Custom color"
        value={value ?? fallback}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

// ── Share ──
// A link opens the file in Spool; the embed is the compact player in an
// iframe, for any web page. Both only name the file's address: Spool keeps
// nothing on a server, so the file must be online where anyone can read it.

function byline(score: MeiScore): string {
  return [...new Set([score.composer, score.artist].filter(Boolean))].join(' · ')
}

function Share({ address, title, settings, player, onAddress, busy }: {
  address: string; title: string; settings: ShareSettings; player: ReactNode
  onAddress: (at: string) => void; busy: boolean
}) {
  const [draft, setDraft] = useState(address)
  useEffect(() => setDraft(address), [address])
  const origin = window.location.origin
  return (
    <div className="studio-share">
      <form className="studio-row" onSubmit={(e) => { e.preventDefault(); onAddress(draft) }}>
        <label className="studio-label studio-grow" title="A GitHub or Dropbox link works, or any address that lets other sites read the file.">
          File address
          <input className="studio-field studio-grow" type="url" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://…/your-file.mei" />
        </label>
        {draft.trim() !== address && <button className="studio-button" type="submit" disabled={busy}>Use this file</button>}
      </form>
      {!address && <p className="studio-muted">Spool doesn't upload files. Put this file online, then paste its address here to share it.</p>}

      <h2 className="studio-heading">Link</h2>
      <CopyRow text={address ? shareLink(origin, address, settings) : ''} label="Copy link" tip="Opens this file in Spool, set up as it is now" />

      <h2 className="studio-heading">Embed</h2>
      <div className="studio-essay">{player}</div>
      <CopyRow text={address ? embedCode(origin, address, title, settings) : ''} label="Copy code" tip="Paste into a web page's HTML" code />
    </div>
  )
}

// Text to copy, with its button. Empty text: nothing to copy until the file
// has an address.
function CopyRow({ text, label, tip, code }: { text: string; label: string; tip: string; code?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* the text is on screen to copy by hand */ }
  }
  return (
    <div className="studio-code">
      <pre className={code ? '' : 'studio-nowrap'}>{text || 'Add the file’s address first.'}</pre>
      <button className="studio-button" onClick={copy} disabled={!text} title={tip}>{copied ? 'Copied' : label}</button>
    </div>
  )
}

// ── Image maker ──
// Still pictures of real excerpts, for cards, slides and article images. The
// preview is the exact SVG that downloads.

function ImageMaker({ score, theme, partColors }: { score: MeiScore; theme: ThemeName; partColors: string[] }) {
  const barCount = Math.max(score.bars.length, 1)
  const [fromBar, setFromBar] = useState(1)
  const [toBar, setToBar] = useState(Math.min(barCount, 4))
  const [width, setWidth] = useState(1200)
  const [height, setHeight] = useState(400)
  const [keyboard, setKeyboard] = useState(true)
  const [barNumbers, setBarNumbers] = useState(false)
  const [noteLabels, setNoteLabels] = useState(false)
  const [background, setBackground] = useState(true)
  const [separateParts, setSeparateParts] = useState(false)

  const from = Math.min(Math.max(1, fromBar), barCount)
  const to = Math.min(Math.max(from, toBar), barCount)
  const svg = useMemo(
    () => rollToSvg(score, { fromBar: from, toBar: to, width, height, keyboard, barNumbers, noteLabels, background, theme, partColors, separateParts }),
    [score, from, to, width, height, keyboard, barNumbers, noteLabels, background, theme, partColors, separateParts],
  )
  const name = `${(score.title || 'piano-roll').replace(/[^\w-]+/g, '-').toLowerCase()}-bars-${from}-${to}`
  const num = (v: string, fallback: number) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : fallback)
  const check = (text: string, on: boolean, set: (v: boolean) => void, tip?: string) => (
    <label className="studio-label" title={tip}><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {text}</label>
  )

  return (
    <section className="studio-image">
      <div className="studio-preview">
        <img alt="Image preview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
      </div>
      <div className="studio-row">
        <label className="studio-label" title={`Bar 1 to ${barCount}`}>
          Bars
          <input className="studio-field studio-num" type="number" min={1} max={barCount} value={from} onChange={(e) => setFromBar(num(e.target.value, 1))} />
          to
          <input className="studio-field studio-num" type="number" min={1} max={barCount} value={to} onChange={(e) => setToBar(num(e.target.value, barCount))} />
        </label>
        <label className="studio-label" title="In pixels. PNGs save at twice this size.">
          Size
          <input className="studio-field studio-num-wide" type="number" min={100} value={width} onChange={(e) => setWidth(num(e.target.value, 1200))} />
          ×
          <input className="studio-field studio-num-wide" type="number" min={50} value={height} onChange={(e) => setHeight(num(e.target.value, 400))} />
        </label>
        {check('Keyboard', keyboard, setKeyboard)}
        {check('Bar numbers', barNumbers, setBarNumbers)}
        {check('Note names', noteLabels, setNoteLabels)}
        {check('Background', background, setBackground, 'Off for a transparent background')}
        {score.parts.length > 1 && check('Separate parts', separateParts, setSeparateParts, 'Each part on its own roll')}
        <span className="studio-spacer" />
        <button className="studio-button" title="A vector image, sharp at any size" onClick={() => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`)}>Save SVG</button>
        <button className="studio-button" onClick={async () => downloadBlob(await svgToPng(svg, width, height, 2), `${name}.png`)}>Save PNG</button>
      </div>
    </section>
  )
}

// ── Page styles ──
// The site's palette. The player reads the same custom properties, so its
// chrome matches the page; its play button takes the accent.

const CSS = `
.studio {
  ${SITE_TOKENS}
  min-height: 100vh; display: grid; grid-template-columns: 260px minmax(0, 1fr);
  background: #0a0b0d; color: var(--text); font: 14px/1.45 'Instrument Sans', system-ui, sans-serif;
}
.studio-drop { outline: 2px dashed var(--accent); outline-offset: -6px; }
.studio-side { display: flex; flex-direction: column; gap: 14px; padding: 24px 20px; background: var(--surface); border-right: 1px solid var(--border); }
.studio-side h1 { margin: 0 0 6px; font-size: 17px; font-weight: 700; color: var(--text-strong); letter-spacing: -0.01em; }
.studio-alpha { margin-left: 6px; padding: 1px 6px; border: 1px solid currentColor; border-radius: 4px; font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; vertical-align: 2px; opacity: 0.7; cursor: help; }
.studio-side section { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.studio-side h2 { margin: 0; font: 400 11px var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; color: #808795; }
.studio-open { display: flex; align-items: center; justify-content: center; height: 40px; border-radius: 8px; border: 1px dashed #3a455f; color: var(--text-strong); font-weight: 500; cursor: pointer; }
.studio-open:hover { border-color: var(--accent); }
.studio-file { margin-top: -6px; font: 12px var(--font-mono); color: #808795; overflow-wrap: anywhere; }
.studio-field { height: 34px; box-sizing: border-box; padding: 0 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-strong); font: inherit; }
.studio-swatches { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.studio-swatch { width: 22px; height: 22px; padding: 0; border: none; border-radius: 50%; cursor: pointer; }
.studio-custom { width: 26px; height: 24px; padding: 0; border: none; background: none; cursor: pointer; }
.studio-parts { display: flex; flex-direction: column; gap: 2px; }
.studio-part { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 5px 8px; border: 1px solid transparent; border-radius: 6px; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-part:hover { border-color: var(--border); }
.studio-part[aria-pressed="true"] { border-color: var(--border); background: var(--surface-2); color: var(--text-strong); }
.studio-part-swatch { width: 12px; height: 12px; border-radius: 3px; flex: none; }

.studio-main { min-width: 0; display: flex; flex-direction: column; gap: 16px; padding: 20px 28px 32px; }
.studio-tabs { display: flex; align-items: flex-end; gap: 22px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.studio-tabs button { appearance: none; background: none; border: none; border-bottom: 2px solid transparent; padding: 0 2px 10px; color: var(--text-muted); font: inherit; font-size: 15px; cursor: pointer; }
.studio-tabs button[aria-selected="true"] { color: var(--text-strong); font-weight: 600; border-bottom-color: var(--accent); }
.studio-spacer { flex: 1; }
.studio-meta { padding-bottom: 10px; font: 13px var(--font-mono); color: #808795; }
.studio-muted { color: var(--text-muted); }
.studio-essay { max-width: 760px; }
.studio-share { max-width: 760px; display: flex; flex-direction: column; gap: 12px; }
.studio-heading { margin: 10px 0 0; font: 400 11px var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; color: #808795; }
.studio-grow { flex: 1; min-width: 0; }
.studio-code { display: flex; gap: 12px; align-items: flex-start; }
.studio-code pre { flex: 1; min-width: 0; margin: 0; padding: 10px 12px; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-muted); font: 12px/1.5 var(--font-mono); }
.studio-code pre.studio-nowrap { white-space: nowrap; overflow-wrap: normal; }
.studio-link { display: flex; gap: 8px; margin-top: -4px; }
.studio-link .studio-field { flex: 1; min-width: 0; }
.studio-text-button { align-self: flex-start; margin-top: -6px; padding: 0; border: none; background: none; color: var(--text-muted); font: inherit; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.studio-text-button:hover { color: var(--text-strong); }
.studio-error { margin-top: -6px; font-size: 13px; color: #ff8080; }
.studio-credit { margin-top: -10px; font: 12px var(--font-mono); color: #808795; }
.studio-credit a { color: var(--text-muted); text-underline-offset: 3px; }
.studio-credit a:hover { color: var(--text-strong); }
.studio-issue { margin-top: auto; padding-top: 16px; font-size: 13px; color: var(--text-muted); text-underline-offset: 3px; }
.studio-issue:hover { color: var(--text-strong); }

.studio-image { display: flex; flex-direction: column; gap: 14px; }
.studio-preview { overflow: auto; border: 1px dashed var(--border); border-radius: 8px; background: repeating-conic-gradient(#1c1f2a 0% 25%, #15171f 0% 50%) 50% / 16px 16px; }
.studio-preview img { display: block; max-width: 100%; }
.studio-row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
.studio-label { display: flex; align-items: center; gap: 6px; color: var(--text-muted); }
.studio-num { width: 58px; }
.studio-num-wide { width: 74px; }
.studio-button { height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-strong); font: inherit; cursor: pointer; }
.studio-button:hover:not(:disabled) { border-color: var(--text-muted); }
.studio-button:disabled { opacity: 0.5; cursor: default; }
.studio input[type="checkbox"] { accent-color: var(--accent); }

@media (max-width: 820px) {
  .studio { grid-template-columns: minmax(0, 1fr); }
  .studio-side { border-right: none; border-bottom: 1px solid var(--border); padding: 18px 16px; }
  .studio-main { padding: 16px; }
}
`
