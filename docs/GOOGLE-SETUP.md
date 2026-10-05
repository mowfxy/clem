# Google Drive credentials

The existing server connector uses a Web application OAuth client, separate from Google sign-in. These credentials do not yet enable the unfinished desktop Drive bridge.

1. Open https://console.cloud.google.com/ and select or create the Mowr project.
2. Under APIs & Services → Library, enable Google Drive API.
3. Configure Google Auth Platform branding, audience and contact details. For initial external testing, add your Google account as a test user.
4. Under Data Access, add `https://www.googleapis.com/auth/drive`, the scope currently requested by Mowr (it reads linked folders and saves dropped files, Mowr's files and approved edits into them; `drive.file` cannot add to folders Mowr did not create). This is a restricted scope; public distribution requires Google's applicable verification. People connected under the older read-only scope are asked to reconnect once, the first time they save into a folder.
5. Under Clients, create an OAuth client with application type **Web application**.
6. Add this exact authorized redirect URI: `https://mowrai.com/api/drive/callback`.
7. Copy the client ID and client secret into the existing ignored `.env.local` at the repository root:

```dotenv
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
APP_URL="https://mowrai.com"
```

Update those existing fields rather than duplicating them. For deployed server use, add the same values to the Mowr project's **Vercel → Settings → Environment Variables → Production**, then redeploy. Keep existing database, session and credential-encryption configuration. Do not put the secret in `VITE_*`, `desktop/public-config.json`, source code, or chat.

`GOOGLE_AUTH_CLIENT_ID` and `GOOGLE_AUTH_CLIENT_SECRET` are for Google sign-in, not these Drive variables. No Drive API key is needed for private user files.

## YouTube

No API key is required for the embedded player. In chat, paste a video link or use **+ → Mention a YouTube video**. Links in assistant replies also produce players. Players load on click, preserve supported start timestamps, and have an external YouTube fallback. A video link does not give the model the transcript or audiovisual contents; attach a transcript for grounded analysis. Private, age-restricted, removed or embedding-disabled videos may require opening YouTube.

Sources:
- https://developers.google.com/workspace/guides/create-credentials
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/youtube/player_parameters
- https://developers.google.com/youtube/terms/required-minimum-functionality

## Desktop connection

In Mowr, open Drive and choose **Connect / reconnect Drive**. A separate browser sign-in screen opens; use the same Mowr account as desktop, then grant Google access. Return to Mowr and choose **Refresh** if files have not appeared yet. Select a file to import a local copy. **Disconnect** revokes the saved Google grant.

Desktop calls the deployed Drive service using its main-process session. The client secret remains in Vercel, never in the desktop bundle. Google Docs/Sheets/Slides export to Office formats using Google's supported export MIME types: https://developers.google.com/workspace/drive/api/guides/ref-export-formats .
