const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Load service account credentials
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'Private', 'studio-session-monitor-fbca8136fb63.json'),
  scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/spreadsheets'],
});

const calendar = google.calendar({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

// Test route
app.get('/', (req, res) => {
  res.send('✅ Backend is running!');
});

// You can later add routes for handling session extensions here

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
