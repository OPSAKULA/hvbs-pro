const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Bot token environment variable se
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error("❌ TELEGRAM_BOT_TOKEN not set!");
    process.exit(1);
}

const bot = new TelegramBot(token);

// Webhook endpoint
app.post('/webhook', (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Health check
app.get('/', (req, res) => {
    res.send('HVBS Backend is running');
});

// Webhook set karne ka helper endpoint
app.get('/setwebhook', async (req, res) => {
    const webhookUrl = `https://api.hvbsai.com/webhook`;
    try {
        await bot.setWebHook(webhookUrl);
        res.send(`✅ Webhook set to ${webhookUrl}`);
    } catch (err) {
        res.status(500).send(`❌ Error: ${err.message}`);
    }
});

// Tumhare original APIs yahan add karo (trending, token scan, alerts etc.)
// Example:
app.get('/api/trending', async (req, res) => {
    // TODO: implement
    res.json({ success: true, trending: [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`✅ Webhook endpoint: /webhook`);
    console.log(`✅ Visit /setwebhook to configure Telegram`);
});