const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

function loadServiceAccountCredentials() {
  const fromBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  const fromJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  try {
    if (fromBase64) {
      const decoded = Buffer.from(fromBase64, "base64").toString("utf8");
      return JSON.parse(decoded);
    }

    if (fromJson) {
      return JSON.parse(fromJson);
    }

    if (credentialsPath) {
      const absolutePath = path.resolve(credentialsPath);
      const fileContents = fs.readFileSync(absolutePath, "utf8");
      return JSON.parse(fileContents);
    }
  } catch (error) {
    console.error("❌ Failed to parse Google service account credentials:", error);
    throw error;
  }

  throw new Error(
    "Service account credentials were not provided. Set GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, GOOGLE_SERVICE_ACCOUNT_KEY, or GOOGLE_APPLICATION_CREDENTIALS."
  );
}

// These will be initialized after authentication
let calendar, sheets, authClient;

// Authenticate and initialize clients
(async () => {
  try {
    const credentials = loadServiceAccountCredentials();
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/spreadsheets",
      ],
    });

    authClient = await auth.getClient();
    calendar = google.calendar({ version: "v3", auth: authClient });
    sheets = google.sheets({ version: "v4", auth: authClient });

    app.listen(PORT, () => {
      console.log(`✅ Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to initialize Google APIs:", error);
  }
})();

// Calendar and sheet info
const CALENDAR_ID = "2l28nlc148jqqc7uk24u5jr9cs@group.calendar.google.com";
const SPREADSHEET_ID = "1AhJHK4wWg_c3aOclzqbJ1XZf9L1mBafik-MtQub77Zo";
const SHEET_NAME = "Session_Extensions";

// Endpoint to extend session
app.post("/extend-session", async (req, res) => {
  if (!calendar || !sheets) {
    return res.status(503).json({ error: "Google services not initialized" });
  }

  const {
    eventId,
    originalTitle,
    currentEnd,
    extendMinutes,
    description,
    clientName,
    durationLabel,
    extensionAmount,
  } = req.body;

  try {
    const newEnd = new Date(new Date(currentEnd).getTime() + extendMinutes * 60000);
    const updatedTitle = originalTitle.includes("[EXTENDED]")
      ? originalTitle
      : `${originalTitle} [EXTENDED]`;

    const newDescription = `${new Date().toLocaleTimeString()} — Client extended by ${extendMinutes} minutes.\n${description}`;

    // Update calendar event
    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId: eventId,
      resource: {
        summary: updatedTitle,
        end: {
          dateTime: newEnd.toISOString(),
          timeZone: "America/Chicago",
        },
        description: newDescription,
      },
    });

    // Append row to Sheet
    const origStart = new Date(new Date(newEnd).getTime() - extendMinutes * 60000);
    const origRange = formatTimeRange(origStart, new Date(currentEnd));
    const newRange = formatTimeRange(origStart, newEnd);

    const values = [
      [clientName, origRange, newRange, durationLabel, extensionAmount],
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:E`,
      valueInputOption: "USER_ENTERED",
      resource: { values },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error extending session:", err);
    res.status(500).json({ error: "Failed to extend session" });
  }
});

function formatTimeRange(start, end) {
  const format = (d) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${format(start)} – ${format(end)}`;
}

function normalizeDateTime(dateTimeObj) {
  if (!dateTimeObj) return null;
  return dateTimeObj.dateTime || dateTimeObj.date || null;
}

function buildFreeBlock(start, end, fallbackMinutes = 240) {
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;

  let availableMinutes = fallbackMinutes;
  if (startDate && endDate) {
    availableMinutes = Math.max(0, Math.floor((endDate - startDate) / 60000));
  }

  return {
    start: startDate ? startDate.toISOString() : null,
    end: endDate ? endDate.toISOString() : null,
    availableMinutes,
  };
}

// Endpoint to fetch the active session and next free block
app.get("/active-session", async (req, res) => {
  if (!calendar) {
    return res.status(503).json({ error: "Google Calendar client not initialized" });
  }

  try {
    const now = new Date();
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      timeMax: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items || [];
    const currentEvent = events.find((event) => {
      const start = normalizeDateTime(event.start);
      const end = normalizeDateTime(event.end);
      if (!start || !end) return false;
      const startDate = new Date(start);
      const endDate = new Date(end);
      return now >= startDate && now < endDate;
    });

    let nextFreeBlock = null;

    if (currentEvent) {
      const currentEnd = normalizeDateTime(currentEvent.end);
      const nextEvent = events.find((event) => {
        if (!event.start) return false;
        const eventStart = normalizeDateTime(event.start);
        if (!eventStart || !currentEnd) return false;
        return new Date(eventStart) > new Date(currentEnd);
      });

      if (currentEnd) {
        const nextStart = nextEvent ? normalizeDateTime(nextEvent.start) : null;
        nextFreeBlock = buildFreeBlock(currentEnd, nextStart);
      }
    } else {
      const nextEvent = events.find((event) => {
        const eventStart = normalizeDateTime(event.start);
        if (!eventStart) return false;
        return new Date(eventStart) > now;
      });

      if (nextEvent) {
        const nextStart = normalizeDateTime(nextEvent.start);
        nextFreeBlock = buildFreeBlock(now.toISOString(), nextStart, Math.max(0, Math.floor((new Date(nextStart) - now) / 60000)));
      } else {
        nextFreeBlock = buildFreeBlock(now.toISOString(), null);
      }
    }

    if (!nextFreeBlock) {
      nextFreeBlock = buildFreeBlock(now.toISOString(), null);
    }

    res.json({
      currentSession: currentEvent
        ? {
            id: currentEvent.id,
            summary: currentEvent.summary || "",
            description: currentEvent.description || "",
            start: normalizeDateTime(currentEvent.start),
            end: normalizeDateTime(currentEvent.end),
          }
        : null,
      nextFreeBlock,
    });
  } catch (err) {
    console.error("❌ Error fetching active session:", err);
    res.status(500).json({ error: "Failed to fetch active session" });
  }
});

// Test route
app.get("/test-calendar", async (req, res) => {
  try {
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
      timeMax: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // next 24 hours
      singleEvents: true,
      orderBy: "startTime",
    });

    res.json({
      message: "Success",
      events: response.data.items,
    });
  } catch (err) {
    console.error("❌ Calendar API error:", err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});
