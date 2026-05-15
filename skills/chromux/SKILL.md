---
name: chromux
description: Real Chrome browser automation through the chromux CLI. Use when an agent needs to open, inspect, interact with, scrape, test, or verify web pages using isolated Chrome profiles and raw CDP.
version: 0.1.0
platforms: [macos, linux]
metadata:
  hermes:
    tags: [browser, chrome, cdp, automation]
    category: browser
---

# chromux

Direct browser control through the `chromux` CLI. chromux launches or reuses an
isolated real Chrome profile, keeps one daemon per profile, and exposes a small
CLI surface for tab work, multi-step JavaScript, raw CDP, screenshots, and
diagnostics.

For setup, installation, or connection problems, read the repo's `install.md`.
For multi-step browser work orchestration, use the `chromux-work` skill. For the
current command surface, run `chromux help`; it is the source of truth.

## First Rule

Resolve the chromux command once, then inline the resolved command and session ID
literally in every shell call. Do not rely on shell variables persisting across
agent tool calls.

```bash
CX=$(command -v chromux 2>/dev/null || echo "") && [ -n "$CX" ] && echo "$CX" || echo "MISSING"
```

If chromux is missing, read the repo's `install.md` and install it before
browser work.

## Normal Workflow

1. Generate a unique session ID, for example `exp-ab12`.
2. Open the page: `<chromux> open exp-ab12 <url>`.
3. Inspect structure with `<chromux> snapshot exp-ab12`.
4. Prefer `@ref` interactions from the snapshot:
   - `<chromux> click exp-ab12 @<N>`
   - `<chromux> fill exp-ab12 @<N> "text"`
   - `<chromux> type exp-ab12 "Enter"`
5. Re-run `snapshot` after every meaningful click, fill, type, navigation, or
   state change. `@ref` numbers can go stale.
6. Use `screenshot` for visual verification and evidence, not as the primary
   way to locate elements.
7. Close the session when done: `<chromux> close exp-ab12`.

## Current Core Surface

Run `chromux help` for exact syntax. The day-to-day mental model is:

- `open` creates or navigates a tab.
- `snapshot` returns an accessibility tree with `@ref` handles.
- `click`, `fill`, and `type` are convenience shortcuts for visible interaction.
- `run` executes multi-step async JavaScript with `cdp`, `js`, `sleep`, and
  `waitLoad` helpers.
- `cdp` sends one raw Chrome DevTools Protocol method.
- `watch` reads console and network diagnostics.
- `screenshot` saves visual evidence.
- `show` opens DevTools for a live tab.
- `close`, `list`, `launch`, `ps`, `kill`, and `stop` manage sessions/profiles.

Older aliases such as `eval`, `scroll`, `wait`, `console`, `network`, and
`scroll-until` may still work for compatibility, but do not teach them as the
primary interface. Prefer `run`, `cdp`, and `watch`.

## JavaScript And CDP

Use `run` for multi-step scripts:

```bash
/path/to/chromux run exp-ab12 - <<'JS'
await cdp('Page.navigate', { url: 'https://example.com' });
await waitLoad();
return await js('document.title');
JS
```

Use `cdp` for a single raw protocol call:

```bash
/path/to/chromux cdp exp-ab12 Runtime.evaluate '{"expression":"location.href","returnByValue":true}'
```

`run` is intentionally small. It does not expose Node `import` or `require`.
Reusable browser logic should be a copied `run` script, a checked-in helper
example, or a future chromux helper, not an ad hoc hidden module load.

## Builtin Runner Snippets

Before recreating common browser loops, check the bundled snippets under
`snippets/_builtin/` in this skill or repo directory. They are examples for
`chromux run`, not extra top-level CLI verbs.

Available snippets:

- `snippets/_builtin/scroll-until.js` — scroll until a selector count reaches a
  target count. Use this for infinite feeds, load-more surfaces, and result
  collection loops before falling back to the deprecated `scroll-until` alias.

Run a snippet with an absolute path when possible:

```bash
/path/to/chromux run exp-ab12 --file /path/to/chromux/snippets/_builtin/scroll-until.js
```

If the installed skill directory contains a symlinked `snippets/` folder, the
same file is also available next to this `SKILL.md`.

## Diagnostics

Use `watch` for console and network capture:

```bash
/path/to/chromux watch exp-ab12 console
/path/to/chromux watch exp-ab12 network --all
/path/to/chromux watch exp-ab12 console --off
/path/to/chromux watch exp-ab12 network --off
```

Use diagnostics as supporting evidence. A passing UI action with new console
errors or failed requests should be reported as partial or suspicious, not
silently accepted.

## Site Knowledge

chromux may surface host-specific hints from `~/.chromux/skills/<host>/*.md` on
navigation. If the `open` response includes hints, read them before inventing a
new approach. If you learn durable site knowledge, or discover existing notes
are stale, wrong, too task-specific, or unsafe, review/update public,
non-secret, non-task-diary notes under the relevant host directory.

Good site knowledge:
- stable selectors or URL patterns
- framework quirks
- hidden waits or load-more behavior
- private API shapes that are safe to document

Bad site knowledge:
- credentials, tokens, cookies, or personal data
- pixel coordinates that will break on layout changes
- one-off task narration
- stale selectors or URLs that you already know are wrong

## Gotchas

- Shell variables do not persist across separate agent shell calls. Inline the
  chromux path and session ID literally.
- A successful `open` means the browser navigated, not that the page is ready
  for the intended task. Use `snapshot`, `run`, or `watch` to verify state.
- Prefer `@ref` clicks over CSS selectors for normal page interaction.
- Coordinate click is available when visual geometry is the right tool:
  `<chromux> click exp-ab12 --xy X Y`.
- Auth walls are user-owned. If a site redirects to login and no saved profile
  is available, stop and ask the user to log in manually.
- Always close sessions you open. Use `chromux ps` and `chromux kill <profile>`
  when profile cleanup is needed.
