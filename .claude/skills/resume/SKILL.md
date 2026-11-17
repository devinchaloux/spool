---
name: resume
description: Pick up work from a session that stopped while its pull request was open — check out the PR's branch, read the handoff in its description, re-subscribe, and carry on. Use when the maintainer says "resume", "pick up", "continue PR #N", or "carry on where the last session stopped". Also says how a session keeps that handoff current while its PR is open.
---

# Resume from an open pull request

A paused cloud session's container is reclaimed, and a new session used to
start cold: re-reading the repo, the notes and the diff to work out where
things stood. So **a session with an open PR keeps a handoff in the PR's
description**, and the next session reads that instead.

## Writing the handoff

**While your PR is open, end every turn with its handoff current.** You can't
know which turn is your last. Update only the `## Handoff` section of the PR
body, at the end of the body, and keep the rest as it is.

**This repo is public, and so is the handoff.** Write it like any PR text: the
state of the work and the next steps. Private notes stay out of it.

```markdown
## Handoff

<!-- Kept current by the session at the end of each turn. Read by the resume skill. -->
**Updated:** 2026-11-17 21:40 UTC · **Branch:** `claude/<slug>`

**Where it stands:** two or three sentences: what is built and pushed, what
is half done, and whether CI is green.

**Next:**
1. The very next step, concrete enough to start on.
2. …

**Waiting on the maintainer:** what has to be decided or done first, or "nothing".
**Not pushed:** work that isn't pushed, or "nothing". Push before you end a turn whenever you can.
**Gotchas:** what cost time this session and will again.
```

Keep it short: the diff and the commits carry the detail. A handoff on a
merged or closed PR is history; nothing reads it.

## Picking up

The maintainer types `/resume`, or `/resume <PR number>`, or says the same in
words.

1. **Find the PR.** With a number, read it. Without one, list this repo's
   open PRs and take those whose body has `## Handoff`. One: take it.
   Several: ask which, naming each by title and handoff date. None: say so,
   and offer to start fresh.
2. **Check out its branch**, not the one this session was given:
   ```bash
   git fetch origin <branch> && git checkout -B <branch> FETCH_HEAD
   ```
   Resuming is permission to push there: commits go to the open PR.
3. **Subscribe** to the PR (`subscribe_pr_activity`). If another session is
   already watching it, that is the stopped session: say so, and ask before
   archiving it.
4. **Do the rest of your session start**, skipping the reading the handoff
   stands in for.
5. **Say where things stand** in two or three lines, from the handoff and the
   PR's latest CI, and start on Next step 1 unless the handoff says it waits
   on the maintainer.
