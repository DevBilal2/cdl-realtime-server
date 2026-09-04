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
- `TOKEN_SECRET` — used to derive each recruiter's access code from their email.

The recruiter roster is not configured here. Zoho pushes its active-user list to
`POST /roster` on a schedule and that is the only source of truth, so nobody has
a second list to keep in sync. The roster lives in memory: after a restart no one
can connect until the next push.

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

## Access codes

Recruiters authenticate with a code derived from their email rather than typing
the address itself. Before this, the websocket believed whatever address a
client sent, so anyone could receive a colleague's leads by typing their
address, and a typo connected successfully and then silently received nothing.

```
code = HMAC-SHA256(TOKEN_SECRET, lowercased email), hex, first 24 chars

sarah@cdl-cda.com  ->  29658e088d2b8b9c1f10ea86
```

One-way, so a code cannot be turned back into an address. The server instead
computes the code for every address on the roster and looks up the one it was
given. Knowing an email gets you nothing without `TOKEN_SECRET`.

Node and Deluge must produce identical output. Both use hex and truncate to 24
characters; this is the check that proves it, and it is worth running after any
change to either side:

```
secret = "verify-me-123";
info zoho.encryption.hmacsha256(secret, "test@cdl-cda.com", "hex").subString(0,24);
// must print f1b89810bfbc559f0575de8b
```

```
TOKEN_SECRET=verify-me-123 node make-tokens.js test@cdl-cda.com
# must print the same
```

## The Zoho side

Two org variables under `Setup > Developer Hub > Variables`, each holding the
same value as the matching Render environment variable:

| Zoho variable | Render variable |
| --- | --- |
| `cdl_notifier_api_key` | `LEAD_API_KEY` |
| `cdl_notifier_token_secret` | `TOKEN_SECRET` |

### Notifier function

Fires from a workflow rule on lead create and owner change. Note that `owner`
must come from the record; hardcoding it here has caused two outages, where
every lead in the system routed to one person and nobody noticed because the
server still answered `200`.

```
lead = zoho.crm.getRecordById("Leads", leadId);
ownerEmail = "";

if(lead != null && lead.get("Owner") != null)
{
	ownerEmail = lead.get("Owner").get("email");
}

if(ownerEmail != null && ownerEmail != "")
{
	payload = Map();
	payload.put("name", lead.get("Full_Name"));
	payload.put("campus", lead.get("Campus"));
	payload.put("owner", ownerEmail);
	payload.put("leadId", lead.get("id"));

	headers = Map();
	headers.put("X-API-Key", zoho.crm.getOrgVariable("cdl_notifier_api_key"));

	response = invokeurl
	[
		url :"https://cdl-realtime-server-vuw5.onrender.com/lead"
		type :POST
		parameters: payload.toString()
		headers: headers
		content-type: "application/json"
	];
	info "CDL Notifier -> " + ownerEmail + " : " + response;
}
else
{
	info "CDL Notifier: lead " + leadId + " has no owner email, skipping";
}
```

`info response` matters: `{"delivered":0}` means the lead reached nobody, and
that is the only trace it leaves.

### Roster sync function

Run this whenever someone joins or leaves. The roster is held in memory, so it
must also be re-run after any server restart or nobody can connect.

```
users = zoho.crm.getRecords("users", 1, 200, {"type":"ActiveUsers"});

emails = List();
for each u in users
{
	e = u.get("email");
	if(e != null && e != "")
	{
		emails.add(e.toLowerCase());
	}
}

if(emails.size() > 0)
{
	payload = Map();
	payload.put("emails", emails);

	headers = Map();
	headers.put("X-API-Key", zoho.crm.getOrgVariable("cdl_notifier_api_key"));

	response = invokeurl
	[
		url :"https://cdl-realtime-server-vuw5.onrender.com/roster"
		type :POST
		parameters: payload.toString()
		headers: headers
		content-type: "application/json"
	];
	info "Roster sync: " + response;
}
else
{
	info "Roster sync skipped: no active users found";
}
```

### Code lookup function

Prints every active recruiter with their access code, for onboarding. Whoever
can run this can impersonate anyone, so it belongs behind a permissioned button
rather than general function-edit rights.

```
secret = zoho.crm.getOrgVariable("cdl_notifier_token_secret");
users = zoho.crm.getRecords("users", 1, 200, {"type":"ActiveUsers"});

for each u in users
{
	e = u.get("email");
	if(e != null && e != "")
	{
		e = e.toLowerCase();
		info e + "  ->  " + zoho.encryption.hmacsha256(secret, e, "hex").subString(0,24);
	}
}
```

## Checking the roster

```
curl -H "X-API-Key: $LEAD_API_KEY" https://cdl-realtime-server-vuw5.onrender.com/roster
{"count":11,"recruiters":["..."]}
```

Addresses only. The codes are deliberately not exposed, so the API key alone is
not enough to impersonate a recruiter.
