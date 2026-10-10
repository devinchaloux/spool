import { useEffect, useRef, useState } from "react";
import { parseNative, midiName, isBlackKey } from "../mei/parseNative";
import type { MeiPart, MeiScore, MeiWarning } from "../mei/types";
import { SoundEngine, type SoundStatus } from "../audio/engine";
import { Transport } from "../audio/transport";
import { SOUNDS, DEFAULT_SOUND, SAMPLE_CREDIT, findSound } from "../audio/sounds";
import { soundForPart } from "../audio/instruments";
import { resolveTheme, shade, type RollTheme, type ThemeName } from "./themes";
import { partColors as defaultPartColors } from "./noteColors";
import { layoutLanes, widestLaneRows, MIN_LANE_HEIGHT, MIN_ROW_HEIGHT, type Lane } from "./lanes";
import { rollToSvg } from "../render/svg";
import { svgToPng, downloadBlob } from "../render/toPng";

/* ===========================================================================
 * MeiPianoRoll — an embeddable MEI piano-roll player.
 *
 * Reads MEI with the native reader (src/mei/parseNative.ts), draws a DAW-style
 * piano roll on a single fixed canvas (camera/offset based, so scrolling +
 * playback-follow are smooth — no giant scroll-canvas, no scrollLeft jumps),
 * and plays it with a choice of sounds: built-in synths, or sampled instruments
 * downloaded when chosen (src/audio/). Colors come from a theme (./themes.ts).
 * A file with several parts (instruments) shows each in its own color, on one
 * roll or one lane per part, with mute, solo and a sound for each.
 *
 * Usage:
 *   <MeiPianoRoll meiText={xmlString} />
 *   <MeiPianoRoll src="/music/example.mei" />
 * ======================================================================== */

