# cdl-realtime-server

Real-time lead notification system for CDL recruiters. When a lead is created/assigned in Zoho CRM, its owning recruiter gets a desktop notification with a click-through link to the lead — no polling, no refreshing Zoho.

## How it works

1. **Zoho CRM** (Deluge function) fires on lead create/assign and `POST`s the lead (`name`, `campus`, `owner` email, `leadId`) to this server's `/lead` endpoint.
2. **This server** (Express + WebSocket, deployed on Render) tracks which recruiter email is connected on which WebSocket, and forwards each incoming lead only to the socket(s) registered under its `owner` email.
3. **cdl-notifier** (`cdl-notifier/`, a Chrome extension) runs in the background on each recruiter's machine, connects to this server with their email, and on receiving a lead shows a desktop notification + plays a sound. Clicking the notification opens the lead directly in Zoho CRM.

## Server

### Setup

```
npm install
npm start
```

Listens on `$PORT` (defaults to `3000`). Requires two environment variables and refuses to start without them, so a missing variable is a loud failure rather than a silently open server:

- `LEAD_API_KEY` — shared secret Zoho sends as `X-API-Key`.
- `RECRUITER_TOKENS` — JSON object mapping access code to recruiter email.

Run `node test-smoke.js` to check auth, validation and per-recruiter routing.

The free Render instance spins down after 15 minutes without inbound traffic, which drops every socket. An uptime monitor hitting `GET /` every 5 minutes keeps it up; note that running 24/7 uses roughly 730 of the 750 free instance hours per month, so keep other free services in the workspace suspended.

### Endpoints

- `GET /` — health check, unauthenticated (Render + uptime monitor). Returns `{status, connected}`.
- `POST /lead` — requires `X-API-Key` matching `LEAD_API_KEY`. Accepts JSON with `name`/`Full_Name`, `campus`/`Campus`, `owner`, `leadId`. `owner` and `leadId` are required; anything missing them is a 400 rather than a silent no-op. Returns `{status, delivered}` so the caller can see when a lead reached nobody.

### WebSocket

Clients connect to `wss://<host>?token=<access-code>`. The server looks the token up in `RECRUITER_TOKENS` and derives the email itself, so a client cannot claim an address it wasn't issued, and a mistyped code fails immediately instead of connecting as an address that never receives anything. Unknown or missing tokens are rejected during the HTTP upgrade. A recruiter can have multiple sockets open at once; all of them receive matching leads.

Generate codes with:

```
node make-tokens.js sarah@cdl-cda.com greg@cdl-cda.com
```

stdout is the `RECRUITER_TOKENS` value; stderr is the per-person list to hand out.

## Extension (`cdl-notifier/`)

Manifest V3 Chrome extension.

- Click the toolbar icon to open the popup and paste your access code, saved in `chrome.storage.local`. The server maps the code to your Zoho email; there is nothing to type by hand and no way to mistype an address.
- `background.js` maintains the WebSocket connection to the server (auto-reconnects on disconnect, plus a `chrome.alarms`-based health check as a fallback).
- On a matching lead: shows a Chrome notification with the lead's name/campus, plays `alert.mp3` via an offscreen document, and stores a Zoho CRM deep link so clicking the notification opens that lead.

### Install (unpacked, for now)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the `cdl-notifier` folder
3. Click the extension icon and paste your access code

## Zoho side

The Deluge function that triggers `/lead` must send the lead's real owner email, e.g.:

```
payload.put("owner", lead.get("Owner").get("email"));
```

Not a hardcoded test value — the server matches on this exact email against what each recruiter set in their extension popup.
