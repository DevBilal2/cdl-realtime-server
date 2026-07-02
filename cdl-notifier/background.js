const DEFAULT_SERVER_URL = "wss://cdl-realtime-server-vuw5.onrender.com";

let socket = null;
let reconnectTimer = null;

async function getConfig() {
  const { myEmail, serverUrl } = await chrome.storage.local.get(["myEmail", "serverUrl"]);
  return { myEmail: myEmail || null, serverUrl: serverUrl || DEFAULT_SERVER_URL };
}

async function connect() {
  const { myEmail, serverUrl } = await getConfig();

  if (!myEmail) {
    console.log("No email configured yet, not connecting. Open extension options to set it.");
    return;
  }

  socket = new WebSocket(`${serverUrl}?email=${encodeURIComponent(myEmail)}`);

  socket.onopen = () => {
    console.log("Connected to realtime server as", myEmail);
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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "EMAIL_UPDATED") {
    if (socket) {
      socket.close();
    }
    connect();
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
