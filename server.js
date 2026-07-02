import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const app = express();
app.use(express.json());

// health check route (IMPORTANT for Render)
app.get("/", (req, res) => {
  res.send("CDL Realtime Server Running");
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
  try {
    console.log("RAW BODY:", req.body);

    // handle both cases: JSON OR string
    let lead = req.body;

    if (typeof lead === "string") {
      try {
        lead = JSON.parse(lead);
      } catch (e) {
        console.log("Failed to parse string body");
      }
    }

    const payload = {
      title: "New Lead",
      name: lead.name || lead.Full_Name || "Unknown",
      campus: lead.campus || lead.Campus || "Unknown",
      owner: lead.owner || "Unknown",
      leadId: lead.leadId || "Unknown"
    };

    console.log("FINAL PAYLOAD:", payload);

    const ownerEmail = String(payload.owner).toLowerCase().trim();
    const sockets = clientsByEmail.get(ownerEmail);

    if (sockets) {
      sockets.forEach(ws => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(payload));
        }
      });
    } else {
      console.log("No connected client for owner:", ownerEmail);
    }

    res.json({ status: "ok" });

  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "server error" });
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});