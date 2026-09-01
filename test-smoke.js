// Smoke test: boots the server, connects a fake recruiter, checks routing + auth.
// Run: node test-smoke.js
import assert from "assert";
import { spawn } from "child_process";
import WebSocket from "ws";

const PORT = 3998;
const KEY = "test-key-do-not-use-in-prod";
const BASE = `http://localhost:${PORT}`;

const post = (body, key) =>
  fetch(`${BASE}/lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "X-API-Key": key } : {}) },
    body: JSON.stringify(body)
  });

const srv = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: String(PORT), LEAD_API_KEY: KEY },
  stdio: "inherit"
});

const ready = async () => {
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE); return; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error("server never came up");
};

try {
  await ready();

  // no key is rejected, wrong key is rejected
  assert.equal((await post({ owner: "a@b.com", leadId: "1" })).status, 401, "missing key must 401");
  assert.equal((await post({ owner: "a@b.com", leadId: "1" }, "wrong")).status, 401, "wrong key must 401");

  // missing load-bearing fields are rejected loudly, not silently accepted
  assert.equal((await post({ name: "Bob" }, KEY)).status, 400, "missing owner/leadId must 400");

  // nobody connected -> delivered 0, and the caller is told
  assert.deepEqual(await (await post({ owner: "a@b.com", leadId: "1" }, KEY)).json(),
    { status: "ok", delivered: 0 }, "undelivered must report delivered:0");

  // connected recruiter receives only their own lead
  const ws = new WebSocket(`ws://localhost:${PORT}?email=Sarah@B.com`);
  const got = new Promise(r => ws.on("message", d => r(JSON.parse(d))));
  await new Promise(r => ws.on("open", r));

  const other = await (await post({ owner: "greg@b.com", leadId: "9" }, KEY)).json();
  assert.equal(other.delivered, 0, "lead for another owner must not reach Sarah");

  const mine = await (await post({ owner: "SARAH@b.com", name: "Bob", campus: "Dallas", leadId: "7" }, KEY)).json();
  assert.equal(mine.delivered, 1, "lead for Sarah must be delivered once");

  const msg = await got;
  assert.equal(msg.leadId, "7");
  assert.equal(msg.owner, "sarah@b.com", "owner must be normalized to lowercase");
  assert.equal(msg.name, "Bob");

  ws.close();
  console.log("\nall smoke checks passed");
} finally {
  srv.kill();
}
