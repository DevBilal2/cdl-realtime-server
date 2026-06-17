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
    const lead = req.body;

    const payload = JSON.stringify({
      title: "New Lead",
      name: lead.name,
      campus: lead.campus,
      owner: lead.owner,
      leadId: lead.leadId
    });

    clients.forEach(ws => {
      if (ws.readyState === 1) {
        ws.send(payload);
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