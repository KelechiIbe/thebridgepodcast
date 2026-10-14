# The Bridge Studio

The Bridge Studio turns the notes from TaxStreem's weekly open office into a short podcast episode with moving visuals. You upload the meeting notes and the AI writes an anonymised script. You then give your host and experts their voices (ElevenLabs clones or library voices), adjust the words and the on-screen cards, and export an MP3, a video in any orientation, or an interactive web page.

The studio runs in the browser. Netlify hosts it and runs a handful of small server functions that keep your API keys away from the browser. Supabase handles sign-in, the database and file storage for the team.

## Try it on your own computer first

You need Node 20 or newer.

```bash
npm install
npm run dev
```

Open the address it prints. With no Supabase settings the studio starts in **demo mode**, where everything is saved in your browser and AI writing and voice generation are switched off. The sample episode from the 9 October session is loaded so you can look around, edit the script and visuals, and try the exports.

## Set it up for the team

This takes about twenty minutes. You'll need a Supabase account, a Netlify account, and an ElevenLabs account plus a Claude or Gemini API key.

### 1. Supabase

1. Create a new project at [supabase.com](https://supabase.com). Pick the region closest to your team (London or Frankfurt work well from Lagos).
2. Open **SQL Editor**, paste the whole of `supabase/migrations/0001_init.sql`, and run it. It creates the tables, the access rules and a private storage bucket called `media`. Running it twice is harmless.
3. Under **Authentication → Sign In / Providers → Email**, switch off **Allow new users to sign up**. People join only when an admin adds them.
4. From **Project Settings → API Keys**, copy the **Publishable key** (it starts `sb_publishable_`) and the **Secret key** (it starts `sb_secret_`). The secret key can bypass every access rule, so it goes only into Netlify's environment variables, never into the code or the browser. Your project URL is on the project's home page and looks like `https://abcdefgh.supabase.co`.

### 2. Netlify

1. In Netlify choose **Add new project → Import an existing project**, connect GitHub and pick this repository. The build settings come from `netlify.toml`, so leave them as they are.
2. Under **Project configuration → Environment variables**, add:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | the Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key |
| `SUPABASE_SECRET_KEY` | the secret key |
| `APP_SECRET` | a long random string, at least 32 characters |
| `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | optional; you can paste keys in the studio's Settings page instead |

The older `anon` and `service_role` keys still work under the names `VITE_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, but Supabase is retiring them.

`APP_SECRET` encrypts the API keys you save in Settings. If you change it later, those saved keys stop working and you'll need to paste them again.

3. Deploy. Copy the site address (for example `https://the-bridge-studio.netlify.app`).
4. Back in Supabase, under **Authentication → URL Configuration**, set **Site URL** to that address and add `https://YOUR-SITE.netlify.app/**` to **Redirect URLs**. Sign-in and invitation links won't work until this is done.

Background functions, which the script writer uses, are available on Netlify's free plan as well as the paid ones.

### 3. The first admin

In Supabase go to **Authentication → Users → Add user → Create new user**. Enter your own email and a password, leave **Auto Confirm User** ticked, and create the user. The first account the studio sees becomes the admin, so do this before anyone else has an account. Then open the Netlify address and sign in.

Everyone else joins through the studio's **Team** page. Enter their email and role, keep **I'll give them a temporary password** selected, and press **Add to the team**. The page shows the address, email and password to send them; they change the password from the account link at the bottom left after signing in. The roles are:

* **Admin** manages the team, API keys and settings, and can do everything else.
* **Producer** creates and edits episodes, characters, voices and the brand.
* **Reviewer** reads, comments, runs checks and approves episodes.

If someone forgets their password, an admin presses **New password** next to their name on the Team page.

Accounts created any other way can sign in but see a "not on the team yet" page until an admin adds them.

#### Email (optional)

Supabase's built-in mailer only delivers to people who belong to your Supabase organisation, and only a few messages an hour. Emailed invitations, "email me a sign-in link" and "forgot password" emails therefore reach your team only after you connect an email service of your own (Resend, Brevo, Zoho Mail and most others work) under **Authentication → Emails → SMTP Settings** in Supabase. Everything else works without it.

### 4. Keys and voices

1. Open **Settings**, paste your ElevenLabs key and a Claude or Gemini key, and press **Test** on each. Pick which AI writes the scripts. You can switch at any time.
2. Open **Characters**. For each speaker press **Choose a voice** and either pick one of the voices already in your ElevenLabs account (your professional clone appears here once ElevenLabs has trained it), search the ElevenLabs voice library with the Nigerian accent filter, or upload a few minutes of clean recordings to make an instant clone. Only clone a voice with the owner's written permission.
3. The listener voices (the people who "send voice notes") are separate characters. Give them a few different Nigerian voices so episodes don't sound the same.

A nine-minute episode is about 7,000 to 9,000 characters of speech. Regenerating one line costs only that line, and the studio reuses audio for any line whose words and voice haven't changed.

## Making an episode

Each episode has six tabs, worked roughly in order.

**Notes.** Upload the meeting notes (Word, PDF, text or a caption file) or paste them in. **Write the script** sends them to the AI with your house style from Settings. The script comes back with the questioners renamed and their businesses changed, plus a short report of what was anonymised. Check that report before anything else.

**Script.** Edit any line, move lines, change who speaks, and add or edit the on-screen cards: big numbers, side-by-side comparisons, bar charts, formulas, steps, do and don't lists, quotes, images and quiz questions.

**Visuals.** A live preview in 16:9, 9:16 or 1:1. Type requests in the chat box ("put the ₦5m penalty card in red", "make the captions boxed") and the AI changes the cards, script or layout. **Undo last** reverses a chat change.

**Voices.** **Generate** makes audio for every line that is new or has changed since it was last voiced. **Check every word** runs each line through ElevenLabs speech-to-text and flags words the voice skipped or mangled.

**Review.** Runs a fact check of the script against your **Tax facts** library and the law, collects comments, keeps versions you can restore, and holds the approval. Exports stay watermarked as drafts until a reviewer or admin approves (you can switch this off in Settings). Editing an approved script sends it back for review.

**Export.**

* MP3 for podcast apps (loudness set to -16 LUFS), or WAV
* Video in landscape, portrait or square, as the full episode or a clip between any two lines, with your intro and outro videos added
* An interactive page: one HTML file with the player, chapters, the transcript, quiz questions and any tax calculators that fit the episode. You can host it anywhere or send it as a file
* Captions (SRT and VTT), a plain transcript, cover art
* A launch pack: show notes, posts for LinkedIn, X and WhatsApp, and suggested clips

## The pronunciation library

**Pronunciation** holds words the voices should say a particular way. Each entry has the written form, what the voice should say, and whether capital letters must match. Examples already included:

* `CAC` is spoken as `C. A. C.`
* `NRS` and `FIRS` are spelt out letter by letter, and `WHT` becomes "withholding tax"
* `TaxStreem` is spoken as `Tax Stream`

The written form stays on screen and in the captions, and only the voice hears the spoken form. Naira amounts are handled automatically, so `₦3m` is read as "3 million naira". Press **Listen** on any entry, or type a test sentence at the top of the page, to hear it in whichever character's voice you pick. The whole library imports and exports as CSV.

## Brand

The **Brand** page holds the logo, colours, fonts, background scene, music cues (sting, chapter ident, voice-note blip, outro bed), intro and outro videos for each orientation, the end card with its QR code, and the AI-voices disclosure. **Import a brand guide** takes a PDF, a web page (.html) or a whole project folder zipped up (.zip), such as a design-system export with its stylesheets, font files and logos. The studio reads the colours, colour tokens, fonts and logo candidates in your browser, the AI fits them to the stage, and any font files and the best logo for a dark background are uploaded for you. Nothing inside the files is run. **Undo import** puts the previous brand back. Without the online studio, HTML and zip imports still work from the names in the code; PDFs need the AI.

The music in `public/defaults` was composed for this project and is free to use. Replace it with your own whenever you like.

## Limits

* **MP4 needs desktop Chrome or Edge.** The video is encoded in the browser. Other browsers, and some Linux machines, produce a WebM file instead, which plays everywhere except older iPhones. Keep the tab open while a video renders; a full nine-minute 1080p episode takes a few minutes on a recent laptop.
* **Voices are only as good as their source.** An instant clone from a phone recording will sound like a phone recording. For the expert voices, a professional clone made in ElevenLabs from 30 minutes or more of studio audio is worth the effort.
* **The tax calculators are illustrations.** Their assumptions live in `src/shared/tax.ts` and in the Tax facts library. Check them whenever the law or the rates change.
* **Not built yet:** a public episode hub with an RSS feed for Apple Podcasts and Spotify, listening analytics, a cloud render service so long videos don't need an open browser tab, and talking-head avatars.

## For developers

```bash
npm run dev        # player bundle, then the Vite dev server (demo mode unless .env has Supabase values)
npm run typecheck
npm test           # timing, pronunciation, timeline and tax unit tests
npm run build      # what Netlify runs
```

To run the server functions locally, install the Netlify CLI, copy `.env.example` to `.env`, fill it in, and run `netlify dev`.

The layout of the code:

* `src/shared` holds the types, the pronunciation engine, timing, the timeline builder, captions, tax maths and the AI schemas. Both the browser and the functions use it.
* `src/lib` contains the storage layer (Supabase or the browser), the audio mixer and loudness meter, the canvas renderer, and the exporters.
* `src/ui` is the React app. `src/player` is the small player embedded in interactive exports.
* `netlify/functions` holds the server side. It covers AI jobs, chat edits, text-to-speech, voices and cloning, the listen-back check, usage, keys and the team.
* `supabase/migrations` contains the database schema and access rules.

The AI writes structured JSON that is checked against a schema before the studio uses it. The browser never receives your API keys. They're encrypted with `APP_SECRET` and stored in a table that only the server functions can read.
