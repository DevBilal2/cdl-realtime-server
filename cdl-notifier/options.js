const DEFAULT_SERVER_URL = "wss://cdl-realtime-server-vuw5.onrender.com";

const emailInput = document.getElementById("email");
const serverUrlInput = document.getElementById("serverUrl");
const advancedToggle = document.getElementById("advancedToggle");
const advancedBody = document.getElementById("advancedBody");
const saveBtn = document.getElementById("saveBtn");
const statusMsg = document.getElementById("statusMsg");
const statusIcon = document.getElementById("statusIcon");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const statusLabel = document.getElementById("statusLabel");

const CONNECTION_META = {
  disconnected: { label: "Not connected", color: "#A8A8A8" },
  connecting: { label: "Connecting…", color: "#F9B21D" },
  connected: { label: "Connected", color: "#089949" },
};

function hideStatus() {
  statusMsg.className = "status-msg";
}

function setConnectionState(state) {
  const meta = CONNECTION_META[state] || CONNECTION_META.disconnected;
  statusDot.style.background = meta.color;
  statusLabel.textContent = meta.label;

  if (state === "connected") {
    hideStatus();
  }
}

function showStatus(type, message) {
  statusMsg.className = `status-msg show ${type}`;
  statusIcon.textContent = type === "success" ? "✓" : "!";
  statusText.textContent = message;
}

advancedToggle.addEventListener("click", () => {
  const isOpen = advancedBody.classList.toggle("open");
  advancedToggle.classList.toggle("open", isOpen);
});

chrome.storage.local.get(["myEmail", "serverUrl"], ({ myEmail, serverUrl }) => {
  if (myEmail) {
    emailInput.value = myEmail;
  }
  serverUrlInput.value = serverUrl || DEFAULT_SERVER_URL;
});

chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
  if (response && response.status) {
    setConnectionState(response.status);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATUS_UPDATE") {
    setConnectionState(msg.status);
  }
});

saveBtn.addEventListener("click", () => {
  const email = emailInput.value.trim().toLowerCase();
  const serverUrl = serverUrlInput.value.trim();

  if (!email || !email.includes("@")) {
    showStatus("error", "Enter a valid email address.");
    return;
  }

  if (!serverUrl.startsWith("ws://") && !serverUrl.startsWith("wss://")) {
    showStatus("error", "Server URL must start with ws:// or wss://");
    return;
  }

  chrome.storage.local.set({ myEmail: email, serverUrl }, () => {
    showStatus("success", "Saved");
    setConnectionState("connecting");
    chrome.runtime.sendMessage({ type: "EMAIL_UPDATED" });
  });
});
