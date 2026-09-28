# Microsoft Store (MSIX)

The Store build is a separate MSIX package; the website keeps shipping the NSIS `.exe` from `electron-builder.cjs`.

| File | What it is |
| --- | --- |
| `electron-builder.store.cjs` | Store config: Partner Center identity, `appx` target, package version (default `1.0.0.0`, or `MOWR_STORE_VERSION`) |
| `build/appx/`, `desktop/icon.ico` | Icons and tiles: `node scripts/render-icons.mjs` (draws the app's mark from `public/logo.svg` at every size), then `python scripts/store-assets.py` (tiles) |
| `scripts/store-test-sign.ps1` | Signs a *copy* of the package with a self-signed test certificate, for installing on your own PC |

## Build

```bash
npm run desktop:store
```

Output: `release-store/Mowr-Store-<version>.msix`, unsigned. Upload that file; the Store signs it after certification.
Each new submission needs a higher version, e.g. `MOWR_STORE_VERSION=1.0.1.0` (the last part must stay `0`).

## Install and test locally

1. `powershell -ExecutionPolicy Bypass -File scripts/store-test-sign.ps1` makes `.store-cert/mowr-store-test.cer` (subject = your Publisher) and `release-store/Mowr-Store-<version>.test-signed.msix`.
2. Trust the test certificate once, from an **administrator** PowerShell:
   `Import-Certificate -FilePath .store-cert\mowr-store-test.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople`
3. Double-click the `.test-signed.msix`, or `Add-AppxPackage release-store\Mowr-Store-<version>.test-signed.msix`.
4. Remove it again with `Get-AppxPackage *Mowr* | Remove-AppxPackage`, and the certificate with
   `Get-ChildItem Cert:\LocalMachine\TrustedPeople | ? Subject -eq '<your CN=...>' | Remove-Item` (admin).

Things that behave differently in the Store build:
- **Start with Windows** is hidden: Windows ignores Electron's login-item setting for MSIX apps.
- `%APPDATA%\Mowr` is redirected into the package's private folder, so sign-in and settings are not shared with an `.exe` install on the same PC, and Windows deletes them on uninstall. `Documents\Mowr` is shared as normal.
- The Store build doesn't update itself; the Store updates it.

## Windows App Certification Kit (WACK)

WACK ships with the Windows SDK (`C:\Program Files (x86)\Windows Kits\10\App Certification Kit\appcert.exe`).
Install the test-signed package first, then either open **Windows App Cert Kit** from Start > Validate Store App > pick the `.msix`,
or from an administrator prompt:

```
"C:\Program Files (x86)\Windows Kits\10\App Certification Kit\appcert.exe" reset
"C:\Program Files (x86)\Windows Kits\10\App Certification Kit\appcert.exe" test -appxpackagepath "<full path>\release-store\Mowr-Store-1.0.0.0.test-signed.msix" -reportoutputpath "%TEMP%\mowr-wack.xml"
```

## Partner Center submission (1.0.0.0)

| Section | Value |
| --- | --- |
| Pricing | Free, all markets |
| Category | Productivity (subcategory: none) |
| Privacy policy URL | https://mowrai.com/#/privacy |
| Website | https://mowrai.com |
| Support contact | support@mowrai.com |
| Age rating | IARC questionnaire: no violence, sex, drugs or gambling; no user-to-user chat; has generative AI and web access, so expect 12+/PEGI 12–16 |
| Restricted capability `runFullTrust` | "Mowr is a Win32 desktop app (Electron) packaged with the Desktop Bridge; it needs full trust to run." |
| Package | `release-store/Mowr-Store-1.0.0.0.msix` |
| Screenshots | `node scripts/store-screenshots.mjs` → `.work/store-screenshots/` (1920×1080) |

**Short description:** One calm place for your projects, study and documents, with the AI subscription you already have.

**Description:**

Mowr is a calm desktop workspace for learning, research and professional work. Bring the AI subscription you already pay for (ChatGPT, Claude or SuperGrok) and think with it next to your own files.

- Chat, research and write in one place, with answers that cite and check themselves.
- Subjects keep a class or project together: its chats, files, flashcards and quizzes.
- Visuals turn an idea into an interactive model you can play with.
- Open the folders you already have on your PC. Mowr proposes edits and you approve every change.
- Make documents, worksheets and PDFs in a clean, readable style.

Your files stay in Documents\Mowr on your PC. You need a Mowr account and an internet connection to sign in and chat.

**Features (one per line):** Chat with ChatGPT, Claude or Grok using your own subscription · Subjects with flashcards and quizzes · Interactive visual models · Works with folders on your PC · Proposed edits you approve · Documents and PDFs in one click

**Search terms:** AI workspace, study, flashcards, research, notes, quiz, study planner

Only generic words: Store policy 10.1.3 rejects search terms that name other publishers’ products (Submission 1 was sent back for “ChatGPT” and “Claude” on 2026-09-28).

**Certification notes:** Sign-in opens the browser at mowrai.com and returns to the app. Test account: create one free at https://mowrai.com. Settings → Models can install the official Claude Code or Grok command-line tools; this runs the vendor's own installer from its own domain only when the person clicks Install, and is optional.
