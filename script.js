// ------------------- Configuration & OAuth -------------------
const CLIENT_ID = "991293667384-b654jos0v2e8mbgqr8q50ck4hantv8tf.apps.googleusercontent.com";
// combine Calendar + Sheets scopes (read/write Sheets)
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets"
].join(" ");

let tokenClient;
let gapiInited = false;
let tokenClientReady = false;
let autoAuthTimeoutId;

// This function is called by <script onload="gapiLoaded()"> in index.html
function gapiLoaded() {
  gapi.load("client", initializeGapiClient);
}

async function initializeGapiClient() {
  await gapi.client.init({
    discoveryDocs: [
      "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
      "https://sheets.googleapis.com/$discovery/rest?version=v4"
    ]
  });
  gapiInited = true;
  tryAuthorize();
}

function maybeAutoAuth() {
  if (!gapiInited || !tokenClientReady || gapi.client.getToken()) {
    return;
  }

  tokenClient.requestAccessToken({ prompt: "" });

  if (autoAuthTimeoutId) {
    clearTimeout(autoAuthTimeoutId);
  }

  autoAuthTimeoutId = setTimeout(() => {
    if (!gapi.client.getToken()) {
      document.getElementById("authorize_button").style.display = "inline-block";
    }
  }, 2000);
}

function tryAuthorize() {
  if (!gapiInited) {
    return;
  }

  if (gapi.client.getToken()) {
    document.getElementById("authorize_button").style.display = "none";
    listEvents();
    return;
  }

  maybeAutoAuth();
}

window.onload = () => {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope:     SCOPES,
    prompt:    "",
    callback: (resp) => {
      if (resp.access_token) {
        gapi.client.setToken(resp);
        document.getElementById("authorize_button").style.display = "none"; // ✅ hide the button
        tryAuthorize();
      } else {
        document.getElementById("authorize_button").style.display = "inline-block";
      }
    }
  });

  tokenClientReady = true;
  tryAuthorize();
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

// Hide the countdown alert until needed
countdownAlert.style.display = "none";

// ------------------- Fetch & Display Calendar Events -------------------
function listEvents() {
  const now      = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  gapi.client.calendar.events
    .list({
      calendarId:   "2l28nlc148jqqc7uk24u5jr9cs@group.calendar.google.com",
      timeMin:      new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      timeMax:      tomorrow.toISOString(),
      showDeleted:  false,
      singleEvents: true,
      maxResults:   10,
      orderBy:      "startTime"
    })
    .then(response => {
      const { items = [], timeZone: calendarTimeZone } = response.result || {};
      window.calendarTimeZone = calendarTimeZone;
      handleLiveEvents(items, calendarTimeZone);
    })
    .catch(error => {
      console.error("❌ Calendar error:", error);
    });
}

// ------------------- Main Logic: Identify & Display Current Session -------------------
function getDateFromEventTime(eventTime, calendarTimeZone) {
  if (!eventTime) return new Date(NaN);

  if (eventTime.dateTime) {
    return new Date(eventTime.dateTime);
  }

  if (eventTime.date) {
    const tz = eventTime.timeZone || calendarTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const [year, month, day] = eventTime.date.split("-").map(Number);

    if ([year, month, day].some(value => Number.isNaN(value))) {
      return new Date(`${eventTime.date}T00:00:00`);
    }

    if (!tz) {
      return new Date(`${eventTime.date}T00:00:00`);
    }

    const referenceUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year:   "numeric",
      month:  "2-digit",
      day:    "2-digit",
      hour:   "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });

    const parts = formatter.formatToParts(referenceUtc);
    const mapped = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        mapped[part.type] = part.value;
      }
    }

    const asUtc = Date.UTC(
      Number(mapped.year),
      Number(mapped.month) - 1,
      Number(mapped.day),
      Number(mapped.hour),
      Number(mapped.minute),
      Number(mapped.second)
    );

    const offset = asUtc - referenceUtc.getTime();
    return new Date(referenceUtc.getTime() - offset);
  }

  return new Date(NaN);
}

function handleLiveEvents(events, calendarTimeZone) {
  const now = new Date();

  // Find the event where “now” is between its start and end
  const current = events.find(evt => {
    const start = getDateFromEventTime(evt.start, calendarTimeZone);
    const end   = getDateFromEventTime(evt.end, calendarTimeZone);
    return now >= start && now < end;
  });

  if (!current) {
    sessionTimeText.textContent = "No active session";
    console.log("ℹ️ No session currently running.");
    return;
  }

  // Store for later extension logic
  window.currentEventId          = current.id;
  window.originalEventTitle      = current.summary || "Session";
  window.sessionStartTime        = getDateFromEventTime(current.start, calendarTimeZone);
  window.sessionEndTime          = getDateFromEventTime(current.end, calendarTimeZone);
  window.currentEventDescription = current.description || "";

  const summaryText = current.summary || "";
  const isEvent = summaryText.toLowerCase().includes("event");
  window.sessionClientName = extractClientName(current, isEvent);

  // Display client name & session time
  displayClientName(window.sessionClientName);
  const startTime = getDateFromEventTime(current.start, calendarTimeZone);
  const endTime   = getDateFromEventTime(current.end, calendarTimeZone);
  const isAllDay  = Boolean(current.start.date && !current.start.dateTime);
  sessionTimeText.textContent = isAllDay
    ? "All day"
    : `${formatTime(startTime)} - ${formatTime(endTime)}`;

  // Begin the countdown
  startCountdown(endTime, isEvent, events, calendarTimeZone, { isAllDay });
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
    sessionTimeText.parentElement.insertBefore(el, sessionTimeText);
  }
  el.textContent = name;
}

