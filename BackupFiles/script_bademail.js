// script.js

// ------------------- Configuration & OAuth -------------------
const CLIENT_ID = "991293667384-b654jos0v2e8mbgqr8q50ck4hantv8tf.apps.googleusercontent.com";
const SCOPES    = "https://www.googleapis.com/auth/calendar";

let tokenClient;

// Called by <script onload="gapiLoaded()"> in index.html
function gapiLoaded() {
  gapi.load("client", initializeGapiClient);
}

async function initializeGapiClient() {
  await gapi.client.init({
    discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"]
  });
  maybeAutoAuth();
}

function maybeAutoAuth() {
  tokenClient.requestAccessToken({ prompt: "" });
  setTimeout(() => {
    if (!gapi.client.getToken()) {
      document.getElementById("authorize_button").style.display = "inline-block";
    }
  }, 2000);
}

window.onload = () => {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope:     SCOPES,
    prompt:    "",
    callback:  (resp) => {
      if (resp.access_token) {
        gapi.client.setToken(resp);
        listEvents();
      }
    }
  });
};

function handleAuthClick() {
  tokenClient.requestAccessToken();
}

// ------------------- UI Elements & Prices -------------------
const extensionDiv    = document.getElementById("extension-options");
const countdownAlert  = document.getElementById("countdown-alert");
const countdownText   = document.getElementById("countdown");
const sessionTimeText = document.getElementById("session-time");

// Extension pricing options
const extensionOptions = [
  { minutes: 15, price: "$22" },
  { minutes: 30, price: "$43" },
  { minutes: 60, price: "$84.96" }
];

// Hide the countdown alert until we need it
countdownAlert.style.display = "none";

// ------------------- Fetch & Display Calendar Events -------------------
function listEvents() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  gapi.client.calendar.events.list({
    calendarId: "2l28nlc148jqqc7uk24u5jr9cs@group.calendar.google.com",
    timeMin:    new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    timeMax:    tomorrow.toISOString(),
    showDeleted: false,
    singleEvents: true,
    maxResults: 10,
    orderBy: "startTime"
  })
  .then(response => {
    handleLiveEvents(response.result.items);
  })
  .catch(error => {
    console.error("❌ Calendar error:", error);
  });
}

