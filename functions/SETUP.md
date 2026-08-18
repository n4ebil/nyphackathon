# Setting up email + Zoom notifications

This only has to be done once. Everything below needs your own accounts/logins — I can't do any of it for you, since it all involves either billing or credentials that shouldn't be shared in chat.

## 1. Enable Blaze (pay-as-you-go) on the Firebase project

Cloud Functions require it. At this volume (a handful of emails/meetings per day) it's normally **$0/month** — Blaze only bills once you're past a large free quota, it's not a flat fee.

1. Go to https://console.firebase.google.com/project/awaws-6aa73/usage/details
2. Click **Modify plan** → select **Blaze** → add a payment method.

## 2. Log in to the Firebase CLI

```bash
npx firebase login
```

This opens a browser window — sign in with whichever Google account owns the `awaws-6aa73` project.

## 3. Get a Gmail App Password

Regular Gmail passwords don't work for this — you need a 16-character "app password."

1. Go to https://myaccount.google.com/apppasswords (your Google account needs 2-Step Verification turned on first, if it isn't already).
2. Create one named "NYPkaki", copy the 16-character password it gives you.
3. Decide which Gmail address will send the emails (can be your own, or a fresh Gmail you make just for this).

## 4. Create a Zoom Server-to-Server OAuth app

1. Go to https://marketplace.zoom.us/ → sign in with your Zoom account → **Develop** → **Build App**.
2. Choose **Server-to-Server OAuth**.
3. Name it "NYPkaki", fill in the basic info it asks for.
4. Under **Scopes**, add: `meeting:write:meeting:admin` (or the closest available "create meetings" scope — Zoom's scope names change occasionally, look for anything meeting-creation related).
5. Activate the app.
6. Copy the three values it shows you: **Account ID**, **Client ID**, **Client Secret**.

## 5. Set all five secrets

Run each of these from the project root — each one will privately prompt you to paste the value (nothing gets typed in plain text, and none of this needs to be shared with me):

```bash
npx firebase functions:secrets:set GMAIL_USER
npx firebase functions:secrets:set GMAIL_APP_PASSWORD
npx firebase functions:secrets:set ZOOM_ACCOUNT_ID
npx firebase functions:secrets:set ZOOM_CLIENT_ID
npx firebase functions:secrets:set ZOOM_CLIENT_SECRET
```

## 6. Deploy

```bash
cd functions && npm install && cd ..
npx firebase deploy --only functions
```

First deploy takes a few minutes. You'll see four functions come up:
- `onMatchRequestCreated` — emails the tutor when a request comes in, and confirms to the student it was sent
- `onSessionCreated` — emails both people once a session is arranged; if it's online, creates the real Zoom meeting first and includes the link
- `onClassRequestUpdated` — emails everyone interested once a Schedule-page class gets confirmed
- `sendClassReminders` — runs every 30 minutes, emails a reminder once a session/class is within 24 hours out (only ever sends one reminder per session)

## Checking it's working

```bash
npx firebase functions:log
```

Send a real test request through the app and watch the log — you'll see each function fire, and any errors (e.g. a typo'd secret) will show up here immediately rather than failing silently.

## If Zoom fails but you still want the rest working

`onSessionCreated` is written so a Zoom failure never blocks the session or the email — it just logs the error and sends the confirmation email without a Zoom link (the tutor can still add one manually, same as before). So you can deploy with just the email secrets first, add Zoom later, and nothing breaks in between.
