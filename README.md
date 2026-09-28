# Zichru AI — Talmud Mastery

Single-file web app (`public/index.html`) with Firebase Auth (Google) + Firestore.
Firebase project: `tracking-app-0001`.

## Layout

```
public/index.html   the whole app (HTML + CSS + JS in one file)
server.js           tiny local dev server (also proxies /fetch-pdf)
firebase.json       hosting + firestore rules config
firestore.rules     security rules
.firebaserc         default project: tracking-app-0001
```

## Run locally

```bash
npm start
# http://127.0.0.1:4173
```

Don't open the HTML with `file://` — Google sign-in needs a real origin.

To preview exactly what will be deployed (Firebase Hosting emulator):

```bash
npm run serve
```

## Deploy

One-time:

```bash
npm run login:firebase
```

Then:

```bash
npm run deploy            # hosting + firestore rules
npm run deploy:hosting    # hosting only
npm run deploy:rules      # rules only
```

Live URLs after deploy:

- https://tracking-app-0001.web.app
- https://tracking-app-0001.firebaseapp.com

### Pre-deploy checklist

1. Firebase console → Authentication → Sign-in method → enable **Google**.
2. Firebase console → Authentication → Settings → Authorized domains: make sure
   `tracking-app-0001.web.app` and `tracking-app-0001.firebaseapp.com` are listed
   (they are added automatically), plus any custom domain you attach.
3. Firestore Database created (Native mode).
4. Rules deployed — if the app says `Missing or insufficient permissions` on
   `Publish tractates` / `Sync progress to cloud`, run `npm run deploy:rules`.

### Custom domain

Firebase console → Hosting → Add custom domain, then add that domain to
Authentication → Authorized domains too, or Google sign-in will fail on it.

## Notes on the deployed build

- **No secrets in the repo.** The Firebase web config in `index.html` is public by
  design; Anthropic/OpenAI keys are entered by each user and stay in their browser's
  localStorage. Never commit a real `sk-ant-...` / `sk-...` key into this file.
- **PDF import by link**: locally, `server.js` proxies the download through
  `/fetch-pdf` to dodge CORS. Firebase Hosting is static, so there is no proxy in
  production — the app falls back to a direct browser fetch, which works only for
  CORS-permissive links. If a link is blocked, the app already tells the user to
  download the PDF and use the upload box instead. Uploading a local PDF always works.
  (To restore link-import in production you'd need a Cloud Function or Cloud Run
  proxy, which requires the Blaze plan.)
- `firebase.json` rewrites every path to `/index.html` and sends `no-cache` for it,
  so users always get the latest version after a deploy.

## Firestore structure

- `tractates/{tractateId}` — shared tractate data (`tractate`, `chapters`, `dafim`,
  `updatedAt`, `updatedBy`); world-readable, writable by any signed-in user.
- `users/{uid}` — `profile`, `settings`, `study`, `updatedAt`, `schemaVersion`.
- `users/{uid}/state/main` — full user state: `settings`, `study`, `progress`, `custom`.

## PDF import

1. Settings → AI Keys → add an Anthropic key (`sk-ant-...`, best parsing) or an
   OpenAI key (`sk-...`) as fallback.
2. Settings → Library → Import PDF → upload a file or paste a link.
