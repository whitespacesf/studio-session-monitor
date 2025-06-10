// server.js

const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Load service account credentials
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'Private', 'studio-session-monitor-fbca8136fb63.json'),
  scopes: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets'
  ]
});

// Example endpoint (test it with a POST request later)
app.post('/log-extension', async (req, res) => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const { name, originalTime, newTime, duration, total } = req.body;

    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: '1AhJHK4wWg_c3aOclzqbJ1XZf9L1mBafik-MtQub77Zo',
      range: 'Session_Extensions!A:E',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[name, originalTime, newTime, duration, total]]
      }
    });

    res.status(200).send({ success: true, result });
  } catch (err) {
    console.error('Error logging to sheet:', err);
    res.status(500).send({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
