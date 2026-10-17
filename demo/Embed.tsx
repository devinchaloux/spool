import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MeiPianoRoll } from '../src'
import { fetchMei, readParams, shareLink } from './share'
import { SAMPLES_URL, tokensFor } from './site'

// ── The embed ──
// The compact player alone, for an iframe in someone else's page. It reads the
// file named in its address (?src=), so the file stays wherever its owner put
// it. The expand button opens the same file in Spool, in a new tab, because the
// full player wouldn't fit in the frame.

const params = readParams(window.location.search)

export default function Embed() {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [height, setHeight] = useState(240)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!params.src) { setError('No file to play. The embed needs a file address (src).'); return }
    fetchMei(params.src).then(setText, (e: Error) => setError(e.message))
  }, [])

  // The roll, or the notation in its place, takes whatever height the frame
  // leaves after the caption below it, which changes when a credit line appears.
  useLayoutEffect(() => {
    const fit = () => {
      const root = rootRef.current
      const view = root?.querySelector<HTMLElement>('.mpr-notation') ?? root?.querySelector('canvas')
      if (!root || !view) return
      const chrome = root.offsetHeight - view.offsetHeight
      setHeight(Math.max(120, window.innerHeight - chrome))
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (rootRef.current) ro.observe(rootRef.current)
    window.addEventListener('resize', fit)
    return () => { ro.disconnect(); window.removeEventListener('resize', fit) }
  }, [text])

  if (error) return <p className="embed-error">{error}</p>
  if (text === null) return <p className="embed-error">Loading…</p>
  return (
    <div ref={rootRef}>
      <MeiPianoRoll
        meiText={text}
        variant="compact"
        height={height}
        theme={params.theme}
        partColors={params.colors.length ? params.colors : undefined}
        partSounds={params.sounds.length ? params.sounds : undefined}
        samplesUrl={SAMPLES_URL}
        openHref={shareLink(window.location.origin, params.src ?? '', params)}
      />
    </div>
  )
}

export const EMBED_CSS = `body { ${tokensFor(params.theme)} font: 14px/1.45 'Instrument Sans', system-ui, sans-serif; }
.embed-error { margin: 0; padding: 16px; color: var(--text-muted); }`