export interface MeiPianoRollProps {
  /** URL to fetch an MEI file from (client-side). */
  src?: string;
  /** Raw MEI XML string (e.g. a Vite `?raw` import). Takes precedence over src. */
  meiText?: string;
  /** Player height in px. Pitch range is fit vertically into this. Default 280. */
  height?: number;
  /** Initial horizontal zoom in px-per-quarter-beat. Default 64. */
  pxPerBeat?: number;
  /** Override the tempo from the file, in quarter notes a minute. The player shows it in the meter's beat. */
  bpm?: number;
  /**
   * Note color. Without it, the page's `--accent` CSS variable is used (and
   * followed live, so a site's accent switch recolors the notes), then the
   * theme's own note color. With several parts, the first part's color.
   */
  accent?: string;
  /** One color per part, in score order. Default: the note color, then quick-pick colors. */
  partColors?: string[];
  /** Start with each part on its own roll. Default false: all parts on one roll. */
  separateParts?: boolean;
  /** Color theme for the roll: a preset name or your own colors. Default "studio". */
  theme?: ThemeName | RollTheme;
  /**
   * Starting sound for every part, by id (see SOUNDS). Default: each part's
   * nearest sound to the instrument the file names, else the square lead.
   */
  sound?: string;
  /**
   * Starting sound for each part, by id, in score order. Takes precedence over
   * `sound` for the parts it covers.
   */
  partSounds?: string[];
  /**
   * Where the sampled instruments' recordings are hosted: a folder of
   * `<instrument>-mp3.js` files from the FluidR3 set, ending in "/". Default:
   * the volunteer-run site smplr uses.
   */
  samplesUrl?: string;
  /** Called with every part's sound, in score order, whenever the listener changes one. */
  onPartSoundsChange?: (ids: string[]) => void;
  /**
   * "full" (default): the roll with its controls underneath. "compact": the roll
   * with a play button over it and a one-line caption with play/pause, for a
   * page of text; it opens into the full player on request.
   */
  variant?: "full" | "compact";
  /**
   * Compact player only: an address the expand button opens in a new tab,
   * instead of opening the full player in place. For a player in a small
   * frame, where the full player wouldn't fit.
   */
  openHref?: string;
  /** Show the title line above the full player. Default true. */
  header?: boolean;
  className?: string;
  /** Called with the parsed score (notes and warnings) each time a file loads. */
  onLoad?: (score: MeiScore) => void;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// The sound each part starts with: the page's choice for that part, else for
// all parts, else the nearest to the instrument the file names, else the default.
function startingSounds(parts: MeiPart[], pageSound: string | undefined, pagePartSounds: string[] | undefined): string[] {
  const count = Math.max(parts.length, 1);
  return Array.from({ length: count }, (_, i) =>
    findSound(pagePartSounds?.[i] ?? pageSound ?? (parts[i] ? soundForPart(parts[i]) ?? undefined : undefined)).id);
}

// Who made it: the composer, and the artist when the file names a different one.
function byline(score: MeiScore): string {
  return [...new Set([score.composer, score.artist].filter(Boolean))].join(" · ");
}
const unique = <T,>(xs: T[]) => [...new Set(xs)];
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  // The canvas throws on a negative radius, which a very thin note would give.
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// "Bar.beat" for the playhead, counting beats in the meter's own unit
// (eighths in 6/8), from the reader's bar starts.
function positionLabel(score: MeiScore, beat: number): string {
  const bars = score.bars;
  if (!bars.length) return "";
  let i = bars.length - 1;
  while (i > 0 && bars[i].start > beat + 1e-6) i--;
  const beatLen = 4 / (score.meterUnit || 4);
  return `${bars[i].label}.${Math.floor((beat - bars[i].start) / beatLen + 1e-6) + 1}`;
}

// The beat a meter's lower number names, by its length in quarter notes.
const BEAT_NAMES: Record<number, string> = { 4: "whole note", 2: "half note", 1: "quarter note", 0.5: "eighth note", 0.25: "sixteenth note" };

// Layout constants
const KEY_W = 46;
const RULER_H = 22;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function MeiPianoRoll(props: MeiPianoRollProps) {
  const { src, meiText, height = 280 } = props;
  const theme = resolveTheme(props.theme);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scoreRef = useRef<MeiScore | null>(null);
  const bpmRef = useRef<number>(props.bpm ?? 120);
  const pxRef = useRef<number>(props.pxPerBeat ?? 64);
  const loopRef = useRef<boolean>(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const themeRef = useRef<RollTheme>(theme);
  // One color per part; the draw loop reads these refs, never React state.
  const colorsRef = useRef<string[]>([props.accent ?? theme.note]);
  const audibleRef = useRef<boolean[]>([true]);
  const separateRef = useRef<boolean>(!!props.separateParts);
  const engineRef = useRef<SoundEngine | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const loopFnRef = useRef<() => void>(() => {});

  // Transport, kept in a ref so the rAF loop never reads stale React state.
  // The view's state: playhead (mirrored from the transport while playing) and camera.
  const tx = useRef({ beat: 0, offsetX: 0, targetOffsetX: 0, raf: 0, manualAt: 0 });
  // Plays the notes (src/audio/transport.ts). Made with the sound engine, on first play.
  const transportRef = useRef<Transport | null>(null);
  // The listener's intent: true from pressing play until pause, stop or the end,
  // including while a sound is still downloading. A newer request supersedes an
  // older one through the token, so a quick second press can't start twice.
  const wantPlayRef = useRef(false);
  const startTokenRef = useRef(0);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [meta, setMeta] = useState<{ title: string; byline: string; line: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  // Tempo is kept in quarter notes a minute, as the transport and MIDI count it,
  // and shown in the beat the meter names: half notes in 2/2, eighths in 6/8.
  const [bpm, setBpm] = useState<number>(props.bpm ?? 120);
  const [beatQuarters, setBeatQuarters] = useState(1);
  const [zoom, setZoom] = useState<number>(props.pxPerBeat ?? 64);
  const [loop, setLoop] = useState(false);
  const [warnings, setWarnings] = useState<MeiWarning[]>([]);
  const [showWarnings, setShowWarnings] = useState(false);
  // The compact player opens into the full one in place.
  const [expanded, setExpanded] = useState(false);
  const layout = props.variant === "compact" && !expanded ? "compact" : "full";
  // Updated straight from the draw loop, so the readouts move without re-rendering.
  const positionRef = useRef<HTMLSpanElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);

  // ---- Parts ---------------------------------------------------------------
  const [parts, setParts] = useState<MeiPart[]>([]);
  // The widest part's pitch range, in rows: sets how tall separated lanes must be.
  const [laneRows, setLaneRows] = useState(0);
  const [separate, setSeparate] = useState<boolean>(!!props.separateParts);
  const [muted, setMuted] = useState<Set<number>>(() => new Set());
  const [soloed, setSoloed] = useState<Set<number>>(() => new Set());
  const multi = parts.length > 1;
  // Solo plays only the soloed parts; a muted part stays silent either way.
  const isAudible = (p: number) => !muted.has(p) && (soloed.size === 0 || soloed.has(p));
  const toggleIn = (set: Set<number>, p: number) => {
    const next = new Set(set);
    if (!next.delete(p)) next.add(p);
    return next;
  };

  // One sound per part. Refs as well as state: the keyboard shortcuts are wired
  // up once, on mount, and must still see the sounds chosen since. The version
  // goes up with every change, so a download that finishes after a newer
  // choice knows it has been superseded.
  const [partSounds, setPartSounds] = useState<string[]>(() => startingSounds([], props.sound, props.partSounds));
  const partSoundsRef = useRef(partSounds);
  const soundsVersionRef = useRef(0);
  const [soundLoad, setSoundLoad] = useState<{ status: SoundStatus; ids: string[] }>({ status: "ready", ids: [] });
  const [pageAccent, setPageAccent] = useState<string | null>(null);
  // A ref, so a new onLoad function from the parent doesn't re-read the file.
  const onLoadRef = useRef(props.onLoad);
  useEffect(() => { onLoadRef.current = props.onLoad; }, [props.onLoad]);
  const onSoundsRef = useRef(props.onPartSoundsChange);
  useEffect(() => { onSoundsRef.current = props.onPartSoundsChange; }, [props.onPartSoundsChange]);

  // Keep refs in sync with UI state.
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { pxRef.current = zoom; drawRef.current(); }, [zoom]);
  useEffect(() => { loopRef.current = loop; if (transportRef.current) transportRef.current.loop = loop; }, [loop]);
  useEffect(() => { separateRef.current = separate; drawRef.current(); }, [separate]);
  // Opening or closing the compact player swaps the readouts; fill the new ones.
  useEffect(() => { drawRef.current(); }, [layout]);

  // ---- Colors ------------------------------------------------------------
  // Follow the page's --accent live: a site's theme or accent switch changes
  // attributes on <html>, so watching those is enough (no polling).
  useEffect(() => {
    if (props.accent) return;
    const read = () => {
      const el = rootRef.current;
      const v = el ? getComputedStyle(el).getPropertyValue("--accent").trim() : "";
      setPageAccent(v || null);
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true });
    return () => mo.disconnect();
  }, [props.accent]);
  const noteColor = props.accent ?? pageAccent ?? theme.note;
  const colors = props.partColors?.length ? props.partColors : defaultPartColors(Math.max(parts.length, 1), theme, noteColor);
  const colorsKey = colors.join(",");
  useEffect(() => {
    themeRef.current = theme;
    colorsRef.current = colorsKey.split(",");
    drawRef.current();
  }, [theme, colorsKey]);

