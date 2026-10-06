# YouTube upload (you do this; nothing is uploaded for you)

1. Go to https://studio.youtube.com signed in as the account that owns the project's contact email.
2. **Create → Upload videos** and choose `docs/verification/mowr-drive-demo.mp4`.
3. **Title:** `Mowr: Google OAuth verification demo (https://www.googleapis.com/auth/drive)`
4. **Description** (paste):
```
Demo of Mowr (https://mowrai.com), a Windows desktop app, for Google OAuth verification.

OAuth clients shown:
1. Google sign-in ("Continue with Google"): identifies the user's account (email, basic profile).
2. Google Drive connector: requests the restricted scope https://www.googleapis.com/auth/drive

How Mowr uses the Drive scope:
- READ: the user links a Drive folder to a subject; folders and files are listed live, PDFs and videos are streamed from Drive, and "Ask about it" reads the chosen file only to answer the user's question.
- WRITE: files the user drops or adds into the folder they linked are uploaded to it; worksheets Mowr makes are saved into it; edits the user approves update the same Drive file.
- Why not drive.file: it cannot add files to folders the user created themselves, so saving into the folder the user linked needs the drive scope.
- Data stays with the user: read live from Drive and streamed, never copied to our servers. Disconnect revokes access at Google.

Privacy policy: https://mowrai.com/#/privacy
Support: support@mowrai.com
```
5. **Audience:** "No, it's not made for kids".
6. **Visibility → Unlisted**. Do not choose Public or Private (Google cannot open Private).
7. Wait for processing to finish, **Save**, and copy the link (`https://youtu.be/...`).
8. Open the link in a private window to confirm it plays without signing in. Paste it into the verification form's demo video field.
