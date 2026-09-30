# Reliability review implementation and acceptance — 2026-09-30

## Repository and protection of existing work

Verified repository: Gunanzhao/NovelForge; origin fetch and push both use the matching GitHub HTTPS repository. Original main, fetched origin/main, review baseline and task baseline all equal `88bbdcc7ddde1e73e0a91f8d41da82ec717588ce`. Work runs in a separate managed worktree on `codex/reliability-review-20260930`. The original checkout has an unstaged deletion of `docs/release-1.1.1-rc.4.md` and untracked audit documents; these remain untouched and are excluded. No submodules or merge/rebase operations were found. No applicable AGENTS.md was found in the repository or checked ancestors.

No main push, PR creation, merge, release, history rewrite or branch protection change is authorized by this task. Stage labels below are acceptance stages, not remote PRs.

## Toolchain and baseline

Windows; Node 24.18.1, pnpm 11.19.0, Rust/Cargo 1.97.1 MSVC. Dependencies installed using `pnpm install --frozen-lockfile` in the task worktree. Current rusqlite is 0.32.1 (default busy timeout 5000 ms); no WAL change is planned. Preserve GLib vendor backport and optimized Linux regression.

Executed against baseline: `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS (77 files, 475 tests). `cargo test --manifest-path src-tauri/Cargo.toml --locked` is running; result pending. Baseline desktop/build not yet run. Historical published results are not this task's evidence. Local logs and synthetic fixtures stay ignored.

GitHub protection was read successfully: required contexts are `Frontend checks` and `Rust checks`, strict=true. Keep their names; additional Windows gates are additive. Enforcing any new check in protection requires a separate administrator action.

## Stage plan and acceptance mapping

| Stage | Implementation and decision scope | Required validation |
| --- | --- | --- |
| PR-1 H1/H2 | Windows full Rust and short desktop gates; real serde + Tauri dispatch fixtures shared with frontend; controlled contract drift rejection | Chinese temp path create/save/reopen, external conflict recovery copy, backup restore, exported body; missing/null/optional/Unicode/error/token contracts |
| PR-2 M1/N2 | Validate unknown recent cache and bound entries; root and major-view error boundaries preserving rescue text; retain async catches | malformed cache through welcome/load/remember chain; render failure retains editor state and allows copy/export |
| PR-3 M1/N3 | Independent application-data atomic snapshots, serializable document and form drafts, 10 second periodic target, bounded storage, visible errors, version-aware acknowledgement | continuous input, stale save completion, process termination, render failure, write failure, switch and conflict; recovery never silently overwrites |
| PR-4 M3/N1/N5/N4 | Typed storage failures, conservative recovery, persistent unresolved journals and rescue read mode, pre-write format/schema guards; measure connection/schema/recovery/lock cost before optimization | lock/permission/full disk/I/O/corruption/newer schema/journal truncation-ID-external changes; restart persistence and byte-identical future formats; N4 empty/live/crashed samples |
| PR-5 M5 | Usage and explicit preview, preserve named/protected histories and activity, recoverable cleanup, preserve journal commit markers | synthetic cleanup/interruption/restart, history reads, backup integrity and rescue copies |
| PR-6 M4/M6 | Redacted rotating startup diagnostics and native failure notice; only justified behavior-preserving extraction after gates; classify low priority items | redaction, startup failure visibility, full types/lint/frontend/Rust/build/desktop and exact pushed SHA CI |

## Safety and evidence rules

Preserve atomic writes, expectedContent conflict checks, recovery copies, lease reacquisition and journal/database coordination. Never rename damaged journals to ignore them; never delete unresolved commit markers. Classify BUSY/LOCKED, permission/read-only/full disk/I/O separately from confirmed corruption. Compatibility checks precede migration and recovery writes. Never clean real projects or call paid AI. All destructive fault tests use synthetic temporary fixtures.

M7 token ownership and M8 held-lock insertion are low-priority hardening, not demonstrated vulnerabilities. M9 global lock is not a measured bottleneck. N4 optimization is conditional on measured evidence. Refactoring and optional low-priority items may be deferred with explicit rationale; mandatory incomplete acceptance remains incomplete.

Each independently tested stage or subpart gets a scoped commit after explicit file staging and diff review. Final report records exact tested code SHA, commands/results/unrun items, stage commits, N4 results, local/remote SHA and matching CI. Failed or unavailable checks are never recorded as passed. A final task-branch push is permitted after local checks, with runner-only checks followed on the exact final SHA; otherwise incomplete draft push requires the user's decision.

## PR-1 verified implementation

Baseline Windows Rust: 159 passed, 7 ignored (existing opt-in tests), zero failures. Added shared JSON fixtures consumed by Rust serde and browser fallback, with real Windows production dispatcher checks in `scripts/reliability-smoke-cdp.mjs`. Missing/null required fields, omitted/null optional anchors, Unicode bodies, UUID-v4 lease tokens, string rejection envelopes and EXTERNAL_CONFLICT prefix are checked. Renamed content and changed error-envelope negative controls must reject. Existing Linux and Windows CLI compatibility jobs remain unchanged; additive `Windows reliability` builds and tests the production executable. Administrator enforcement of the new name is not changed here.

Validation on Windows: Rust targeted contract 1 passed; frontend shared fixture 1 passed; typecheck and lint passed; production `pnpm tauri build --no-bundle` passed; real WebView2 smoke passed including Chinese path, new chapter, full body save, lease close/reopen, conflict refusing overwrite plus exact recovery content, backup restore to a new directory and actual exported Markdown body. Initial fixture parent/format mismatches and a missing lint global were fixed before commit. No paid AI or real project data used. Native file-dialog/screenshot matrices are outside this short gate; WebView2 runtime and a desktop session are required. Startup/environment failure is reported separately from an initialized bridge failure; neither is a passing check.

## PR-2 verified implementation

Recent cache now parses unknown, rejects oversized/malformed roots, validates and bounds fields, deduplicates paths and keeps eight valid entries without clearing unrelated preferences/drafts. Root, primary view, inspector and AI host error boundaries retain the independent store and offer rescue textarea/copy/download and explicit retry without reload. Existing event/async handling remains in place.

Windows validation: `pnpm exec vitest run tests/recent-boundary.test.tsx tests/store-save.test.ts tests/store-session.test.ts` PASS (57); `pnpm typecheck` and `pnpm lint` PASS. Actual App welcome, loadRecent and createProject/rememberProject chain covers null, object, string, null array and invalid JSON. Synthetic render failure preserves dirty body even after retry. This stage rescues body; durable form snapshots belong to PR-3. jsdom required a matchMedia fixture, added without changing product behavior.

Prior stage commit: PR-1 `dedcf72`; planning `f4ec928`.

## PR-3 verified implementation

An application-data `draft-snapshots-v1` directory now stores atomic independent snapshots. Each has project UUID, canonical project path, SHA-256 identity fingerprint, target, UUID revision, monotonic timestamp-based version and captured time. A fixed 10,000ms clock runs outside React; typing does not restart it. Document and registered form payloads are cloned on change. Core character/location/world forms, attachment descriptions, chapter memory, planning forms, project info, annotation drafts and textual manuscript-import previews register serializable payloads. Binary attachments and AI credentials are not snapshotted. Browser fallback uses memory only and is explicitly not durable desktop evidence.

Limits: 2 MiB per snapshot, 100 targets and 50 MiB including atomic replacement headroom. Existing unresolved targets are not evicted to make room; failure is visible. A new target revision atomically supersedes its prior snapshot; acknowledgement removes only the matching UUID. A stale save/write cannot remove the newer revision. Orphaned/unmounted dirty snapshots remain available. Recovery is accessible from welcome and data settings, supports read-only current-body comparison, copy/export and explicit per-version removal; it never silently replaces external content.

Validation: full frontend 486 passed (80 files); Windows Rust 161 passed, 7 ignored; typecheck/lint and production build passed. New fixed-clock test inputs every 500ms for 31 seconds and observes snapshots at 10/20/30 seconds. Tests cover old save versus new edits, project switch, immutable form payload, failed write and retry, atomic restart reads and capacity refusal. Actual production EXE smoke forcibly terminates the process after a confirmed snapshot, restarts and reads exact newer content after acknowledging an old UUID. App-data and projects in the smoke are isolated temporary fixtures. Existing render failure, save conflict and backup/export chains also pass.

Recovery target is the latest completed write on each 10-second tick during a responsive process, not zero loss or a guarantee during suspended/blocked I/O, disk-full or power loss. An unconfirmed write may be lost; Windows atomic rename does not establish a whole-device power-loss guarantee. Oversize import drafts require manual export. Users should verify their exported file before explicitly removing a draft. PR-2 commit: `95b0ab1`.

## PR-4 verified implementation and N4 decision

Storage errors preserve rusqlite/I/O variants through open, node and entity queries; the IPC boundary emits stable category prefixes. BUSY/LOCKED retain a bounded 5000ms wait (the existing dependency default). Permission/read-only/full-disk/I/O/query errors no longer trigger database quarantine. Only confirmed SQLITE_CORRUPT/NOTADB enters mirror recovery. Original database and sidecars and rollback remain; mirror rebuild writes an explicit partial recovery report identifying missing history/activity/batch-state categories. Unresolved journals prohibit database reconstruction that would lose their commit markers.

Read-only format/schema preflight runs before session-file creation, schema initialization or recovery. Format 1 is supported; unknown formats are refused. Legacy database user_version=0 follows explicit schema initialization to version 1; version 1 is not rewritten; unknown future versions refuse writes. No journal_mode change. Malformed/ID-mismatched/external-change journals retain original evidence and a durable unresolved marker. Marker blocks normal connections after restart even if someone removes the bad journal. Committed journal after-images are also checked. The independent rescue reader and UI inspect/export safe Markdown without normal project connections. Unlock requires original verifiable journal evidence, integrity checks and existing referenced files; missing evidence cannot silently unlock.

Validation: full Windows Rust 167 passed, 7 ignored; frontend 486 passed; typecheck/lint passed. Actual production IPC smoke confirms future-format metadata/database bytes unchanged, truncated journal evidence retained, read-only rescue body and unresolved state after forced process restart. Rust tests also cover future schema, schema 0/1, real exclusive-lock timeout without quarantine, SQLite read-only and max_page_count-induced SQLITE_FULL, injected permission/I/O categorization, truncated/ID/external/committed-external journals and controlled unlock. Existing genuine-corruption and rollback tests pass. OS-wide disk exhaustion and real-user ACL changes were deliberately not performed; fault injection is on synthetic fixtures. One old junk-sidecar test now accepts the earlier READ_ONLY refusal, while still asserting exact original database/sidecar bytes; this is the intended conservative behavior, not a product failure suppressed.

N4 method: 5 sequential project_connection + all_nodes calls in each synthetic case, one SCHEMA call, one recover call and one Immediate transaction per read with a present journal directory. Windows microseconds: empty [2180,1862,1755,1721,1710]; live batch journal with 80ms owned write transaction [102743,107135,109014,108122,108620]; crashed uncommitted no-op journal [3191,3095,2657,2991,2657]. Live transaction commits its batch marker before recovery examines it. These small fixtures are not UI latency or network filesystem benchmarks. Connection splitting is deferred: samples do not establish a user-visible bottleneck and removing synchronization would risk active-batch misclassification. PR-3 commit: `59cfff8`.

## PR-5 verified implementation

Data settings now show body-history bytes, serialized entity-history bytes and retained batch payload bytes, followed by an explicit candidate list and confirmation. There is no automatic TTL. Only old exact automatic labels are eligible; latest per target, named/protected/unknown labels, recovery files and activity stay. Batch undo payload compaction is deferred; all unrelated batch markers/payloads stay, including those referenced by an unfinished journal. Preview fingerprints reject drift and missing history is a hard error, not omitted to make backup pass. Each operation is capped at 1000 candidates.

Cleanup writes a separate atomic intent journal while holding an Immediate transaction; database references are removed and a small dedicated marker commits first, then unreferenced files with matching hashes are removed. Interrupted pre-commit work rolls back without deleting files; post-commit work resumes safely on connection. External changes retain the file and journal and block normal access. The operation's own marker is removed only after its journal; unrelated markers are never deleted. Database free pages are reusable, not a promise that SQLite file size shrinks immediately. Destructive cleanup was executed only on temporary synthetic fixtures.

Validation: 4 Rust cleanup tests cover interruption before/after commit, external edits, named/protected/latest retention, missing history refusal, activity/recovery/marker retention, subsequent history reads and full backup creation. UI tests verify preview/confirmation/exact fingerprint and stale-session error rejection. Full frontend 488 passed; full Windows Rust 171 passed, 7 ignored; typecheck/lint passed. PR-4 commit: `4668583`.
