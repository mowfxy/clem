# Local data and portable subjects

Mowr stores user work under the Windows Documents known folder (`Documents/Mowr`; Windows may redirect Documents into OneDrive). Mowr itself does not upload chats, source files, projects or subjects. Operating-system folder backup follows the user's Windows configuration.

`Accounts/<account>/workspace.json` holds the workspace index and conversations. `Accounts/<account>/Files/<id>.blob` contains original source bytes. `Local data` contains Chromium IndexedDB for document edits, source caches and workflow checkpoints. Protected login/provider credentials remain in AppData and never enter exported subject archives.

The first launch migrates existing IndexedDB and local storage, including Chromium’s encrypted Local State key before Electron initializes. The original AppData copy remains as fallback. Never launch an older build against the same live profile after migration: it may read the old snapshot. A failed local read does not create or overwrite an empty workspace; fix permissions or disk capacity and retry.

## Subject ZIPs

Subjects → choose subject → Export subject ZIP. The archive includes a versioned manifest, owned/referenced files, document edits, chats and study collections. Keep it before choosing Delete subject. Import subject ZIP creates a separate subject with fresh IDs and keeps existing data. Untrusted archive paths and malformed manifests are rejected. The current archive processor accepts up to 250 MB compressed and 500 MB expanded, up to 1,000 files.

Subject deletion removes the subject's owned files, chats, visuals, study sets, automations and workflow checkpoints; it removes references to deleted files from other spaces. Separately owned files included as references in an export are kept. A failed blob deletion is reported, not treated as reclaimed space.

## Uninstall

Data is retained by default for reinstalling. Interactive uninstall offers removal of all Mowr local data. That choice runs only in the actual uninstall phase. Updates and silent uninstall preserve data. Cloud account/essential-memory deletion is a separate operation.
