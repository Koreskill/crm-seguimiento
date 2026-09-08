require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1L22_1omyOo3nrEJJ3fYE_q7OCCmTejIpF3QoVbB1gE4';
const SHEET_NAME = process.env.SHEET_NAME || 'Sheet1';
const TEMPLATES_FILE = path.join(__dirname, 'templates.json');

// ─── Google Sheets Auth ───────────────────────────────────────────────────────
async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

// ─── Column mapping ───────────────────────────────────────────────────────────
// A=0  title | B=1 website | C=2 city | D=3 state | E=4 categoryName
// F=5  phone | G=6 phone_raw | H=7 (empty) | I=8 WhatsApp | J=9 contacted
// K=10 address | L=11 url | M=12 etapa | N=13 notas | O=14 ultimo_contacto

function rowToContact(row, index) {
  return {
    id: index,           // sheet row number (0-based from data, header=row0)
    rowNum: index + 2,   // actual sheet row number (1-based, +1 for header, +1 for 1-index)
    nombre: row[0] || '',
    website: row[1] || '',
    ciudad: row[2] || '',
    provincia: row[3] || '',
    rubro: row[4] || '',
    telefono: row[5] || '',
    whatsapp: row[6] || '',  // raw digits for wa.me
    contactado: row[9] === 'TRUE',
    direccion: row[10] || '',
    maps_url: row[11] || '',
    etapa: row[12] || 'sin_contactar',
    notas: row[13] || '',
    ultimo_contacto: row[14] || '',
  };
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────

// GET all contacts
app.get('/api/contacts', async (req, res) => {
  try {
    const sheets = await getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:O`,
    });
    const rows = response.data.values || [];
    const contacts = rows.map((row, i) => rowToContact(row, i));
    res.json({ success: true, contacts, total: contacts.length });
  } catch (err) {
    console.error('Error reading sheet:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH update contact stage (and optionally notes/ultimo_contacto)
app.patch('/api/contacts/:rowNum', async (req, res) => {
  try {
    const rowNum = parseInt(req.params.rowNum);
    const { etapa, notas, ultimo_contacto, contactado } = req.body;
    const sheets = await getSheets();

    const updates = [];

    if (etapa !== undefined) {
      updates.push({
        range: `${SHEET_NAME}!M${rowNum}`,
        values: [[etapa]],
      });
      // Also mark contacted=TRUE when stage moves past sin_contactar
      if (etapa !== 'sin_contactar') {
        updates.push({
          range: `${SHEET_NAME}!J${rowNum}`,
          values: [['TRUE']],
        });
      }
    }
    if (notas !== undefined) {
      updates.push({ range: `${SHEET_NAME}!N${rowNum}`, values: [[notas]] });
    }
    if (ultimo_contacto !== undefined) {
      updates.push({ range: `${SHEET_NAME}!O${rowNum}`, values: [[ultimo_contacto]] });
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updates,
        },
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating sheet:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST log a WhatsApp message send (sets ultimo_contacto + stage to 'enviado' if was sin_contactar)
app.post('/api/contacts/:rowNum/message-sent', async (req, res) => {
  try {
    const rowNum = parseInt(req.params.rowNum);
    const { etapa_actual } = req.body;
    const sheets = await getSheets();
    const now = new Date().toLocaleDateString('es-AR');

    const updates = [
      { range: `${SHEET_NAME}!O${rowNum}`, values: [[now]] },
      { range: `${SHEET_NAME}!J${rowNum}`, values: [['TRUE']] },
    ];

    // Auto-advance stage from sin_contactar to enviado
    if (etapa_actual === 'sin_contactar') {
      updates.push({ range: `${SHEET_NAME}!M${rowNum}`, values: [['enviado']] });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
    });

    res.json({ success: true, nueva_etapa: etapa_actual === 'sin_contactar' ? 'enviado' : etapa_actual });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET metrics
app.get('/api/metrics', async (req, res) => {
  try {
    const sheets = await getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:O`,
    });
    const rows = response.data.values || [];
    const contacts = rows.map((row, i) => rowToContact(row, i));
    const today = new Date().toLocaleDateString('es-AR');

    const metrics = {
      total: contacts.length,
      sin_contactar: contacts.filter(c => c.etapa === 'sin_contactar').length,
      enviados: contacts.filter(c => c.etapa === 'enviado').length,
      respondieron: contacts.filter(c => c.etapa === 'respondio').length,
      interesados: contacts.filter(c => c.etapa === 'interesado').length,
      cerrados: contacts.filter(c => c.etapa === 'cerrado').length,
      no_interesados: contacts.filter(c => c.etapa === 'no_interesado').length,
      contactados_hoy: contacts.filter(c => c.ultimo_contacto === today).length,
      tasa_respuesta: 0,
      tasa_cierre: 0,
    };

    const contactados = metrics.enviados + metrics.respondieron + metrics.interesados + metrics.cerrados + metrics.no_interesados;
    metrics.tasa_respuesta = contactados > 0
      ? Math.round(((metrics.respondieron + metrics.interesados + metrics.cerrados) / contactados) * 100)
      : 0;
    metrics.tasa_cierre = metrics.interesados > 0
      ? Math.round((metrics.cerrados / metrics.interesados) * 100)
      : 0;

    res.json({ success: true, metrics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET templates
app.get('/api/templates', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
    res.json({ success: true, templates: data.stages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update a template
app.put('/api/templates/:stage', (req, res) => {
  try {
    const { stage } = req.params;
    const { message } = req.body;
    const data = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
    if (!data.stages[stage]) return res.status(404).json({ success: false, error: 'Stage not found' });
    data.stages[stage].message = message;
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 KoreSkill CRM corriendo en http://localhost:${PORT}`);
  console.log(`📊 Conectado al Sheet: ${SPREADSHEET_ID}`);
});
