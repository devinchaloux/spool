# Decisions

**Status (2026-10-10):** Spool is a public alpha that opens a file from a
link and shares one as a link or an iframe embed, and plays the sampled
instruments from its own copy. The native reader works, and the player has a sound
picker, color themes, image export and several instruments in one roll, each
with its own color and sound. Tied notes sound once and grace notes play
before their beat. The composer and artist show when the file names them.
**Next action:** the second reader (Verovio) for any MEI file; annotations
once their list is settled.

Each decision gets: date, the choice, the alternatives rejected, and why, so it
isn't re-litigated later. Entries are binding until a later entry reverses
them; don't edit an old entry, add a dated note beneath it.

---

## Decided

### 2026-10-07: two readers behind one renderer

**Choice.** A small reader of our own for clean, simply encoded files, and the
Verovio toolkit for everything else, loaded only when needed. Both hand the
renderer the same note data, so drawing and playback are written once.

**Rejected.**
- *Verovio only:* correct across the repertoire, but every embedding page
  downloads several megabytes.
- *Our own reader only:* no extra download, but it must solve ties, repeats,
  pickup bars, tempo and meter changes and transposing instruments itself, and
  an unhandled case would show as a confident but wrong roll.

**Why.** Verovio already solves the hard timing problems and reports them as
data. Loading it on demand keeps small embeds light. Comparing the two readers'
output on public-domain files turns "is the small reader right?" into a
measurement.

### 2026-10-07: packaged as a component, with a demo, for installation

**Choice.** A component built as a library, plus a one-page demo that opens any
MEI file, published for anyone to install (npm) once the repository is public.

**Rejected.** A standalone page only: nothing for other sites to embed.

**Why.** Other pages need to embed the roll, and a demo makes it easy to try.

### 2026-10-07: test files are fetched, never committed

**Choice.** The stress test reads the MEI project's sample encodings
(`music-encoding/sample-encodings`, ECL-2.0), MEI 3.0 to 5.1. A script
downloads them, pinned to one commit, into a folder git ignores, and runs
every file. Files whose headers carry a modern publisher's copyright are left
out. Unit tests use short MEI snippets written for the tests.

**Rejected.** Committing a sample (about 21 MB for the small files) or the
whole set (about 113 MB): it stays in the history for good, and the MEI
project's repository is already the maintained source.

**Why.** The point is to run the roll over every file as it is built and see
what breaks; the result table is what is worth keeping, not the files.

### 2026-10-07: the tools, matching the maintainer's other projects

**Choice.** React (a peer dependency, version 18 or later), Vite, TypeScript 5.9,
Vitest, ESLint with the TypeScript and React Hooks rules, and jsdom for tests
that need a browser's XML parser. CI on GitHub Actions runs lint, tests and the
build.

**Rejected.** TypeScript 7: newer, but the lint tooling is proven on 5.

**Why.** The same tools as the maintainer's other public project, so one set of
habits covers both. React is a peer dependency because the page embedding the
roll already has it; two copies of React on one page break hooks.

### 2026-10-07: the reader reports what it leaves out

