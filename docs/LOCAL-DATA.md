# Local data and portable subjects

Clem stores user work under the Windows Documents known folder (`Documents/Clem`; Windows may redirect Documents into OneDrive). Clem itself does not upload chats, source files, projects or subjects. Operating-system folder backup follows the user's Windows configuration.

`Accounts/<account>/workspace.json` holds the workspace index and conversations. `Accounts/<account>/Files/<id>.blob` contains original source bytes. `Local data` contains Chromium IndexedDB for document edits, source caches and workflow checkpoints. Protected login/provider credentials remain in AppData and never enter exported subject archives.

The first launch migrates existing IndexedDB and local storage, including Chromium’s encrypted Local State key before Electron initializes. The original AppData copy remains as fallback. Never launch an older build against the same live profile after migration: it may read the old snapshot. A failed local read does not create or overwrite an empty workspace; fix permissions or disk capacity and retry.

## Backups

Settings → Data & privacy → Backups writes the whole workspace to one file, `Clem backup <date> <time>.clembackup`, in a folder you choose or in “Clem backups” in your Google Drive. Nothing goes to M4 Labs.

- **What is in it**: everything in `Accounts/<account>` (the workspace index, chats, subjects and projects with their folders, study sets with FSRS review history, routines, and every file's bytes) plus document edits and workflow checkpoints from IndexedDB. Source text and OCR caches are left out and rebuilt when needed. Memory and skills are not in it; they sync with your account. Linked PC folders and AI sign-ins are not in it either.
- **Encryption**: a key is derived from your passphrase with scrypt (N = 2^15, r = 8, p = 1, a new salt per backup), and the contents are gzipped and encrypted with AES-256-GCM in 1 MB chunks, each authenticated with its position and whether it is the last, so a changed, reordered or cut-short file is refused before anything is restored. The header holds only the date, Clem's version and the key-derivation settings; what the backup contains (counts for the preview) is encrypted too. The passphrase is kept in Clem's protected storage on this PC so scheduled backups can run. Clem cannot recover a forgotten passphrase, and nobody can open a backup without it.
- **Schedule**: off, daily or weekly. The check runs every ten minutes while Clem is open or in the tray; a failed try waits an hour. The newest 7 are kept by default (3 to 30); older ones are deleted from a folder, or moved to Drive's trash.
- **Restore**: pick a backup from the backup folder, any `.clembackup` file, or Drive, type its passphrase (or use yours), and see its counts beside what is here now. An empty workspace is restored straight away. A workspace with anything in it is replaced only after you confirm, and only after a copy of it is saved to `Documents/Clem/Backups` (the newest three such copies are kept; restore one the same way to undo). The backup is opened into a separate folder first and checked; the current workspace is moved aside, the restored one moved in, and the window reloads. Saving is paused until it has.
- **New PC**: install Clem, sign in, then Settings → Data & privacy → Restore… → Choose a file… (or Google Drive). Restoring into a different Clem account works too.

## Subject ZIPs

Subjects → choose subject → Export subject ZIP. The archive includes a versioned manifest, owned/referenced files, document edits, chats and study collections. Keep it before choosing Delete subject. Import subject ZIP creates a separate subject with fresh IDs and keeps existing data. Untrusted archive paths and malformed manifests are rejected. The current archive processor accepts up to 250 MB compressed and 500 MB expanded, up to 1,000 files.

Subject deletion removes the subject's owned files, chats, visuals, study sets, automations and workflow checkpoints; it removes references to deleted files from other spaces. Separately owned files included as references in an export are kept. A failed blob deletion is reported, not treated as reclaimed space.

## Uninstall

Data is retained by default for reinstalling. Interactive uninstall offers removal of all Clem local data. That choice runs only in the actual uninstall phase. Updates and silent uninstall preserve data. Cloud account/essential-memory deletion is a separate operation.
