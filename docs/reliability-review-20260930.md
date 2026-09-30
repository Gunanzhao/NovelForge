# Reliability review implementation and acceptance — 2026-09-30

## Repository and protection of existing work

Verified repository: Gunanzhao/NovelForge; origin fetch and push both use the matching GitHub HTTPS repository. Original main, fetched origin/main, review baseline and task baseline all equal `88bbdcc7ddde1e73e0a91f8d41da82ec717588ce`. Work runs in a separate managed worktree on `codex/reliability-review-20260930`. The original checkout has an unstaged deletion of `docs/release-1.1.1-rc.4.md` and untracked audit documents; these remain untouched and are excluded. No submodules or merge/rebase operations were found. No applicable AGENTS.md was found in the repository or checked ancestors.

No main push, PR creation, merge, release, history rewrite or branch protection change is authorized by this task. Stage labels below are acceptance stages, not remote PRs.

## Toolchain and baseline

Windows; Node 24.18.1, pnpm 11.19.0, Rust/Cargo 1.97.1 MSVC. Dependencies installed using `pnpm install --frozen-lockfile` in the task worktree. Current rusqlite is 0.32.1 (default busy timeout 5000 ms); no WAL change is planned. Preserve GLib vendor backport and optimized Linux regression.

Executed against baseline: `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS (77 files, 475 tests). Baseline `cargo test --manifest-path src-tauri/Cargo.toml --locked` subsequently passed: 159 passed, 7 ignored. Baseline desktop/build was not run separately; task production build and desktop evidence follow below. Historical published results are not this task's evidence. Local logs and synthetic fixtures stay ignored.

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

## PR-6 verified implementation

Startup diagnostics use an allowlist of timestamped codes, discard arbitrary error strings, rotate startup.log at 256 KiB with one retained file, and live outside projects. Windows GUI startup failures show a native MessageBox even without a terminal; a failure to write the log has its own visible notice. The explicit offline self-test switch exercises the same failure path in the release EXE without opening a project. Linux writes diagnostics but its notification remains stderr; native GUI failure acceptance here is Windows-only.

Low-priority disposition:

| Item | Disposition and evidence |
| --- | --- |
| M6 responsibility boundaries | Added narrow drafts, diagnostics, rescue and history-cleanup modules; deferred broad save/session/export reshuffling because it is unnecessary for these fixes and would expand regression scope. |
| module-wide unused_imports | Deferred until glob/re-export ownership can be cleaned independently; removing suppressions without organizing imports would introduce unrelated churn. Clippy with -D warnings passes the current tree. |
| async session errors | Implemented: AutoBackupSettings rechecks current session after the directory operation rejects; stale cleanup/recovery results are also guarded. |
| ambiguous transport boolean | Implemented: explicit demoAllowed / desktopOnly modes retain existing fallback behavior. |
| configuration type checks | Implemented typecheck:config for Vite/Vitest TypeScript, run in Frontend checks; checkJs=false explicitly. JavaScript remains covered by ESLint. |
| recovery/trash names | Recovery copies now have UUID suffixes; 20 rapid copies retain distinct bodies. Existing trash ref_id + original filename retained; extra UUID hardening deferred without collision evidence. |
| removal helper | Implemented direct remove_file, swallowing only NotFound. |
| concurrent navigation | Existing policy drops another request while a confirmation is pending; different-destination regression proves one confirmation executes only the first callback. |
| M7 / M8 / M9 | Existing UUID-v4 token/ownership and held-lock insertion invariants retained. No demonstrated security flaw/panic/bottleneck; speculative changes deferred. |
| CSP, GLib backport, evidence | Unchanged policies, vendor source and optimized regression preserved; large screenshots/logs remain ignored local artifacts. No Release published. |

Final snapshot audit additionally guards transition frames so old form fields cannot be attributed to a new project/entity, exposes serialized form rescue text at the error boundary, and clears a visible write error only after a successful retry. A real App/store/scheduler integration test keeps typing every 500 ms with no 900 ms gap and verifies the 10-second snapshot before automatic save. This supplements, rather than substitutes for, the production process-kill/restart test.

Windows validation on the final code: pnpm typecheck, pnpm typecheck:config, pnpm lint; pnpm test (84 files, 491 passed); cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check; cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings; cargo test --manifest-path src-tauri/Cargo.toml --locked (173 passed, 7 existing opt-in ignored); pnpm tauri build --no-bundle: all PASS. Existing bundle-size advisory remains non-fatal.

Release EXE validation: scripts/startup-diagnostics-test.ps1 PASS with process-owned visible native window and isolated STARTUP_SELF_TEST log; scripts/reliability-smoke-cdp.mjs PASS with real registered Tauri dispatch, Unicode lifecycle, conflict recovery, backup/export, future-format no-write, unresolved-journal restart and independent snapshot process-kill/restart. Original pnpm test:e2e:desktop PASS across editor/tree/drag/drop/history/entity/wiki/statistics/settings/recovery/planning/search/mock-AI/cancellation/trash/exports. The full desktop run used temporary APPDATA/LOCALAPPDATA and mock provider, with native-dialog/webdriver/real-Codex options disabled. It is not a native-file-dialog or screenshot matrix and did not use paid AI.

Local evidence indexes (ignored tmp/): final-frontend.log, pr6-full-rust.log, final-clippy.log, final-build.log, final-startup.log, final-reliability-desktop.log, final-full-desktop.log. Initial startup-window title lookup was replaced by PID-scoped enumeration; only the final passing run is acceptance. CI adds the same native startup and IPC scripts after the production Windows build. PR-5 commit: 015ee2b.

## Final local acceptance and commit index (2026-10-01)

Tested code SHA: abf0b1d4c655c93544527573c3492e02a72cdfed. This final report-only commit changes no tested application code. Full local commands and result counts are recorded under PR-6; after the report commit, rerun frontend/config type checks and lint, and verify Git whitespace/working-tree state before pushing. Windows Node 24.18.1, pnpm 11.19.0, Rust/MSVC 1.97.1 were used; CI selects Node 22 and stable Rust. Seven opt-in Rust tests remain ignored, not passed.

| Stage | Commit | Main changed paths / evidence |
| --- | --- | --- |
| Plan | f4ec928 | docs/reliability-review-20260930.md |
| PR-1 | dedcf72 | .github/workflows/ci.yml; scripts/reliability-smoke-cdp.mjs; tests/fixtures/reliability-contract.json; src-tauri/src/reliability_contract_tests.rs; tests/reliability-contract.test.ts |
| PR-2 | 95b0ab1 | src/stores/app-store.ts; src/components/ErrorBoundary.tsx; src/main.tsx; src/App.tsx; tests/recent-boundary.test.tsx |
| PR-3 | 59cfff8 | src-tauri/src/drafts.rs; src/lib/draft-snapshot-scheduler.ts; src/lib/draft-snapshots.ts; src/hooks/useUnsavedDraft.ts; src/components/DraftSnapshotRecovery.tsx; registered view forms; tests/draft-snapshots.test.ts |
| PR-4 | 4668583 | src-tauri/src/storage/errors.rs, database.rs, batch.rs; commands/mod.rs, project.rs, rescue.rs; src/components/ProjectRescue.tsx; conservative_recovery_tests.rs |
| PR-5 | 015ee2b | src-tauri/src/storage/history_cleanup.rs; commands/history_cleanup.rs; src/components/HistoryStorage.tsx; cleanup Rust/UI tests |
| PR-6 | abf0b1d | src-tauri/src/diagnostics.rs; src-tauri/src/lib.rs; scripts/startup-diagnostics-test.ps1; history/filesystem helpers; config/transport/session maintenance; snapshot identity/runtime and navigation tests; README.md |

Pre-push fetch confirms origin/main remains 88bbdcc7ddde1e73e0a91f8d41da82ec717588ce, the task branch descends from that baseline, and no same-named remote task branch exists. Origin fetch/push both point to https://github.com/Gunanzhao/NovelForge.git. Original main and its four dirty/untracked entries remain unchanged; only the isolated task worktree is committed. No credentials, real drafts/databases, build outputs or screenshots were staged. The task branch is codex/reliability-review-20260930. No PR, main update, merge, Release or branch-protection change is authorized or performed.

Delivery verification: push the final docs commit, compare its local SHA with git ls-remote, then follow every triggered GitHub run for that exact SHA to completion. The delivery response records the actual final SHA and verified run URLs/outcomes; no previous green run substitutes for this gate. At report-commit time remote CI has not yet been triggered. Existing path-filtered Codex CLI compatibility is preserved; if not triggered, record that fact rather than claiming a new compatibility run passed.

Remaining limits: no native file-dialog/screenshot matrix, no real AI generation, no OS-wide disk exhaustion or real-user permission mutations. Those are not replaced by mock claims; detailed scope is above. Linux native startup GUI notice remains unsupported. N4 lightweight-connection optimization, broad refactoring, unused-import cleanup, batch undo-payload compaction and optional M7/M8/trash hardening are deliberately deferred with reasons. The added Windows job is not yet a required branch-protection context; administrator action is optional and outside this task.

## CI follow-up: dependency audit

First exact-SHA CI run [36747675578](https://github.com/Gunanzhao/NovelForge/actions/runs/36747675578), for 487202706abb5ff3e3f3723c96bd40802a106a48, failed Frontend checks at its existing pnpm audit step before frontend checks ran. The unchanged baseline lockfile contained brace-expansion 1.1.18 and 5.0.9, affected by [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) and [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p). Updated only these transitive patch lines to 1.1.21 / 5.0.12; package.json, direct versions and audit policy are unchanged. No broad pnpm update or audit bypass.

Post-fix Windows checks: frozen install, pnpm audit --audit-level high (no known vulnerabilities), typecheck, typecheck:config, lint, full frontend 491 tests and pnpm build PASS. Runtime/Rust source is identical to the previously fully tested abf0b1d. A new exact final SHA must pass all remote jobs; the first failure is retained as evidence, not labelled green. Initial direct Git HTTPS failed; using the already-enabled Windows system proxy for the individual Git command succeeded without changing persistent settings or origin.

Final tested source/dependency SHA after the audit repair: 7dca8c7aa10e20349dd6f6b7229c6808ac442a77 (repair commit), following final-report commit 4872027. Application/Rust source remains abf0b1d. The first pushed SHA's Linux Rust checks completed successfully, including format, Clippy, tests, cargo-audit and the optimized GLib backport regression; Windows was still running when this follow-up report was committed. All future run outcomes must be read against the final pushed SHA, not inferred from these intermediate results. The report-only follow-up will again be followed by typecheck/config/lint and exact remote SHA verification.

## CI follow-up: canonical-path regression assertion

The first Windows full suite completed with 172 passed, 1 failed and 7 ignored. Its only failure was the pre-existing legacy_interruption_reports_preserved_metadata_copy assertion comparing the caller's noncanonical temporary path spelling to the canonical path that existing_project_root reports. The diagnostic still identified legacy interruption; the exact runner alias was not printed by that assertion. Windows DOS aliases and equivalent parent path components need not retain the input spelling.

The test now requires the exact canonical preserved-copy path in the error, tests both normal and parent-component inputs, and still verifies the original bytes. Production behavior is unchanged and the test is not skipped. Local targeted atomic tests: 3 passed; full Windows Rust: 173 passed, 7 ignored; strict Clippy and rustfmt PASS. Evidence: tmp/ci-first-failed.log, tmp/ci-path-fix-targeted.log, tmp/ci-path-fix-full-rust.log, tmp/ci-path-fix-clippy.log. Intermediate run [36748789879](https://github.com/Gunanzhao/NovelForge/actions/runs/36748789879) on 2f8a8226b3906c374b368828a5dee92c70e5894a already passed Frontend checks and Rust checks; it predates this test correction and cannot establish final Windows acceptance.

## Delivery revision after CI corrections

Latest tested code/test/lockfile SHA: e1fd81399fc7a5c150d25ddda02e6c871bab55ed. This supersedes earlier tested-SHA labels for delivery. Application runtime source remains abf0b1d; the only later source edit is the canonical-path test above. Frontend dependency state was fully revalidated at 7dca8c7, and the final Rust state was fully revalidated at e1fd813. Final local counts remain frontend 491 passed and Windows Rust 173 passed / 7 ignored; no mandatory local failure remains unexplained.

Additional commits since the six stages: 4872027 final acceptance documentation; 7dca8c7 dependency audit patch; 2f8a822 dependency acceptance documentation; e1fd813 canonical-path regression correction. This report-only delivery revision is followed by type/config/lint/format checks, normal push and exact remote-SHA CI tracking. Superseded CI runs retain their actual failed/cancelled status; only the final SHA's completed jobs establish remote acceptance. Existing Codex CLI compatibility remains path-filtered and has not been triggered by these changes.

## CI follow-up: explicit WebView2 provisioning

Run [36749529171](https://github.com/Gunanzhao/NovelForge/actions/runs/36749529171) on bd322192ff9820dc830ee69e6ccc82dadeba0c3d passed Frontend checks, Linux Rust checks, all 173 Windows Rust tests and the production EXE build. Its real IPC smoke failed before bridge initialization with STARTUP_OR_ENVIRONMENT_FAILURE; the native notice step was consequently skipped. This run is failed, not desktop acceptance. The runner software manifest does not promise a WebView2 Runtime, and the job previously had no explicit preparation step. The timeout alone did not prove which startup prerequisite was missing.

The Windows job now detects a genuine installed WebView2 Runtime and, only on the disposable GitHub runner when missing, downloads the official Microsoft bootstrapper, verifies its Authenticode signature, installs silently and verifies the runtime executable. It resolves the browser folder before tests isolate LOCALAPPDATA. This follows [Microsoft deployment guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution); it does not substitute a browser/mock for Tauri. Native-window acceptance runs before the IPC smoke to distinguish desktop-session availability from WebView startup. Failed startup now prints only process exit state and allowlisted startup codes. Successful compilation is cached before desktop tests so an environment failure does not discard a valid build; failures still fail the job.

Local verification: runtime probe found the existing genuine runtime (no local installation), official installer download had a valid Microsoft Corporation signature, PowerShell parse check and lint passed, and the updated production IPC script passed every lifecycle/kill/restart assertion using the selected real runtime. Remote installation and desktop-session acceptance remain pending the next exact-SHA run. Product Rust/frontend source has not changed. The PR-4 changed-path index above was also corrected to point to commands/mod.rs rather than a nonexistent storage/recovery.rs.

Latest tested acceptance-harness revision: 371a9e8253033ee78c6f709493cdf0b53105db22. Product/test/lockfile acceptance remains e1fd813 as above; this revision changes CI provisioning and startup failure diagnostics, with local production IPC revalidated. Its report-only successor is the next delivery candidate. Earlier bd32219 is now an intermediate failed CI revision; the final response must name the new local/remote SHA and its actual completed run rather than reuse the earlier partial successes.
