# Contributing to Mowr

Thanks for wanting to make Mowr better. Bug reports, fixes, docs and ideas are all welcome.

## Before you start

- **Small fixes** (typos, clear bugs, docs): open a pull request straight away.
- **Bigger changes** (new features, new dependencies, changes to how files or accounts are handled): open an issue first so we can agree on the shape before you spend time on it.
- **Security problems**: do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Set up

You need Windows 10 or 11, Node 25 and npm.

```powershell
git clone https://github.com/mowfxy/mowr.git
cd mowr
npm ci
copy .env.example .env.local   # fill in the Supabase public URL and key
npm run desktop:dev            # builds and opens the desktop app
```

The website runs on its own with `npm run server` and `npm run dev` in two terminals.

## Check your change

Run what applies before you open a pull request. CI runs the same checks on every push.

```powershell
npm test                         # unit and integration tests
npm run test:desktop             # Electron main-process tests
npx tsc -p desktop/tsconfig.json # desktop types
npm run typecheck:server         # server types
npm run build:vercel             # website build
node scripts/check-performance-budget.mjs
```

For interface changes, `npm run verify:all` runs the browser-driven checks in `scripts/verify/`. Add a screenshot or short clip to the pull request.

## Style

- Match the code around you: naming, comment density and the compact one-line style used across `src/`.
- Comments say *why*, not *what*.
- Interface text is short, plain and calm. Fonts are named only through `--sans`, `--serif` and `--mono` (see `src/type.css`).
- Keep the user's files on their PC. Anything that sends data off the machine needs to say so in the pull request.

## Pull requests

- One topic per pull request, with a clear title and a short description of what changed and why.
- Link the issue it closes, if there is one.
- New behaviour comes with a test where it can.

By contributing you agree that your work is released under the [MIT License](LICENSE).
