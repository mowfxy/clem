# Google Drive credentials

Clem uses one Web application OAuth client for Google sign-in (through Supabase) and for the Drive connector.

1. Open https://console.cloud.google.com/ and select or create the M4 Labs project.
2. Under APIs & Services → Library, enable **Google Drive API** and **Google Picker API**.
3. Configure Google Auth Platform branding, audience and contact details. For initial external testing, add your Google account as a test user.
4. Under Data Access, add `https://www.googleapis.com/auth/drive.file` (plus `openid`, `userinfo.email` and `userinfo.profile` for sign-in). It is not a sensitive or restricted scope, so only brand verification is needed. Clem opens Google's own picker inside the consent screen (`trigger_onepick=true`); people choose files, or a folder to link, and Clem can open only those and the files it creates. Saving into a picked folder works; files already in it are visible only once chosen in the picker too.
5. Under Clients, create an OAuth client with application type **Web application**.
6. Add the authorized redirect URIs `https://npdkvkikudvjrgnesuhc.supabase.co/auth/v1/callback` (sign-in) and `https://clem.m4labs.xyz/api/drive/callback` (Drive), and the JavaScript origins `https://clem.m4labs.xyz` and `https://admin.m4labs.xyz`.
7. Copy the client ID and client secret into the existing ignored `.env.local` at the repository root:

```dotenv
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
APP_URL="https://clem.m4labs.xyz"
```

Update those existing fields rather than duplicating them. For deployed server use, add the same values to the Clem project's **Vercel → Settings → Environment Variables → Production**, then redeploy. Keep existing database, session and credential-encryption configuration. Do not put the secret in `VITE_*`, `desktop/public-config.json`, source code, or chat.

`GOOGLE_AUTH_CLIENT_ID` and `GOOGLE_AUTH_CLIENT_SECRET` hold the same client for Google sign-in; `scripts/configure-supabase.mjs` sends them to Supabase. No Drive API key is needed for private user files.

## YouTube

No API key is required for the embedded player. In chat, paste a video link or use **+ → Mention a YouTube video**. Links in assistant replies also produce players. Players load on click, preserve supported start timestamps, and have an external YouTube fallback. A video link does not give the model the transcript or audiovisual contents; attach a transcript for grounded analysis. Private, age-restricted, removed or embedding-disabled videos may require opening YouTube.

Sources:
- https://developers.google.com/workspace/guides/create-credentials
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/youtube/player_parameters
- https://developers.google.com/youtube/terms/required-minimum-functionality

## Desktop connection

In Clem, open Drive and choose **Continue with Google**, then **Choose in Google Drive** (or **Choose a folder in Google Drive** when linking). Google's picker opens in the browser; use the same Clem account as desktop. Clem notices the choice on its own. **Disconnect** revokes the saved Google grant.

Desktop calls the deployed Drive service using its main-process session. The client secret remains in Vercel, never in the desktop bundle. Google Docs/Sheets/Slides export to Office formats using Google's supported export MIME types: https://developers.google.com/workspace/drive/api/guides/ref-export-formats .
