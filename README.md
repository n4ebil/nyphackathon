# PeerLink

Peer tutoring matching app. The matching algorithm, NLP request parser, and
NYP reference data live in [src/shared](src/shared), copied from the original
`awaws` project and treated as a read-only logic library, not UI code.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Without Firebase configured (see below), the app renders the login/register
screens with a "Firebase isn't connected yet" banner instead of crashing —
everything past sign-in requires a real project.

## Connect Firebase

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Build → Authentication → Get started → Sign-in method** → enable **Email/Password**.
3. **Build → Firestore Database → Create database** (start in production mode; the rules below lock it down anyway).
4. **Project settings → General → Your apps → Add app → Web**, copy the `firebaseConfig` values.
5. Copy `.env.example` to `.env.local` and fill in those values:
   ```bash
   cp .env.example .env.local
   ```
6. Restart `npm run dev` — the banner disappears once `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_PROJECT_ID` are set.
7. (Recommended) Deploy the included security rules so users can only write their own data:
   ```bash
   npm install -g firebase-tools   # if you don't have it
   firebase login
   firebase deploy --only firestore:rules --project <your-project-id>
   ```
   Or paste [firestore.rules](firestore.rules) into **Firestore Database → Rules** in the console.

## AI-parsed requests (optional, free)

The "What do you need help with?" box on Find a Tutor can use Gemini to pick
which competency a free-text request is about, via **Firebase AI Logic**
(client-side, no server, no exposed key — billed through the free Gemini
Developer API tier, not the paid Vertex AI one).

1. Firebase console → **Build → AI Logic → Get started**.
2. Choose the **Gemini Developer API** option (free tier) when prompted, not Vertex AI.
3. That's it — no new env vars. `src/lib/ai.js` picks it up automatically and
   falls back to the local heuristic parser in `src/shared/nlp.ts` if AI Logic
   isn't enabled yet or a call fails, so the app never breaks over this.

Everything except picking the competency (topics, urgency, the deadline's
weekday math) stays local and deterministic on purpose — matches the scoping
the original project used for its own Claude integration.

## Data model

Top-level Firestore collections, shaped to match the domain types in
[src/shared/types.ts](src/shared/types.ts) so the matching functions there
can consume them directly:

| Collection         | Doc id                    | Notes |
| ------------------ | -------------------------- | ----- |
| `users`             | Firebase Auth `uid`         | profile: name, adminNo, course, year, bio, preferredFormat |
| `teachingSubjects`  | auto                        | what a user can tutor, keyed by `userId` |
| `availability`      | auto                        | free time slots, keyed by `userId` |
| `learningRequests`  | auto                        | a parsed "I need help with…" request |
| `matchRequests`     | `${requestId}--${tutorId}`  | the tutoring ask + accept/reject status |
| `sessions`          | same id as the match request | arranged time/place once accepted |

## Layout

```
src/
├── firebase.js          Firebase app/auth/firestore init (reads .env.local)
├── context/              Auth session (Firebase Auth + users/{uid} profile)
├── lib/
│   ├── firestore.js      All reads/writes — the only place that talks to Firestore
│   └── match.js          Bridges Firestore data into shared/'s matching engine
├── shared/               Matching algorithm, NLP parser, NYP data (logic only, no UI)
├── components/           Layout (sidebar/header), Icon, Avatar, Spinner/Banner
└── pages/                Login, Register, Dashboard, FindTutor, Requests, Profile
```
