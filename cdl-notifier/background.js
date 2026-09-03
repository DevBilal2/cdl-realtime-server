const DEFAULT_SERVER_URL = "wss://cdl-realtime-server-vuw5.onrender.com";

let socket = null;
let reconnectTimer = null;
let isConnecting = false;
let reconnectAttempts = 0;

async function getConfig() {
  const { myToken, serverUrl } = await chrome.storage.local.get(["myToken", "serverUrl"]);
  return { myToken: myToken || null, serverUrl: serverUrl || DEFAULT_SERVER_URL };
}

function getConnectionState() {
  if (!socket) return "disconnected";
  switch (socket.readyState) {
    case WebSocket.CONNECTING:
      return "connecting";
    case WebSocket.OPEN:
      return "connected";
    default:
      return "disconnected";
  }
}

function broadcastStatus(status) {
  chrome.runtime.sendMessage({ type: "STATUS_UPDATE", status }).catch(() => {});
}

async function connect() {
  if (isConnecting || (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))) {
    console.log("Already connecting/connected, skipping duplicate connect()");
    return;
  }
  isConnecting = true;

  let myToken, serverUrl;
  try {
    ({ myToken, serverUrl } = await getConfig());
  } catch (e) {
    isConnecting = false;
    throw e;
  }

  if (!myToken) {
    console.log("No access code set, not connecting. Open the extension popup to paste it.");
    isConnecting = false;
    return;
  }

  try {
    socket = new WebSocket(`${serverUrl}?token=${encodeURIComponent(myToken)}`);
  } catch (e) {
    console.error("Failed to open WebSocket:", e.message);
    isConnecting = false;
    scheduleReconnect();
    return;
  }

  broadcastStatus("connecting");

  let pingInterval = null;

  socket.onopen = () => {
    console.log("Connected to realtime server");
    isConnecting = false;
    reconnectAttempts = 0;
    broadcastStatus("connected");

    // keep traffic flowing so proxies (Render/Cloudflare) don't treat the
    // connection as idle and close it
    pingInterval = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping" }));
      }
    }, 10000);
  };

  socket.onmessage = (event) => {
    let lead;
    try {
      lead = JSON.parse(event.data);
    } catch (e) {
      console.error("Ignoring unparseable message:", e.message);
      return;
    }

    const leadUrl = `https://crm.zoho.com/crm/EntityInfo.do?module=Leads&id=${lead.leadId}`;

    chrome.notifications.create(lead.leadId, {
      type: "basic",
      iconUrl: "icon.png",
      title: lead.title || "New Lead",
      message: `${lead.name} - ${lead.campus}`,
      priority: 2,
      requireInteraction: true
    }, (notificationId) => {
      if (chrome.runtime.lastError) {
        console.error("notifications.create failed:", chrome.runtime.lastError.message);
      } else {
        console.log("Notification created:", notificationId);
      }
    });

    // store URL for click event
    chrome.storage.local.set({
      [lead.leadId]: leadUrl
    });

    playSound();
  };

  socket.onerror = (err) => {
    console.error("WebSocket error:", err);
  };

  socket.onclose = () => {
    isConnecting = false;
    if (pingInterval) {
      clearInterval(pingInterval);
    }
    broadcastStatus("disconnected");
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);

  // Every recruiter drops at once when the server redeploys, so a fixed delay
  // would stampede a booting instance. Back off, and jitter so they spread out.
  const backoff = Math.min(1000 * 2 ** reconnectAttempts, 60000);
  const delay = backoff / 2 + Math.random() * (backoff / 2);
  reconnectAttempts++;

  console.log("WebSocket disconnected, retrying in", Math.round(delay / 1000) + "s");
  reconnectTimer = setTimeout(connect, delay);
}

// Two leads arriving together would otherwise both see "no document" and race,
// and the second createDocument throws.
let offscreenReady = null;

function createOffscreen() {
  if (!offscreenReady) {
    offscreenReady = (async () => {
      if (!(await chrome.offscreen.hasDocument?.())) {
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: ["AUDIO_PLAYBACK"],
          justification: "Play notification sound"
        });
      }
    })().catch(e => {
      offscreenReady = null;
      throw e;
    });
  }
  return offscreenReady;
}

async function playSound() {
  try {
    await createOffscreen();
    chrome.runtime.sendMessage({ type: "PLAY_SOUND" });
  } catch (e) {
    console.error("Could not play alert sound:", e.message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon.png",
    title: "CDL Notifier",
    message: "Installed. Click the toolbar icon and paste your access code."
  });

  playSound();
  connect();
});

chrome.runtime.onStartup.addListener(connect);

// service workers can be suspended/killed; this periodically wakes us up
// and reconnects if the socket died without onclose firing cleanly
chrome.alarms.create("keepalive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive" && (!socket || socket.readyState !== WebSocket.OPEN)) {
    connect();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CONFIG_UPDATED") {
    if (socket) {
      socket.close();
    }
    connect();
  }
  if (msg.type === "GET_STATUS") {
    sendResponse({ status: getConnectionState() });
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.storage.local.get(notificationId, (result) => {
    const url = result[notificationId];

    if (url) {
      chrome.tabs.create({ url });
    }

    // the stored url has served its purpose; without this every lead leaves a
    // permanent entry alongside the real settings
    chrome.storage.local.remove(notificationId);
    chrome.notifications.clear(notificationId);
  });
});

connect();