function handleLiveEvents(events) {
  const now = new Date();
  const current = events.find(evt => {
    const start = new Date(evt.start.dateTime);
    const end   = new Date(evt.end.dateTime);
    return now >= start && now < end;
  });

  if (!current) {
    sessionTimeText.textContent = "No active session";
    console.log("ℹ️ No session currently running.");
    return;
  }

  // Store a few values for later extension logic:
  window.currentEventId      = current.id;
  window.originalEventTitle  = current.summary || "Session";
  window.sessionEndTime      = new Date(current.end.dateTime);
  const isEvent             = current.summary.toLowerCase().includes("event");
  window.sessionClientName  = extractClientName(current, isEvent);

  // Display client name & session time in the UI
  displayClientName(window.sessionClientName);
  const startTime = new Date(current.start.dateTime);
  const endTime   = new Date(current.end.dateTime);
  sessionTimeText.textContent = `${formatTime(startTime)} - ${formatTime(endTime)}`;

  // Begin the countdown
  startCountdown(endTime, isEvent, events);
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function extractClientName(evt, isEvent) {
  if (!evt.summary) return "";
  return isEvent ? evt.summary.trim() : evt.summary.split(":")[0].trim();
}

function displayClientName(name) {
  let el = document.getElementById("client-name");
  if (!el) {
    el = document.createElement("p");
    el.id = "client-name";
    el.style.fontWeight = "bold";
    el.style.fontSize   = "1.5rem";
    sessionTimeText.parentNode.insertBefore(el, sessionTimeText);
  }
  el.textContent = name;
}

// ------------------- Countdown & Extension Buttons -------------------
function startCountdown(endTime, isEvent, events) {
  const alertThreshold = isEvent ? 30 : 15;
  const chimeSound     = new Audio(isEvent ? "30_minute_warning.wav" : "15_minute_warning.wav");

  // Find next event after the current session to compute available minutes
  const nextEvt = events.find(evt => new Date(evt.start.dateTime) > endTime);
  const availableMinutes = nextEvt
    ? Math.floor((new Date(nextEvt.start.dateTime) - endTime) / (60 * 1000))
    : 240; // fallback: assume 4 hours free

  const interval = setInterval(() => {
    const now = new Date();
    const minsLeft = Math.ceil((endTime - now) / (60 * 1000));

    if (minsLeft === alertThreshold) {
      countdownText.textContent = `${alertThreshold} minutes remaining`;
      countdownAlert.style.display = "inline-block";
      chimeSound.play().catch(err => console.log("Autoplay blocked:", err));
      showExtensionButtons(availableMinutes, isEvent);
    }

    if (minsLeft <= 0) {
      clearInterval(interval);
      countdownText.textContent = "Session ended";
      countdownAlert.style.display = "none";
      extensionDiv.innerHTML = "";
    }
  }, 30000); // check every 30 seconds
}

function showExtensionButtons(availableMinutes, isEvent = false) {
  extensionDiv.innerHTML = ""; // Clear any existing buttons

  const options = isEvent
    ? [
        { minutes: 30, price: "$53.10" },
        { minutes: 60, price: "$106.20" }
      ]
    : extensionOptions;

  options.forEach(option => {
    if (availableMinutes >= option.minutes) {
      const button = document.createElement("button");
      button.textContent = `Extend ${option.minutes} Minutes (${option.price})`;

      
      button.onclick = async () => {
        console.log("🔽 Extend button clicked (minutes=", option.minutes, ")");
        const confirmed = confirm(`Extend session for ${option.minutes} minutes (${option.price})?`);
        if (!confirmed) return;

        // 1️⃣ Patch the Calendar event (append [EXTENDED] if necessary)
        const newEnd = new Date(window.sessionEndTime.getTime() + option.minutes * 60000);
        const originalTitle = window.originalEventTitle;
        const alreadyExtended = originalTitle.includes("[EXTENDED]");
        const updatedTitle = alreadyExtended
          ? originalTitle
          : `${originalTitle} [EXTENDED]`;

        const updatedEvent = {
          summary: updatedTitle,
          end: {
            dateTime: newEnd.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          },
          description: `${new Date().toLocaleTimeString()} — Client extended their session by ${option.minutes} minutes.`
        };

        try {
          await gapi.client.calendar.events.patch({
            calendarId: "2l28nlc148jqqc7uk24u5jr9cs@group.calendar.google.com",
            eventId: window.currentEventId,
            resource: updatedEvent
          });

          // 2️⃣ Build the payload for Apps Script
          const origStart = new Date(newEnd.getTime() - option.minutes * 60000);
          const origRange = `${formatTime(origStart)} – ${formatTime(window.sessionEndTime)}`;
          const newRange  = `${formatTime(origStart)} – ${formatTime(newEnd)}`;
          const extendedLabel = `${option.minutes === 60 ? "1 hour" : option.minutes + " minutes"} for ${option.price}`;

          // Remove “(White Space Studio)” from the appointment title if present
          const cleanedTitle = originalTitle.replace(/\s*\(White Space Studio\)/i, "").trim();

          const payload = {
            clientName:       window.sessionClientName,
            extendedMinutes:  option.minutes,
            appointmentTitle: cleanedTitle,
            originalTime:     origRange,
            newTime:          newRange,
            extendedLabel:    extendedLabel
          };

          // 3️⃣ POST to Apps Script Web App
          //    (Replace the URL below with your actual Web App URL)
          const webAppUrl = "https://script.google.com/macros/s/AKfycbwp3tLcNPU44q_kTN5nMz2q2xYJvh9bp_NVWNvTYitOtK-9_haZzoOPmuvt7jWEaXgsGw/exec";
fetch(webAppUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
})
  .then(response => {
    console.log("📤 Sent extension data to Apps Script:", response.status);
  })
  .catch(err => {
    console.error("❌ Failed to notify Apps Script:", err);
  })
  .finally(() => {
    // Only reload the page after the fetch promise settles:
    window.sessionEndTime = newEnd;
    window.originalEventTitle = updatedTitle;
    location.reload();
  });


        } catch (error) {
          console.error("❌ Failed to update event:", error);
          alert("❌ Failed to update session in calendar.");
        }
      };

      extensionDiv.appendChild(button);
    }
  });
}
