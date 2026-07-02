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

Listens on `$PORT` (defaults to `3000`).

### Endpoints

- `GET /` — health check.
- `POST /lead` — accepts JSON (or a JSON string body) with `name`/`Full_Name`, `campus`/`Campus`, `owner`, `leadId`. Normalizes and forwards it only to the WebSocket client(s) registered under that `owner` email.

### WebSocket

Clients connect to `wss://<host>?email=<recruiter-email>`. Connections without an `email` query param are rejected. A recruiter can have multiple sockets open at once (e.g. multiple browser windows); all of them receive matching leads.

## Extension (`cdl-notifier/`)

Manifest V3 Chrome extension.

- Click the toolbar icon to open the popup and set your Zoho email — this is what the server matches incoming leads against, and is saved in `chrome.storage.local`.
- `background.js` maintains the WebSocket connection to the server (auto-reconnects on disconnect, plus a `chrome.alarms`-based health check as a fallback).
- On a matching lead: shows a Chrome notification with the lead's name/campus, plays `alert.mp3` via an offscreen document, and stores a Zoho CRM deep link so clicking the notification opens that lead.

### Install (unpacked, for now)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the `cdl-notifier` folder
3. Click the extension icon and set your email

## Zoho side

The Deluge function that triggers `/lead` must send the lead's real owner email, e.g.:

```
payload.put("owner", lead.get("Owner").get("email"));
```

Not a hardcoded test value — the server matches on this exact email against what each recruiter set in their extension popup.
