# CLAUDE.md

Instructions for Claude Code in this repository. They apply to anyone working
on Spool with Claude; the maintainer's own session instructions load
from a private file through the import at the end.

**Current state (2026-10-08):** the native reader and the player work,
several instruments included, with unit tests, a demo page (`npm run dev`) and
a stress test over the MEI project's sample files (`npm run stress`). The
second reader is not built.
`docs/decisions.md` lists what is decided and what is open.

---

## What this project is

**Spool** is a piano roll player for MEI (Music Encoding Initiative) files,
packaged for npm as `mei-piano-roll`. It loads an MEI document, shows its
notes as a piano roll, and plays them.

The core design bets:
- **MEI is the source of truth.** The roll is derived from the encoding; the
  tool never rewrites the user's file.
- **Say what the roll leaves out.** MEI encodes more than pitch and time:
  editorial marks, alternate readings, ornaments. When the roll drops or
  resolves something, that choice is documented, never silent.
- **One renderer, whatever reads the file.** However a file is parsed, the
  parser hands the renderer the same note data, so drawing and playback are
  written once.

Read `docs/decisions.md` before changing anything architectural: it is
binding, and its table lists what is still open.

**Musical and encoding questions are the maintainer's call.** How a tie, grace
note, ornament or `<choice>` appears on the roll is a music-scholarship
decision. Raise it with the options and a recommendation; don't settle it in
code.

---

## Architecture in brief

- React + Vite + TypeScript, built as a library (`src/index.ts`). React comes
  from the embedding page, never from the bundle. Vitest for tests, ESLint for
  lint.
- **`src/mei/`** reads MEI into `MeiScore` (`src/mei/types.ts`): notes in
  quarter-note beats, plus **warnings** for anything the reader drops,
  simplifies or guesses. Every reader returns this one shape. No UI here, and it
  is unit-tested in `src/test/`.
- **`src/roll/MeiPianoRoll.tsx`** only draws (one canvas) and plays what a
  reader returns, and lists the warnings under the roll. Colors come from
  `src/roll/themes.ts`.
- **`src/audio/`** plays notes: synth sounds are data recipes in `synth.ts`;
  sampled instruments come from `smplr`, imported only when one is chosen, so
  pages using synths never load it.
- **`src/render/svg.ts`** draws still images as SVG with no browser needed;
  keep it in step with the canvas drawing when the roll's look changes.
- A new gap the reader knows about gets a warning, not a silent skip: the
  stress test counts them across the sample files.

---

## Working in this repo

**The repo is public: treat a push as a publication.** Anything pushed to any
branch can be read and can't be taken back: a deleted branch stays reachable through pull-request refs, forks and
clones.

1. **Work on a branch and open a pull request into `main`.** Never push to
   `main`.
2. **Ask before adding a dependency.** A dependency is a decision. Record it
   in `docs/decisions.md` with its reason.
3. **If you didn't create a file and its origin and license aren't clear, don't
   commit it.** This covers MEI files above all: scores and encodings carry their own
   copyright. No MEI files are committed; the stress test fetches them
   (`docs/fixtures.md`). The one exception is the demo's default file, kept
   with its license in `demo/public/files/` (`docs/decisions.md`, 2026-10-10).
4. **No secrets, tokens or personal email addresses** in any commit.
5. **Ask before anything destructive:** deleting files, `git reset`, anything
   that touches an outside service.

### Checks

CI (`.github/workflows/ci.yml`) runs lint, a guard against `TEMPORARY`
markers, the tests and the build (`tsc`, then `vite build`) on every push and
pull request. Run the same before pushing:

```bash
npm run lint && npm run test:run && npm run build
```

A comment marked `TEMPORARY` is a merge blocker; CI fails on one.

`npm run stress` is not part of CI: it downloads about 113 MB and its job is
to show what breaks. Run it after any change to a reader and compare its
totals with the last run.

### Commit messages

Conventional Commits: `<type>(<scope>): <summary>`, then an optional body saying
why. Types: `feat`, `fix`, `refactor`, `docs`, `chore`. Scope is the area
(`parser`, `roll`, `playback`, `docs` …). Write them for a stranger reading the
history.

---

## Code style

- **Match existing patterns**; don't introduce new ones without asking.
- **Legibility over cleverness.**
- **No `any`**: use `unknown` and narrow.
- **Comments explain why, not what.** Good: `// MEI durations are fractions of
  a whole note; convert to beats before scheduling`. Bad: `// get duration`.
- **Section dividers** in longer files: `// ── Section name ──`.

---

## Writing interface text

**American English everywhere**: code, comments, docs and the interface
("color", "license", "behavior").

Text in the player and the demo reads like brief technical documentation:
1. Say what a control does, or what to do next, in as few words as that takes.
2. Never explain how the code works or why it was built this way; that belongs
   in `docs/decisions.md`.
3. Anything more a reader might want (a reason, a limit, a reassurance) goes in
   a tooltip, not on the screen.
4. Inline text stays only when it prevents a mistake.
5. One idea, one wording, everywhere it appears.
6. Write sentences, not fragments spliced with dashes.

---

## Docs are part of the change

A doc that describes something the code no longer does is worse than no doc.
Docs land in the same commit as the change that invalidates them:

- every design decision gets an entry in `docs/decisions.md` with its reason;
- a behavior change updates the README's "Status" section;
- a new source of test files updates `docs/fixtures.md`.

Before committing, grep for what the change invalidates:

```bash
grep -rn "<the identifier>" docs/ README.md CLAUDE.md
```

A historical record stays; a live instruction that is now wrong gets rewritten.

---

## Maintainer instructions

These load from the maintainer's private notes, checked out beside this repo.
In a cloud environment that holds only this repo the import below loads empty.

@../research/piano-roll/maintainer.md
