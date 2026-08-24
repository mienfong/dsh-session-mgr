# Contributing

Thanks for your interest in `dsh-session-mgr`! Contributions are welcome via issues and pull requests.

## Getting started

1. Fork the repo and create a feature branch.
2. Install nothing extra — the plugin is plain ESM with **no build step** (`lib/host.js` is the host half, `lib/client.js` is the browser half).
3. Make your change and keep the existing style.

## Coding conventions

- **No build step.** Both halves are plain ESM; the browser half is a `window.__ModuleLoader__.load({ id, factory })` bundle.
- **Localize strings.** UI text lives in the `STR` table (`en` / `zh-CN` / `zh-TW`) inside `lib/client.js`; add every new string to all three, and reference it via `t("key")`. Server errors carry a stable `code` that the client maps to the current language.
- **All user-facing error messages** thrown by the host must be created with `fail("<code>", "<english message>")` and have a matching `err.<code>` string in each language table.
- Keep path / format helpers in `lib/host.js` pure and exported, so they are unit-testable.
- Running sessions must always be refused for destructive operations; never silently overwrite an existing file or folder at a destination.

## Tests

```sh
node scripts/test-move.mjs                       # synthetic-data tests
node scripts/test-real.mjs "<session-dir>"       # needs a real session dir (or DSH_REAL_SAMPLE)
```

Add or update tests for any change to `lib/host.js`.

## Pull requests

- One logical change per PR.
- Keep the READMEs in sync: if you change behaviour, update both `README.md` and `README.zh-CN.md`.
- A maintainer will review; be ready to adjust.

## License

By contributing you agree that your contributions are under the [MIT](LICENSE) license.
