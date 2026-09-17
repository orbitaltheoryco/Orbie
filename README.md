# Orbie

A companion pet whose mood matches your glucose trend, pulling from
Nightscout or LibreLinkUp. `public/index.html` is the pet; `api/` is
the backend that talks to your CGM data source.

## Project layout

```
orbie/
├── public/index.html   ← Orbie itself (frontend)
├── api/reading.js       ← GET /api/reading  (current value + trend)
├── api/history.js       ← GET /api/history  (last ~4 hours)
├── lib/nightscout.js    ← Nightscout adapter
├── lib/librelinkup.js   ← LibreLinkUp adapter (unofficial API)
└── .env.example         ← copy this into Vercel's env var settings
```

Because the frontend and backend deploy together as one Vercel
project, `public/index.html` just calls relative `/api/reading` and
`/api/history` — no URL configuration needed. It also auto-falls-back
to demo mode if those endpoints aren't reachable yet.

## Deploy steps (free tier, no credit card needed)

1. **Get the code into a GitHub repo.** Create a new repo (private is
   fine) and push this folder to it. If you don't already use git:
   GitHub's own "upload files" button in the web UI works fine for a
   one-time push this small.

2. **Import into Vercel.** Sign up at vercel.com with your GitHub
   account (free Hobby tier), click "Add New → Project", and select
   the repo. Vercel auto-detects the `api/` folder as serverless
   functions and `public/` as static output — no config needed.

3. **Set environment variables.** In the project's Settings →
   Environment Variables, add everything from `.env.example`:
   `DATA_SOURCE`, and either the `NIGHTSCOUT_*` or `LIBRE_*` values
   depending which source you're using.

4. **Deploy.** Vercel gives you a `https://orbie-xxxx.vercel.app` URL
   immediately. Open it — Orbie should say "Live" under Connection
   status within a few seconds if the env vars are right.

5. **Point your own domain at it.** In Vercel: Project → Settings →
   Domains → add `orbie.yourdomain.com` (swap in your actual Namecheap
   domain). Vercel shows you a CNAME target, usually
   `cname.vercel-dns.com`.

6. **Add the DNS record in Namecheap.** Domain List → Manage → Advanced
   DNS → Add New Record:
   - Type: `CNAME Record`
   - Host: `orbie`
   - Value: whatever Vercel showed you (e.g. `cname.vercel-dns.com`)
   - TTL: Automatic

   DNS changes can take a few minutes to a few hours to propagate.
   Vercel's domain page will show a green checkmark once it sees it.

7. **Visit `https://orbie.yourdomain.com`.** That's Orbie, live, on
   your own domain, for $0/month beyond the domain you already own.

## If something doesn't go live

Open the "Connection status" drawer in Orbie itself — it says plainly
whether it found a backend or fell back to demo mode. If it's stuck on
demo:
- Double check the env vars are saved *and* that you redeployed after
  adding them (Vercel doesn't apply new env vars to an already-running
  deployment automatically — trigger a redeploy from the dashboard).
- For LibreLinkUp specifically, see the note in `lib/librelinkup.js` —
  it's an unofficial, reverse-engineered API and the first thing to
  check if it breaks.
