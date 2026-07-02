const emailInput = document.getElementById("email");
const status = document.getElementById("status");

chrome.storage.local.get("myEmail", ({ myEmail }) => {
  if (myEmail) {
    emailInput.value = myEmail;
  }
});

document.getElementById("save").addEventListener("click", () => {
  const email = emailInput.value.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    status.style.color = "red";
    status.textContent = "Enter a valid email";
    return;
  }

  chrome.storage.local.set({ myEmail: email }, () => {
    status.style.color = "green";
    status.textContent = "Saved. Reconnecting...";
    chrome.runtime.sendMessage({ type: "EMAIL_UPDATED" });
  });
});
