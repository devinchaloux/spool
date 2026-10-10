# Test files

**No test MEI files are committed to this repository** (decided 2026-10-07;
see `docs/decisions.md`). The one MEI file in the repository is the demo's
default, `demo/public/files/CRIM_Model_0052.mei`, credited and licensed
separately (`demo/public/files/LICENSE.md`); tests don't use it.

- **Stress test:** a script downloads the MEI project's sample encodings
  (`music-encoding/sample-encodings`, Educational Community License 2.0),
  pinned to one commit, into `fixtures/` (git-ignored): `npm run samples`, or
  `npm run stress`, which fetches and then reads every file. MEI 3.0, 4.0, 5.0
  and 5.1 only; 637 files. The 20 whose header carries a modern publisher's
  copyright notice are left out at run time, so 617 are read. The report is
  `fixtures/stress-report.md`.
- **Unit tests:** short MEI snippets written for the tests, in this
  repository's license.

If a file from anywhere else is ever needed, record it here first: file, what
it covers, source URL, license, date added.
