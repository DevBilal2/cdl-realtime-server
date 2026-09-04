import express from "express";
import http from "http";
import crypto from "crypto";
import { WebSocketServer } from "ws";

// fail closed: a server that won't boot is better than one that's silently open
const LEAD_API_KEY = process.env.LEAD_API_KEY;
if (!LEAD_API_KEY) {
  console.error("LEAD_API_KEY is not set, refusing to start");
  process.exit(1);
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const app = express();
app.use(express.json());

// health check, stays unauthenticated for Render and the uptime monitor
app.get("/", (req, res) => {
  res.json({ status: "ok", connected: clientsByEmail.size });
});

// Access codes are derived from the email, so there is no code-to-person
// mapping for anyone to maintain or get out of sync. Changing TOKEN_SECRET
// invalidates every code at once, which is the panic button.
//
// hex, lowercase, first 24 chars: Deluge's zoho.encryption.hmacsha256 emits
// hex, and both sides must produce byte-identical codes.
const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!TOKEN_SECRET) {
  console.error("TOKEN_SECRET is not set, refusing to start");
  process.exit(1);
}

function codeFor(email) {
  return crypto.createHmac("sha256", TOKEN_SECRET)
    .update(email.toLowerCase().trim())
    .digest("hex")
    .slice(0, 24);
}

// token -> email. The client presents a code and the server decides which
// address it maps to, so a recruiter can't read someone else's leads by
// claiming their address, and a mistyped code fails immediately instead of
// connecting as an address that never receives anything.
let recruiterTokens = {};

function setRoster(emails) {
  const map = {};
  let skipped = 0;

  for (const raw of emails) {
    const email = String(raw || "").toLowerCase().trim();
    if (!email.includes("@")) {
      skipped++;
      continue;
    }
    map[codeFor(email)] = email;
  }

  recruiterTokens = map;

  // someone taken off the roster should lose their connection now, not
  // whenever they next happen to reconnect
  const active = new Set(Object.values(map));
  for (const [email, sockets] of clientsByEmail) {
    if (!active.has(email)) {
      console.log("Disconnecting, no longer on roster:", email);
      for (const ws of sockets) {
        ws.close(1008, "no longer on roster");
      }
    }
  }

  return { count: Object.keys(map).length, skipped };
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// This system fails silently: a lead that reaches nobody looks exactly like a
// quiet afternoon. Optional, but without it a broken notifier can go unnoticed
// for weeks.
const ALERT_WEBHOOK = process.env.ALERT_WEBHOOK;
if (!ALERT_WEBHOOK) {
  console.warn("ALERT_WEBHOOK is not set, undelivered leads will only appear in the logs");
}

const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS) || 5 * 60 * 1000;
let undeliveredSinceAlert = 0;
let lastAlertAt = 0;

function alertUndelivered(leadId, owner) {
  if (!ALERT_WEBHOOK) return;

  undeliveredSinceAlert++;

  // an empty roster makes every lead undelivered at once, and a hundred
  // messages is the same as none
  if (Date.now() - lastAlertAt < ALERT_COOLDOWN_MS) return;

  const also = undeliveredSinceAlert > 1 ? ` (and ${undeliveredSinceAlert - 1} more in the last few minutes)` : "";
  lastAlertAt = Date.now();
  undeliveredSinceAlert = 0;

  // the lead's name is customer PII and stays out of the alert, as with the logs
  const text = `CDL Lead Notifier: lead ${leadId} for ${owner} reached nobody${also}. `
    + `They are not connected, so no notification was shown.`;

  // never let a broken webhook affect the response to Zoho
  fetch(ALERT_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  }).catch(e => console.error("Alert webhook failed:", e.message));
}

// email -> Set<ws>, supports multiple tabs/windows per recruiter
const clientsByEmail = new Map();

// The roster lives only in memory and only ever comes from Zoho. Nobody can
// connect between a restart and the next roster push, which is the price of
// having exactly one source of truth for who is a recruiter.
console.warn("Roster is empty at boot, waiting for Zoho to push it");

