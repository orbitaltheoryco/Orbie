# Website update: Dexcom support

Copy these files over the same paths in your repo (no new packages, no new env vars —
Dexcom uses the same CREDENTIAL_ENCRYPTION_KEY):

```
api/create-instance.js   CHANGED   (adds the Dexcom sign-up)
api/reading.js           CHANGED
api/history.js           CHANGED
api/weekly.js            CHANGED
lib/dexcom.js            NEW
lib/dexcomSession.js     NEW
lib/resolveSource.js     CHANGED
public/index.html        CHANGED   (no weekly recap for Dexcom)
public/try.html          CHANGED   (Dexcom tab + "copy link" for the watch)
public/privacy.html      CHANGED   (built on YOUR file; your details are kept)
```

## Things to know about Dexcom
- Dexcom has NO separate follower login for this. Orbie needs the main Dexcom account of
  the person wearing the sensor. The page says so plainly and suggests Nightscout instead.
- Dexcom Share must be on (at least one follower added). The page and the error message say so.
- Region matters (US / outside US / Japan); a wrong region looks like a wrong password.
- Unofficial interface. If Dexcom changes it: optional env var DEXCOM_USER_AGENT, else lib/dexcom.js.
- Dexcom shares about a day of data, so there is no weekly recap (the link is hidden).
- Same abuse limits as Libre: 8/hour and 20/day per IP, 5/hour per username.

## Please test with a real Dexcom account
This was tested against a fake of Dexcom's service built from community documentation, not the
real one. Try a real account, a wrong password, and the wrong region before telling anyone.

## Capacity heads-up (new with the watch "Orbie link" feature)
Each watch using an Orbie link calls your server about every 5 minutes (~288 times a day), and
each call uses roughly 5 Redis commands (~1,500 a day per watch). Check Upstash's current
free-tier limit: it will probably be the first limit you hit as watch users grow. Vercel
invocations are the second.
