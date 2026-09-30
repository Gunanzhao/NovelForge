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
