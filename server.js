const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

let sock;
let latestQR = null;
let isConnected = false;

const PHP_WEBHOOK_URL = 'https://globeforge.debanganam.co.in/webhook.php';

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    sock = makeWASocket({ auth: state });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            latestQR = await QRCode.toDataURL(qr);
            isConnected = false;
        }
        if (connection === 'open') {
            isConnected = true;
            latestQR = null;
        }
        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startWhatsApp();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (text) {
            try {
                await axios.post(PHP_WEBHOOK_URL, { from: sender, body: text });
            } catch (err) {
                console.error('Webhook Error:', err.message);
            }
        }
    });
}

app.get('/', (req, res) => res.send('WA Bridge Active'));
app.get('/qr', (req, res) => res.json({ connected: isConnected, qr: latestQR }));

app.post('/send', async (req, res) => {
    const { number, text } = req.body;
    if (!isConnected) return res.status(400).json({ error: 'Not connected' });
    await sock.sendMessage(number, { text });
    res.json({ status: 'sent' });
});

startWhatsApp();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
