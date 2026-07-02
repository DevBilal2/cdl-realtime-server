const DEFAULT_SERVER_URL = "wss://cdl-realtime-server-vuw5.onrender.com";

let socket = null;
let reconnectTimer = null;
let isConnecting = false;

async function getConfig() {
  const { myEmail, serverUrl } = await chrome.storage.local.get(["myEmail", "serverUrl"]);
  return { myEmail: myEmail || null, serverUrl: serverUrl || DEFAULT_SERVER_URL };
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

  let myEmail, serverUrl;
  try {
    ({ myEmail, serverUrl } = await getConfig());
  } catch (e) {
    isConnecting = false;
    throw e;
  }

  if (!myEmail) {
    console.log("No email configured yet, not connecting. Open extension options to set it.");
    isConnecting = false;
    return;
  }

  try {
    socket = new WebSocket(`${serverUrl}?email=${encodeURIComponent(myEmail)}`);
  } catch (e) {
    console.error("Failed to open WebSocket:", e.message);
    isConnecting = false;
    scheduleReconnect();
    return;
  }

  broadcastStatus("connecting");

  socket.onopen = () => {
    console.log("Connected to realtime server as", myEmail);
    isConnecting = false;
    broadcastStatus("connected");
  };

  socket.onmessage = (event) => {
    console.log("Received lead:", event.data);
    const lead = JSON.parse(event.data);

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
    console.log("WebSocket disconnected, retrying in 5s");
    isConnecting = false;
    broadcastStatus("disconnected");
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 5000);
}

async function createOffscreen() {
  const exists = await chrome.offscreen.hasDocument?.();

  if (!exists) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play notification sound"
    });
  }
}

async function playSound() {
  await createOffscreen();
  chrome.runtime.sendMessage({ type: "PLAY_SOUND" });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon.png",
    title: "CDL Notifier",
    message: "Installed successfully. Set your email in extension options."
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
  if (msg.type === "EMAIL_UPDATED") {
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
  });
});

connect();
