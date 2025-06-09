// ------------------- Configuration & OAuth -------------------
const CLIENT_ID = "991293667384-b654jos0v2e8mbgqr8q50ck4hantv8tf.apps.googleusercontent.com";
// combine Calendar + Sheets scopes (read/write Sheets)
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets"
].join(" ");

let tokenClient;
let gapiInited = false;

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
      handleLiveEvents(response.result.items);
    })
    .catch(error => {
      console.error("❌ Calendar error:", error);
    });
}

// ------------------- Main Logic: Identify & Display Current Session -------------------
function handleLiveEvents(events) {
  const now = new Date();

  // Find the event where “now” is between its start and end
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

  // Store for later extension logic
  window.currentEventId          = current.id;
  window.originalEventTitle      = current.summary || "Session";
  window.sessionStartTime        = new Date(current.start.dateTime);
  window.sessionEndTime          = new Date(current.end.dateTime);
  window.currentEventDescription = current.description || "";

  const isEvent = current.summary.toLowerCase().includes("event");
  window.sessionClientName = extractClientName(current, isEvent);

  // Display client name & session time
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
    sessionTimeText.parentElement.insertBefore(el, sessionTimeText);
  }
  el.textContent = name;
}

// ------------------- Countdown & Time-Remaining Display -------------------
function startCountdown(endTime, isEvent, events) {
  const alertThreshold = isEvent ? 30 : 15;
  const chimeSound     = new Audio(isEvent ? "30_minute_warning.wav" : "15_minute_warning.wav");

  // Find the next event that starts after this one ends
  const nextEvt = events.find(evt => new Date(evt.start.dateTime) > endTime);
  const availableMinutes = nextEvt
    ? Math.floor((new Date(nextEvt.start.dateTime) - endTime) / (60 * 1000))
    : 240; // fallback: assume 4 hours free

  let alertPlayed = false;

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
    if (minsRemaining === alertThreshold && msRemaining > 0 && !alertPlayed) {
      alertPlayed = true;
      countdownText.textContent     = `${alertThreshold} minutes remaining`;
      countdownAlert.style.display  = "inline-block";
      chimeSound.play().catch(err => console.log("Autoplay blocked:", err));
      showExtensionButtons(availableMinutes, isEvent);
    }

    // When time’s up, clear things
    if (msRemaining <= 0) {
      clearInterval(interval);
      countdownText.textContent     = "Session ended";
      countdownAlert.style.display  = "none";
      extensionDiv.innerHTML        = "";
      if (timeRemainingEl) timeRemainingEl.textContent = "";
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

        // 1) Calculate new end time
        const newEnd = new Date(
          window.sessionEndTime.getTime() + option.minutes * 60000
        );

        // 2) Build updated title (append [EXTENDED] if needed)
        const originalTitle   = window.originalEventTitle || "Session";
        const alreadyExtended = originalTitle.includes("[EXTENDED]");
        const updatedTitle    = alreadyExtended
          ? originalTitle
          : `${originalTitle} [EXTENDED]`;

        // 3) Build appended description
        const timestamp  = new Date().toLocaleTimeString();
        const appendText = `${timestamp} — Client extended their session by ${option.minutes} minutes.`;
        const newDescription = window.currentEventDescription
          ? appendText + "\n" + window.currentEventDescription
          : appendText;

        // 4) Patch the Calendar event
        const patchBody = {
          summary: updatedTitle,
          end: {
            dateTime: newEnd.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          },
          description: newDescription
        };

        try {
          await gapi.client.calendar.events.patch({
            calendarId: "2l28nlc148jqqc7uk24u5jr9cs@group.calendar.google.com",
            eventId:    window.currentEventId,
            resource:   patchBody
          });

         // 5) Build data for the Sheets row
const formattedDate = window.sessionStartTime.toLocaleDateString(undefined, {
  month:  "long",
  day:    "numeric",
  year:   "numeric"
});
const originalRange = `${formattedDate} ${formatTime(window.sessionStartTime)} – ${formatTime(window.sessionEndTime)}`;
const newTimeRange  = `${formatTime(window.sessionStartTime)} – ${formatTime(newEnd)}`;

const durationLabel   = option.minutes === 60
  ? "1 hour"
  : `${option.minutes} minutes`;
const total = option.price;

// 6) Clean off “(White Space Studio)” if present
const cleanedTitle = originalTitle.replace(
  /\s*\(White Space Studio\)/i,
  ""
).trim();

// 7) Append directly via Sheets API
const SPREADSHEET_ID = "1AhJHK4wWg_c3aOclzqbJ1XZf9L1mBafik-MtQub77Zo";
const SHEET_NAME     = "Session_Extensions";
const range          = `${SHEET_NAME}!A:E`;

const values = [[
  window.sessionClientName, // A: Name
  originalRange,            // B: Original Appointment
  newTimeRange,             // C: New Time
  durationLabel,            // D: Duration
  total                     // E: Total
]];

await gapi.client.sheets.spreadsheets.values.append({
  spreadsheetId:    SPREADSHEET_ID,
  range:            range,
  valueInputOption: "USER_ENTERED",
  resource:         { values: values }
});
          console.log("✅ Successfully updated Calendar and appended row to Sheet.");

          // 8) Update in-memory values & reload UI
          window.sessionEndTime          = newEnd;
          window.originalEventTitle      = updatedTitle;
          window.currentEventDescription = newDescription;
          location.reload();

        } catch (err) {
          console.error("❌ Error extending session:", err);
          alert("❌ Failed to update Calendar or append row to Sheet.");
        }
      };

      extensionDiv.appendChild(button);
    }
  });
}