  // Mute and solo reach the sound at once, and the roll fades silent parts.
  const audibleKey = parts.map((_p, i) => (isAudible(i) ? "1" : "0")).join("");
  useEffect(() => {
    audibleRef.current = [...audibleKey].map((c) => c === "1");
    applyAudible();
    drawRef.current();
  }, [audibleKey]);
  function applyAudible() {
    const engine = engineRef.current;
    if (engine) audibleRef.current.forEach((on, i) => engine.setAudible(i, on));
  }

  // ---- Audio -------------------------------------------------------------
  // The engine and transport are made on first use: browsers only allow sound
  // after a click.
  function ensureEngine(): SoundEngine {
    if (!engineRef.current) {
      const engine = new SoundEngine(props.samplesUrl);
      const transport = new Transport({
        now: () => engine.ctx.currentTime,
        play: (midi, when, dur, part) => engine.play(midi, when, dur, part),
        stopAll: () => engine.stopAll(),
      });
      transport.loop = loopRef.current;
      transport.setTempo(bpmRef.current);
      transport.onEnd = () => {
        wantPlayRef.current = false;
        setPlaying(false);
        tx.current.beat = transport.position();
        startLoopIfNeeded();
      };
      const score = scoreRef.current;
      if (score) {
        transport.setScore(score.notes, score.totalBeats);
        transport.seek(tx.current.beat);
        engine.setPartCount(score.parts.length);
      }
      engineRef.current = engine;
      transportRef.current = transport;
      applyAudible();
    }
    return engineRef.current;
  }
  function soundsReady(engine: SoundEngine): boolean {
    return partSoundsRef.current.every((id, part) => engine.isReady(part, id));
  }
  // Every part's sound must be ready before playback: a sampled one has to
  // download, a synth is ready now. "superseded" means a sound was changed
  // again while this one downloaded.
  async function prepareSounds(): Promise<"ready" | "superseded" | "failed"> {
    const engine = ensureEngine();
    const version = soundsVersionRef.current;
    const sounds = partSoundsRef.current;
    const pending = sounds.filter((id, part) => !engine.isReady(part, id));
    if (pending.some((id) => findSound(id).kind === "sampled")) setSoundLoad({ status: "loading", ids: unique(pending) });
    await Promise.allSettled(sounds.map((id, part) => engine.use(part, id)));
    if (version !== soundsVersionRef.current) return "superseded";
    const failed = sounds.filter((id, part) => !engine.isReady(part, id));
    if (failed.length) {
      setSoundLoad({ status: "error", ids: unique(failed) });
      return "failed";
    }
    setSoundLoad({ status: "ready", ids: [] });
    return "ready";
  }
  // Switching sound keeps the playhead: the old sound is silenced at once, and
  // playback carries on with the new one as soon as it is ready.
  async function onSoundChange(part: number, id: string) {
    const next = [...partSoundsRef.current];
    next[part] = id;
    partSoundsRef.current = next;
    setPartSounds(next);
    soundsVersionRef.current++;
    onSoundsRef.current?.(next);
    const transport = transportRef.current;
    if (transport?.playing) transport.pause();
    const result = await prepareSounds();
    if (result === "superseded" || !wantPlayRef.current) return;
    if (result === "ready") {
      transportRef.current?.play();
      startLoopIfNeeded();
    } else {
      wantPlayRef.current = false;
      setPlaying(false);
    }
  }

  // ---- Transport ---------------------------------------------------------
  function startLoopIfNeeded() {
    if (!tx.current.raf) tx.current.raf = requestAnimationFrame(loopFnRef.current);
  }
  async function play() {
    if (!scoreRef.current || wantPlayRef.current) return;
    wantPlayRef.current = true;
    setPlaying(true);
    const token = ++startTokenRef.current;
    const engine = ensureEngine();
    engine.ctx.resume();
    if (!soundsReady(engine)) {
      const result = await prepareSounds();
      if (token !== startTokenRef.current) return; // paused, or played again, meanwhile
      // A newer sound was picked while this one downloaded: its own change
      // handler starts playback when it is ready, since the listener still wants it.
      if (result === "superseded") return;
      if (result === "failed") { wantPlayRef.current = false; setPlaying(false); return; }
    }
    if (token !== startTokenRef.current || !wantPlayRef.current) return;
    transportRef.current!.play();
    startLoopIfNeeded();
  }
  function pause() {
    wantPlayRef.current = false;
    startTokenRef.current++;
    setPlaying(false);
    const transport = transportRef.current;
    if (transport) { transport.pause(); tx.current.beat = transport.position(); }
    startLoopIfNeeded();
  }
  function togglePlay() {
    if (wantPlayRef.current) pause();
    else play();
  }
  function seekToBeat(beat: number) {
    const score = scoreRef.current;
    if (!score) return;
    const b = clamp(beat, 0, score.totalBeats);
    tx.current.beat = b;
    transportRef.current?.seek(b);
    startLoopIfNeeded();
  }
  // Rewind the playhead (and the view) to the start, whether playing or not.
  function toStart() {
    if (!scoreRef.current) return;
    tx.current.targetOffsetX = 0;
    seekToBeat(0);
  }

