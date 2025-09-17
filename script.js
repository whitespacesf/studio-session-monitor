function resolveApiBaseUrl() {
  if (window.APP_API_BASE_URL) {
    return window.APP_API_BASE_URL;
  }

  if (window.location.protocol === "file:") {
    return "http://localhost:3001";
  }

  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:3001";
  }

  return "";
}

const API_BASE_URL = resolveApiBaseUrl().replace(/\/$/, "");

const extensionDiv = document.getElementById("extension-options");
const countdownAlert = document.getElementById("countdown-alert");
const countdownText = document.getElementById("countdown");
const sessionTimeText = document.getElementById("session-time");
const timeRemainingEl = document.getElementById("time-remaining");

const extensionOptions = [
  { minutes: 15, price: "$22" },
  { minutes: 30, price: "$43" },
  { minutes: 60, price: "$84.96" },
];

const eventExtensionOptions = [
  { minutes: 30, price: "$53.10" },
  { minutes: 60, price: "$106.20" },
];

let countdownInterval = null;

document.addEventListener("DOMContentLoaded", () => {
  if (countdownAlert) {
    countdownAlert.style.display = "none";
  }
  loadActiveSession();
});

async function loadActiveSession() {
  clearCountdown();

  try {
    const response = await fetch(`${API_BASE_URL}/active-session`);
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    handleSessionData(data);
  } catch (error) {
    console.error("❌ Failed to fetch active session:", error);
    sessionTimeText.textContent = "Unable to load session";
    extensionDiv.innerHTML = "";
  }
}

function handleSessionData({ currentSession, nextFreeBlock }) {
  if (!currentSession || !currentSession.start || !currentSession.end) {
    sessionTimeText.textContent = "No active session";
    displayClientName("");
    extensionDiv.innerHTML = "";
    return;
  }

  const start = new Date(currentSession.start);
  const end = new Date(currentSession.end);
  const isEvent = (currentSession.summary || "").toLowerCase().includes("event");

  window.currentEventId = currentSession.id;
  window.originalEventTitle = currentSession.summary || "Session";
  window.sessionStartTime = start;
  window.sessionEndTime = end;
  window.currentEventDescription = currentSession.description || "";

  const clientName = extractClientName(currentSession.summary, isEvent);
  window.sessionClientName = clientName;

  displayClientName(clientName);
  sessionTimeText.textContent = `${formatTime(start)} - ${formatTime(end)}`;

  const availableMinutes = Math.max(
    0,
    nextFreeBlock && typeof nextFreeBlock.availableMinutes === "number"
      ? nextFreeBlock.availableMinutes
      : 240
  );

  startCountdown(end, isEvent, availableMinutes);
}

function clearCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  updateTimeRemainingDisplay(null);

  if (countdownAlert) {
    countdownAlert.style.display = "none";
  }

  if (countdownText) {
    countdownText.textContent = "";
  }
}

function startCountdown(endTime, isEvent, availableMinutes) {
  clearCountdown();

  const alertThreshold = isEvent ? 30 : 15;
  const chimeSound = new Audio(
    isEvent ? "30_minute_warning.wav" : "15_minute_warning.wav"
  );

  let alertPlayed = false;

  countdownInterval = setInterval(() => {
    const now = new Date();
    const msRemaining = endTime - now;

    if (msRemaining <= 0) {
      clearCountdown();
      sessionTimeText.textContent = "Session ended";
      extensionDiv.innerHTML = "";
      return;
    }

    updateTimeRemainingDisplay(msRemaining);

    const minsRemaining = Math.floor(msRemaining / (60 * 1000));

    if (minsRemaining === alertThreshold && !alertPlayed) {
      alertPlayed = true;
      if (countdownText) {
        countdownText.textContent = `${alertThreshold} minutes remaining`;
      }
      if (countdownAlert) {
        countdownAlert.style.display = "inline-block";
      }
      chimeSound.play().catch((err) => console.log("Autoplay blocked:", err));
      showExtensionButtons(availableMinutes, isEvent);
    }
  }, 1000);
}

function updateTimeRemainingDisplay(msRemaining) {
  if (!timeRemainingEl) return;

  if (msRemaining && msRemaining > 0) {
    const minsRemaining = Math.floor(msRemaining / (60 * 1000));
    const secsRemaining = Math.floor((msRemaining % (60 * 1000)) / 1000);
    const hrs = Math.floor(minsRemaining / 60);
    const mins = minsRemaining % 60;
    const secs = secsRemaining;

    let formatted;
    if (hrs > 0) {
      formatted = `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(
        2,
        "0"
      )}`;
    } else {
      formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(
        2,
        "0"
      )}`;
    }

    timeRemainingEl.textContent = formatted;
  } else {
    timeRemainingEl.textContent = "";
  }
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function extractClientName(summary, isEvent) {
  if (!summary) return "";
  return isEvent ? summary.trim() : summary.split(":")[0].trim();
}

function displayClientName(name) {
  let el = document.getElementById("client-name");
  if (!el) {
    el = document.createElement("p");
    el.id = "client-name";
    el.style.fontWeight = "bold";
    el.style.fontSize = "1.5rem";
    sessionTimeText.parentElement.insertBefore(el, sessionTimeText);
  }

  el.textContent = name;
}

function showExtensionButtons(availableMinutes, isEvent = false) {
  extensionDiv.innerHTML = "";

  const options = isEvent ? eventExtensionOptions : extensionOptions;

  options.forEach((option) => {
    if (availableMinutes < option.minutes) {
      return;
    }

    const button = document.createElement("button");
    button.textContent = `Extend ${option.minutes} Minutes (${option.price})`;

    button.onclick = async () => {
      const confirmed = confirm(
        `Extend session for ${option.minutes} minutes (${option.price})?`
      );
      if (!confirmed) return;

      button.disabled = true;

      const payload = {
        eventId: window.currentEventId,
        originalTitle: window.originalEventTitle,
        currentEnd: window.sessionEndTime.toISOString(),
        extendMinutes: option.minutes,
        description: window.currentEventDescription,
        clientName: window.sessionClientName,
        durationLabel:
          option.minutes === 60 ? "1 hour" : `${option.minutes} minutes`,
        extensionAmount: option.price,
      };

      try {
        const response = await fetch(`${API_BASE_URL}/extend-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error("Unexpected response from server");
        }

        console.log("✅ Successfully requested session extension.");
        await loadActiveSession();
      } catch (err) {
        console.error("❌ Error extending session:", err);
        alert("❌ Failed to update session. Please notify staff.");
      } finally {
        button.disabled = false;
      }
    };

    extensionDiv.appendChild(button);
  });
}
