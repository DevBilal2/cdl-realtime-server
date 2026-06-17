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

let clients = [];

wss.on("connection", (ws) => {
  console.log("Client connected");

  clients.push(ws);

  ws.on("close", () => {
    clients = clients.filter(c => c !== ws);
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

    clients.forEach(ws => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(payload));
      }
    });

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