  // ---- Setup: parse, canvas sizing, input, render loop -------------------
  useEffect(() => {
    let canceled = false;

    async function load() {
      try {
        let text = meiText;
        if (!text && src) {
          const res = await fetch(src);
          if (!res.ok) throw new Error(`Couldn't load ${src} (${res.status}).`);
          text = await res.text();
        }
        if (!text) throw new Error("No MEI file given.");
        const score = parseNative(text);
        if (canceled) return;
        scoreRef.current = score;
        // A new file: stop, back to the start, and give the transport its notes.
        wantPlayRef.current = false;
        setPlaying(false);
        tx.current.beat = 0;
        transportRef.current?.setScore(score.notes, score.totalBeats);
        engineRef.current?.setPartCount(score.parts.length);
        // Each part starts with its own sound, unmuted.
        setParts(score.parts);
        setLaneRows(widestLaneRows(score.notes));
        setMuted(new Set());
        setSoloed(new Set());
        partSoundsRef.current = startingSounds(score.parts, props.sound, props.partSounds);
        setPartSounds(partSoundsRef.current);
        soundsVersionRef.current++;
        setWarnings(score.warnings);
        onLoadRef.current?.(score);
        setBeatQuarters(4 / (score.meterUnit || 4));
        if (props.bpm == null) {
          bpmRef.current = score.bpm;
          setBpm(score.bpm);
          transportRef.current?.setTempo(score.bpm);
        }
        setMeta({
          title: score.title,
          byline: byline(score),
          line: [
            `${score.notes.length} notes`,
            ...(score.parts.length > 1 ? [`${score.parts.length} parts`] : []),
            `${score.meterCount}/${score.meterUnit}`,
            `${score.bars.length} bars`,
          ].join(" · "),
        });
        setStatus("ready");
        drawRef.current();
      } catch (err) {
        if (canceled) return;
        setErrMsg(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    }
    load();
    return () => { canceled = true; };
    // props.sound and props.partSounds only set the starting sounds; changing
    // them later doesn't re-read the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, meiText, props.bpm]);

  // Drawing + input + loop live in one mount effect using refs only.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The transport object itself is never replaced (only its fields change), so
    // the cleanup below can safely use this same reference.
    const transport = tx.current;

    // Lanes change only with the file, the view and the height; not every frame.
    let lanesCache: { score: MeiScore | null; key: string; lanes: Lane[] } = { score: null, key: "", lanes: [] };
    const lanesFor = (score: MeiScore, separate: boolean, cssH: number): Lane[] => {
      const key = `${separate}|${cssH}`;
      if (lanesCache.score !== score || lanesCache.key !== key) {
        lanesCache = { score, key, lanes: layoutLanes(score.notes, { separate, top: RULER_H, height: cssH - RULER_H }) };
      }
      return lanesCache.lanes;
    };

    const draw = () => {
      const cv = canvasRef.current;
      const score = scoreRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = cv.clientWidth;
      const cssH = cv.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
        cv.width = Math.round(cssW * dpr);
        cv.height = Math.round(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const th = themeRef.current;
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = th.background;
      ctx.fillRect(0, 0, cssW, cssH);
      if (!score) return;

      const px = pxRef.current;
      const trackW = cssW - KEY_W;
      const contentW = score.totalBeats * px;
      const maxOffset = Math.max(0, contentW - trackW);

      const t = tx.current;
      t.targetOffsetX = clamp(t.targetOffsetX, 0, maxOffset);
      t.offsetX = clamp(t.offsetX, 0, maxOffset);
      const offset = t.offsetX;
      const xFor = (b: number) => KEY_W + b * px - offset;
      const colors = colorsRef.current;
      const audible = audibleRef.current;
      const lanes = lanesFor(score, separateRef.current, cssH);
      const labelLanes = lanes.length > 1;

      // --- clipped track content ---
      ctx.save();
      ctx.beginPath();
      ctx.rect(KEY_W, 0, trackW, cssH);
      ctx.clip();

      // The piece may be narrower than the canvas (zoomed out); only shade and
      // grid up to the actual end of the score so no phantom measures appear.
      const rowRight = clamp(xFor(score.totalBeats), KEY_W, cssW);
      const viewFirst = offset / px;
      const viewLast = (offset + trackW) / px;
      for (const lane of lanes) {
        const noteH = lane.height / (lane.hi - lane.lo + 1);
        const yFor = (m: number) => lane.top + (lane.hi - m) * noteH;
        const bottom = lane.top + lane.height;
        for (let m = lane.lo; m <= lane.hi; m++) {
          ctx.fillStyle = isBlackKey(m) ? th.rowBlack : th.rowWhite;
          ctx.fillRect(KEY_W, yFor(m), rowRight - KEY_W, noteH);
        }

        // Bar lines where the reader says each bar starts (a pickup is short, so
        // bars are not simply every N beats from zero); beat lines every quarter
        // note counted from each bar's start.
        score.bars.forEach((bar, i) => {
          const end = i + 1 < score.bars.length ? score.bars[i + 1].start : score.totalBeats;
          if (end < viewFirst || bar.start > viewLast) return;
          for (let b = bar.start; b < end - 1e-6; b += 1) {
            const x = xFor(b);
            const isBarLine = b === bar.start;
            ctx.strokeStyle = isBarLine ? th.gridBar : th.gridBeat;
            ctx.lineWidth = isBarLine ? 1.5 : 1;
            ctx.beginPath();
            ctx.moveTo(Math.round(x) + 0.5, lane.top);
            ctx.lineTo(Math.round(x) + 0.5, bottom);
            ctx.stroke();
          }
        });

        for (const n of score.notes) {
          if (labelLanes && n.part !== lane.parts[0]) continue;
          const x = xFor(n.start);
          const w = Math.max(2, n.dur * px - 2);
          if (x + w < KEY_W || x > cssW) continue;
          const y = yFor(n.midi);
          const h = Math.max(1, noteH - 2);
          const on = audible[n.part] ?? true;
          const active = on && !!transportRef.current?.playing && t.beat >= n.start - 1e-6 && t.beat < n.start + n.dur - 1e-6;
          const color = colors[n.part] ?? colors[0];
          const fill = active ? th.activeNote : color;
          // A muted part stays visible, faded, so the music doesn't seem to vanish.
          ctx.globalAlpha = on ? 1 : 0.3;
          roundRect(ctx, x + 1, y + 1, w, h, 3);
          const grad = ctx.createLinearGradient(0, y, 0, y + h);
          grad.addColorStop(0, fill);
          grad.addColorStop(1, shade(fill, -0.18));
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.strokeStyle = shade(fill, -0.35);
          ctx.lineWidth = 1;
          ctx.stroke();
          if (w > 24 && noteH > 12) {
            ctx.fillStyle = active ? shade(th.activeNote, -0.8) : th.noteText;
            ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
            ctx.textBaseline = "middle";
            ctx.fillText(n.name, x + 5, y + h / 2 + 1);
          }
          ctx.globalAlpha = 1;
        }

        // Each lane's part name, top left, on a backing so notes don't hide it.
        if (labelLanes) {
          const label = score.parts[lane.parts[0]]?.label ?? "";
          ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
          ctx.textBaseline = "middle";
          const w = ctx.measureText(label).width;
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = th.background;
          ctx.fillRect(KEY_W + 2, lane.top + 2, w + 10, 16);
          ctx.globalAlpha = 1;
          ctx.fillStyle = th.text;
          ctx.fillText(label, KEY_W + 7, lane.top + 10);
        }
      }

      // playhead
      const phx = xFor(t.beat);
      if (phx >= KEY_W && phx <= cssW) {
        ctx.strokeStyle = th.playhead;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(phx, RULER_H);
        ctx.lineTo(phx, cssH);
        ctx.stroke();
      }
      ctx.restore();

      // --- ruler (over content) ---
      ctx.fillStyle = th.background;
      ctx.fillRect(0, 0, cssW, RULER_H);
      ctx.fillStyle = th.text;
      ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
      ctx.textBaseline = "middle";
      for (const bar of score.bars) {
        const x = xFor(bar.start);
        if (x >= KEY_W - 2 && x <= cssW) ctx.fillText(bar.label, x + 4, RULER_H / 2);
      }

      // --- keyboard gutter (over everything on the left), one per lane ---
      for (const lane of lanes) {
        const noteH = lane.height / (lane.hi - lane.lo + 1);
        const yFor = (m: number) => lane.top + (lane.hi - m) * noteH;
        ctx.fillStyle = th.keyWhite;
        ctx.fillRect(0, lane.top, KEY_W, lane.height);
        for (let m = lane.lo; m <= lane.hi; m++) {
          const y = yFor(m);
          if (isBlackKey(m)) {
            ctx.fillStyle = th.keyBlack;
            ctx.fillRect(0, y, KEY_W - 8, noteH - 1);
          }
          if (m % 12 === 0 && noteH > 9) {
            ctx.fillStyle = th.text;
            ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
            ctx.fillText(midiName(m), 5, y + noteH / 2);
          }
        }
      }
      ctx.strokeStyle = th.gridBar;
      ctx.beginPath();
      ctx.moveTo(KEY_W + 0.5, 0);
      ctx.lineTo(KEY_W + 0.5, cssH);
      ctx.stroke();

      if (positionRef.current) positionRef.current.textContent = positionLabel(score, t.beat);
      if (progressRef.current) progressRef.current.style.width = `${score.totalBeats ? (t.beat / score.totalBeats) * 100 : 0}%`;
    };
    drawRef.current = draw;

    const frame = () => {
      const t = tx.current;
      // smooth camera lerp
      const diff = t.targetOffsetX - t.offsetX;
      if (Math.abs(diff) > 0.4) t.offsetX += diff * 0.22;
      else t.offsetX = t.targetOffsetX;

      const transport = transportRef.current;
      if (transport?.playing) {
        const score = scoreRef.current!;
        t.beat = transport.position();
        // follow: keep playhead ~38% into the track once it gets there, but not
        // for a moment after the listener has moved the view by hand.
        const px = pxRef.current;
        const cv = canvasRef.current!;
        const trackW = cv.clientWidth - KEY_W;
        const contentW = score.totalBeats * px;
        const maxOffset = Math.max(0, contentW - trackW);
        if (performance.now() - t.manualAt > 1500) t.targetOffsetX = clamp(t.beat * px - trackW * 0.38, 0, maxOffset);
      }

      draw();

      const animating = !!transportRef.current?.playing || Math.abs(t.targetOffsetX - t.offsetX) > 0.4;
      t.raf = animating ? requestAnimationFrame(frame) : 0;
    };
    loopFnRef.current = frame;

    // --- input: wheel to scroll, drag to pan, click to seek ---
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = tx.current;
      t.targetOffsetX += e.deltaX !== 0 ? e.deltaX : e.deltaY;
      t.manualAt = performance.now();
      startLoopIfNeeded();
    };
    let dragging = false;
    let dragStartX = 0;
    let dragStartOffset = 0;
    let moved = 0;
    let lastClick = 0;
    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      dragStartX = e.clientX;
      dragStartOffset = tx.current.targetOffsetX;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
      canvas.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - dragStartX;
      moved = Math.max(moved, Math.abs(dx));
      tx.current.offsetX = tx.current.targetOffsetX = dragStartOffset - dx;
      tx.current.manualAt = performance.now();
      startLoopIfNeeded();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = "grab";
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      if (moved < 4 && scoreRef.current) {
        const now = performance.now();
        if (now - lastClick < 300) {
          // double-click anywhere clears the seek -> back to start
          toStart();
          lastClick = 0;
        } else {
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          if (x > KEY_W) {
            const beat = (tx.current.offsetX + (x - KEY_W)) / pxRef.current;
            seekToBeat(beat);
          }
          lastClick = now;
        }
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Home") { e.preventDefault(); toStart(); }
      else if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        togglePlay();
      }
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("keydown", onKeyDown);
    canvas.style.cursor = "grab";

    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);

    draw();

    return () => {
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("keydown", onKeyDown);
      if (transport.raf) cancelAnimationFrame(transport.raf);
      transport.raf = 0;
      transportRef.current?.dispose();
      transportRef.current = null;
      engineRef.current?.close();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Image export ------------------------------------------------------
  // Saves what is on screen: the bars in view, in the current colors.
  async function saveImage() {
    const score = scoreRef.current;
    const cv = canvasRef.current;
    if (!score || !cv) return;
    const px = pxRef.current;
    const fromBeat = tx.current.offsetX / px;
    const toBeat = (tx.current.offsetX + cv.clientWidth - KEY_W) / px;
    const firstIdx = Math.max(0, score.bars.findIndex((_bar, i) => (score.bars[i + 1]?.start ?? score.totalBeats) > fromBeat + 1e-6));
    let lastIdx = score.bars.findIndex((b) => b.start >= toBeat - 1e-6) - 1;
    if (lastIdx < 0) lastIdx = score.bars.length - 1;
    const width = Math.round(cv.clientWidth);
    const imgHeight = Math.round(cv.clientHeight);
    const svg = rollToSvg(score, {
      fromBar: firstIdx + 1, toBar: Math.max(firstIdx, lastIdx) + 1, width, height: imgHeight,
      theme: themeRef.current, partColors: colorsRef.current, barNumbers: true,
      separateParts: separateRef.current,
      fadedParts: audibleRef.current.flatMap((on, i) => (on ? [] : [i])),
    });
    const name = (score.title || "piano-roll").replace(/[^\w-]+/g, "-").toLowerCase();
    downloadBlob(await svgToPng(svg, width, imgHeight, 2), `${name}.png`);
  }

  const onBpmChange = (v: number) => {
    if (!(v > 0)) return;
    setBpm(v);
    bpmRef.current = v;
    transportRef.current?.setTempo(v);
  };

  const ready = status === "ready";
  // Separated, the roll grows rather than squeeze each lane below a readable height.
  const laneHeight = Math.max(MIN_LANE_HEIGHT, laneRows * MIN_ROW_HEIGHT);
  const canvasHeight = separate && multi ? Math.max(height, RULER_H + parts.length * (laneHeight + 6)) : height;
  const soundLabels = soundLoad.ids.map((id) => findSound(id).label).join(", ");
  const soundSelect = (part: number) => (
    <select
      className="mpr-select"
      value={partSounds[part] ?? DEFAULT_SOUND}
      onChange={(e) => onSoundChange(part, e.target.value)}
      aria-label={multi ? `Sound for ${parts[part]?.label}` : "Sound"}
      title="Sound. Instruments load the first time you choose them."
    >
      {(["Synth", "Instrument"] as const).map((group) => (
        <optgroup key={group} label={group === "Synth" ? "Synths" : "Instruments"}>
          {SOUNDS.filter((snd) => snd.group === group).map((snd) => (
            <option key={snd.id} value={snd.id}>{snd.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
  // The roll never hides what it leaves out (docs/decisions.md).
  const notShown = ready && warnings.length > 0 && (
    <button
      className="mpr-chip"
      onClick={() => setShowWarnings((v) => !v)}
      aria-expanded={showWarnings}
      title="Parts of the file the roll can't show yet"
    >
      {warnings.length} not shown
    </button>
  );
  // Several parts: a row for each, with its color, mute, solo and sound.
  const partRows = multi && ready && (
    <div className="mpr-parts">
      {parts.map((part, i) => (
        <div key={i} className={"mpr-part" + (isAudible(i) ? "" : " mpr-part-off")}>
          <span className="mpr-swatch" style={{ background: colors[i] ?? colors[0] }} />
          <span className="mpr-part-name" title={part.label}>{part.label}</span>
          <button className="mpr-ms" aria-pressed={muted.has(i)} onClick={() => setMuted((m) => toggleIn(m, i))} title="Mute" aria-label={`Mute ${part.label}`}>M</button>
          <button className="mpr-ms mpr-solo" aria-pressed={soloed.has(i)} onClick={() => setSoloed((m) => toggleIn(m, i))} title="Solo" aria-label={`Solo ${part.label}`}>S</button>
          {soundSelect(i)}
        </div>
      ))}
    </div>
  );

  return (
    <div ref={rootRef} className={`mpr-root mpr-${layout} ${props.className ?? ""}`}>
      <style>{CSS}</style>
      {layout === "full" && props.header !== false && (
        <div className="mpr-header">
          <span className="mpr-title">{meta?.title ?? "—"}</span>
          {meta?.byline ? <span className="mpr-composer">{meta.byline}</span> : null}
          <span className="mpr-spacer" />
          <span className="mpr-meta">{meta?.line ?? ""}</span>
        </div>
      )}

      <div className="mpr-stage">
        <canvas
          ref={canvasRef}
          className="mpr-canvas"
          style={{ height: canvasHeight, background: theme.background }}
          tabIndex={0}
          title="Drag or scroll to move. Click to set the playhead. Space plays; Home returns to the start."
        />
        {layout === "compact" && ready && !playing && (
          <button className="mpr-overlay" onClick={togglePlay} aria-label="Play" title="Play (Space)">
            <Icon name="play" size={26} />
          </button>
        )}
        {layout === "compact" && <div className="mpr-progress"><div ref={progressRef} /></div>}
      </div>

      {layout === "full" ? (
        <div className="mpr-bar">
          <button className="mpr-icon" onClick={toStart} disabled={!ready} title="Back to start (Home)" aria-label="Back to start">
            <Icon name="start" />
          </button>
          <button className="mpr-play" onClick={togglePlay} disabled={!ready} title={playing ? "Pause (Space)" : "Play (Space)"} aria-label={playing ? "Pause" : "Play"}>
            <Icon name={playing ? "pause" : "play"} size={18} />
          </button>
          <button className="mpr-icon" onClick={() => setLoop((v) => !v)} aria-pressed={loop} title="Loop" aria-label="Loop">
            <Icon name="loop" />
          </button>
          <span className="mpr-position" ref={positionRef} title="Bar and beat" />
          <span className="mpr-spacer" />
          {!multi && soundSelect(0)}
          {multi && (
            <button className="mpr-icon" onClick={() => setSeparate((v) => !v)} aria-pressed={separate} title="Each part on its own roll" aria-label="Separate parts">
              <Icon name="lanes" />
            </button>
          )}
          <label className="mpr-tempo" title={`Tempo, in ${BEAT_NAMES[beatQuarters] ?? "beat"}s a minute`}>
            <input type="number" min={10} max={400} value={Math.round(bpm / beatQuarters)} aria-label="Tempo" onChange={(e) => onBpmChange(parseFloat(e.target.value) * beatQuarters)} />
            BPM
          </label>
          <span className="mpr-zoom">
            <button className="mpr-icon" onClick={() => setZoom((z) => clamp(Math.round(z / 1.25), 28, 160))} title="Zoom out" aria-label="Zoom out">
              <Icon name="minus" />
            </button>
            <button className="mpr-icon" onClick={() => setZoom((z) => clamp(Math.round(z * 1.25), 28, 160))} title="Zoom in" aria-label="Zoom in">
              <Icon name="plus" />
            </button>
          </span>
          <button className="mpr-icon" onClick={saveImage} disabled={!ready} title="Save the visible bars as a PNG" aria-label="Save image">
            <Icon name="image" />
          </button>
          {notShown}
          {props.variant === "compact" && (
            <button className="mpr-icon" onClick={() => setExpanded(false)} title="Back to the small player" aria-label="Back to the small player">
              <Icon name="collapse" />
            </button>
          )}
        </div>
      ) : (
        <div className="mpr-foot">
          <button className="mpr-icon" onClick={togglePlay} disabled={!ready} title={playing ? "Pause (Space)" : "Play (Space)"} aria-label={playing ? "Pause" : "Play"}>
            <Icon name={playing ? "pause" : "play"} />
          </button>
          <span className="mpr-title">{meta?.title ?? ""}</span>
          {meta?.byline ? <span className="mpr-composer">{meta.byline}</span> : null}
          <span className="mpr-spacer" />
          {!multi && soundSelect(0)}
          <span className="mpr-meta">{Math.round(bpm / beatQuarters)} BPM</span>
          {notShown}
          {props.openHref ? (
            <a className="mpr-icon" href={props.openHref} target="_blank" rel="noopener" title="Open the full player" aria-label="Open the full player">
              <Icon name="expand" />
            </a>
          ) : (
            <button className="mpr-icon" onClick={() => setExpanded(true)} title="Open the full player" aria-label="Open the full player">
              <Icon name="expand" />
            </button>
          )}
        </div>
      )}

      {/* Only what needs saying: loading, and errors. How to use the roll is in
          the canvas tooltip. */}
      {layout === "full" && partRows}
      {(status !== "ready" || soundLoad.status !== "ready") && (
        <div className={"mpr-status" + (status === "error" || soundLoad.status === "error" ? " mpr-error" : "")}>
          {status === "loading" && "Loading…"}
          {status === "error" && errMsg}
          {ready && soundLoad.status === "loading" && `Loading ${soundLabels}…`}
          {ready && soundLoad.status === "error" && `Couldn't load ${soundLabels}. Try again or choose a synth.`}
        </div>
      )}
      {showWarnings && ready && warnings.length > 0 && (
        <ul className="mpr-warnings">
          {warnings.map((w) => (
            <li key={w.code}>
              {w.message}
              {w.count > 1 ? ` (${w.count}×)` : ""}
            </li>
          ))}
        </ul>
      )}
      {partSounds.some((id) => findSound(id).kind === "sampled") && <div className="mpr-credit">{SAMPLE_CREDIT}</div>}
    </div>
  );
}

// ── Icons ──
// Drawn inline so the player needs no icon font or image files.

type IconName = "play" | "pause" | "start" | "loop" | "minus" | "plus" | "image" | "expand" | "collapse" | "lanes";

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const solid = name === "play" || name === "pause";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={solid ? "currentColor" : "none"}
      stroke={solid ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "play" && <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />}
      {name === "pause" && <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>}
      {name === "start" && <path d="M6 5v14M19 5l-9 7 9 7z" />}
      {name === "loop" && <path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />}
      {name === "minus" && <path d="M5 12h14" />}
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
      {name === "image" && <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>}
      {name === "expand" && <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />}
      {name === "collapse" && <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />}
      {name === "lanes" && <><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /></>}
    </svg>
  );
}


/* Chrome styling spends the SITE's tokens (with fallbacks for a host page
   without them). The canvas interior keeps its own palette from the theme: a
   piano roll is a DAW surface and reads as an instrument, not a page. Notes are
   the one canvas element painted with the page's accent. */
const CSS = `
.mpr-root {
  --mpr-panel: var(--surface, #141823); --mpr-panel2: var(--surface-2, #1b2030); --mpr-border: var(--border, #232a3b);
  --mpr-text: var(--text-strong, #e7ecf5); --mpr-muted: var(--text-muted, #8b95ad); --mpr-accent: var(--accent, #4f8cff);
  font: 13px/1.4 var(--font-mono, ui-monospace, Menlo, Consolas, monospace);
  color: var(--mpr-text); background: var(--mpr-panel);
  border: 1px solid var(--mpr-border); border-radius: var(--radius, 10px); overflow: hidden;
}
.mpr-full { box-shadow: var(--shadow, 0 10px 40px rgba(0,0,0,.35)); }
.mpr-header { display: flex; align-items: baseline; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--mpr-border); }
.mpr-title { font-size: 15px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.mpr-composer, .mpr-meta { color: var(--mpr-muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mpr-spacer { flex: 1; }
.mpr-stage { position: relative; }
.mpr-canvas { display: block; width: 100%; touch-action: none; outline: none; }
.mpr-canvas:focus-visible { box-shadow: inset 0 0 0 2px var(--mpr-accent); }

.mpr-bar, .mpr-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px; border-top: 1px solid var(--mpr-border); }
.mpr-foot { gap: 12px; padding: 8px 12px; }
.mpr-foot .mpr-title { font-size: 13px; }
.mpr-foot .mpr-composer { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.mpr-icon { appearance: none; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid var(--mpr-border); background: transparent; color: var(--mpr-text); cursor: pointer; padding: 0; box-sizing: border-box; text-decoration: none; }
.mpr-foot .mpr-icon { width: 30px; height: 30px; }
.mpr-icon:hover:not(:disabled) { border-color: var(--mpr-muted); }
.mpr-icon[aria-pressed="true"] { border-color: var(--mpr-accent); color: var(--mpr-accent); background: color-mix(in srgb, var(--mpr-accent) 14%, transparent); }
.mpr-play { appearance: none; width: 44px; height: 44px; border-radius: 50%; border: none; background: var(--mpr-accent); color: var(--accent-ink, #fff); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.mpr-play:hover:not(:disabled) { filter: brightness(1.08); }
.mpr-icon:disabled, .mpr-play:disabled { opacity: .5; cursor: default; }
.mpr-position { min-width: 44px; font-size: 14px; font-variant-numeric: tabular-nums; }
.mpr-select, .mpr-tempo input { background: var(--mpr-panel2); color: var(--mpr-text); border: 1px solid var(--mpr-border); border-radius: 8px; height: 34px; padding: 0 8px; font: inherit; }
.mpr-foot .mpr-select { height: 28px; background: transparent; color: var(--mpr-muted); font-size: 12px; }
.mpr-tempo { display: inline-flex; align-items: center; gap: 6px; color: var(--mpr-muted); font-size: 12px; }
.mpr-tempo input { width: 62px; box-sizing: border-box; }
.mpr-zoom { display: inline-flex; gap: 4px; }
.mpr-chip { appearance: none; height: 28px; padding: 0 9px; border-radius: 5px; border: 1px solid var(--mpr-border); background: transparent; color: var(--mpr-muted); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.mpr-chip[aria-expanded="true"] { color: var(--mpr-text); border-color: var(--mpr-muted); }

.mpr-overlay { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 64px; height: 64px; border-radius: 50%; border: none; background: var(--mpr-accent); color: var(--accent-ink, #fff); display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; box-shadow: 0 6px 24px rgba(0,0,0,.45); }
.mpr-overlay:hover { filter: brightness(1.08); }
.mpr-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: color-mix(in srgb, var(--mpr-muted) 25%, transparent); pointer-events: none; }
.mpr-progress > div { height: 100%; width: 0; background: var(--mpr-accent); }

.mpr-parts { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 8px 14px; border-top: 1px solid var(--mpr-border); }
.mpr-part { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.mpr-part-off .mpr-part-name, .mpr-part-off .mpr-swatch { opacity: .45; }
.mpr-swatch { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.mpr-part-name { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.mpr-ms { appearance: none; width: 24px; height: 24px; padding: 0; border-radius: 5px; border: 1px solid var(--mpr-border); background: transparent; color: var(--mpr-muted); font: inherit; font-size: 11px; font-weight: 650; cursor: pointer; }
.mpr-ms:hover { border-color: var(--mpr-muted); }
.mpr-ms[aria-pressed="true"] { color: var(--mpr-text); border-color: var(--mpr-muted); background: color-mix(in srgb, var(--mpr-muted) 30%, transparent); }
.mpr-solo[aria-pressed="true"] { color: var(--mpr-accent); border-color: var(--mpr-accent); background: color-mix(in srgb, var(--mpr-accent) 14%, transparent); }
.mpr-part .mpr-select { height: 26px; font-size: 12px; padding: 0 4px; }
.mpr-status { padding: 8px 14px; color: var(--mpr-muted); font-size: 12px; border-top: 1px solid var(--mpr-border); }
.mpr-error { color: #ff8a8a; }
.mpr-warnings { margin: 0; padding: 8px 14px 10px 32px; color: var(--mpr-muted); font-size: 12px; border-top: 1px solid var(--mpr-border); }
.mpr-credit { padding: 0 14px 8px; color: var(--mpr-muted); font-size: 11px; opacity: .8; }
`;
