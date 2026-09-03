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

// token -> email. The client presents a token and the server decides which
// address it maps to, so a recruiter can't read someone else's leads by
// typing their address, and a typo fails immediately instead of silently
// connecting as an address that never receives anything.
const RECRUITER_TOKENS = JSON.parse(process.env.RECRUITER_TOKENS || "{}");
if (Object.keys(RECRUITER_TOKENS).length === 0) {
  console.error("RECRUITER_TOKENS is not set, refusing to start");
  process.exit(1);
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// email -> Set<ws>, supports multiple tabs/windows per recruiter
const clientsByEmail = new Map();

// Authenticate during the upgrade so an unauthorized client never completes
// the handshake.
server.on("upgrade", (req, socket, head) => {
  const { searchParams } = new URL(req.url, "http://localhost");
  const email = (RECRUITER_TOKENS[searchParams.get("token")] || "").toLowerCase().trim();

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