// Authenticate during the upgrade so an unauthorized client never completes
// the handshake.
server.on("upgrade", (req, socket, head) => {
  const { searchParams } = new URL(req.url, "http://localhost");
  const email = (recruiterTokens[searchParams.get("token")] || "").toLowerCase().trim();

  if (!email) {
    console.log("Rejected websocket upgrade: bad or missing token");
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, email);
  });
});

wss.on("connection", (ws, req, email) => {
  const connectedAt = Date.now();
  console.log("Client connected:", email);

  if (!clientsByEmail.has(email)) {
    clientsByEmail.set(email, new Set());
  }
  clientsByEmail.get(email).add(ws);

  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", () => {
    // client-side keepalive pings, nothing to do beyond proving liveness
    ws.isAlive = true;
  });

  ws.on("close", () => {
    console.log("Client disconnected:", email, "after", Math.round((Date.now() - connectedAt) / 1000) + "s");
    const sockets = clientsByEmail.get(email);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        clientsByEmail.delete(email);
      }
    }
  });
});

// A socket can die without ever firing "close" (laptop lid, dropped network),
// leaving a dead entry that makes `delivered` count leads nobody received.
// Ping every 30s and drop anything that missed the previous round.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on("close", () => clearInterval(heartbeat));

// Addresses only, never the codes: the API key is a server-to-server secret and
// should not be enough to impersonate a recruiter.
app.get("/roster", (req, res) => {
  if (!safeEqual(req.get("x-api-key") || "", LEAD_API_KEY)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const recruiters = Object.values(recruiterTokens).sort();
  res.json({ count: recruiters.length, recruiters });
});

app.post("/roster", (req, res) => {
  if (!safeEqual(req.get("x-api-key") || "", LEAD_API_KEY)) {
    console.log("Rejected /roster: bad or missing API key");
    return res.status(401).json({ error: "unauthorized" });
  }

  const emails = Array.isArray(req.body && req.body.emails) ? req.body.emails : null;

  // an empty push would disconnect everyone and lock the whole team out, which
  // is far more likely to be a broken Zoho function than a real empty roster
  if (!emails || emails.length === 0) {
    console.log("Rejected /roster: emails must be a non-empty array");
    return res.status(400).json({ error: "emails must be a non-empty array" });
  }

  const { count, skipped } = setRoster(emails);
  console.log("Roster updated from Zoho:", count, "recruiter(s),", skipped, "skipped");
  res.json({ status: "ok", recruiters: count, skipped });
});

app.post("/lead", (req, res) => {
  if (!safeEqual(req.get("x-api-key") || "", LEAD_API_KEY)) {
    console.log("Rejected /lead: bad or missing API key");
    return res.status(401).json({ error: "unauthorized" });
  }

  const lead = req.body || {};
  const owner = String(lead.owner || "").toLowerCase().trim();
  const leadId = String(lead.leadId || "").trim();

  // owner and leadId are load-bearing: without them the lead is undeliverable
  // and unclickable, so fail loudly rather than notify nobody and report "ok"
  if (!owner || !leadId) {
    console.log("Rejected /lead: missing owner or leadId");
    return res.status(400).json({ error: "owner and leadId are required" });
  }

  const payload = {
    title: "New Lead",
    name: lead.name || lead.Full_Name || "Unknown",
    campus: lead.campus || lead.Campus || "Unknown",
    owner,
    leadId
  };

  let delivered = 0;
  for (const ws of clientsByEmail.get(owner) || []) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
      delivered++;
    }
  }

  // the lead's name is customer PII and stays out of the logs; owner and
  // leadId are what you need to trace whether a lead actually landed
  console.log("Lead", leadId, "->", owner, ": delivered to", delivered, "client(s)");

  if (delivered === 0) {
    alertUndelivered(leadId, owner);
  }

  res.json({ status: "ok", delivered });
});

// keep stack traces and absolute paths out of responses
app.use((err, req, res, next) => {
  console.error("Request error:", err.message);
  res.status(err.status || 500).json({ error: "bad request" });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
