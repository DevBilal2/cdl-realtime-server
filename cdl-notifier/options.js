const DEFAULT_SERVER_URL = "wss://cdl-realtime-server-vuw5.onrender.com";

const emailInput = document.getElementById("email");
const serverUrlInput = document.getElementById("serverUrl");
const status = document.getElementById("status");

chrome.storage.local.get(["myEmail", "serverUrl"], ({ myEmail, serverUrl }) => {
  if (myEmail) {
    emailInput.value = myEmail;
  }
  serverUrlInput.value = serverUrl || DEFAULT_SERVER_URL;
});

document.getElementById("save").addEventListener("click", () => {
  const email = emailInput.value.trim().toLowerCase();
  const serverUrl = serverUrlInput.value.trim();

  if (!email || !email.includes("@")) {
    status.style.color = "red";
    status.textContent = "Enter a valid email";
    return;
  }

  if (!serverUrl.startsWith("ws://") && !serverUrl.startsWith("wss://")) {
    status.style.color = "red";
    status.textContent = "Server URL must start with ws:// or wss://";
    return;
  }

  chrome.storage.local.set({ myEmail: email, serverUrl }, () => {
    status.style.color = "green";
    status.textContent = "Saved. Reconnecting...";
    chrome.runtime.sendMessage({ type: "EMAIL_UPDATED" });
  });
});
