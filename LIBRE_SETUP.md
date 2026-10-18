# Orbie — LibreLinkUp support: setup

## 1. Put the files in your repo (GitHub Desktop)

Same layout as your repo already has:

```
api/
  create-instance.js   CHANGED  (handles Nightscout AND LibreLinkUp)
  delete-instance.js   NEW      ("delete this Orbie" button)
  reading.js           CHANGED
  history.js           CHANGED
  weekly.js            CHANGED
lib/
  crypto.js            NEW      (AES-256-GCM encryption)
  ratelimit.js         NEW
  redis.js             NEW
  libreSession.js      NEW      (per-person login/token caching)
  errors.js            NEW
  instances.js         CHANGED
  librelinkup.js       CHANGED  (rewritten — the old one no longer works with Abbott)
  resolveSource.js     CHANGED
  nightscout.js        unchanged (leave yours as is)
public/
  index.html           CHANGED  (YOUR latest version with the two new games, merged
                                 with the LibreLinkUp changes — use this one, not your old copy)
  try.html             CHANGED
  privacy.html         NEW      (privacy policy — fill in 3 items first, see section 7)
vercel.json            CHANGED  (adds /privacy and a "headers" block — if you've added your
                                 own settings, merge it rather than overwrite)
package.json           unchanged (no new packages)
```

## 2. Create the encryption key (REQUIRED)

Without it the site refuses LibreLinkUp sign-ups (it will NOT store a password
unencrypted). In Windows PowerShell:

```
$b = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)
```

Copy the 44-character result. In Vercel: Project -> Settings -> Environment
Variables -> add `CREDENTIAL_ENCRYPTION_KEY` = that value (tick "Sensitive").
Then redeploy.

**Back this key up somewhere safe (password manager).** If it's lost or changed,
every saved LibreLinkUp login becomes unreadable and each person has to set
up their Orbie again. Don't paste it into chat, email, or the repo.

## 3. If Abbott changes things (optional env vars, no code change)

Abbott changes the LibreLinkUp API without notice (v5 rolled out in early
October 2026). Orbie identifies itself with these defaults:

| Variable | Default |
|---|---|
| `LLU_PRODUCT` | `llu.android` |
| `LLU_VERSION` | `5.0.1` |
| `LLU_USER_AGENT` | `LibreLinkUp/<LLU_VERSION>` |

If sign-ins suddenly fail with "Abbott may have changed something", look at
what the open-source clients (nightscout-connect, nightscout-librelink-up,
pylibrelinkup) now send, set the new values in Vercel, and redeploy.

## 4. What's stored, and for how long

- Nightscout link: address + optional token (as before).
- LibreLinkUp link: the email + password, **encrypted** (AES-256-GCM, key only in
  the env var, each value bound to its own link), plus an encrypted login
  token (~1 h) and the latest reading (45 s).
- Every link expires 30 days after its last visit. "Delete this Orbie" on the
  link's own page removes everything immediately.
- Passwords are never logged, never sent back to the browser, never put in
  a Redis key.

## 5. Abuse limits (protect your site, and Abbott accounts)

LibreLinkUp sign-up: 8 attempts / IP / hour, 20 / IP / day, 5 / email / hour.
Blocked attempts never reach Abbott. After an Abbott lockout or a rejected
login, an Orbie link stops retrying for 10-30 minutes.

## 6. Limits to tell people about

- Unofficial connection; may stop working if Abbott changes it.
- No weekly recap with LibreLinkUp (it only shares ~12 hours). The
  "see Orbie's week" link is hidden for those links.
- The Orbie link itself is the key to the data: anyone who has it can see the
  glucose. (Links are 128-bit random; the page tells people not to share them.)

## 7. Privacy policy (public/privacy.html) — fill in before publishing

Open `public/privacy.html` and replace the highlighted items (search for
`class="todo"`):

- `[YOUR NAME OR BUSINESS]` (2 places)
- `[CONTACT EMAIL]` (4 places) — an address you actually read
- `[MAILING ADDRESS ...]` — optional, but some places require one

Then delete the HTML comment near the top. It will be live at `/privacy`.

Use that address wherever a privacy-policy link is asked for (e.g. the
Connect IQ store listing). It is linked from the main page, the try page, and
the LibreLinkUp notice.

It describes what the code does TODAY. If you later add analytics, new
storage, or another data source, update it first. It is a plain-language
policy, not legal advice — have it reviewed if you can.

Optional improvement: the pages load fonts from Google Fonts (disclosed in the
policy). Hosting the fonts yourself would remove that third party entirely.
