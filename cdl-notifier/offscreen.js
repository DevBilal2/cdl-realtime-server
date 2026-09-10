const audio = new Audio(chrome.runtime.getURL("alert.mp3"));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "PLAY_SOUND") {
    audio.currentTime = 0;
    audio.play();
  }
});