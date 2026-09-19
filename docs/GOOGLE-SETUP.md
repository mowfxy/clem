# Google Drive credentials

The existing server connector uses a Web application OAuth client, separate from Google sign-in. These credentials do not yet enable the unfinished desktop Drive bridge.

1. Open https://console.cloud.google.com/ and select or create the Mowr project.
2. Under APIs & Services → Library, enable Google Drive API.
3. Configure Google Auth Platform branding, audience and contact details. For initial external testing, add your Google account as a test user.
4. Under Data Access, add `https://www.googleapis.com/auth/drive.readonly`, the scope currently requested by Mowr. This is a restricted scope; public distribution requires Google's applicable verification. A future Google Picker integration can use narrower per-file access.
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