**Choice.** Every reader returns `warnings` alongside the notes: one entry per
kind of gap (ties drawn as separate notes, pickup bars padded, a meter written
where the reader doesn't look, skipped elements…) with a count. The player lists
them under the roll. An unreadable duration now takes no time instead of
breaking the whole timeline.

**Rejected.** Failing silently, as the prototype did: a user can't tell a
limitation from a bug.

**Why.** It is the "say what the roll leaves out" design bet, made concrete, and
it lets the stress test count each gap across the sample files.

### 2026-10-07: the stress test gives each file its own simulated browser

**Choice.** The stress test reads files in plain Node, creating a fresh jsdom
window per file and closing it afterwards.

**Rejected.** One shared jsdom window: it keeps every document it has parsed
and ran out of memory (8 GB) partway through the samples.

**Why.** Memory stays flat (about 55 MB) whatever the number of files.

### 2026-10-07: the native reader reads MEI where modern files write it

**Choice.** The reader now:
- takes the opening meter from any staff, the score, a `<meterSig>`, or the
  header's description of the work, and each staff's opening key from the
  staff, the score, a `<keySig>` or MEI 3's `key.sig`;
- takes a chord's duration from its notes when the chord has none;
- keeps a bar flagged `metcon="false"` (meant to be short, such as a pickup) at
  its real length, and reports where every bar starts, so the player draws bar
  lines and numbers from the file instead of every N beats from zero;
- reads only `<music>`, never an incipit quoted in the header;
- follows `copyof` references, MEI's shorthand for repeated content.

**Rejected.** Leaving these to the second reader: they are a few lines each,
and files exported by notation software hit the first one constantly.

**Why.** The stress test measured them. On the 617 sample files, files read
with no warnings went from 0 to 35, wrong-meter warnings from 474 files to 8
(the 8 really have no opening meter), and padded short bars from 367 to 139.
An unflagged short bar is still padded and reported: it is more often an
encoding slip than a pickup.

### 2026-10-07: sounds: built-in synths first, sampled instruments on demand

**Choice.** A sound picker with two kinds of sound:
- **Synths** (12: square lead, saw lead, supersaw, pluck, rave stab, warm pad,
  acid bass, sub bass, chiptune, organ, FM bell, sine), built from the
  browser's own oscillators and filters as data recipes (`src/audio/synth.ts`).
  Nothing to download. The square lead, the prototype's sound, stays the
  default.
- **Sampled instruments** (15, including piano and trumpet), played by the
  `smplr` library (MIT) from the FluidR3 General MIDI recordings (CC BY 3.0,
  credited under the roll whenever one is in use). Each is downloaded, about
  2-3 MB, the first time it is chosen, and the library's own code loads only
  then too.

**Rejected.**
- *Synths only:* no real piano or trumpet.
- *The Musyng Kite recordings,* smplr's default: richer but under a share-alike
  license.
- *Tone.js:* five times the size, for features the roll doesn't need.

**Why.** The roll's first audience reads music as a producer does, so
electronic sounds come first and cost nothing; real instruments are there when
a piece needs them, and a page pays for them only when someone listens.

**Known risk.** The recordings are fetched from a single volunteer-run GitHub
site. Before the package is public, host a copy alongside it (smplr supports a
custom address).

**Note (2026-10-10).** The hosted demo now has its own copy; see "the hosted
demo plays the sampled instruments from its own copy". The library's default is
still the volunteer site, until the tool has its own address.

### 2026-10-07: color themes, and notes follow the page's accent

**Choice.** Four themes for the roll's surface (`src/roll/themes.ts`): studio
(the default, a dark DAW surface), paper (light), neon (high contrast) and ink
(grayscale, for print), or any set of colors passed in. The note color comes
from the `accent` prop, else the page's `--accent` CSS variable, followed live,
else the theme.

**Why.** Following the page's variable means a site's theme or accent switch
recolors the notes with no wrapper code; the prop and themes cover pages that
have no such variable.

### 2026-10-07: still images as SVG, made without a browser

**Choice.** `rollToSvg(score, options)` draws any range of bars as SVG text:
size, keyboard, bar numbers, note names, transparent background, theme and note
color are options. It needs no browser, so a site's build can draw pictures
straight from the excerpt files. `svgToPng` makes a PNG in the browser. The
player's Image button saves the bars in view; the demo page has a full image
maker.

**Rejected.** Exporting the canvas directly: canvas images are fixed-resolution
and need a browser.

**Why.** Pictures made from the real files can't drift from them, and SVG stays
sharp at any size.

**Note (2026-10-08).** "Needs no browser" holds for the drawing only.
Reading the MEI (`parseNative`) uses the browser's `DOMParser`, so a site's
build in Node must supply one, such as jsdom's, before it reads a file.

### 2026-10-08: the demo is hosted on Vercel, open to anyone

**Choice.** Vercel builds the demo page (`npm run build:demo`, settings in
`vercel.json`): `main` deploys it and every pull request gets a preview link.
The deployments are not locked down: anyone with a link can open them.

**Why.** Trying the roll, and hearing the sampled sounds, should not require
installing anything; previews let a change be heard before it merges. The demo
holds no private material (it plays a built-in scale or a file the viewer opens),
so there is nothing for a sign-in to protect.

### 2026-10-08: brief interface text, details in tooltips, American English

**Choice.** The player and the demo say only what a control does or what to do
next; reasons, limits and how-to hints go in tooltips; status text appears only
while something loads or fails. The rules are in `CLAUDE.md` ("Writing
interface text"). The project is written in American English throughout.

**Why.** Short text gets read; long text gets skipped, and the useful detail
goes with it. The first version explained itself on screen (a permanent line of
instructions under the roll, a download note in the sound menu).

### 2026-10-08: quick-pick note colors

**Choice.** `NOTE_COLORS` offers eight named colors (Magenta, Sky, Rose, Cyan,
Amber, Lime, Violet, Neutral), each with a bright strength for dark themes and
a deeper one for light themes, chosen automatically. Every built-in theme's own
note color is one of them. The demo shows them as swatches beside a custom
color picker.

**Why.** Picking a color should take one click, and a color chosen on a dark
theme should still read when the theme turns light.

### 2026-10-08: a transport that schedules just ahead

**Choice.** Playback goes through a transport (`src/audio/transport.ts`) that
hands notes to the sound engine about a tenth of a second before they sound,
on a 25 ms timer. Play, pause, stop, seek, tempo and loop are its methods, and
it is unit-tested with a fake clock. The player tracks the listener's intent
separately, so pressing play again while a sound downloads cancels instead of
starting a second playback, and picking another sound mid-download plays the
newest choice.

Switching sound cuts the old one off at once: each sampled instrument has its
own output level, faded to silence in about 20 ms when it is left, rather than
ringing on through its release under the new sound. A synth note is
disconnected as well as stopped when playback halts, because some browsers
refuse a second stop() on a sound that already has one scheduled.

**Rejected.** Scheduling the whole piece when play is pressed, as before. The
sample library queues notes scheduled far ahead and its stop() leaves that
queue alone, so pausing, or switching instrument, kept the old notes playing.

**Why.** It is how players stay responsive: nothing is committed further ahead
than the lookahead, so every control acts at once.

### 2026-10-08: two player layouts, and a studio page for the demo

**Choice.** The player comes in two layouts. The full player puts the controls
in one bar under the roll: back to start, play/pause, loop, the position as
bar and beat, then sound, tempo, zoom, image and the "not shown" list. The
compact player, for essays, shows the roll with one play button over it, a thin
progress line, and a caption with the title and sound; it opens into the full
player in place. The demo became a studio page: a side panel for the file and
the look, and tabs for the full player, the compact player and the image maker.
Only the open tab's player exists, so two can never play at once.

**Rejected.** Controls above the roll (the first version), which put a row of
settings between the title and the music; and a media-player bar with the
settings in a pop-up, which hid the sound and tempo that producers change most.
A separate Stop button: back to start and pause cover it.

**Why.** The roll is the point, so the controls sit under it, as in a DAW's
transport. Essays need the music without the machinery; the studio page is
where the machinery lives.

**Note (2026-10-08).** The compact player's caption now starts with a
play/pause button: the button over the roll disappears while it plays, and
clicking the roll moves the playhead, so a reader had no way to pause other
than the space bar.

### 2026-10-08: several instruments in one roll

**Choice.** Every note now carries a `part`, an index into the score's new
`parts` list (`src/mei/types.ts`). A part is one instrument:

- **What counts as a part.** Each staff is its own part, except that a staff
  group is read as one part when it is braced or names an instrument (a label,
  or an `<instrDef>`), and its staves don't name different instruments. A
  piano's two braced staves are one part; a bracket named "Violini" over two
  unnamed staves is one part. A name on a later staff alone (a viola staff
  named inside a group of violins) names only that staff, and the unnamed
  staves take the group's name. A group label that is a bare number doesn't
  count as a name. Parts with no notes are dropped, so every part listed can
  be heard.
- **Colors.** The first part takes the note color, so a one-part file looks
  as before; the others follow from the quick-pick colors, in an order that
  keeps neighbors apart, in the strength that suits the theme. `partColors`
  overrides them.
- **One roll or lanes.** All parts share one roll by default. A toggle gives
  each part its own lane, fitted to its own pitch range, labeled, and the
  player grows taller rather than squeeze a lane below 56 px, or a pitch row
  below 4 px (`MIN_ROW_HEIGHT`): a quartet's cello spans more than three
  octaves, and at 56 px its notes were slivers. The canvas and
  `rollToSvg` both lay out through `src/roll/lanes.ts`, so a saved image
  matches the screen.
- **Mute, solo and a sound per part.** Each part has its own audio channel.
  Mute and solo set its level, so they act at once, even on notes already
  sounding; a muted part stays on the roll, faded. Solo plays only soloed
  parts, and a muted part stays silent either way. Each part has its own copy
  of a sampled instrument, so switching one part's sound never cuts another.
  The overall level comes down as parts are added (1/√n), so a full score
  doesn't clip.
- **Starting sounds.** A part starts with the nearest sound to the instrument
  the file names: by General MIDI program when an `<instrDef>` gives one,
  else by words in its name, in English, Italian and German
  (`src/audio/instruments.ts`). A staff with no name of its own takes one from
  the header's performer list (`<perfRes n="1">Violin I</perfRes>`), but only
  when that list numbers exactly the score's staves, so a list of another shape
  never names the wrong staff. "Bass" alone matches nothing (a voice or a
  double bass). A `sound` prop sets every part's starting sound instead.

**Rejected.**
- *A part per staff and layer,* as the architecture notes first suggested:
  two voices on one staff are one instrument, and splitting them would give a
  violin two mute buttons.
- *One sampled instrument shared by every part that uses it:* it has one
  output, so muting one part, or switching its sound, would either silence the
  others or leave the old sound ringing through its release. The cost of a
  copy per part is memory and a short decode when two parts pick the same
  instrument.
- *Mute by not scheduling notes:* a note already handed to the engine would
  play on.

**Why.** The roll's first audience reads music as a producer does, and
mute, solo and a color per track are how a DAW shows several instruments.
Lanes are not decoration: a wide score on one roll leaves a few pixels per
semitone. On the 617 sample files, 310 read as more than one part, and the
stress test's totals did not change.

### 2026-10-08: tied notes sound once, as one note

**Choice.** A tied chain becomes one note on the roll, as long as the whole
chain, and it sounds once. The reader finds a tie from a `<tie>` element (by
the notes it names, or, if it names only one end, the note of the same pitch
in the same part that meets it) or from a note marked `tie="i"` or `"m"`,
which continues into the next note of the same pitch in the same part,
starting where it ends. A chord's `tie` applies to each of its notes. A tie
whose other end can't be found is reported, and its notes play as written.

**Rejected.**
- *One long note with a faint line where the written notes meet:* the bar
  lines already show where they fall.
- *Two notes drawn, played as one sound:* the roll would show two attacks
  where one is heard.

**Why.** A tie is one sound, and a piano roll shows sounds, as a recording or
MIDI file would. Ties were the most common gap in the sample files (322 files);
after this, 64 still report a tie the reader can't follow, mostly where the
encoding marks a tie with no matching note after it.

### 2026-10-08: grace notes play just before the beat

**Choice.** A grace note plays just before the note it leads into, taking its
time from the note before, so the beat stays where it is written. It takes its
written length, but a run of grace notes takes at most half the time since the
note before, so that note is never swallowed. A grace note with no written
length, or with no time before it (at the very start of a part), is left out
and reported. All grace notes are placed this way, including those MEI marks
as accented (`grace="acc"`), which some performers play on the beat.

**Rejected.**
- *Leaving them off,* as before: the roll would drop notes that are heard.
- *On the beat, taking time from the main note:* it moves the written beat.

**Why.** It is how playback software usually performs them. Grace notes were
left out of 168 sample files; after this, 21 still report one it can't place.
With ties and grace notes handled, the files read with nothing left out went
from 35 to 144 of 617.

### 2026-10-08: tremolos play as the notes they stand for

**Choice.** A measured tremolo is shorthand for repeated notes, so the reader
writes them out: a `<bTrem>` repeats its note or chord, a `<fTrem>` alternates
between its two, each stroke one unit long, and the whole lasts as long as one
written note. The unit is `@unitdur` (or MEI 3's `@measperf`), else what the
slashes through a stem or the beams between a pair mean: one slash through a
quarter means eighths. A stated unit no shorter than the note can't be right
(one sample file gives a whole note for a dotted quarter), so the next source
is tried. A tremolo with no unit at all is unmeasured, "as fast as possible",
and plays held, with a warning. A tie out of a tremolo leaves from its last
stroke.

**Rejected.** Reading a tremolo as a plain container, as before: a `<bTrem>`
became one held chord, and a `<fTrem>` played both its notes at full length,
one after the other, pushing the rest of the bar late.

**Why.** The maintainer asked for Erlkönig's tremolo to read properly
(2026-10-08): its piano part is repeated triplet chords, written as tremolos,
and the roll showed one held chord per beat.

### 2026-10-08: more string sounds, and the metronome mark as a tempo

**Choice.** Viola, double bass and pizzicato strings join the sampled
instruments, and General MIDI programs and instrument names map to them
("Viola", "Bratsche", "Kontrabass", "pizz."). The tempo comes from `midi.bpm`
first, then from the metronome mark (`mm`, counted in `mm.unit`, so a dotted
quarter at 60 is 90 quarter notes a minute), then 120.

**Why.** A string quartet played a viola part on a violin and a cello part on
the default synth. Many files give only the metronome mark, and played at 120
regardless.

### 2026-10-08: a color for each part, and the embed keeps the chosen sounds

**Choice.** The demo's side panel lists the parts of a file with several; the
color picker sets the color of the part selected there, for all three tabs.
The demo remembers the sound chosen for each part in either player, so the
essay embed plays what the full player was set to, and the embed's tab shows
the code for an embed set up that way (theme, colors and sounds; defaults left
out, so a page's own accent still colors the notes unless one was chosen). The
player takes a `partSounds` prop, a starting sound for each part, and reports
changes through `onPartSoundsChange`.

**Rejected.** Picking colors inside the player itself: the colors are part of
how an excerpt is presented, set once by whoever embeds it, like the theme;
listeners change sounds, so those stay in the player.

**Why.** An essay's excerpt is set up in the studio page and then embedded;
without a way to carry the choices over, every embed played the file's
suggested sounds in the default colors.

**Note (2026-10-10).** The embed's tab is now **Share**, and its code is an
iframe anyone can paste, not React code; see "sharing a file by its address".

### 2026-10-08: the composer and artist, as the file names them

**Choice.** The reader returns `composer` and a new `artist` (a performer or
band, for a song), and the players show them beside the title. It finds a
composer in a `<composer>` element (MEI 3 and 4), a `<creator>` with a role
(MEI 5), or a name with a role (`<persName role="composer">`), with roles in
words or as MARC relator codes (`cmp`); an artist by the roles `artist`,
`performer` or `prf`, on a person's or a group's name (`<corpName>`, for a
band). It looks in the header first. Names listed together are joined; the
same person named again elsewhere in the header (in a source description,
often spelled differently) is not.

**Rejected.** Every credited name in the header: a file often credits its
encoder, editor and publisher, and names the composer twice.

**Why.** Before, only `<persName role="composer">` was read, and the demo
didn't show it at all. On the 617 sample files, a composer is now found in 420
(from 390), and no file lost one; the gain is files that use only `<composer>`.

### 2026-10-10: the hosted demo is a public alpha

**Choice.** The hosted demo is shared publicly as a tool anyone can open an MEI
file in, as Verovio offers its online viewer. It is labeled **Alpha** beside
its title, with a tooltip saying it changes often and lists what it leaves
out. Phones are not a target.

**Why.** The maintainer wants to share the public version of the tool
(2026-10-10). "Alpha" sets expectations: the reader handles cleanly encoded
files, and on the sample files most still report a gap.

**Note (2026-10-10).** The tool is named **Spool**, after the spool a piano
roll is wound on, and is to be hosted at `spool.devinchaloux.com`. The package
keeps the name `mei-piano-roll`, which says what it is to someone searching npm.
The repository was renamed from `mei-piano-roll` to `spool` the same day; GitHub
redirects the old address.

### 2026-10-10: the hosted demo plays the sampled instruments from its own copy

**Choice.** When the demo builds (`npm run build:demo`), `scripts/fetch-sounds.mjs`
downloads the recordings of every sampled instrument the player offers, read
from `src/audio/sounds.ts`, into `demo/public/sounds/`, which git ignores. The
source is the FluidR3 set as rendered by `gleitz/midi-js-soundfonts`, pinned to
one commit in `demo/sounds.json`; the folder is named after that commit, so
its files never change and browsers cache them for a year. MP3 only: every
browser decodes it, and it halves the copy, to about 45 MB. A `CREDITS.txt`
beside them carries the CC BY credit and license. The player takes a new
`samplesUrl` prop for a hosted copy; the demo sets it in its built version
only, so `npm run dev` still uses the volunteer site.

**Rejected.**
- *Committing the files:* about 45 MB (95 MB with the second format) in the
  history for good, in every clone.
- *Vercel Blob storage:* durable, but a second service on the maintainer's
  account to look after, and an upload step outside the repo.

**Why.** Listeners no longer depend on a volunteer-run site. Nothing large
enters git. If the source ever disappears, the next build fails loudly, the
live demo keeps its copy, and that copy is the place to move the files from
(to Blob storage, say) by changing one setting.

**Still open.** The library's own default stays the volunteer site. Once the
tool has a lasting address, the default could point at its copy, which would
then need a cross-origin header so other sites can read it.

### 2026-10-10: sharing a file by its address: a link, and an iframe embed

**Choice.** Spool can open a file from its address (**Open from a link**, or
`?src=` in Spool's own address), and **Share** turns a file that is online into
two things: a link that opens it in Spool with the theme, colors and sounds
chosen, and an iframe embed (`/embed`, the compact player alone) for any web
page. Both name the file's address and the settings in the query (`src`,
`theme`, `colors`, `sounds`); Spool stores nothing. A GitHub file page or a
Dropbox share link is turned into the file's raw address. In the embed, the
expand button opens the file in Spool in a new tab (`openHref`), and a light
theme gets light chrome. Embed options are never renamed once published.

**Rejected.**
- *React code to paste,* as the embed's tab gave before: only a developer who
  installs the package can use it, and nothing is on npm yet.
- *A web component* (a script tag and a custom element): it reads the host
  page's own files with no cross-origin setup, but many blog, course and site
  builders strip scripts and allow iframes. It can come later.
- *Uploading the file to Spool:* a server, storage and accounts for something a
  link already does.

**Why.** Spool is shared as a public tool for people who will mostly never
install anything; an iframe works in nearly every page that allows embeds, and
it is how Strata's embeds already work, so the two tools behave alike. The cost
is that the file's host must let other sites read it, which GitHub and Dropbox
do.

### 2026-10-10: a "Report an issue" link

**Choice.** The studio page's side panel links to the repository's new-issue
form, for bugs and suggestions.

**Why.** A public tool needs one obvious place for feedback.

## Open questions

| Question | Options |
|---|---|
| How is the roll drawn, and how does it make sound? | Settled by the existing prototype for now (canvas; the browser's own audio); revisit only if the move shows a reason |
| Which MEI elements does the roll handle first? | Notes, rests, ties and several staves first; list the rest as known gaps |
