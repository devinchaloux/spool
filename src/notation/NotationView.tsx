import { useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import type { MeiScore } from "../mei/types";
import { THEMES } from "../roll/themes";
import { engrave, type Engraving } from "./engrave";

/* ===========================================================================
 * NotationView: the file as notation, in place of the piano roll.
 *
 * Verovio draws the music as one long line (./engrave.ts). The player's own
 * clock drives it: each frame the player hands it the playhead, and it lights
 * the notes sounding then, in their part's color, and scrolls to keep them in
 * view, as the roll does. Notation is always ink on paper, whatever the roll's
 * theme: it is read as printed music. Notes are matched by xml:id, which the native reader
 * records and Verovio keeps. Clicking a note moves the playhead to it.
 * ======================================================================== */

export interface NotationViewProps {
  /** The MEI file, with an id on every note (src/mei/noteIds.ts). */
  text: string;
  score: MeiScore;
  /** One color per part, for the notes sounding; strengths that read on paper. */
  colors: string[];
  /** Whether each part is heard; silent parts' notes aren't lit. */
  audible: boolean[];
  height: number;
  /** How large to draw it: 1 is Verovio's own size, or smaller if that's taller than the player. */
  zoom: number;
  /** The view sets this; the player calls it every frame with the playhead. */
  frameRef: MutableRefObject<((beat: number, playing: boolean) => void) | null>;
  onSeek: (beat: number) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onStatus: (status: "loading" | "ready" | "error", message?: string) => void;
}

// At zoom 1, Verovio's own size, shrunk to fit a score taller than the
// player, though never below half: past that it scrolls instead. Fitting a
// one-line tune to the player's height made a giant staff, so it never grows
// unless the listener zooms in.
const MIN_SHRINK = 0.5;
const PAD = 8;
// How far toward the playhead the view moves each frame while it plays.
const FOLLOW = 0.25;
// The paper theme's darkest tone, for staves, notes and text.
const INK = "#1d1f26";

// Verovio draws from the file, which may come from anyone's link; keep only
// drawing in the SVG before it joins the page.
function toSafeSvg(markup: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.localName !== "svg") return null;
  for (const el of Array.from(svg.querySelectorAll("script, foreignObject"))) el.remove();
  for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    for (const attr of Array.from(el.attributes)) {
      const href = attr.localName === "href" && !attr.value.startsWith("#");
      if (attr.name.toLowerCase().startsWith("on") || href) el.removeAttribute(attr.name);
    }
  }
  return document.importNode(svg, true) as unknown as SVGSVGElement;
}

