# Spool (mei-piano-roll)

🎹 A piano roll player for MEI (Music Encoding Initiative) files. The hosted
tool is called **Spool**; the package keeps the name `mei-piano-roll`. It reads an
MEI file in the browser, draws its notes as a piano roll, plays them with a
choice of synths or sampled instruments, makes still images of any bars, and
lists anything in the file it could not show faithfully.

## Status

**2026-10-10:** the hosted demo is a public alpha, and plays the sampled
instruments from its own copy of the recordings. The first reader works. It handles short, cleanly encoded files.
On the MEI project's 617 sample files it reads everything without crashing, and
144 read with nothing left out; the rest report a gap (repeats, mid-piece
changes, notes without a length, a few ties it can't follow). Tied notes sound
once, as one long note, grace notes play just before their beat, and measured
tremolos play as the repeated notes they stand for. A file with
several instruments shows each in its own color, on one roll or one lane per
part, with mute, solo, a color and a sound for each, starting from the
instruments the file names. The composer, and the artist for a song, show
beside the title when the file names them. The second reader, for everything
else, is not built yet. Nothing is published to npm yet.

## Try it

Requires Node 22 or later.

```bash
npm install
npm run dev
```

Open the address it prints. The demo shows a built-in two-part example; open any `.mei`
file, or drop one on the page. The file stays in your browser. Three tabs show
the **full player**, the **compact player** as it sits in an essay, and the
**image maker**, which saves any bars as SVG or PNG. The side panel sets the
theme and each part's color for all three. Sounds chosen in either player
carry over to the other, and the compact player's tab gives the code for an
embed set up that way (**Copy code**).

The same demo is hosted on Vercel (`vercel.json`): `main` deploys it, and each
pull request gets its own preview link. To build it yourself:

```bash
npm run build:demo   # static site in dist-demo/
```

The build first downloads the sampled instruments (about 45 MB, once) into
`demo/public/sounds/`, which git ignores, so the hosted demo plays them from
its own address (`npm run sounds` does only that step).

## Use it in a React page

```tsx
import { MeiPianoRoll } from 'mei-piano-roll'

<MeiPianoRoll src="/music/example.mei" />
// or, with the file's text already loaded:
<MeiPianoRoll meiText={xml} height={320} onLoad={(score) => console.log(score.warnings)} />
// in a page of text: a play button over the roll, a one-line caption with play/pause
<MeiPianoRoll src="/music/example.mei" variant="compact" />
```

| Prop | What it does |
|---|---|
| `src` / `meiText` | The MEI file, by address or as text |
| `variant` | `"full"` (default): the roll with its controls underneath. `"compact"`: a play button over the roll and a caption line with play/pause, the title and the composer; it opens into the full player |
| `header` | Show the title line above the full player; default `true` |
| `sound` | Starting sound for every part, by id (see `SOUNDS`); default each part's nearest sound to the instrument the file names, else the square lead |
| `partSounds` | Starting sound for each part, by id, in score order; takes precedence over `sound` |
| `samplesUrl` | Where the sampled instruments are hosted: a folder of FluidR3 `<instrument>-mp3.js` files, ending in `/`; default the volunteer-run site smplr uses |
| `onPartSoundsChange` | Called with every part's sound whenever the listener changes one, so a page can keep the choice |
| `theme` | `"studio"` (default), `"paper"`, `"neon"`, `"ink"`, or your own colors |
| `accent` | Note color (the first part's, with several); without it, the page's `--accent` CSS variable, then the theme's |
| `partColors` | One color per part, in score order; default the note color, then quick-pick colors |
| `separateParts` | Start with each part on its own roll; default `false` |
| `height`, `pxPerBeat`, `bpm` | Size, starting zoom, tempo override |
| `onLoad` | Called with the parsed score, warnings included |

Also exported: `NOTE_COLORS`, eight quick-pick note colors that adjust for
light and dark themes; `parseNative(xml)` for the note data without the player; and
`rollToSvg(score, options)` for still images (`partColors`, `separateParts` and
`fadedParts` match the player's view of several parts). Drawing needs no
browser, so a site's build can draw pictures straight from its files; reading
the MEI does need an XML parser, which Node lacks, so a build gives
`parseNative` one first, such as jsdom's `DOMParser` (the stress test does
this, in `stress/samples.stress.ts`).

Sampled instruments are FluidR3 GM by Frank Wen (CC BY 3.0), played by
[smplr](https://github.com/danigb/smplr); the player credits them whenever one
is in use.

## Checks

```bash
npm run lint && npm run test:run && npm run build
```

CI runs the same on every push. `npm run build` type-checks, then builds the
library into `dist/`.

## Stress test

```bash
npm run stress
```

Downloads the MEI project's sample files (about 113 MB, once) into `fixtures/`,
which git ignores, reads every one, and writes `fixtures/stress-report.md`. It
takes about two minutes. Its job is to show what breaks, not to pass; see
[`docs/fixtures.md`](docs/fixtures.md).

## Layout

| Path | What it is |
|---|---|
| `src/mei/` | The reader: MEI text in, note data and warnings out. No UI. |
| `src/roll/` | The player component (one canvas), its color themes, and the lane layout it shares with the images. |
| `src/audio/` | Sounds: the synth recipes, the sampled-instrument list, a part's starting sound, the engine that plays them. |
| `src/render/` | Still images: SVG from a score, and PNG in the browser. |
| `src/test/` | Unit tests, with short MEI snippets written for them. |
| `demo/` | The demo page (`npm run dev`); not part of the library. |
| `stress/` | The stress test (`npm run stress`). |
| `scripts/fetch-samples.mjs` | Downloads the sample files for the stress test. |

## Docs

- [`CLAUDE.md`](CLAUDE.md): rules for working on this repo with Claude Code
- [`docs/decisions.md`](docs/decisions.md): design decisions and open questions
- [`docs/fixtures.md`](docs/fixtures.md): where the test files come from