// ------------------- Countdown & Time-Remaining Display -------------------
function startCountdown(endTime, isEvent, events, calendarTimeZone, options = {}) {
  const { isAllDay = false } = options;
  const shouldOfferExtensions = !isAllDay;
  const alertThreshold = shouldOfferExtensions ? (isEvent ? 30 : 15) : null;
  const chimeSound = shouldOfferExtensions
    ? new Audio(isEvent ? "30_minute_warning.wav" : "15_minute_warning.wav")
    : null;

  // Find the next event that starts after this one ends
  const nextEvt = shouldOfferExtensions
    ? events.find(evt => getDateFromEventTime(evt.start, calendarTimeZone) > endTime)
    : null;
  const nextEventStart = nextEvt
    ? getDateFromEventTime(nextEvt.start, calendarTimeZone)
    : null;
  const availableMinutes = nextEventStart
    ? Math.floor((nextEventStart - endTime) / (60 * 1000))
    : 240; // fallback: assume 4 hours free

  let alertPlayed = false;

  extensionDiv.innerHTML        = "";
  countdownAlert.style.display  = "none";
  countdownText.textContent     = "";

  const interval = setInterval(() => {
    const now           = new Date();
    const msRemaining   = endTime - now;
    const minsRemaining = Math.floor(msRemaining / (60 * 1000));
    const secsRemaining = Math.floor((msRemaining % (60 * 1000)) / 1000);

    // ⏳ Update “Time Remaining” in H:MM:SS or MM:SS format
    const timeRemainingEl = document.getElementById("time-remaining");
    if (timeRemainingEl) {
      if (msRemaining > 0) {
        const hrs  = Math.floor(minsRemaining / 60);
        const mins = minsRemaining % 60;
        const secs = secsRemaining;
        let formatted;

        if (hrs > 0) {
          formatted = `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        } else {
          formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        }
        timeRemainingEl.textContent = formatted;
      } else {
        timeRemainingEl.textContent = "";
      }
    }

    // Only play the chime once at threshold
    if (alertThreshold !== null && minsRemaining === alertThreshold && msRemaining > 0 && !alertPlayed) {
      alertPlayed = true;
      countdownText.textContent     = `${alertThreshold} minutes remaining`;
      countdownAlert.style.display  = "inline-block";
      if (chimeSound) {
        chimeSound.play().catch(err => console.log("Autoplay blocked:", err));
      }
      if (shouldOfferExtensions) {
        showExtensionButtons(availableMinutes, isEvent);
      }
    }

    // When time’s up, clear things
    if (msRemaining <= 0) {
      countdownText.textContent     = "Session ended";
      countdownAlert.style.display  = "none";
      extensionDiv.innerHTML        = "";
      if (timeRemainingEl) timeRemainingEl.textContent = "";
      // Refresh events so the next session (if any) displays automatically
      setTimeout(() => {
        try {
          listEvents();
        } catch (err) {
          console.error("❌ Failed to refresh events after session end:", err);
        }
      }, 500);
      clearInterval(interval);
    }
  }, 1000);
}

// ------------------- Show “Extend” Buttons & Patch Calendar & Log to Sheet -------------------
function showExtensionButtons(availableMinutes, isEvent = false) {
  extensionDiv.innerHTML = ""; // Clear existing buttons

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
        const confirmed = confirm(
          `Extend session for ${option.minutes} minutes (${option.price})?`
        );
        if (!confirmed) return;

        const originalTitle   = window.originalEventTitle || "Session";
        const alreadyExtended = originalTitle.includes("[EXTENDED]");
        const updatedTitle    = alreadyExtended
          ? originalTitle
          : `${originalTitle} [EXTENDED]`;

        const durationLabel = option.minutes === 60
          ? "1 hour"
          : `${option.minutes} minutes`;

        const payload = {
          eventId:          window.currentEventId,
          originalTitle:    originalTitle,
          sessionStart:     window.sessionStartTime.toISOString(),
          currentEnd:       window.sessionEndTime.toISOString(),
          extendMinutes:    option.minutes,
          description:      window.currentEventDescription || "",
          clientName:       window.sessionClientName || "",
          durationLabel:    durationLabel,
          extensionAmount:  option.price
        };

        const newEnd = new Date(
          window.sessionEndTime.getTime() + option.minutes * 60000
        );

        const timestamp  = new Date().toLocaleTimeString();
        const appendText = `${timestamp} — Client extended their session by ${option.minutes} minutes.`;
        const newDescription = window.currentEventDescription
          ? appendText + "\n" + window.currentEventDescription
          : appendText;

        try {
          const response = await fetch("http://localhost:3001/extend-session", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(payload)
          });

          if (!response.ok) {
            throw new Error(`Server responded with ${response.status}`);
          }

          const result = await response.json();
          if (!result.success) {
            throw new Error("Server reported failure");
          }

          window.sessionEndTime          = newEnd;
          window.originalEventTitle      = updatedTitle;
          window.currentEventDescription = newDescription;

          console.log("✅ Successfully extended session via server.");
          location.reload();

        } catch (err) {
          console.error("❌ Error extending session:", err);
          alert("❌ Failed to extend session.");
        }
      };

      extensionDiv.appendChild(button);
    }
  });
}
