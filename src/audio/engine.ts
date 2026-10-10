import { findSound, type Sound } from './sounds'
import { playSynthNote } from './synth'

// ── The sound engine ──
// One per player. It owns the audio context and plays each part (instrument)
// on its own channel, with that part's sound. A sampled instrument is
// downloaded only when a part is given it.
//
//   synth voices ──→ synth level ─┐
//   sampled instrument ───────────┴→ part channel (mute/solo) → master → speakers
//
// Mute and solo set a channel's level, so they act at once, even on notes
// already sounding. Each part has its own copy of a sampled instrument, so
// silencing one part (or switching its sound) never touches another.

/** The part of a smplr instrument the engine uses. */
interface SampledInstrument {
  start(note: { note: number; time?: number; duration?: number; velocity?: number }): unknown
  stop(): void
  readonly load: Promise<unknown>
}

interface Loaded {
  inst: SampledInstrument
  out: GainNode
}

interface Channel {
  out: GainNode
  synthIn: GainNode
  sound: Sound
  // Sounding synth notes: a way to stop each, and when it ends on its own.
  voices: Array<{ stop: () => void; end: number }>
  // Cached per instrument, so switching back and forth downloads nothing twice.
  // Each has its own output level, so the one being left can be silenced at once.
  instruments: Map<string, Promise<Loaded>>
  current: Loaded | null
}

export type SoundStatus = 'ready' | 'loading' | 'error'

// The synths are raw oscillators, much louder than the recordings; these two
// levels make switching between them roughly even.
const SYNTH_LEVEL = 0.22
const SAMPLE_LEVEL = 0.9

export class SoundEngine {
  readonly ctx: AudioContext
  private master: GainNode
  private channels: Channel[] = []

  /**
   * `samplesUrl`: a folder holding the FluidR3 recordings as `<instrument>-mp3.js`,
   * ending in "/". Without it, they come from the volunteer-run site smplr
   * knows (gleitz.github.io), which a page can't count on staying up.
   */
  constructor(private samplesUrl?: string) {
    const AC: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.connect(this.ctx.destination)
  }

  /**
   * Sets how many parts will play. Several parts sounding together add up, so
   * the overall level comes down as parts are added, keeping a full score
   * from clipping. One part plays at the level it always has.
   */
  setPartCount(count: number): void {
    this.master.gain.setValueAtTime(1 / Math.sqrt(Math.max(1, count)), this.ctx.currentTime)
  }

  /** The sound a part is set to. */
  soundOf(part: number): string {
    return this.channel(part).sound.id
  }

  /** True when a part can play this sound now, with nothing to download. */
  isReady(part: number, soundId: string): boolean {
    const ch = this.channel(part)
    return ch.sound.id === findSound(soundId).id && (ch.sound.kind === 'synth' || ch.current !== null)
  }

  /**
   * Gives a part a sound. A synth is ready at once; a sampled instrument
   * resolves when its recordings have downloaded, and rejects if they can't
   * be fetched.
   */
  async use(part: number, soundId: string): Promise<void> {
    if (this.isReady(part, soundId)) return
    const ch = this.channel(part)
    const wanted = findSound(soundId)
    ch.sound = wanted
    // The sound being left stops at once: a synth's notes are cut, and an
    // instrument fades out over a few milliseconds instead of ringing on
    // through its release while the new sound starts.
    this.stopVoices(ch)
    if (ch.current) {
      ch.current.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01)
      ch.current = null
    }
    if (wanted.kind === 'synth') return
    const loaded = await this.loadInstrument(ch, wanted.instrument)
    // Another sound may have been picked while this one downloaded.
    if (ch.sound !== wanted) return
    loaded.out.gain.cancelScheduledValues(this.ctx.currentTime)
    loaded.out.gain.setValueAtTime(SAMPLE_LEVEL, this.ctx.currentTime)
    ch.current = loaded
  }

  /** Mutes or unmutes a part, at once. */
  setAudible(part: number, audible: boolean): void {
    const gain = this.channel(part).out.gain
    gain.cancelScheduledValues(this.ctx.currentTime)
    gain.setTargetAtTime(audible ? 1 : 0, this.ctx.currentTime, 0.008)
  }

  /** Schedules a note on the audio clock (seconds, as ctx.currentTime counts). */
  play(midi: number, when: number, duration: number, part = 0): void {
    const ch = this.channel(part)
    const now = this.ctx.currentTime
    if (ch.sound.kind === 'sampled') {
      if (!ch.current) return
      let t0 = when, d = duration
      if (t0 < now) { d -= now - t0; t0 = now }
      if (d > 0.001) ch.current.inst.start({ note: midi, time: t0, duration: d })
      return
    }
    // Forget notes that have finished, so the list stays short in long pieces.
    ch.voices = ch.voices.filter((v) => v.end > now)
    // The end allows for the longest release among the presets.
    ch.voices.push({ stop: playSynthNote(this.ctx, ch.synthIn, ch.sound.id, midi, when, duration), end: when + duration + 2 })
  }

  stopAll(): void {
    for (const ch of this.channels) {
      this.stopVoices(ch)
      ch.current?.inst.stop()
    }
  }

  close(): void {
    this.stopAll()
    this.ctx.close().catch(() => {})
  }

  // ── Internals ──

  // Channels are made on first use, each starting on the default sound.
  private channel(part: number): Channel {
    while (this.channels.length <= part) {
      const out = this.ctx.createGain()
      out.connect(this.master)
      const synthIn = this.ctx.createGain()
      synthIn.gain.value = SYNTH_LEVEL
      synthIn.connect(out)
      this.channels.push({ out, synthIn, sound: findSound(undefined), voices: [], instruments: new Map(), current: null })
    }
    return this.channels[part]
  }

  private stopVoices(ch: Channel): void {
    for (const v of ch.voices) v.stop()
    ch.voices = []
  }

  private loadInstrument(ch: Channel, name: string): Promise<Loaded> {
    let p = ch.instruments.get(name)
    if (!p) {
      p = (async () => {
        // Imported here, not at the top, so pages that only use the synths never
        // download the sample library's code either.
        const { Soundfont } = await import('smplr')
        const out = this.ctx.createGain()
        out.connect(ch.out)
        // MP3 only from a hosted copy: every browser decodes it, and one format
        // halves what the host stores.
        // A hosted copy may carry loop points beside each recording, so a
        // held note sustains past the recording's three seconds; a missing
        // file just means the recording plays once.
        const source = this.samplesUrl
          ? { instrumentUrl: `${this.samplesUrl}${name}-mp3.js`, loopDataUrl: `${this.samplesUrl}${name}-loop.json` }
          : { instrument: name, kit: 'FluidR3_GM' }
        const inst = Soundfont(this.ctx, { ...source, destination: out }) as unknown as SampledInstrument
        await inst.load
        return { inst, out }
      })()
      // A failed download is forgotten, so choosing the sound again retries it.
      p.catch(() => ch.instruments.delete(name))
      ch.instruments.set(name, p)
    }
    return p
  }
}
