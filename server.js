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

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// email -> Set<ws>, supports multiple tabs/windows per recruiter
const clientsByEmail = new Map();

wss.on("connection", (ws, req) => {
  const { searchParams } = new URL(req.url, "http://localhost");
  const email = (searchParams.get("email") || "").toLowerCase().trim();

  if (!email) {
    console.log("Client connected without email, closing");
    ws.close();
    return;
  }

  const connectedAt = Date.now();
  console.log("Client connected:", email);

  if (!clientsByEmail.has(email)) {
    clientsByEmail.set(email, new Set());
  }
  clientsByEmail.get(email).add(ws);

  ws.on("message", () => {
    // client-side keepalive pings, nothing to do
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

  if (delivered === 0) {
    console.log("No connected client for owner:", owner);
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