export default function NotationView(props: NotationViewProps) {
  const { text, score, height, zoom } = props;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [engraving, setEngraving] = useState<Engraving | null>(null);
  // Refs, so the frame function set up once sees the latest of these.
  const colorsRef = useRef(props.colors);
  const audibleRef = useRef(props.audible);
  const onSeekRef = useRef(props.onSeek);
  const onStatusRef = useRef(props.onStatus);
  useEffect(() => {
    colorsRef.current = props.colors;
    audibleRef.current = props.audible;
    onSeekRef.current = props.onSeek;
    onStatusRef.current = props.onStatus;
  });

  // ---- Engraving ---------------------------------------------------------
  useEffect(() => {
    let current = true;
    onStatusRef.current("loading");
    engrave(text).then(
      (e) => { if (current) { setEngraving(e); onStatusRef.current("ready"); } },
      (err: unknown) => { if (current) onStatusRef.current("error", err instanceof Error ? err.message : String(err)); },
    );
    return () => { current = false; };
  }, [text]);

  // ---- Drawing, lighting and following ----------------------------------
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !engraving) return;
    const svg = toSafeSvg(engraving.svg);
    if (!svg) return;
    const k = zoom * Math.max(MIN_SHRINK, Math.min(1, (height - 2 * PAD) / (engraving.height || 1)));
    // A new zoom keeps the same music in the middle of the view, or the start
    // in place when it all fitted.
    const old = box.firstElementChild as SVGSVGElement | null;
    const middle = old && old.clientWidth > box.clientWidth ? (box.scrollLeft + box.clientWidth / 2) / old.clientWidth : null;
    svg.style.width = `${engraving.width * k}px`;
    svg.style.height = `${engraving.height * k}px`;
    box.replaceChildren(svg);
    if (middle !== null) box.scrollLeft = middle * engraving.width * k - box.clientWidth / 2;

    // Every drawn note (and chord symbol, lit by the bass line) by id, and every sound by what it lights.
    const drawn = new Map<string, Element>();
    for (const g of Array.from(svg.querySelectorAll("g.note, g.harm"))) if (g.id) drawn.set(g.id, g);
    // Where clicking each drawn note or chord symbol moves the playhead.
    const startOf = new Map<string, number>();
    for (const n of score.notes) for (const id of n.ids ?? []) if (!startOf.has(id)) startOf.set(id, n.start);
    for (const c of score.chords) if (c.id && !startOf.has(c.id)) startOf.set(c.id, c.start);
    const sorted = [...score.notes].sort((a, b) => a.start - b.start);

    // ── Where the playhead is along the line ──
    // Each onset's place, measured once: the leftmost note drawn there. Between
    // two onsets the playhead moves at an even pace, so the view glides
    // through a bar instead of jumping from note to note. An onset drawn left
    // of the one before (music Verovio lays out in another order) is skipped,
    // so the view never runs backwards.
    const boxLeft = box.getBoundingClientRect().left - box.scrollLeft;
    const firstX = new Map<number, number>();
    for (const n of sorted) {
      for (const id of n.ids ?? []) {
        const g = drawn.get(id);
        if (!g) continue;
        const x = g.getBoundingClientRect().left - boxLeft;
        firstX.set(n.start, Math.min(x, firstX.get(n.start) ?? Infinity));
      }
    }
    const anchors: { beat: number; x: number }[] = [];
    for (const [beat, x] of [...firstX].sort((a, b) => a[0] - b[0])) {
      if (!anchors.length || x > anchors[anchors.length - 1].x) anchors.push({ beat, x });
    }
    const xAt = (beat: number): number | null => {
      if (!anchors.length) return null;
      if (beat <= anchors[0].beat) return anchors[0].x;
      let lo = 0, hi = anchors.length - 1;
      if (beat >= anchors[hi].beat) return anchors[hi].x;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (anchors[mid].beat <= beat) lo = mid;
        else hi = mid;
      }
      const a = anchors[lo], b = anchors[hi];
      return a.x + ((beat - a.beat) / (b.beat - a.beat)) * (b.x - a.x);
    };

    // ── Moving the view ──
    // The browser scrolls in whole pixels, which at a slow tempo moves the
    // music a pixel every few frames, a visible judder. So the view keeps its
    // own position, scrolls to the whole pixel below it, and shifts the music
    // the rest of the way with a transform. Scrolling by hand clears the shift.
    let pos = box.scrollLeft;
    let setByUs = -1;
    let manualAt = 0;
    const moveTo = (x: number) => {
      pos = Math.max(0, Math.min(x, box.scrollWidth - box.clientWidth));
      const whole = Math.floor(pos);
      setByUs = whole;
      box.scrollLeft = whole;
      svg.style.transform = pos > whole ? `translateX(${(whole - pos).toFixed(2)}px)` : "";
    };
    const onScroll = () => {
      if (box.scrollLeft === setByUs) return;
      // Moved by hand (wheel, drag or scrollbar): follow it, and pause following.
      pos = box.scrollLeft;
      svg.style.transform = "";
      manualAt = performance.now();
    };

    let lit = new Map<Element, string>();
    const frame = (beat: number, playing: boolean) => {
      const next = new Map<Element, string>();
      for (const n of sorted) {
        if (n.start > beat + 1e-6) break;
        if (beat >= n.start + n.dur - 1e-6 || audibleRef.current[n.part] === false) continue;
        const color = colorsRef.current[n.part] ?? colorsRef.current[0];
        for (const id of n.ids ?? []) {
          const g = drawn.get(id);
          if (g) next.set(g, color);
        }
      }
      for (const g of lit.keys()) if (!next.has(g)) g.classList.remove("mpr-sounding");
      for (const [g, color] of next) {
        (g as SVGGElement).style.setProperty("--mpr-lit", color);
        g.classList.add("mpr-sounding");
      }
      lit = next;
      // Follow: keep the playhead about 38% across, as the roll does, but not
      // for a moment after the listener has moved the view by hand.
      const x = xAt(beat);
      if (x === null || performance.now() - manualAt < 1500) return;
      const target = x - box.clientWidth * 0.38;
      if (playing) {
        // Eased a little toward the playhead: the target already moves
        // continuously, and the easing evens out the steps that remain (notes
        // aren't evenly spaced, and the audio clock advances in small chunks)
        // while trailing it by only a few pixels. After a jump (a seek, or the
        // view moved by hand) the same easing catches up without a snap.
        moveTo(pos + (target - pos) * FOLLOW);
      } else if (x < pos || x > pos + box.clientWidth) moveTo(target);
    };
    props.frameRef.current = frame;

    // --- input: wheel and drag to scroll, click a note to move there ---
    const onWheel = (e: WheelEvent) => {
      if (box.scrollHeight > box.clientHeight && e.deltaX === 0) return;
      e.preventDefault();
      box.scrollLeft += e.deltaX !== 0 ? e.deltaX : e.deltaY;
      manualAt = performance.now();
    };
    let dragging = false;
    let dragStartX = 0;
    let dragStartScroll = 0;
    let moved = 0;
    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      dragStartX = e.clientX;
      dragStartScroll = box.scrollLeft;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - dragStartX;
      moved = Math.max(moved, Math.abs(dx));
      if (moved >= 4) {
        box.scrollLeft = dragStartScroll - dx;
        manualAt = performance.now();
        box.style.cursor = "grabbing";
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      box.style.cursor = "";
      if (moved >= 4) return;
      const g = (e.target as Element | null)?.closest?.("g.note, g.harm");
      const start = g ? startOf.get(g.id) : undefined;
      if (start !== undefined) onSeekRef.current(start);
    };
    box.addEventListener("scroll", onScroll);
    box.addEventListener("wheel", onWheel, { passive: false });
    box.addEventListener("pointerdown", onPointerDown);
    box.addEventListener("pointermove", onPointerMove);
    box.addEventListener("pointerup", onPointerUp);
    return () => {
      box.removeEventListener("scroll", onScroll);
      box.removeEventListener("wheel", onWheel);
      box.removeEventListener("pointerdown", onPointerDown);
      box.removeEventListener("pointermove", onPointerMove);
      box.removeEventListener("pointerup", onPointerUp);
      if (props.frameRef.current === frame) props.frameRef.current = null;
    };
    // frameRef is a ref; the rest comes in through refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engraving, score, height, zoom]);

  return (
    <div
      ref={boxRef}
      className="mpr-notation"
      style={{ height, background: THEMES.paper.background, color: INK, fill: INK }}
      tabIndex={0}
      onKeyDown={props.onKeyDown}
      title="Drag or scroll to move. Click a note or chord symbol to set the playhead. Space plays; Home returns to the start."
    />
  );
}
