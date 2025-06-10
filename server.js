const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Load service account credentials
const KEY_PATH = path.join(__dirname, "./Private/studio-session-monitor-fbca8136fb63.json");
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_PATH,
  scopes: [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

// These will be initialized after authentication
let calendar, sheets, authClient;

// Authenticate and initialize clients
(async () => {
  try {
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
