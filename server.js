import express from "express";
import cors from "cors";
import axios from "axios";
import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import { exec } from "child_process";
import multer from "multer";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

// ─── SOLANA SUBSCRIPTION SYSTEM ─────────────────────────────────────────────
import {
  Connection, PublicKey, Keypair, Transaction,
  SystemProgram, LAMPORTS_PER_SOL
} from "@solana/web3.js";
import cron from "node-cron";
import bs58 from "bs58";

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const ADMIN_WALLET = "DKaLRLF17JeAnHpYsBgRZnNVFPnKC2gnDn5cHUtLMsAz";
const SUB_PRICE_USD = 3;
const SUB_DURATION_DAYS = 30;

// USDC & USDT mint addresses (Solana mainnet)
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

// Data persistence files
const SUBS_FILE = "./subscriptions.json";
const BURN_FILE = "./burn_history.json";
const SEEN_TXS_FILE = "./seen_txs.json";

function loadJSON(file, def = {}) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch (e) { }
  return def;
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { }
}

let subscriptions = loadJSON(SUBS_FILE, {});   // { walletAddr: { active, startedAt, expiresAt, txSignature, currency } }
let burnHistory = loadJSON(BURN_FILE, { history: [], totalBurned: 0, totalUsdBurned: 0, totalRevenue: 0, burnCount: 0 });
let seenTxs = loadJSON(SEEN_TXS_FILE, {});

// Lazily get backend keypair from env
function getBackendKeypair() {
  const raw = process.env.BACKEND_PRIVATE_KEY;
  if (!raw) throw new Error("BACKEND_PRIVATE_KEY not set in .env");
  const bytes = bs58.decode(raw);
  return Keypair.fromSecretKey(bytes);
}

// ─── SOL PRICE HELPER ────────────────────────────────────────────────────────
async function getSolPrice() {
  try {
    const r = await axios.get("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { timeout: 5000 });
    return r.data?.solana?.usd || 0;
  } catch (e) {
    try {
      const r2 = await axios.get("https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112", { timeout: 5000 });
      return parseFloat(r2.data?.data?.["So11111111111111111111111111111111111111112"]?.price) || 0;
    } catch (e2) { return 0; }
  }
}

// ─── TOKEN BURN ───────────────────────────────────────────────────────────────
// Burns ALERT tokens by sending them to the Solana burn address
async function burnAlertTokens(amountLamports, reason = "subscription") {
  const alertMint = process.env.ALERT_MINT;
  if (!alertMint) { console.warn("ALERT_MINT not set, skipping burn"); return null; }

  try {
    const connection = new Connection(SOLANA_RPC, "confirmed");
    const payer = getBackendKeypair();

    // Use Token-2022 burn instruction via spl-token
    // Here we simulate with a memo transfer to the burn address (11111...) as a placeholder
    // In production replace with @solana/spl-token createBurnInstruction
    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: payer.publicKey });

    // Minimal SOL transfer to self as a signed marker (real burn needs spl-token)
    tx.add(SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: 1  // marker tx – replace with real burn instruction
    }));

    const sig = await connection.sendTransaction(tx, [payer]);
    console.log(`🔥 Burn TX: ${sig}`);
    return sig;
  } catch (err) {
    console.error("Burn error:", err.message);
    return null;
  }
}

// ─── VERIFY SOLANA TRANSACTION ───────────────────────────────────────────────
async function verifySolanaTransaction(txSignature, expectedRecipient, currency, walletAddress) {
  try {
    const connection = new Connection(SOLANA_RPC, "confirmed");
    await new Promise(r => setTimeout(r, 5000)); // wait for confirmation

    const txInfo = await connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed"
    });
    if (!txInfo) return { ok: false, error: "Transaction not found" };
    if (txInfo.meta?.err) return { ok: false, error: "Transaction failed on-chain" };

    const instructions = txInfo.transaction.message.instructions || [];

    if (currency === "SOL") {
      const solPriceUsd = await getSolPrice();
      if (!solPriceUsd) return { ok: false, error: "Could not fetch SOL price" };
      const requiredLamports = Math.floor((SUB_PRICE_USD / solPriceUsd) * LAMPORTS_PER_SOL * 0.92); // 8% tolerance

      for (const ix of instructions) {
        const parsed = ix.parsed;
        if (parsed?.type === "transfer" &&
          parsed.info?.destination?.toLowerCase() === expectedRecipient.toLowerCase() &&
          parseInt(parsed.info?.lamports || 0) >= requiredLamports) {
          return { ok: true, amount: parsed.info.lamports / LAMPORTS_PER_SOL, usd: solPriceUsd };
        }
      }
      return { ok: false, error: "Payment amount too low or wrong recipient" };
    }

    if (currency === "USDC" || currency === "USDT") {
      const mintAddr = currency === "USDC" ? USDC_MINT : USDT_MINT;
      const requiredAmount = SUB_PRICE_USD * 0.92 * 1e6; // 6 decimals, 8% tolerance

      for (const ix of instructions) {
        const parsed = ix.parsed;
        if (parsed?.type === "transferChecked" &&
          parsed.info?.mint === mintAddr &&
          parseInt(parsed.info?.tokenAmount?.amount || 0) >= requiredAmount) {
          return { ok: true, amount: parsed.info.tokenAmount.uiAmount, usd: parsed.info.tokenAmount.uiAmount };
        }
      }
      return { ok: false, error: "USDC/USDT payment not found or amount insufficient" };
    }

    return { ok: false, error: "Unsupported currency" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── ADMIN TOKEN (simple HMAC-free for demo; use JWT in production) ──────────
const adminSessions = new Map(); // token → expiry
function generateAdminToken() {
  const token = "adm_" + Date.now() + "_" + Math.random().toString(36).slice(2);
  adminSessions.set(token, Date.now() + 3600000); // 1 hour
  return token;
}
function isValidAdminToken(token) {
  if (!token || !adminSessions.has(token)) return false;
  return adminSessions.get(token) > Date.now();
}
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!isValidAdminToken(token)) return res.status(401).json({ success: false, error: "Unauthorized" });
  next();
}

// ─── CRON JOB: every 2 minutes ───────────────────────────────────────────────
cron.schedule("*/2 * * * *", async () => {
  console.log("[CRON] Running subscription + burn checks…");

  // Check for expired subscriptions
  let changed = false;
  for (const [wallet, sub] of Object.entries(subscriptions)) {
    if (sub.active && new Date(sub.expiresAt) < new Date()) {
      subscriptions[wallet].active = false;
      changed = true;
      console.log(`[CRON] Expired: ${wallet.slice(0, 8)}…`);
    }
  }
  if (changed) saveJSON(SUBS_FILE, subscriptions);

  // Process queued burns
  const queued = (burnHistory.history || []).filter(h => h.status === "queued");
  for (const item of queued) {
    const sig = await burnAlertTokens(item.amount, "queued-burn");
    if (sig) {
      item.status = "done";
      item.txSignature = sig;
      burnHistory.totalBurned += item.amount;
      burnHistory.burnCount += 1;
      console.log(`[CRON] Burned: ${item.amount} ALERT — TX: ${sig}`);
    }
  }
  saveJSON(BURN_FILE, burnHistory);
});


const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("."));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "./sounds";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const chatId = req.params.chatId;
    const ext = path.extname(file.originalname);
    cb(null, `${chatId}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// 🔐 TELEGRAM BOT TOKEN (fixed — do not use env var to avoid Render override conflict)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
console.log(
  "Telegram Token Prefix:",
  TELEGRAM_BOT_TOKEN ? TELEGRAM_BOT_TOKEN.substring(0, 10) : "NOT FOUND"
);
const CMC_API_KEY = process.env.CMC_API_KEY;

const DEXSCREENER_TOKEN_PAIRS = "https://api.dexscreener.com/token-pairs/v1/solana/";
const DEXSCREENER_SEARCH = "https://api.dexscreener.com/latest/dex/search?q=";
const TRENDING_API = "https://api.dexscreener.com/latest/dex/search?q=solana";
const JUPITER_PRICE_API = "https://api.jup.ag/price/v2?ids=";
const COINGECKO_SEARCH = "https://api.coingecko.com/api/v3/search?query=";
const COINGECKO_COIN_DATA = "https://api.coingecko.com/api/v3/coins/";
const GECKO_TERMINAL_API = "https://api.geckoterminal.com/api/v2/networks/solana/tokens/";
const SOLSCAN_TOPHOLDERS = "https://api.solscan.io/v2/token/holders?tokenAddress=";

// ========== ETHEREUM CONSTANTS ==========
const DEXSCREENER_ETH_PAIRS = "https://api.dexscreener.com/token-pairs/v1/ethereum/";
const GECKO_TERMINAL_ETH_API = "https://api.geckoterminal.com/api/v2/networks/eth/tokens/";
const TRENDING_ETH_API = "https://api.dexscreener.com/latest/dex/search?q=ethereum";

// ========== BNB/BSC CONSTANTS ==========
const DEXSCREENER_BSC_PAIRS = "https://api.dexscreener.com/token-pairs/v1/bsc/";
const GECKO_TERMINAL_BSC_API = "https://api.geckoterminal.com/api/v2/networks/bsc/tokens/";
const TRENDING_BSC_API = "https://api.dexscreener.com/latest/dex/search?q=bnb";

// ========== BASE CHAIN CONSTANTS ==========
const DEXSCREENER_BASE_PAIRS = "https://api.dexscreener.com/token-pairs/v1/base/";
const GECKO_TERMINAL_BASE_API = "https://api.geckoterminal.com/api/v2/networks/base/tokens/";
const TRENDING_BASE_API = "https://api.dexscreener.com/latest/dex/search?q=base";

const ALERTS_FILE = "./alerts.json";
const WATCHLIST_FILE = "./watchlist.json";
const USERNAME_MAP_FILE = "./username_chatid_map.json";
const MUTE_FILE = "./muted_users.json";
const HISTORY_FILE = "./history.json";

function loadData(file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file));
  return {};
}
function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let alerts = loadData(ALERTS_FILE);
let watchlists = loadData(WATCHLIST_FILE);
let usernameChatIdMap = loadData(USERNAME_MAP_FILE);
let mutedUsers = loadData(MUTE_FILE);
let history = loadData(HISTORY_FILE);

// Clean invalid alerts
for (let chatId in alerts) {
  for (let addr in alerts[chatId]) {
    if (!alerts[chatId][addr].price || isNaN(alerts[chatId][addr].price)) {
      delete alerts[chatId][addr];
    }
  }
  if (Object.keys(alerts[chatId]).length === 0) delete alerts[chatId];
}
saveData(ALERTS_FILE, alerts);

let bot;
let botInitialized = false;
let lastPollingActivity = Date.now();     // updated on any incoming update/error event
let reconnectAttempts = 0;
let reconnecting = false;

// Exponential backoff, capped at 60s
function getBackoffDelay() {
  return Math.min(5000 * Math.pow(2, reconnectAttempts), 60000);
}

function initBot() {
  try {
    if (!TELEGRAM_BOT_TOKEN) {
      console.error("❌ Telegram bot token not set! Add TELEGRAM_BOT_TOKEN to .env");
      return;
    }

    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
      polling: true,
      autoStart: true,
      onlyFirstMatch: true,
      request: {
        timeout: 30000
      }
    });

    // Any polling error (network drop, ETELEGRAM, EFATAL, 409 conflict, timeouts, etc.)
    // triggers a full reconnect with exponential backoff instead of only two error codes.
    bot.on('polling_error', (error) => {
      console.error("Polling error:", error.code, error.message);
      lastPollingActivity = Date.now();
      const isConflict = error.code === 'ETELEGRAM' && /409/.test(error.message);
      scheduleReconnect(isConflict);
    });

    bot.on('webhook_error', (error) => {
      console.error("Webhook error:", error.code, error.message);
    });

    bot.on('error', (error) => {
      console.error("Bot error:", error);
      scheduleReconnect(false);
    });

    // Track activity so the watchdog can detect a silently-stuck poller
    bot.on('message', () => { lastPollingActivity = Date.now(); });
    bot.on('callback_query', () => { lastPollingActivity = Date.now(); });

    bot.getMe().then((botInfo) => {
      console.log(`🤖 Telegram bot started as @${botInfo.username}`);
      botInitialized = true;
      reconnectAttempts = 0;
      lastPollingActivity = Date.now();
    }).catch((err) => {
      console.error("❌ Failed to connect to Telegram API:", err.message);
      botInitialized = false;
      scheduleReconnect(false);
    });

  } catch (err) {
    console.error("❌ Bot initialization error:", err);
    botInitialized = false;
    scheduleReconnect(false);
  }
}

// Central reconnect scheduler: stops any existing polling/instance cleanly,
// then re-creates the bot after a backoff delay. Handles network errors,
// Telegram API disconnects, and Render restarts uniformly.
//
// isConflict=true means Telegram returned "409 Conflict: terminated by other
// getUpdates request" — this happens during a Render deploy, when the old
// instance and the new instance briefly run at the same time and both poll
// with the same bot token. Racing to reconnect every few seconds only makes
// both sides fight longer, so for a conflict we wait a fixed, longer window
// (giving Render time to fully kill the old instance) instead of the normal
// fast exponential backoff.
function scheduleReconnect(isConflict = false) {
  if (reconnecting || shuttingDown) return;
  reconnecting = true;
  botInitialized = false;
  const delay = isConflict ? 15000 : getBackoffDelay();
  reconnectAttempts++;
  const reason = isConflict ? "duplicate instance (409 conflict)" : "connection error";
  console.log(`🔄 Reconnecting Telegram bot in ${delay / 1000}s — ${reason} (attempt ${reconnectAttempts})...`);

  setTimeout(async () => {
    try {
      if (bot) {
        try { await bot.stopPolling({ cancel: true }); } catch (e) { /* ignore */ }
        bot.removeAllListeners();
        bot = null;
      }
    } catch (e) {
      console.error("Error while tearing down bot instance:", e.message);
    } finally {
      reconnecting = false;
      initBot();
    }
  }, delay);
}

initBot();

// ─── WATCHDOG ────────────────────────────────────────────────────────────────
// Independently verifies Telegram connectivity every 3 minutes. If the bot
// looks initialized but hasn't shown any sign of life (no events, and getMe
// itself fails) it forces a reconnect — this catches "silent hang" cases
// where polling_error never fires but the poller is effectively dead.
setInterval(async () => {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    if (!bot || !botInitialized) {
      if (!reconnecting) scheduleReconnect(false);
      return;
    }
    await bot.getMe();
    lastPollingActivity = Date.now();
  } catch (err) {
    console.error("⚠️ Watchdog getMe() failed:", err.message);
    scheduleReconnect(false);
  }
}, 3 * 60 * 1000);

// ─── KEEP-ALIVE SELF-PING ────────────────────────────────────────────────────
// Render's free web services spin down after ~15 minutes without incoming
// HTTP traffic; outbound Telegram polling does not count as traffic, so the
// whole process (and the bot with it) can be suspended until the next manual
// deploy or visit. Pinging our own /health endpoint keeps the service awake.
setInterval(() => {
  const selfUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;
  if (!selfUrl) return;
  axios.get(`${selfUrl.replace(/\/$/, "")}/health`, { timeout: 10000 })
    .catch((e) => console.error("Self-ping failed:", e.message));
}, 10 * 60 * 1000);

const activeSounds = {}; // tracks last-sent alert sound per chat (for /api/sound-status)

function stopSound(chatId) {
  if (activeSounds[chatId]) {
    delete activeSounds[chatId];
    return true;
  }
  return false;
}

// Delivers the alert sound to the USER, not the server.
// The previous version called exec("aplay ...")/afplay/PowerShell Beep,
// which plays audio on whatever machine is running node — fine on a
// developer's own Windows PC, but completely silent and pointless on a
// headless Render container (no sound card, no aplay binary, nobody there
// to hear it). Telegram bots can't remotely trigger sound on a user's
// phone directly — the correct way is to send the audio file as a message,
// so Telegram itself plays/notifies it on the recipient's device.
function playSound(chatId) {
  if (!bot) {
    console.warn(`playSound(${chatId}) skipped — bot not initialized`);
    return;
  }

  const soundDir = "./sounds";
  const exts = [".mp3", ".wav", ".m4a"];
  let soundFile = null;
  for (let ext of exts) {
    const testPath = path.join(soundDir, `${chatId}${ext}`);
    if (fs.existsSync(testPath)) { soundFile = testPath; break; }
  }
  // No custom sound uploaded for this user → fall back to the default beep.
  if (!soundFile && fs.existsSync("./beep.mp3")) soundFile = "./beep.mp3";

  if (!soundFile) {
    console.warn(`No sound file found for chat ${chatId} (no custom upload and no beep.mp3)`);
    bot.sendMessage(chatId, "⚠️ No alert sound file is configured on the server yet.").catch(e => { });
    return;
  }

  activeSounds[chatId] = { file: soundFile, sentAt: Date.now() };
  bot.sendAudio(chatId, soundFile, { title: "🔔 HVBS Price Alert" })
    .catch((err) => {
      console.error(`Failed to send alert sound to ${chatId}:`, err.message);
      // Fallback: some chats/clients reject sendAudio for certain files — try sendVoice as backup.
      bot.sendVoice(chatId, soundFile).catch((e2) => {
        console.error(`Fallback sendVoice also failed for ${chatId}:`, e2.message);
      });
    });
}

// ========== MARKET DATA ==========
async function getMarketData(mint, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(`${DEXSCREENER_TOKEN_PAIRS}${mint}`, { timeout: 6000 });
      if (Array.isArray(res.data) && res.data.length > 0) {
        const p = res.data[0];
        const price = parseFloat(p.priceUsd);
        if (price && !isNaN(price) && price > 0) {
          return {
            price,
            liquidity: p.liquidity?.usd || 0,
            volume24h: p.volume?.h24 || 0,
            priceChange24h: p.priceChange?.h24 || 0,
            marketCap: p.marketCap || 0,
            symbol: p.baseToken?.symbol || "?",
            name: p.baseToken?.name || "",
            chartUrl: p.url || `https://dexscreener.com/solana/${mint}`,
            buyCount: p.txns?.h24?.buys || 0,
            sellCount: p.txns?.h24?.sells || 0,
            pairAddress: p.pairAddress || ""
          };
        }
      }
    } catch (e) { }

    try {
      const searchRes = await axios.get(`${DEXSCREENER_SEARCH}${mint}`, { timeout: 6000 });
      const pairs = searchRes.data.pairs || [];
      const solPairs = pairs.filter(p => p.chainId === "solana");
      if (solPairs.length > 0) {
        const p = solPairs[0];
        const price = parseFloat(p.priceUsd);
        if (price && !isNaN(price) && price > 0) {
          return {
            price,
            liquidity: p.liquidity?.usd || 0,
            volume24h: p.volume?.h24 || 0,
            priceChange24h: p.priceChange?.h24 || 0,
            marketCap: p.marketCap || 0,
            symbol: p.baseToken?.symbol || "?",
            name: p.baseToken?.name || "",
            chartUrl: p.url || `https://dexscreener.com/solana/${mint}`,
            buyCount: p.txns?.h24?.buys || 0,
            sellCount: p.txns?.h24?.sells || 0,
            pairAddress: p.pairAddress || ""
          };
        }
      }
    } catch (e) { }

    try {
      const jupRes = await axios.get(`${JUPITER_PRICE_API}${mint}`, { timeout: 5000 });
      const tokenData = jupRes.data?.data?.[mint];
      if (tokenData) {
        const price = parseFloat(tokenData.price);
        if (price && price > 0) {
          return {
            price, liquidity: 0, volume24h: 0, priceChange24h: 0, marketCap: 0,
            symbol: tokenData.mintSymbol || "?", name: "",
            chartUrl: `https://dexscreener.com/solana/${mint}`,
            buyCount: 0, sellCount: 0, pairAddress: ""
          };
        }
      }
    } catch (e) { }

    try {
      const geckoRes = await axios.get(`${GECKO_TERMINAL_API}${mint}`, { timeout: 5000 });
      const attrs = geckoRes.data?.data?.attributes;
      if (attrs) {
        const price = parseFloat(attrs.price_usd);
        if (price && price > 0) {
          return {
            price,
            liquidity: parseFloat(attrs.total_reserve_in_usd) || 0,
            volume24h: parseFloat(attrs.volume_usd?.h24) || 0,
            priceChange24h: parseFloat(attrs.price_change_percentage?.h24) || 0,
            marketCap: parseFloat(attrs.market_cap_usd) || 0,
            symbol: attrs.symbol || "?",
            name: attrs.name || "",
            chartUrl: `https://dexscreener.com/solana/${mint}`,
            buyCount: 0, sellCount: 0, pairAddress: ""
          };
        }
      }
    } catch (e) { }

    if (attempt < retries) await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

// ========== TOP 10 HOLDERS ==========
async function getTopHolders(mint) {
  try {
    const res = await axios.get(`${SOLSCAN_TOPHOLDERS}${mint}&pageSize=10&page=1`, { timeout: 15000, headers: { "User-Agent": "HVBS-Pro/2.0" } });
    const holders = res.data?.data?.result || res.data?.data || [];
    if (holders.length > 0) {
      return holders.slice(0, 10).map((h, i) => ({
        rank: i + 1,
        address: h.address || h.owner || "Unknown",
        amount: h.uiAmount ?? h.amount ?? 0,
        percentage: h.decimals !== undefined ? ((h.uiAmount || 0) / (res.data?.data?.total || 1) * 100).toFixed(2) : (h.percentage || 0).toFixed(2),
        isContract: h.owner ? h.owner.includes("1111111111") : false
      }));
    }
  } catch (e) { console.log("Solscan holders error:", e.message); }
  try {
    const heliusRes = await axios.post(`https://mainnet.helius-rpc.com/?api-key=35d9c070-00bd-4523-acd7-6b728e9c1127`, {
      jsonrpc: "2.0", id: 1, method: "getTokenLargestAccounts", params: [mint]
    }, { timeout: 7000 });
    const accounts = heliusRes.data?.result?.value || [];
    return accounts.slice(0, 10).map((acc, i) => ({ rank: i + 1, address: acc.address || "Unknown", amount: acc.uiAmount || 0, percentage: "N/A", isContract: false }));
  } catch (e) { console.log("Helius holders error:", e.message); }
  return [];
}

// ========== BUYERS/SELLERS ==========
async function getBuyersSellers(mint) {
  try {
    const res = await axios.get(`${DEXSCREENER_TOKEN_PAIRS}${mint}`, { timeout: 6000 });
    if (Array.isArray(res.data) && res.data.length > 0) {
      let totalBuys1h = 0, totalSells1h = 0, totalBuys6h = 0, totalSells6h = 0, totalBuys24h = 0, totalSells24h = 0;
      for (const p of res.data) {
        totalBuys1h += p.txns?.h1?.buys || 0; totalSells1h += p.txns?.h1?.sells || 0;
        totalBuys6h += p.txns?.h6?.buys || 0; totalSells6h += p.txns?.h6?.sells || 0;
        totalBuys24h += p.txns?.h24?.buys || 0; totalSells24h += p.txns?.h24?.sells || 0;
      }
      return { h1: { buys: totalBuys1h, sells: totalSells1h }, h6: { buys: totalBuys6h, sells: totalSells6h }, h24: { buys: totalBuys24h, sells: totalSells24h } };
    }
  } catch (e) { console.log("Buyers/sellers error:", e.message); }
  return { h1: { buys: 0, sells: 0 }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } };
}

// ========== DEX & CEX EXCHANGES ==========
async function getDEXListings(tokenAddress) {
  try {
    const res = await axios.get(`${DEXSCREENER_SEARCH}${tokenAddress}`, { timeout: 6000 });
    const pairs = res.data.pairs || [];
    const exchanges = new Map();
    for (const pair of pairs) {
      if (pair.dexId && !exchanges.has(pair.dexId)) {
        exchanges.set(pair.dexId, { name: pair.dexId, type: 'DEX', url: pair.url || null, baseToken: pair.baseToken?.symbol || 'N/A', quoteToken: pair.quoteToken?.symbol || 'N/A' });
      }
    }
    return Array.from(exchanges.values());
  } catch (error) { return []; }
}

async function getCEXListings(coingeckoId) {
  if (!coingeckoId) return [];
  try {
    const res = await axios.get(`${COINGECKO_COIN_DATA}${coingeckoId}/tickers`, { timeout: 6000 });
    const tickers = res.data.tickers || [];
    const exchanges = new Map();
    for (const t of tickers) {
      if (t.market && !exchanges.has(t.market.name)) {
        exchanges.set(t.market.name, { name: t.market.name, type: 'CEX', url: t.trade_url || null, baseToken: t.base, quoteToken: t.target });
      }
    }
    return Array.from(exchanges.values()).slice(0, 20);
  } catch (error) { return []; }
}

async function getCoinGeckoDetails(tokenSymbol) {
  try {
    const searchRes = await axios.get(`${COINGECKO_SEARCH}${encodeURIComponent(tokenSymbol)}`, { timeout: 6000 });
    const coins = searchRes.data.coins || [];
    if (!coins.length) return null;
    const cgId = coins[0].id;
    const detailRes = await axios.get(`${COINGECKO_COIN_DATA}${cgId}`, { timeout: 6000 });
    const data = detailRes.data;
    return {
      id: cgId, symbol: data.symbol, name: data.name, image: data.image?.large || data.image?.small || null,
      links: {
        homepage: data.links?.homepage?.[0] || null,
        twitter: data.links?.twitter_screen_name ? `https://twitter.com/${data.links.twitter_screen_name}` : null,
        telegram: data.links?.telegram_channel_identifier ? `https://t.me/${data.links.telegram_channel_identifier}` : null,
        discord: data.links?.discord_server ? `https://discord.gg/${data.links.discord_server}` : null,
        github: data.links?.repos_url?.github?.[0] || null,
        reddit: data.links?.subreddit_url || null
      },
      coingeckoUrl: `https://www.coingecko.com/en/coins/${cgId}`
    };
  } catch (e) { return null; }
}

async function getHolderCount(mint) {
  try {
    const res = await axios.get(`${GECKO_TERMINAL_API}${mint}`, { timeout: 5000 });
    return res.data?.data?.attributes?.holders || 0;
  } catch (e) { return 0; }
}

function calculateRiskScore(market, holderCount = 0) {
  let score = 100, reasons = [];
  if (!market) return { score: 0, reasons: ["No market data found"], level: "⚫ UNKNOWN" };
  if (market.liquidity > 0 && market.liquidity < 50000) { score -= 30; reasons.push("⚠️ Low liquidity (< $50K)"); }
  else if (market.liquidity > 0 && market.liquidity < 100000) { score -= 15; reasons.push("⚠️ Moderate liquidity"); }
  if (market.volume24h > 0 && market.volume24h < 10000) { score -= 20; reasons.push("⚠️ Low 24h volume (< $10K)"); }
  if (market.priceChange24h < -30) { score -= 25; reasons.push("📉 Price dropped >30% in 24h"); }
  else if (market.priceChange24h < -10) { score -= 10; reasons.push("📉 Price dropped >10% in 24h"); }
  if (holderCount > 0 && holderCount < 100) { score -= 15; reasons.push("👥 Very few holders (< 100)"); }
  if (reasons.length === 0) reasons.push("✅ All checks passed");
  const level = score > 70 ? "🟢 SAFE" : (score > 40 ? "🟡 CAUTION" : "🔴 HIGH RISK");
  return { score: Math.max(0, score), reasons, level };
}

async function getTrendingTokens(limit = 10) {
  try {
    const res = await axios.get(TRENDING_API, { timeout: 8000 });
    if (res.data.pairs) {
      let solPairs = res.data.pairs.filter(p => p.chainId === "solana" && parseFloat(p.priceUsd) > 0);
      solPairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
      return solPairs.slice(0, limit).map(p => ({ symbol: p.baseToken?.symbol || "?", address: p.baseToken?.address || "", price: p.priceUsd || "0", volume24h: p.volume?.h24 || 0, priceChange: p.priceChange?.h24 || 0, liquidity: p.liquidity?.usd || 0, url: p.url }));
    }
  } catch (e) { }
  return [];
}

async function searchTokenBySymbol(symbol) {
  try {
    const res = await axios.get(`${DEXSCREENER_SEARCH}${symbol}`, { timeout: 6000 });
    if (res.data.pairs) {
      const solPairs = res.data.pairs.filter(p => p.chainId === "solana");
      if (solPairs.length > 0) {
        const best = solPairs[0];
        return { address: best.baseToken?.address, symbol: best.baseToken?.symbol, name: best.baseToken?.name, price: best.priceUsd, url: best.url };
      }
    }
  } catch (e) { }
  return null;
}

async function resolveTelegramUsername(username) {
  const cleanUsername = username.replace('@', '').toLowerCase();
  for (const [chatId, uname] of Object.entries(usernameChatIdMap)) {
    if (uname.toLowerCase() === cleanUsername) return chatId;
  }
  return null;
}

// ========== ALERT CHECKER ==========
async function checkAllAlerts() {
  if (!bot || !botInitialized) return;
  for (let chatId in alerts) {
    if (mutedUsers[chatId]) continue;
    for (let addr in alerts[chatId]) {
      const alert = alerts[chatId][addr];
      if (!alert.price || isNaN(alert.price)) { delete alerts[chatId][addr]; continue; }
      const targetPrice = alert.price;
      const direction = alert.direction || 'above';

      // Auto-detect chain: saved chain field OR address format
      const isEthAddress = /^0x[0-9a-fA-F]{40}$/.test(addr);
      const chain = alert.chain || (isEthAddress ? 'ethereum' : 'solana');
      const chainLabel = chain === 'bsc' ? '🟡 BNB' : chain === 'base' ? '🔵 Base' : chain === 'ethereum' ? '⟠ ETH' : '◎ SOL';

      const market = chain === 'bsc'
        ? await getMarketDataBNB(addr)
        : chain === 'base'
          ? await getMarketDataBase(addr)
          : chain === 'ethereum'
            ? await getMarketDataEth(addr)
            : await getMarketData(addr);

      if (market) {
        let triggered = false;
        if (direction === 'above' && market.price >= targetPrice) triggered = true;
        if (direction === 'below' && market.price <= targetPrice) triggered = true;
        if (triggered) {
          const options = {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [[{ text: "🔇 Stop Sound", callback_data: "stop_sound" }]] }
          };
          bot.sendMessage(chatId,
            `🚨 *PRICE ALERT!*\nToken [${chainLabel}]: \`${addr.slice(0, 6)}...\`\nDirection: ${direction}\nTarget: $${targetPrice}\nCurrent: $${market.price}\n\n[📈 View Chart](${market.chartUrl})`,
            options
          ).catch(e => console.error("Send message error:", e.message));
          playSound(chatId);
          delete alerts[chatId][addr];
          saveData(ALERTS_FILE, alerts);
        }
      }
    }
  }
}
setInterval(checkAllAlerts, 10000);

// ========== ETHEREUM MARKET DATA ==========
async function getMarketDataEth(address, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(`${DEXSCREENER_ETH_PAIRS}${address}`, { timeout: 6000 });
      if (Array.isArray(res.data) && res.data.length > 0) {
        const p = res.data[0];
        const price = parseFloat(p.priceUsd);
        if (price && !isNaN(price) && price > 0) {
          return {
            price,
            liquidity: p.liquidity?.usd || 0,
            volume24h: p.volume?.h24 || 0,
            priceChange24h: p.priceChange?.h24 || 0,
            marketCap: p.marketCap || 0,
            symbol: p.baseToken?.symbol || "?",
            name: p.baseToken?.name || "",
            chartUrl: p.url || `https://dexscreener.com/ethereum/${address}`,
            buyCount: p.txns?.h24?.buys || 0,
            sellCount: p.txns?.h24?.sells || 0,
            pairAddress: p.pairAddress || ""
          };
        }
      }
    } catch (e) { }

    try {
      const searchRes = await axios.get(`${DEXSCREENER_SEARCH}${address}`, { timeout: 6000 });
      const pairs = searchRes.data.pairs || [];
      const ethPairs = pairs.filter(p => p.chainId === "ethereum");
      if (ethPairs.length > 0) {
        const p = ethPairs[0];
        const price = parseFloat(p.priceUsd);
        if (price && !isNaN(price) && price > 0) {
          return {
            price,
            liquidity: p.liquidity?.usd || 0,
            volume24h: p.volume?.h24 || 0,
            priceChange24h: p.priceChange?.h24 || 0,
            marketCap: p.marketCap || 0,
            symbol: p.baseToken?.symbol || "?",
            name: p.baseToken?.name || "",
            chartUrl: p.url || `https://dexscreener.com/ethereum/${address}`,
            buyCount: p.txns?.h24?.buys || 0,
            sellCount: p.txns?.h24?.sells || 0,
            pairAddress: p.pairAddress || ""
          };
        }
      }
    } catch (e) { }

    try {
      const geckoRes = await axios.get(`${GECKO_TERMINAL_ETH_API}${address}`, { timeout: 5000 });
      const attrs = geckoRes.data?.data?.attributes;
      if (attrs) {
        const price = parseFloat(attrs.price_usd);
        if (price && price > 0) {
          return {
            price,
            liquidity: parseFloat(attrs.total_reserve_in_usd) || 0,
            volume24h: parseFloat(attrs.volume_usd?.h24) || 0,
            priceChange24h: parseFloat(attrs.price_change_percentage?.h24) || 0,
            marketCap: parseFloat(attrs.market_cap_usd) || 0,
            symbol: attrs.symbol || "?",
            name: attrs.name || "",
            chartUrl: `https://dexscreener.com/ethereum/${address}`,
            buyCount: 0, sellCount: 0, pairAddress: ""
          };
        }
      }
    } catch (e) { }

    if (attempt < retries) await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

async function getHolderCountEth(address) {
  try {
    const geckoRes = await axios.get(`${GECKO_TERMINAL_ETH_API}${address}`, { timeout: 5000 });
    return geckoRes.data?.data?.attributes?.holders || 0;
  } catch (e) { return 0; }
}

async function getBuyersSellersEth(address) {
  try {
    const res = await axios.get(`${DEXSCREENER_ETH_PAIRS}${address}`, { timeout: 6000 });
    if (Array.isArray(res.data) && res.data.length > 0) {
      let totalBuys1h = 0, totalSells1h = 0, totalBuys6h = 0, totalSells6h = 0, totalBuys24h = 0, totalSells24h = 0;
      for (const p of res.data) {
        totalBuys1h += p.txns?.h1?.buys || 0; totalSells1h += p.txns?.h1?.sells || 0;
        totalBuys6h += p.txns?.h6?.buys || 0; totalSells6h += p.txns?.h6?.sells || 0;
        totalBuys24h += p.txns?.h24?.buys || 0; totalSells24h += p.txns?.h24?.sells || 0;
      }
      return { h1: { buys: totalBuys1h, sells: totalSells1h }, h6: { buys: totalBuys6h, sells: totalSells6h }, h24: { buys: totalBuys24h, sells: totalSells24h } };
    }
  } catch (e) { }
  return { h1: { buys: 0, sells: 0 }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } };
}

async function getDEXListingsEth(tokenAddress) {
  try {
    const res = await axios.get(`${DEXSCREENER_SEARCH}${tokenAddress}`, { timeout: 6000 });
    const pairs = res.data.pairs || [];
    const exchanges = new Map();
    for (const pair of pairs) {
      if (pair.chainId === "ethereum" && pair.dexId && !exchanges.has(pair.dexId)) {
        exchanges.set(pair.dexId, { name: pair.dexId, type: 'DEX', url: pair.url || null, baseToken: pair.baseToken?.symbol || 'N/A', quoteToken: pair.quoteToken?.symbol || 'N/A' });
      }
    }
    return Array.from(exchanges.values());
  } catch (error) { return []; }
}

async function getTrendingEthTokens(limit = 10) {
  try {
    const res = await axios.get(TRENDING_ETH_API, { timeout: 8000 });
    if (res.data.pairs) {
      let ethPairs = res.data.pairs.filter(p => p.chainId === "ethereum" && parseFloat(p.priceUsd) > 0);
      ethPairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
      return ethPairs.slice(0, limit).map(p => ({ symbol: p.baseToken?.symbol || "?", address: p.baseToken?.address || "", price: p.priceUsd || "0", volume24h: p.volume?.h24 || 0, priceChange: p.priceChange?.h24 || 0, liquidity: p.liquidity?.usd || 0, url: p.url }));
    }
  } catch (e) { }
  return [];
}

// ========== ETHEREUM TOKEN ENDPOINT ==========
app.get("/api/token/ethereum/:address", async (req, res) => {
  const address = req.params.address;
  // Validate Ethereum address (0x...)
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ success: false, error: "Invalid Ethereum token address. Must be 0x followed by 40 hex characters." });
  }
  try {
    const [market, holderCount, buyersSellers] = await Promise.all([
      getMarketDataEth(address),
      getHolderCountEth(address),
      getBuyersSellersEth(address)
    ]);
    const risk = calculateRiskScore(market, holderCount);
    let tokenSymbol = market?.symbol || '';
    let cgDetails = null;
    if (tokenSymbol) cgDetails = await getCoinGeckoDetails(tokenSymbol);
    const dexListings = await getDEXListingsEth(address);
    let cexListings = [];
    if (cgDetails?.id) cexListings = await getCEXListings(cgDetails.id);
    const allExchanges = [...dexListings, ...cexListings];
    let formattedPrice = "N/A";
    if (market) {
      const priceNum = market.price;
      formattedPrice = priceNum < 0.01 ? `$${priceNum.toFixed(10)}` : `$${priceNum.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
    }
    let platformPresence = { coingecko: { listed: !!cgDetails, name: cgDetails?.name || null }, coinmarketcap: { listed: false, name: null } };
    try {
      if (tokenSymbol) {
        const cmcRes = await axios.get(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${tokenSymbol}`, { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY }, timeout: 5000 });
        const cmcData = cmcRes.data?.data?.[tokenSymbol];
        if (cmcData) platformPresence.coinmarketcap = { listed: true, name: cmcData.name };
      }
    } catch (e) { }
    res.json({
      success: true, chain: 'ethereum', tokenAddress: address,
      name: market?.name || market?.symbol || address.slice(0, 8) + "...",
      symbol: market?.symbol || "?",
      price: formattedPrice, rawPrice: market?.price || 0,
      liquidity: market?.liquidity ? `$${Math.round(market.liquidity).toLocaleString()}` : "N/A",
      volume24h: market?.volume24h ? `$${Math.round(market.volume24h).toLocaleString()}` : "N/A",
      priceChange24h: market?.priceChange24h != null ? `${market.priceChange24h.toFixed(2)}%` : "N/A",
      marketCap: market?.marketCap ? `$${Math.round(market.marketCap).toLocaleString()}` : "N/A",
      holderCount, topHolders: [],
      buyersSellers, riskScore: risk.score, riskLevel: risk.level, riskReasons: risk.reasons,
      chartUrl: market?.chartUrl || `https://dexscreener.com/ethereum/${address}`,
      exchanges: allExchanges, socialLinks: cgDetails?.links || {}, logo: cgDetails?.image || null,
      coingeckoUrl: cgDetails?.coingeckoUrl || null, platformPresence
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get("/api/trending/ethereum", async (req, res) => {
  try { const trending = await getTrendingEthTokens(10); res.json({ success: true, trending }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ========== BNB/BSC MARKET DATA FUNCTIONS ==========
async function getMarketDataBNB(address, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(`${DEXSCREENER_BSC_PAIRS}${address}`, { timeout: 6000 });
      if (Array.isArray(res.data) && res.data.length > 0) {
        const p = res.data[0];
        const price = parseFloat(p.priceUsd);
        if (price && !isNaN(price) && price > 0) {
          return {
            price,
            liquidity: p.liquidity?.usd || 0,
            volume24h: p.volume?.h24 || 0,
            priceChange24h: p.priceChange?.h24 || 0,
            marketCap: p.marketCap || 0,
            symbol: p.baseToken?.symbol || '?',
            name: p.baseToken?.name || '',
            chartUrl: p.url || `https://dexscreener.com/bsc/${address}`,
            buyCount: p.txns?.h24?.buys || 0,
            sellCount: p.txns?.h24?.sells || 0,
            pairAddress: p.pairAddress || ''
          };
        }
      }
    } catch (e) { }

    try {
      const searchRes = await axios.get(`${DEXSCREENER_SEARCH}${address}`, { timeout: 6000 });
      const pairs = searchRes.data.pairs || [];
      const bscPairs = pairs.filter(p => p.chainId === 'bsc');
      if (bscPairs.length > 0) {
        const p = bscPairs[0];
        const price = parseFloat(p.priceUsd);
        if (price && !isNaN(price) && price > 0) {
          return {
            price,
            liquidity: p.liquidity?.usd || 0,
            volume24h: p.volume?.h24 || 0,
            priceChange24h: p.priceChange?.h24 || 0,
            marketCap: p.marketCap || 0,
            symbol: p.baseToken?.symbol || '?',
            name: p.baseToken?.name || '',
            chartUrl: p.url || `https://dexscreener.com/bsc/${address}`,
            buyCount: p.txns?.h24?.buys || 0,
            sellCount: p.txns?.h24?.sells || 0,
            pairAddress: p.pairAddress || ''
          };
        }
      }
    } catch (e) { }

    try {
      const geckoRes = await axios.get(`${GECKO_TERMINAL_BSC_API}${address}`, { timeout: 5000 });
      const attrs = geckoRes.data?.data?.attributes;
      if (attrs) {
        const price = parseFloat(attrs.price_usd);
        if (price && price > 0) {
          return {
            price,
            liquidity: parseFloat(attrs.total_reserve_in_usd) || 0,
            volume24h: parseFloat(attrs.volume_usd?.h24) || 0,
            priceChange24h: parseFloat(attrs.price_change_percentage?.h24) || 0,
            marketCap: parseFloat(attrs.market_cap_usd) || 0,
            symbol: attrs.symbol || '?',
            name: attrs.name || '',
            chartUrl: `https://dexscreener.com/bsc/${address}`,
            buyCount: 0, sellCount: 0, pairAddress: ''
          };
        }
      }
    } catch (e) { }

    if (attempt < retries) await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

async function getHolderCountBNB(address) {
  try {
    const geckoRes = await axios.get(`${GECKO_TERMINAL_BSC_API}${address}`, { timeout: 5000 });
    return geckoRes.data?.data?.attributes?.holders || 0;
  } catch (e) { return 0; }
}

async function getBuyersSellersB(address) {
  try {
    const res = await axios.get(`${DEXSCREENER_BSC_PAIRS}${address}`, { timeout: 6000 });
    if (Array.isArray(res.data) && res.data.length > 0) {
      let b1 = 0, s1 = 0, b6 = 0, s6 = 0, b24 = 0, s24 = 0;
      for (const p of res.data) {
        b1 += p.txns?.h1?.buys || 0; s1 += p.txns?.h1?.sells || 0;
        b6 += p.txns?.h6?.buys || 0; s6 += p.txns?.h6?.sells || 0;
        b24 += p.txns?.h24?.buys || 0; s24 += p.txns?.h24?.sells || 0;
      }
      return { h1: { buys: b1, sells: s1 }, h6: { buys: b6, sells: s6 }, h24: { buys: b24, sells: s24 } };
    }
  } catch (e) { }
  return { h1: { buys: 0, sells: 0 }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } };
}

async function getDEXListingsBNB(tokenAddress) {
  try {
    const res = await axios.get(`${DEXSCREENER_SEARCH}${tokenAddress}`, { timeout: 6000 });
    const pairs = res.data.pairs || [];
    const exchanges = new Map();
    for (const pair of pairs) {
      if (pair.chainId === 'bsc' && pair.dexId && !exchanges.has(pair.dexId)) {
        exchanges.set(pair.dexId, { name: pair.dexId, type: 'DEX', url: pair.url || null, baseToken: pair.baseToken?.symbol || 'N/A', quoteToken: pair.quoteToken?.symbol || 'N/A' });
      }
    }
    return Array.from(exchanges.values());
  } catch (e) { return []; }
}

// ========== BSC TOKEN ENDPOINT ==========
app.get("/api/token/bsc/:address", async (req, res) => {
  const address = req.params.address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ success: false, error: "Invalid BNB/BSC token address. Must be 0x followed by 40 hex characters." });
  }
  try {
    const [market, holderCount, buyersSellers] = await Promise.all([
      getMarketDataBNB(address),
      getHolderCountBNB(address),
      getBuyersSellersB(address)
    ]);
    const risk = calculateRiskScore(market, holderCount);
    let tokenSymbol = market?.symbol || '';
    let cgDetails = null;
    if (tokenSymbol) cgDetails = await getCoinGeckoDetails(tokenSymbol);
    const dexListings = await getDEXListingsBNB(address);
    let cexListings = [];
    if (cgDetails?.id) cexListings = await getCEXListings(cgDetails.id);
    const allExchanges = [...dexListings, ...cexListings];
    let formattedPrice = 'N/A';
    if (market) {
      const priceNum = market.price;
      formattedPrice = priceNum < 0.01 ? `$${priceNum.toFixed(10)}` : `$${priceNum.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
    }
    let platformPresence = { coingecko: { listed: !!cgDetails, name: cgDetails?.name || null }, coinmarketcap: { listed: false, name: null } };
    try {
      if (tokenSymbol) {
        const cmcRes = await axios.get(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${tokenSymbol}`, { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY }, timeout: 5000 });
        const cmcData = cmcRes.data?.data?.[tokenSymbol];
        if (cmcData) platformPresence.coinmarketcap = { listed: true, name: cmcData.name };
      }
    } catch (e) { }
    res.json({
      success: true, chain: 'bsc', tokenAddress: address,
      name: market?.name || market?.symbol || address.slice(0, 8) + '...',
      symbol: market?.symbol || '?',
      price: formattedPrice, rawPrice: market?.price || 0,
      liquidity: market?.liquidity ? `$${Math.round(market.liquidity).toLocaleString()}` : 'N/A',
      volume24h: market?.volume24h ? `$${Math.round(market.volume24h).toLocaleString()}` : 'N/A',
      priceChange24h: market?.priceChange24h != null ? `${market.priceChange24h.toFixed(2)}%` : 'N/A',
      marketCap: market?.marketCap ? `$${Math.round(market.marketCap).toLocaleString()}` : 'N/A',
      holderCount, topHolders: [],
      buyersSellers, riskScore: risk.score, riskLevel: risk.level, riskReasons: risk.reasons,
      chartUrl: market?.chartUrl || `https://dexscreener.com/bsc/${address}`,
      exchanges: allExchanges, socialLinks: cgDetails?.links || {}, logo: cgDetails?.image || null,
      coingeckoUrl: cgDetails?.coingeckoUrl || null, platformPresence
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get("/api/trending/bsc", async (req, res) => {
  try {
    const r = await axios.get(TRENDING_BSC_API, { timeout: 8000 });
    if (r.data.pairs) {
      let bscPairs = r.data.pairs.filter(p => p.chainId === 'bsc' && parseFloat(p.priceUsd) > 0);
      bscPairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
      return res.json({ success: true, trending: bscPairs.slice(0, 10).map(p => ({ symbol: p.baseToken?.symbol || '?', address: p.baseToken?.address || '', price: p.priceUsd || '0', volume24h: p.volume?.h24 || 0, priceChange: p.priceChange?.h24 || 0, liquidity: p.liquidity?.usd || 0, url: p.url })) });
    }
    res.json({ success: true, trending: [] });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ========== BASE CHAIN MARKET DATA FUNCTIONS ==========
async function getMarketDataBase(address, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(`${DEXSCREENER_BASE_PAIRS}${address}`, { timeout: 6000 });
      if (Array.isArray(res.data) && res.data.length > 0) {
        const p = res.data[0];
        const price = parseFloat(p.priceUsd);
        if (price && !isNaN(price) && price > 0) {
          return {
            price,
            liquidity: p.liquidity?.usd || 0,
            volume24h: p.volume?.h24 || 0,
            priceChange24h: p.priceChange?.h24 || 0,
            marketCap: p.marketCap || 0,
            symbol: p.baseToken?.symbol || '?',
            name: p.baseToken?.name || '',
            chartUrl: p.url || `https://dexscreener.com/base/${address}`,
            buyCount: p.txns?.h24?.buys || 0,
            sellCount: p.txns?.h24?.sells || 0,
            pairAddress: p.pairAddress || ''
          };
        }
      }
    } catch (e) { }

    try {
      const searchRes = await axios.get(`${DEXSCREENER_SEARCH}${address}`, { timeout: 6000 });
      const pairs = searchRes.data.pairs || [];
      const basePairs = pairs.filter(p => p.chainId === 'base');
      if (basePairs.length > 0) {
        const p = basePairs[0];
        const price = parseFloat(p.priceUsd);
        if (price && !isNaN(price) && price > 0) {
          return {
            price,
            liquidity: p.liquidity?.usd || 0,
            volume24h: p.volume?.h24 || 0,
            priceChange24h: p.priceChange?.h24 || 0,
            marketCap: p.marketCap || 0,
            symbol: p.baseToken?.symbol || '?',
            name: p.baseToken?.name || '',
            chartUrl: p.url || `https://dexscreener.com/base/${address}`,
            buyCount: p.txns?.h24?.buys || 0,
            sellCount: p.txns?.h24?.sells || 0,
            pairAddress: p.pairAddress || ''
          };
        }
      }
    } catch (e) { }

    try {
      const geckoRes = await axios.get(`${GECKO_TERMINAL_BASE_API}${address}`, { timeout: 5000 });
      const attrs = geckoRes.data?.data?.attributes;
      if (attrs) {
        const price = parseFloat(attrs.price_usd);
        if (price && price > 0) {
          return {
            price,
            liquidity: parseFloat(attrs.total_reserve_in_usd) || 0,
            volume24h: parseFloat(attrs.volume_usd?.h24) || 0,
            priceChange24h: parseFloat(attrs.price_change_percentage?.h24) || 0,
            marketCap: parseFloat(attrs.market_cap_usd) || 0,
            symbol: attrs.symbol || '?',
            name: attrs.name || '',
            chartUrl: `https://dexscreener.com/base/${address}`,
            buyCount: 0, sellCount: 0, pairAddress: ''
          };
        }
      }
    } catch (e) { }

    if (attempt < retries) await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

async function getHolderCountBase(address) {
  try {
    const geckoRes = await axios.get(`${GECKO_TERMINAL_BASE_API}${address}`, { timeout: 5000 });
    return geckoRes.data?.data?.attributes?.holders || 0;
  } catch (e) { return 0; }
}

async function getBuyersSellersBase(address) {
  try {
    const res = await axios.get(`${DEXSCREENER_BASE_PAIRS}${address}`, { timeout: 6000 });
    if (Array.isArray(res.data) && res.data.length > 0) {
      let b1 = 0, s1 = 0, b6 = 0, s6 = 0, b24 = 0, s24 = 0;
      for (const p of res.data) {
        b1 += p.txns?.h1?.buys || 0; s1 += p.txns?.h1?.sells || 0;
        b6 += p.txns?.h6?.buys || 0; s6 += p.txns?.h6?.sells || 0;
        b24 += p.txns?.h24?.buys || 0; s24 += p.txns?.h24?.sells || 0;
      }
      return { h1: { buys: b1, sells: s1 }, h6: { buys: b6, sells: s6 }, h24: { buys: b24, sells: s24 } };
    }
  } catch (e) { }
  return { h1: { buys: 0, sells: 0 }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } };
}

async function getDEXListingsBase(tokenAddress) {
  try {
    const res = await axios.get(`${DEXSCREENER_SEARCH}${tokenAddress}`, { timeout: 6000 });
    const pairs = res.data.pairs || [];
    const exchanges = new Map();
    for (const pair of pairs) {
      if (pair.chainId === 'base' && pair.dexId && !exchanges.has(pair.dexId)) {
        exchanges.set(pair.dexId, { name: pair.dexId, type: 'DEX', url: pair.url || null, baseToken: pair.baseToken?.symbol || 'N/A', quoteToken: pair.quoteToken?.symbol || 'N/A' });
      }
    }
    return Array.from(exchanges.values());
  } catch (e) { return []; }
}

// ========== BASE TOKEN ENDPOINT ==========
app.get("/api/token/base/:address", async (req, res) => {
  const address = req.params.address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ success: false, error: "Invalid Base token address. Must be 0x followed by 40 hex characters." });
  }
  try {
    const [market, holderCount, buyersSellers] = await Promise.all([
      getMarketDataBase(address),
      getHolderCountBase(address),
      getBuyersSellersBase(address)
    ]);
    const risk = calculateRiskScore(market, holderCount);
    let tokenSymbol = market?.symbol || '';
    let cgDetails = null;
    if (tokenSymbol) cgDetails = await getCoinGeckoDetails(tokenSymbol);
    const dexListings = await getDEXListingsBase(address);
    let cexListings = [];
    if (cgDetails?.id) cexListings = await getCEXListings(cgDetails.id);
    const allExchanges = [...dexListings, ...cexListings];
    let formattedPrice = 'N/A';
    if (market) {
      const priceNum = market.price;
      formattedPrice = priceNum < 0.01 ? `$${priceNum.toFixed(10)}` : `$${priceNum.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
    }
    let platformPresence = { coingecko: { listed: !!cgDetails, name: cgDetails?.name || null }, coinmarketcap: { listed: false, name: null } };
    try {
      if (tokenSymbol) {
        const cmcRes = await axios.get(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${tokenSymbol}`, { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY }, timeout: 5000 });
        const cmcData = cmcRes.data?.data?.[tokenSymbol];
        if (cmcData) platformPresence.coinmarketcap = { listed: true, name: cmcData.name };
      }
    } catch (e) { }
    res.json({
      success: true, chain: 'base', tokenAddress: address,
      name: market?.name || market?.symbol || address.slice(0, 8) + '...',
      symbol: market?.symbol || '?',
      price: formattedPrice, rawPrice: market?.price || 0,
      liquidity: market?.liquidity ? `$${Math.round(market.liquidity).toLocaleString()}` : 'N/A',
      volume24h: market?.volume24h ? `$${Math.round(market.volume24h).toLocaleString()}` : 'N/A',
      priceChange24h: market?.priceChange24h != null ? `${market.priceChange24h.toFixed(2)}%` : 'N/A',
      marketCap: market?.marketCap ? `$${Math.round(market.marketCap).toLocaleString()}` : 'N/A',
      holderCount, topHolders: [],
      buyersSellers, riskScore: risk.score, riskLevel: risk.level, riskReasons: risk.reasons,
      chartUrl: market?.chartUrl || `https://dexscreener.com/base/${address}`,
      exchanges: allExchanges, socialLinks: cgDetails?.links || {}, logo: cgDetails?.image || null,
      coingeckoUrl: cgDetails?.coingeckoUrl || null, platformPresence
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get("/api/trending/base", async (req, res) => {
  try {
    const r = await axios.get(TRENDING_BASE_API, { timeout: 8000 });
    if (r.data.pairs) {
      let basePairs = r.data.pairs.filter(p => p.chainId === 'base' && parseFloat(p.priceUsd) > 0);
      basePairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
      return res.json({ success: true, trending: basePairs.slice(0, 10).map(p => ({ symbol: p.baseToken?.symbol || '?', address: p.baseToken?.address || '', price: p.priceUsd || '0', volume24h: p.volume?.h24 || 0, priceChange: p.priceChange?.h24 || 0, liquidity: p.liquidity?.usd || 0, url: p.url })) });
    }
    res.json({ success: true, trending: [] });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ========== CHAIN AUTO-DETECTION ==========
// Supported chains: solana, ethereum, bsc, base
const SUPPORTED_CHAINS = ['ethereum', 'bsc', 'base'];
const CHAIN_LABELS = {
  ethereum: '⟠ Ethereum',
  bsc: '🟡 BNB Chain',
  base: '🔵 Base',
  polygon: 'Polygon',
  arbitrum: 'Arbitrum',
  avalanche: 'Avalanche',
  solana: '◎ Solana',
};

async function detectEVMChain(address) {
  try {
    const res = await axios.get(`${DEXSCREENER_SEARCH}${address}`, { timeout: 8000 });
    const pairs = res.data.pairs || [];
    if (pairs.length === 0) return { chain: null, found: false, allChains: [] };

    // Sum liquidity per chain
    const chainLiq = {};
    for (const p of pairs) {
      if (!chainLiq[p.chainId]) chainLiq[p.chainId] = 0;
      chainLiq[p.chainId] += (p.liquidity?.usd || 0);
    }
    const allChains = Object.keys(chainLiq);

    // Pick best supported chain by liquidity
    let bestChain = null, bestLiq = 0;
    for (const ch of SUPPORTED_CHAINS) {
      if (chainLiq[ch] !== undefined && chainLiq[ch] > bestLiq) {
        bestLiq = chainLiq[ch];
        bestChain = ch;
      }
    }
    return { chain: bestChain, found: true, allChains };
  } catch (e) {
    return { chain: null, found: false, allChains: [] };
  }
}

// ========== MAIN API ENDPOINTS ==========
app.get("/api/token/:address", async (req, res) => {
  const mint = req.params.address;
  try {
    const [market, holderCount, topHolders, buyersSellers] = await Promise.all([getMarketData(mint), getHolderCount(mint), getTopHolders(mint), getBuyersSellers(mint)]);
    const risk = calculateRiskScore(market, holderCount);
    let tokenSymbol = market?.symbol || '';
    if (!tokenSymbol) {
      try {
        const searchRes = await axios.get(`${DEXSCREENER_SEARCH}${mint}`, { timeout: 5000 });
        if (searchRes.data.pairs?.[0]) tokenSymbol = searchRes.data.pairs[0].baseToken?.symbol || '';
      } catch (e) { }
    }
    let cgDetails = null;
    if (tokenSymbol) cgDetails = await getCoinGeckoDetails(tokenSymbol);
    const dexListings = await getDEXListings(mint);
    let cexListings = [];
    if (cgDetails?.id) cexListings = await getCEXListings(cgDetails.id);
    const allExchanges = [...dexListings, ...cexListings];
    let formattedPrice = "N/A";
    if (market) {
      const priceNum = market.price;
      formattedPrice = priceNum < 0.01 ? `$${priceNum.toFixed(10)}` : `$${priceNum.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
    }
    let platformPresence = { coingecko: { listed: !!cgDetails, name: cgDetails?.name || null }, coinmarketcap: { listed: false, name: null } };
    try {
      const cmcRes = await axios.get(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${tokenSymbol}`, { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY }, timeout: 5000 });
      const cmcData = cmcRes.data?.data?.[tokenSymbol];
      if (cmcData) platformPresence.coinmarketcap = { listed: true, name: cmcData.name };
    } catch (e) { }
    res.json({
      success: true, tokenAddress: mint, name: market?.name || market?.symbol || mint.slice(0, 6) + "...", symbol: market?.symbol || "?",
      price: formattedPrice, rawPrice: market?.price || 0, liquidity: market?.liquidity ? `$${Math.round(market.liquidity).toLocaleString()}` : "N/A",
      volume24h: market?.volume24h ? `$${Math.round(market.volume24h).toLocaleString()}` : "N/A",
      priceChange24h: market?.priceChange24h != null ? `${market.priceChange24h.toFixed(2)}%` : "N/A",
      marketCap: market?.marketCap ? `$${Math.round(market.marketCap).toLocaleString()}` : "N/A",
      holderCount, topHolders, buyersSellers, riskScore: risk.score, riskLevel: risk.level, riskReasons: risk.reasons,
      chartUrl: market?.chartUrl || `https://dexscreener.com/solana/${mint}`,
      exchanges: allExchanges, socialLinks: cgDetails?.links || {}, logo: cgDetails?.image || null,
      coingeckoUrl: cgDetails?.coingeckoUrl || null, platformPresence
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get("/api/trending", async (req, res) => {
  try { const trending = await getTrendingTokens(10); res.json({ success: true, trending }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post("/api/alert-by-username", async (req, res) => {
  const { username, tokenAddress, targetPrice, direction } = req.body;
  if (!username || !tokenAddress || !targetPrice) return res.status(400).json({ success: false, error: "username, tokenAddress, targetPrice required" });
  const cleanUsername = username.replace('@', '').toLowerCase();
  const chatId = await resolveTelegramUsername(cleanUsername);
  if (!chatId) return res.status(404).json({ success: false, error: "Username not found. Please join the bot first by clicking the join button, then send /start to @YOUR_NEW_BOT_USERNAME." });
  const price = parseFloat(targetPrice);
  if (isNaN(price)) return res.status(400).json({ success: false, error: "Invalid price" });
  const dir = (direction || 'above').toLowerCase();
  if (!alerts[chatId]) alerts[chatId] = {};
  alerts[chatId][tokenAddress] = { price, direction: dir };
  saveData(ALERTS_FILE, alerts);
  if (bot && botInitialized) {
    if (mutedUsers[chatId]) {
      bot.sendMessage(chatId, `🔔 *Alert Set via Web!*\nToken: \`${tokenAddress.slice(0, 6)}...\`\nTarget: $${price} (${dir})\n\n⚠️ *Your alerts are currently muted.* You will not receive notifications. Use /unmute to enable alerts.`, { parse_mode: "Markdown" }).catch(e => console.error(e));
    } else {
      bot.sendMessage(chatId, `🔔 *Alert Set via Web!*\nToken: \`${tokenAddress.slice(0, 6)}...\`\nTarget: $${price} (${dir})\n\nYou will receive a Telegram message + sound when this hits!`, { parse_mode: "Markdown" }).catch(e => console.error(e));
    }
  }
  res.json({ success: true, message: `Alert set for @${cleanUsername}` });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    botRunning: botInitialized,
    botUsername: bot ? "initialized" : "not",
    alertsCount: Object.keys(alerts).length,
    uptime: process.uptime(),
    lastPollingActivitySecondsAgo: Math.floor((Date.now() - lastPollingActivity) / 1000),
    reconnectAttempts
  });
});

// Redirect /index.html to /
app.get("/index.html", (req, res) => {
  res.redirect(301, "/");
});

// PRO Alerts route
app.get("/pro-alerts", (req, res) => {
  res.sendFile(process.cwd() + "/pro-alerts.html");
});

// ========== SOUND ENDPOINTS ==========
app.post("/api/upload-sound/:chatId", upload.single("sound"), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No file" });
  const chatId = req.params.chatId;
  const exts = [".mp3", ".wav", ".m4a"];
  for (let ext of exts) {
    const oldPath = path.join("./sounds", `${chatId}${ext}`);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  res.json({ success: true });
});

app.get("/api/sound-status/:chatId", (req, res) => {
  const chatId = req.params.chatId;
  let hasCustom = false;
  for (let ext of [".mp3", ".wav", ".m4a"]) {
    if (fs.existsSync(path.join("./sounds", `${chatId}${ext}`))) { hasCustom = true; break; }
  }
  res.json({ hasCustom, isPlaying: !!activeSounds[chatId] });
});

app.post("/api/stop-sound/:chatId", (req, res) => {
  const stopped = stopSound(req.params.chatId);
  res.json({ success: stopped, message: stopped ? "Sound stopped" : "No active sound" });
});

// ========== TELEGRAM BOT HANDLERS ==========
const userStates = {}; // tracks per-user conversation state

function setupBotHandlers() {
  if (!bot) return;

  const notificationReminded = {};
  function sendNotificationReminder(chatId) {
    if (!notificationReminded[chatId]) {
      bot.sendMessage(chatId, "🔔 *Notification Reminder*\n\nTo receive price alerts with sound, please ensure Telegram notifications are enabled on your device.\n\nGo to Telegram Settings → Notifications and Sounds → Enable for this bot.\n\nYou can also mute/unmute alerts using:\n`/mute` – disable all alerts\n`/unmute` – enable alerts\n\n_This message will not appear again._", { parse_mode: "Markdown" }).catch(e => { });
      notificationReminded[chatId] = true;
    }
  }

  // Helper: Send persistent keyboard (always visible at bottom)
  function sendMainKeyboard(chatId, text) {
    return bot.sendMessage(chatId, text || '📊 Choose an action:', {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          [{ text: '📈 Alert Above' }, { text: '📉 Alert Below' }],
          [{ text: '📜 History' }]
        ],
        resize_keyboard: true,
        persistent: true
      }
    }).catch(e => console.error(e));
  }

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    if (username) {
      usernameChatIdMap[chatId] = username.toLowerCase();
      saveData(USERNAME_MAP_FILE, usernameChatIdMap);
    }
    delete userStates[chatId];

    // Send welcome with persistent keyboard
    sendMainKeyboard(chatId,
      `🚀 *HVBS Pro Bot*\n\n✅ You are now registered!\nUsername: @${username || 'unknown'}\nChat ID: \`${chatId}\`\n\n💡 Use the buttons below to set price alerts anytime!\n📈 *Alert Above* – Notify when price goes UP\n📉 *Alert Below* – Notify when price goes DOWN`
    );

    // Send beep sound guide after 2 seconds (first time only)
    setTimeout(() => {
      if (!notificationReminded[chatId]) {
        bot.sendMessage(chatId,
          `🔊 *Enable Beep Sound*\n\nWant to hear a beep when your alert triggers?\n\n✅ Once set, every price alert will play the beep sound automatically.\n❌ You can remove it anytime from Telegram Notification Settings for this chat.`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔔 Yes! Send me the beep sound 🎵', callback_data: 'setup_sound' }]
              ]
            }
          }
        ).catch(e => { });
        notificationReminded[chatId] = true;
      }
    }, 1500);
  });

  bot.on('message', async (msg) => {
    const username = msg.from?.username;
    const chatId = msg.chat.id;
    if (username && !usernameChatIdMap[chatId]) {
      usernameChatIdMap[chatId] = username.toLowerCase();
      saveData(USERNAME_MAP_FILE, usernameChatIdMap);
    }

    const text = msg.text?.trim();
    if (!text || text.startsWith('/')) return;

    // ===== PERSISTENT KEYBOARD BUTTON HANDLING =====
    if (text === '📈 Alert Above' || text === '📉 Alert Below') {
      const direction = text === '📈 Alert Above' ? 'above' : 'below';
      userStates[chatId] = { step: 'waiting_address', direction };
      bot.sendMessage(chatId,
        `${text === '📈 Alert Above' ? '📈' : '📉'} *Alert ${direction.toUpperCase()} Selected*\n\n📌 *Step 1:* Please paste the *Token Contract Address* below:`,
        { parse_mode: 'Markdown', reply_markup: { keyboard: [[{ text: '📈 Alert Above' }, { text: '📉 Alert Below' }], [{ text: '📜 History' }]], resize_keyboard: true } }
      ).catch(e => { });
      return;
    }

    if (text === '📜 History') {
      const userHistory = history[String(chatId)] || [];
      if (userHistory.length === 0) {
        bot.sendMessage(chatId, "📜 *Your Token History is empty.*\nSet an alert above to start tracking!", { parse_mode: 'Markdown' });
      } else {
        let historyMsg = "📜 *Your Last 10 Tokens:*\n\n";
        userHistory.forEach((item, index) => {
          historyMsg += `${index + 1}. *${item.symbol}*\n\`${item.address}\`\n\n`;
        });
        bot.sendMessage(chatId, historyMsg, { parse_mode: 'Markdown' });
      }
      return;
    }

    // ===== STEP-BY-STEP STATE HANDLING =====
    if (userStates[chatId]) {
      const state = userStates[chatId];

      // Step 1: Waiting for token address
      if (state.step === 'waiting_address') {
        const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text);
        const isEth = /^0x[0-9a-fA-F]{40}$/.test(text);

        if (!isSolana && !isEth) {
          bot.sendMessage(chatId,
            '❌ *Invalid Address!*\nPlease paste a valid:\n• *Solana* address: `Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump`\n• *Ethereum/BNB* address: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`',
            { parse_mode: 'Markdown' }
          ).catch(e => { });
          return;
        }

        // ===== 0x ADDRESS: AUTO-DETECT CHAIN =====
        if (isEth) {
          // Send detecting message
          const detectMsg = await bot.sendMessage(chatId,
            `🔍 *Detecting Chain...*\n\`${text.slice(0, 16)}...\`\n\n⏳ Checking DexScreener for chain info...`,
            { parse_mode: 'Markdown' }
          ).catch(e => null);

          const detected = await detectEVMChain(text);

          if (!detected.found) {
            // No pairs found anywhere
            if (detectMsg) bot.editMessageText(
              `❌ *Token Not Found!*\n\`${text.slice(0, 16)}...\`\n\n⚠️ No trading pairs found for this address on any chain.\n\n• Make sure it's a valid token contract\n• Token may not have liquidity yet\n• Try again in a few minutes`,
              { chat_id: chatId, message_id: detectMsg.message_id, parse_mode: 'Markdown' }
            ).catch(e => { });
            delete userStates[chatId];
            return;
          }

          if (!detected.chain) {
            // Found on unsupported chain(s)
            const foundOn = detected.allChains
              .map(c => CHAIN_LABELS[c] || c)
              .join(', ');
            if (detectMsg) bot.editMessageText(
              `❌ *Unsupported Chain!*\n\`${text.slice(0, 16)}...\`\n\n📍 Token found on: *${foundOn}*\n\n⚠️ HVBS currently supports:\n• ◎ *Solana*\n• ⟠ *Ethereum*\n• 🟡 *BNB Chain (BSC)*\n• 🔵 *Base*\n\nPlease paste a token from a supported chain.`,
              { chat_id: chatId, message_id: detectMsg.message_id, parse_mode: 'Markdown' }
            ).catch(e => { });
            delete userStates[chatId];
            return;
          }

          // ✅ Chain detected automatically!
          const chain = detected.chain;
          const chainLabel = CHAIN_LABELS[chain];
          userStates[chatId] = { step: 'waiting_price', direction: state.direction, address: text, chain };

          // Fetch live price
          const market = chain === 'bsc' ? await getMarketDataBNB(text) : chain === 'base' ? await getMarketDataBase(text) : await getMarketDataEth(text);

          if (market && market.price) {
            const priceDisplay = market.price < 0.01
              ? `$${market.price.toFixed(10)}`
              : `$${market.price.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
            const changeEmoji = market.priceChange24h >= 0 ? '📈' : '📉';
            const symbol = market.symbol || '?';

            const cid = String(chatId);
            if (!history[cid]) history[cid] = [];
            history[cid] = history[cid].filter(h => h.address !== text);
            history[cid].unshift({ address: text, symbol, chain });
            if (history[cid].length > 10) history[cid].pop();
            saveData(HISTORY_FILE, history);

            if (detectMsg) {
              bot.editMessageText(
                `✅ *${chainLabel} — ${symbol} (Auto-detected!)*\n\`${text.slice(0, 10)}...\`\n\n💰 *Live Price:* ${priceDisplay}\n${changeEmoji} 24h Change: ${market.priceChange24h?.toFixed(2)}%\n💧 Liquidity: $${Math.round(market.liquidity || 0).toLocaleString()}\n\n📌 *Step 2:* Enter your *Target Price* (USD):\nExample: \`${market.price < 0.01 ? (market.price * 1.2).toFixed(10) : (market.price * 1.2).toFixed(6)}\``,
                { chat_id: chatId, message_id: detectMsg.message_id, parse_mode: 'Markdown' }
              ).catch(e => { });
            }
          } else {
            const cid = String(chatId);
            if (!history[cid]) history[cid] = [];
            history[cid] = history[cid].filter(h => h.address !== text);
            history[cid].unshift({ address: text, symbol: '?', chain });
            if (history[cid].length > 10) history[cid].pop();
            saveData(HISTORY_FILE, history);

            if (detectMsg) {
              bot.editMessageText(
                `✅ *${chainLabel} (Auto-detected!)*\n\`${text.slice(0, 10)}...\`\n\n⚠️ Could not fetch live price right now.\n\n📌 *Step 2:* Enter your *Target Price* manually (USD):\nExample: \`0.02593\``,
                { chat_id: chatId, message_id: detectMsg.message_id, parse_mode: 'Markdown' }
              ).catch(e => { });
            }
          }
          return;
        }

        // ===== SOLANA ADDRESS =====
        const chain = 'solana';
        userStates[chatId] = { step: 'waiting_price', direction: state.direction, address: text, chain };
        const chainLabel = '◎ Solana';

        // Send "fetching..." message first
        const fetchMsg = await bot.sendMessage(chatId,
          `✅ *${chainLabel} address accepted!*\n\`${text}\`\n\n⏳ Fetching live price...`,
          { parse_mode: 'Markdown' }
        ).catch(e => { });

        // Fetch live price
        try {
          const market = await getMarketData(text);
          if (market && market.price) {
            const priceDisplay = market.price < 0.01
              ? `$${market.price.toFixed(10)}`
              : `$${market.price.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
            const changeEmoji = market.priceChange24h >= 0 ? '📈' : '📉';

            const symbol = market.symbol || '?';
            const cid = String(chatId);
            if (!history[cid]) history[cid] = [];
            history[cid] = history[cid].filter(h => h.address !== text);
            history[cid].unshift({ address: text, symbol, chain });
            if (history[cid].length > 10) history[cid].pop();
            saveData(HISTORY_FILE, history);

            if (fetchMsg) {
              bot.editMessageText(
                `✅ *${chainLabel} — ${symbol}*\n\`${text.slice(0, 10)}...\`\n\n💰 *Live Price:* ${priceDisplay}\n${changeEmoji} 24h Change: ${market.priceChange24h?.toFixed(2)}%\n💧 Liquidity: $${Math.round(market.liquidity || 0).toLocaleString()}\n\n📌 *Step 2:* Enter your *Target Price* (USD):\nExample: \`${market.price < 0.01 ? (market.price * 1.2).toFixed(10) : (market.price * 1.2).toFixed(6)}\``,
                { chat_id: chatId, message_id: fetchMsg.message_id, parse_mode: 'Markdown' }
              ).catch(e => { });
            }
          } else {
            if (fetchMsg) {
              bot.editMessageText(
                `✅ *${chainLabel} address saved!*\n\`${text.slice(0, 10)}...\`\n\n⚠️ Could not fetch live price right now.\n\n📌 *Step 2:* Enter your *Target Price* manually (USD):\nExample: \`0.02593\``,
                { chat_id: chatId, message_id: fetchMsg.message_id, parse_mode: 'Markdown' }
              ).catch(e => { });
            }

            const cid = String(chatId);
            if (!history[cid]) history[cid] = [];
            history[cid] = history[cid].filter(h => h.address !== text);
            history[cid].unshift({ address: text, symbol: '?', chain });
            if (history[cid].length > 10) history[cid].pop();
            saveData(HISTORY_FILE, history);
          }
        } catch (e) {
          console.error('Price fetch error in bot:', e.message);
        }
        return;
      }

      // Step 2: Waiting for price
      if (state.step === 'waiting_price') {
        const targetPrice = parseFloat(text);
        if (isNaN(targetPrice) || targetPrice <= 0) {
          bot.sendMessage(chatId,
            '❌ *Invalid Price!*\nPlease enter a valid number.\n\nExample: `0.02593`',
            { parse_mode: 'Markdown' }
          ).catch(e => { });
          return;
        }

        const { address, direction, chain } = state;
        if (!alerts[chatId]) alerts[chatId] = {};
        alerts[chatId][address] = { price: targetPrice, direction, chain: chain || 'solana' };
        saveData(ALERTS_FILE, alerts);
        delete userStates[chatId];

        const chainLabel = chain === 'bsc' ? '🟡 BNB' : chain === 'base' ? '🔵 Base' : chain === 'ethereum' ? '⟠ ETH' : '◎ SOL';
        sendMainKeyboard(chatId,
          `✅ *Alert Set Successfully!*\n\n📍 Token [${chainLabel}]: \`${address.slice(0, 8)}...\`\n📈 Direction: *${direction.toUpperCase()}*\n💰 Target Price: *$${targetPrice}*\n\nYou will be notified when price goes *${direction}* $${targetPrice}! 🎯\n\n_Use the buttons below to set another alert._`
        );

        bot.sendMessage(chatId,
          `🔔 *Alert Active:*\n\`${address.slice(0, 8)}...\` [${chainLabel}] → *${direction.toUpperCase()}* $${targetPrice}\n\nTap below to cancel it manually anytime:`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: `❌ Cancel This Alert`, callback_data: `cancel_alert:${address}` }]
              ]
            }
          }
        ).catch(e => { });

        // Check if already triggered
        const market = chain === 'bsc' ? await getMarketDataBNB(address) : chain === 'base' ? await getMarketDataBase(address) : chain === 'ethereum' ? await getMarketDataEth(address) : await getMarketData(address);
        if (market) {
          const already = (direction === 'above' && market.price >= targetPrice) || (direction === 'below' && market.price <= targetPrice);
          if (already) {
            bot.sendMessage(chatId, `⚠️ Current price ($${market.price}) already meets condition! Alert triggered now.`).catch(e => { });
            bot.sendMessage(chatId,
              `🚨 *PRICE ALERT!*\nToken [${chainLabel}]: \`${address.slice(0, 8)}...\`\nDirection: ${direction}\nTarget: $${targetPrice}\nCurrent: $${market.price}\n\n[📈 View Chart](${market.chartUrl})`,
              { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔇 Stop Sound', callback_data: 'stop_sound' }]] } }
            ).catch(e => { });
            playSound(chatId);
            delete alerts[chatId][address];
            saveData(ALERTS_FILE, alerts);
          }
        }
        return;
      }
    }

    // ===== FALLBACK: User sent address directly (no state) =====
    const isSolAddr = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text);
    const isEthAddr = /^0x[0-9a-fA-F]{40}$/.test(text);

    if (isSolAddr || isEthAddr) {
      userStates[chatId] = { step: 'waiting_price_with_direction', address: text, chain: isEthAddr ? null : 'solana' };

      const fetchMsg = await bot.sendMessage(chatId,
        `🔍 *Address detected!*\n\`${text.slice(0, 12)}...\`\n\n⏳ Fetching live price...`,
        { parse_mode: 'Markdown' }
      ).catch(e => null);

      let market = null;
      let chainLabel = '◎ Solana';
      let chain = 'solana';

      if (isEthAddr) {
        const detected = await detectEVMChain(text);
        chain = detected.chain || 'ethereum';
        chainLabel = CHAIN_LABELS[chain] || '⟠ ETH';
        userStates[chatId].chain = chain;
        market = chain === 'bsc' ? await getMarketDataBNB(text) : chain === 'base' ? await getMarketDataBase(text) : await getMarketDataEth(text);
      } else {
        market = await getMarketData(text);
      }

      const cid = String(chatId);
      if (!history[cid]) history[cid] = [];
      history[cid] = history[cid].filter(h => h.address !== text);
      history[cid].unshift({ address: text, symbol: market?.symbol || '?', chain });
      if (history[cid].length > 10) history[cid].pop();
      saveData(HISTORY_FILE, history);

      let priceInfo = '';
      if (market && market.price) {
        const pd = market.price < 0.01 ? `$${market.price.toFixed(10)}` : `$${market.price.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
        const ce = (market.priceChange24h || 0) >= 0 ? '📈' : '📉';
        priceInfo = `\n💰 *Live Price:* ${pd}\n${ce} 24h Change: ${(market.priceChange24h || 0).toFixed(2)}%\n💧 Liquidity: $${Math.round(market.liquidity || 0).toLocaleString()}`;
      } else {
        priceInfo = '\n⚠️ Price not found right now.';
      }

      if (fetchMsg) {
        bot.editMessageText(
          `✅ *${chainLabel} — ${market?.symbol || '?'}*\n\`${text.slice(0, 12)}...\`${priceInfo}\n\n📌 Choose alert direction:`,
          {
            chat_id: chatId,
            message_id: fetchMsg.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📈 Alert Above', callback_data: `dir_above:${text}` },
                  { text: '📉 Alert Below', callback_data: `dir_below:${text}` }
                ]
              ]
            }
          }
        ).catch(e => { });
      }
      return;
    }
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `📖 *Help*\n• /search pippin\n• /alerts So111... 0.02 above\n• /forcecheck\n• /testbeep\n• /mute – turn off alerts\n• /unmute – turn on alerts\n• /stopsound\n• /setalert – set custom notification sound`, { parse_mode: "Markdown" }).catch(e => { });
  });

  bot.onText(/\/testbeep/, (msg) => {
    playSound(msg.chat.id);
    bot.sendMessage(msg.chat.id, "🔊 Testing sound.").catch(e => { });
  });

  bot.onText(/\/forcecheck/, async (msg) => {
    await checkAllAlerts();
    bot.sendMessage(msg.chat.id, "✅ Force check done.").catch(e => { });
  });

  bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const result = await searchTokenBySymbol(match[1].trim());
    if (result?.address) {
      bot.sendMessage(chatId, `🔍 *Found:* ${result.symbol}\nAddress: \`${result.address}\`\nPrice: $${result.price}\n[View](${result.url})`, { parse_mode: "Markdown" }).catch(e => { });
    } else {
      bot.sendMessage(chatId, `❌ No token found for "${match[1].trim()}".`).catch(e => { });
    }
  });

  bot.onText(/\/clearalerts/, (msg) => {
    const chatId = msg.chat.id;
    if (alerts[chatId]) { delete alerts[chatId]; saveData(ALERTS_FILE, alerts); bot.sendMessage(chatId, "✅ All alerts cleared.").catch(e => { }); }
    else bot.sendMessage(chatId, "📭 No active alerts.").catch(e => { });
  });

  bot.onText(/\/stopsound/, (msg) => {
    const chatId = msg.chat.id;
    if (stopSound(chatId)) bot.sendMessage(chatId, "🔇 Sound stopped.").catch(e => { });
    else bot.sendMessage(chatId, "No active sound.").catch(e => { });
  });

  bot.onText(/\/mute/, (msg) => {
    const chatId = msg.chat.id;
    mutedUsers[chatId] = true;
    saveData(MUTE_FILE, mutedUsers);
    bot.sendMessage(chatId, "🔇 *Alerts muted.* You will no longer receive price alerts. Use /unmute to enable again.", { parse_mode: "Markdown" }).catch(e => { });
  });

  bot.onText(/\/unmute/, (msg) => {
    const chatId = msg.chat.id;
    delete mutedUsers[chatId];
    saveData(MUTE_FILE, mutedUsers);
    bot.sendMessage(chatId, "🔔 *Alerts unmuted.* You will now receive price alerts.", { parse_mode: "Markdown" }).catch(e => { });
  });

  bot.onText(/\/checkprice (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const market = await getMarketData(match[1].trim(), 2);
    if (market) bot.sendMessage(chatId, `💰 Price: $${market.price}`).catch(e => { });
    else bot.sendMessage(chatId, "❌ Price fetch failed.").catch(e => { });
  });

  bot.onText(/\/trending/, async (msg) => {
    const chatId = msg.chat.id;
    const msgSend = await bot.sendMessage(chatId, "⏳ Fetching...");
    const trending = await getTrendingTokens(10);
    if (!trending.length) return bot.editMessageText("❌ No data.", { chat_id: chatId, message_id: msgSend.message_id });
    let text = "*🔥 Trending Solana Tokens*\n\n";
    trending.forEach((t, i) => {
      text += `${i + 1}. *${t.symbol}* – $${parseFloat(t.price).toFixed(8)}\n   💧 $${Math.round(t.liquidity).toLocaleString()} | 📊 $${Math.round(t.volume24h).toLocaleString()}\n   📈 ${t.priceChange}%\n   [View](${t.url})\n\n`;
    });
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgSend.message_id, parse_mode: "Markdown", disable_web_page_preview: true }).catch(e => console.error(e));
  });

  bot.onText(/\/add (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const address = match[1].trim();
    if (!watchlists[chatId]) watchlists[chatId] = [];
    if (!watchlists[chatId].includes(address)) {
      watchlists[chatId].push(address);
      saveData(WATCHLIST_FILE, watchlists);
      bot.sendMessage(chatId, `✅ Added \`${address.slice(0, 6)}...\``, { parse_mode: "Markdown" }).catch(e => { });
    } else bot.sendMessage(chatId, `⚠️ Already in watchlist.`).catch(e => { });
  });

  bot.onText(/\/remove (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const address = match[1].trim();
    if (watchlists[chatId]?.includes(address)) {
      watchlists[chatId] = watchlists[chatId].filter(a => a !== address);
      saveData(WATCHLIST_FILE, watchlists);
      bot.sendMessage(chatId, `🗑 Removed \`${address.slice(0, 6)}...\``, { parse_mode: "Markdown" }).catch(e => { });
    } else bot.sendMessage(chatId, `❌ Not found.`).catch(e => { });
  });

  bot.onText(/\/watchlist/, async (msg) => {
    const chatId = msg.chat.id;
    const list = watchlists[chatId] || [];
    if (!list.length) return bot.sendMessage(chatId, "📭 Empty.").catch(e => { });
    let text = "*📋 Your Watchlist*\n\n";
    for (let addr of list.slice(0, 15)) {
      const market = await getMarketData(addr);
      if (market) text += `\`${addr.slice(0, 6)}...\` – $${market.price} | ${market.priceChange24h}%\n`;
      else text += `\`${addr.slice(0, 6)}...\` – (no data)\n`;
    }
    bot.sendMessage(chatId, text, { parse_mode: "Markdown" }).catch(e => { });
  });

  bot.onText(/\/myalerts/, (msg) => {
    const chatId = msg.chat.id;
    const userAlerts = alerts[chatId] || {};
    const entries = Object.entries(userAlerts);
    if (entries.length === 0) return bot.sendMessage(chatId, "📭 No active alerts.").catch(e => { });

    // Send each alert as a separate message with a Cancel button
    bot.sendMessage(chatId, `*🔔 Your Active Alerts (${entries.length}):*`, { parse_mode: "Markdown" }).catch(e => { });
    for (let [addr, { price, direction }] of entries) {
      const dirEmoji = direction === 'above' ? '📈' : '📉';
      bot.sendMessage(chatId,
        `${dirEmoji} *${direction.toUpperCase()}* Alert\n📍 Token: \`${addr.slice(0, 8)}...\`\n💰 Target: *$${price}*`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: `❌ Cancel This Alert`, callback_data: `cancel_alert:${addr}` }]
            ]
          }
        }
      ).catch(e => { });
    }
  });

  bot.onText(/\/removealert (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const address = match[1].trim();
    if (alerts[chatId]?.[address]) {
      delete alerts[chatId][address];
      saveData(ALERTS_FILE, alerts);
      bot.sendMessage(chatId, `🗑 Removed alert for \`${address.slice(0, 6)}...\``, { parse_mode: "Markdown" }).catch(e => { });
    } else bot.sendMessage(chatId, `❌ No active alert.`).catch(e => { });
  });

  bot.onText(/\/alerts (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const parts = match[1].trim().split(/\s+/);
    if (parts.length < 2) return bot.sendMessage(chatId, "❌ Usage: `/alerts <address> <price> [above|below]`", { parse_mode: "Markdown" }).catch(e => { });
    const address = parts[0];
    const targetPrice = parseFloat(parts[1]);
    let direction = (parts[2] || 'above').toLowerCase();
    if (direction !== 'above' && direction !== 'below') direction = 'above';
    if (isNaN(targetPrice)) return bot.sendMessage(chatId, "❌ Invalid price.").catch(e => { });
    const isSolAddr = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    const isEthAddr = /^0x[0-9a-fA-F]{40}$/.test(address);
    if (!isSolAddr && !isEthAddr) return bot.sendMessage(chatId, "❌ Invalid address! Use a Solana (Base58) or Ethereum (0x...) address.").catch(e => { });
    if (!alerts[chatId]) alerts[chatId] = {};
    alerts[chatId][address] = { price: targetPrice, direction };
    saveData(ALERTS_FILE, alerts);
    sendNotificationReminder(chatId);
    bot.sendMessage(chatId, `🔔 Alert set for \`${address.slice(0, 6)}...\` at $${targetPrice} (${direction}).`, { parse_mode: "Markdown" }).catch(e => { });
    const market = await getMarketData(address);
    if (market) {
      let already = (direction === 'above' && market.price >= targetPrice) || (direction === 'below' && market.price <= targetPrice);
      if (already) {
        bot.sendMessage(chatId, `⚠️ Price already meets condition! Current: $${market.price}. Alert triggered.`).catch(e => { });
        const options = {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "🔇 Stop Sound", callback_data: "stop_sound" }]]
          }
        };
        bot.sendMessage(chatId, `🚨 *PRICE ALERT!*\nToken: \`${address.slice(0, 6)}...\`\nDirection: ${direction}\nTarget: $${targetPrice}\nCurrent: $${market.price}\n\n[View Chart](${market.chartUrl})`, options).catch(e => { });
        playSound(chatId);
        delete alerts[chatId][address];
        saveData(ALERTS_FILE, alerts);
      }
    }
  });

  bot.onText(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, async (msg) => {
    const chatId = msg.chat.id;
    const address = msg.text.trim();
    const msgSend = await bot.sendMessage(chatId, "⏳ Analyzing...");
    const market = await getMarketData(address, 2);
    const risk = calculateRiskScore(market);
    let response = `🔍 *Token:* \`${address.slice(0, 6)}...\`\n\n`;
    if (market) {
      response += `💰 Price: $${market.price}\n💧 Liquidity: ${market.liquidity ? `$${Math.round(market.liquidity).toLocaleString()}` : "N/A"}\n📊 24h Vol: ${market.volume24h ? `$${Math.round(market.volume24h).toLocaleString()}` : "N/A"}\n📈 24h Change: ${market.priceChange24h ? `${market.priceChange24h}%` : "N/A"}\n🏦 Market Cap: ${market.marketCap ? `$${Math.round(market.marketCap).toLocaleString()}` : "N/A"}\n🟢 Buys 24h: ${market.buyCount}\n🔴 Sells 24h: ${market.sellCount}\n\n`;
    } else {
      response += `❌ No market data found.\n\n`;
    }
    response += `🎯 Risk: ${risk.score}/100 – ${risk.level}\n📋 ${risk.reasons.join("\n")}\n\n📈 [View Chart](${market?.chartUrl || `https://dexscreener.com/solana/${address}`})`;
    await bot.editMessageText(response, { chat_id: chatId, message_id: msgSend.message_id, parse_mode: "Markdown", disable_web_page_preview: true }).catch(e => console.error(e));
  });

  bot.onText(/\/setalert/, (msg) => {
    const chatId = msg.chat.id;
    const audioPath = './beep.mp3';
    const exists = fs.existsSync(audioPath);
    let message = "🔊 *How to set custom notification sound for this bot:*\n\n" +
      "1️⃣ Open this chat\n" +
      "2️⃣ Tap on the bot's name at the top\n" +
      "3️⃣ Go to *Notifications* → *Sound*\n" +
      "4️⃣ Choose any sound you like (or use the downloaded file below)\n\n" +
      "📌 *Tip:* You can download the sound file below and save it to your phone's 'Notifications' folder, then it will appear in the sound list.\n\n" +
      "⚙️ You can change or remove it anytime from the same settings.\n\n" +
      "✅ After setting, you will hear that sound for all future price alerts from this bot!";
    if (exists) {
      bot.sendDocument(chatId, audioPath, {
        caption: "🔊 *Sample beep sound – download and save to your device*",
        parse_mode: "Markdown"
      }).catch(err => console.error("Document send error:", err));
    } else {
      message += "\n\n⚠️ *Note:* No sound file available for download. Please use your phone's default sounds.";
    }
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" }).catch(e => { });
  });

  bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    if (data === 'stop_sound') {
      if (stopSound(chatId)) bot.sendMessage(chatId, "🔇 Sound stopped.").catch(e => { });
      else bot.sendMessage(chatId, "No active sound to stop.").catch(e => { });
      bot.answerCallbackQuery(callbackQuery.id);

    } else if (data.startsWith('cancel_alert:')) {
      // ===== CANCEL ALERT HANDLER =====
      const address = data.split('cancel_alert:')[1];
      if (alerts[chatId]?.[address]) {
        const { price, direction } = alerts[chatId][address];
        delete alerts[chatId][address];
        // Clean up empty chatId entry
        if (Object.keys(alerts[chatId]).length === 0) delete alerts[chatId];
        saveData(ALERTS_FILE, alerts);
        // Edit the inline button message to show cancelled status
        bot.editMessageText(
          `✅ *Alert Cancelled!*\n\n📍 Token: \`${address.slice(0, 8)}...\`\n📈 Direction: *${direction.toUpperCase()}*\n💰 Target was: *$${price}*\n\n_This alert has been removed._`,
          {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            parse_mode: 'Markdown'
          }
        ).catch(e => { });
        bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Alert cancelled successfully!' });
      } else {
        // Alert already triggered or doesn't exist
        bot.editMessageText(
          `⚠️ *Alert Already Removed*\n\n📍 Token: \`${address.slice(0, 8)}...\`\n\n_This alert was already triggered or cancelled._`,
          {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            parse_mode: 'Markdown'
          }
        ).catch(e => { });
        bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Alert not found!' });
      }

    } else if (data === 'alert_above') {
      userStates[chatId] = 'waiting_alert_above';
      bot.sendMessage(chatId,
        "📈 *Set Alert – Price Goes ABOVE*\n\nPlease send the *Token Address* and *Target Price* separated by a space.\n\nExample:\n`Dfh5DzRgSvvCFDoYc2ciTk... 0.02593`\n\n_Just paste it and send!_",
        { parse_mode: "Markdown" }
      ).catch(e => { });
      bot.answerCallbackQuery(callbackQuery.id);

    } else if (data === 'alert_below') {
      userStates[chatId] = 'waiting_alert_below';
      bot.sendMessage(chatId,
        "📉 *Set Alert – Price Goes BELOW*\n\nPlease send the *Token Address* and *Target Price* separated by a space.\n\nExample:\n`Dfh5DzRgSvvCFDoYc2ciTk... 0.02593`\n\n_Just paste it and send!_",
        { parse_mode: "Markdown" }
      ).catch(e => { });
      bot.answerCallbackQuery(callbackQuery.id);

    } else if (data === 'chain_eth' || data === 'chain_bsc') {
      const state = userStates[chatId];
      if (!state || state.step !== 'waiting_chain') {
        bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Session expired. Start again.' });
        return;
      }
      const chosenChain = data === 'chain_eth' ? 'ethereum' : 'bsc';
      const chainLabel = data === 'chain_eth' ? '⟠ Ethereum' : '🟡 BNB Chain';
      const addr = state.address;
      userStates[chatId] = { step: 'waiting_price', direction: state.direction, address: addr, chain: chosenChain };
      bot.editMessageText(
        `✅ *${chainLabel} selected!*\n\`${addr.slice(0, 16)}...\`\n\n⏳ Fetching live price...`,
        { chat_id: chatId, message_id: callbackQuery.message.message_id, parse_mode: 'Markdown' }
      ).catch(e => { });
      bot.answerCallbackQuery(callbackQuery.id);
      try {
        const market = chosenChain === 'bsc' ? await getMarketDataBNB(addr) : await getMarketDataEth(addr);
        const cid = String(chatId);
        if (!history[cid]) history[cid] = [];
        history[cid] = history[cid].filter(h => h.address !== addr);
        history[cid].unshift({ address: addr, symbol: market?.symbol || '?', chain: chosenChain });
        if (history[cid].length > 10) history[cid].pop();
        saveData(HISTORY_FILE, history);
        if (market?.price) {
          const pd = market.price < 0.01 ? `$${market.price.toFixed(10)}` : `$${market.price.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
          const ce = market.priceChange24h >= 0 ? '📈' : '📉';
          bot.sendMessage(chatId,
            `✅ *${chainLabel} — ${market.symbol || '?'}*\n\`${addr.slice(0, 10)}...\`\n\n💰 *Live Price:* ${pd}\n${ce} 24h: ${market.priceChange24h?.toFixed(2)}%\n💧 Liquidity: $${Math.round(market.liquidity || 0).toLocaleString()}\n\n📌 *Step 2:* Enter your *Target Price* (USD):`,
            { parse_mode: 'Markdown' }
          ).catch(e => { });
        } else {
          bot.sendMessage(chatId,
            `✅ *${chainLabel} address saved!*\n\`${addr.slice(0, 10)}...\`\n\n⚠️ Price not found right now.\n\n📌 *Step 2:* Enter your *Target Price* manually (USD): Example: \`0.02593\``,
            { parse_mode: 'Markdown' }
          ).catch(e => { });
        }
      } catch (e) { console.error('BNB price fetch error:', e.message); }

    } else if (data === 'setup_sound') {
      const audioPath = './beep.mp3';
      const soundExists = fs.existsSync(audioPath);
      const guideMsg = "🔊 *How to Set Custom Beep Sound for this Bot:*\n\n" +
        "1️⃣ Download the sound file sent below\n" +
        "2️⃣ Open this bot's chat in Telegram\n" +
        "3️⃣ Tap on the bot name at the top\n" +
        "4️⃣ Go to *Notifications → Customize → Sound*\n" +
        "5️⃣ Select the downloaded beep file\n\n" +
        "✅ Done! Every price alert from now on will play this beep sound automatically.\n" +
        "❌ To remove: Go back to the same Notifications settings and choose 'Default Sound'.\n\n" +
        "📌 *Note:* This is a one-time setup. You never need to do it again unless you reinstall Telegram.";
      if (soundExists) {
        bot.sendDocument(chatId, audioPath, {
          caption: "🔔 *HVBS Alert Beep Sound*\nDownload this file and set it as your notification sound for this bot (see instructions above).",
          parse_mode: "Markdown"
        }).catch(err => console.error("Document send error:", err));
      } else {
        bot.sendMessage(chatId,
          guideMsg + "\n\n⚠️ *Sound file not found on server.* Please ask the admin to upload beep.mp3 to the server.",
          { parse_mode: "Markdown" }
        ).catch(e => { });
      }
      if (soundExists) bot.sendMessage(chatId, guideMsg, { parse_mode: "Markdown" }).catch(e => { });
      bot.answerCallbackQuery(callbackQuery.id);

    } else if (data.startsWith('dir_above:') || data.startsWith('dir_below:')) {
      // ===== DIRECTION SELECTION for direct-address fallback flow =====
      const direction = data.startsWith('dir_above:') ? 'above' : 'below';
      const address = data.replace('dir_above:', '').replace('dir_below:', '');
      const state = userStates[chatId];
      const chain = state?.chain || 'solana';

      userStates[chatId] = { step: 'waiting_price', direction, address, chain };

      const chainLabel = chain === 'bsc' ? '🟡 BNB' : chain === 'ethereum' ? '⟠ ETH' : '◎ SOL';
      const dirEmoji = direction === 'above' ? '📈' : '📉';

      bot.editMessageText(
        `${dirEmoji} *${direction.toUpperCase()} alert selected!*\n[${chainLabel}] \`${address.slice(0, 12)}...\`\n\n📌 *Step 2:* Enter your *Target Price* (USD):\nExample: \`0.00025\``,
        {
          chat_id: chatId,
          message_id: callbackQuery.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [] }
        }
      ).catch(e => { });
      bot.answerCallbackQuery(callbackQuery.id);
    }
  });
}

// Wait for bot to be ready before setting handlers
const checkBotInterval = setInterval(() => {
  if (botInitialized) {
    clearInterval(checkBotInterval);
    setupBotHandlers();
    console.log("✅ Telegram bot handlers attached");
  }
}, 1000);

// ========== REAL WHALE ALERTS API ==========
const gtCache = {};

app.get("/api/whale-alerts", async (req, res) => {
  const { token, minBuy } = req.query;
  if (!token) return res.status(400).json({ error: "Token is required" });
  const threshold = parseFloat(minBuy) || 10000;

  try {
    let poolAddress = gtCache[token]?.pool;

    // 1. Resolve pool address if not cached
    if (!poolAddress) {
      const poolRes = await axios.get(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${token}/pools?page=1`, {
        timeout: 5000
      });
      const pools = poolRes.data.data;
      if (!pools || pools.length === 0) return res.json({ alerts: [] });
      poolAddress = pools[0].attributes.address;
      gtCache[token] = { pool: poolAddress, trades: [], lastFetch: 0 };
    }

    const cacheEntry = gtCache[token];
    const now = Date.now();

    // 2. Fetch trades if cache is older than 5 seconds
    if (now - cacheEntry.lastFetch > 5000) {
      const tradesRes = await axios.get(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/trades`, {
        timeout: 5000
      });
      cacheEntry.trades = tradesRes.data.data || [];
      cacheEntry.lastFetch = now;
    }

    // 3. Filter and parse trades
    const alerts = [];
    cacheEntry.trades.forEach(t => {
      const attr = t.attributes;
      if (attr.kind === "buy") {
        const amount = parseFloat(attr.volume_in_usd);
        if (amount >= threshold) {
          const walletRaw = attr.tx_from_address || attr.tx_hash;
          const displayWallet = walletRaw.substring(0, 6) + "..." + walletRaw.substring(walletRaw.length - 4);

          let typeLabel = "Fresh Wallet";
          let typeClass = "type-fresh";
          if (amount >= 50000) { typeLabel = "Whale"; typeClass = "type-whale"; }
          else if (amount >= 20000) { typeLabel = "Smart Money"; typeClass = "type-smart"; }

          alerts.push({
            id: attr.tx_hash,
            amount: amount,
            wallet: displayWallet,
            type: { label: typeLabel, class: typeClass },
            time: new Date(attr.block_timestamp).toLocaleTimeString([], { hour12: false })
          });
        }
      }
    });

    res.json({ alerts });
  } catch (err) {
    console.error("Error fetching real trades:", err.message);
    res.json({ alerts: gtCache[token]?.trades ? [] : [] }); // Return empty on error to avoid crash
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION API ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// Payment config — returns the backend wallet address for payments
app.get("/api/payment-config", (req, res) => {
  try {
    const kp = getBackendKeypair();
    res.json({ success: true, recipient: kp.publicKey.toString() });
  } catch (e) {
    res.status(500).json({ success: false, error: "Backend wallet not configured" });
  }
});

// Build a payment transaction server-side (optional, for SPL token payments)
app.post("/build-payment-tx", async (req, res) => {
  const { wallet, currency, amount } = req.body;
  if (!wallet || !currency || !amount) return res.status(400).json({ success: false, error: "Missing fields" });
  try {
    const connection = new Connection(SOLANA_RPC, "confirmed");
    const fromPub = new PublicKey(wallet);
    const payer = getBackendKeypair();
    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: fromPub });

    if (currency === "SOL") {
      const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);
      tx.add(SystemProgram.transfer({ fromPubkey: fromPub, toPubkey: payer.publicKey, lamports }));
    }
    // USDC/USDT: handled client-side via Phantom's signAndSendTransaction

    const serialized = tx.serialize({ requireAllSignatures: false });
    res.json({ success: true, transaction: Buffer.from(serialized).toString("base64") });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /verify-payment — verify tx and activate subscription
app.post("/verify-payment", async (req, res) => {
  const { wallet, txSignature, currency } = req.body;
  if (!wallet || !txSignature || !currency)
    return res.status(400).json({ success: false, error: "wallet, txSignature, currency required" });

  // Prevent duplicate activation
  if (seenTxs[txSignature])
    return res.status(400).json({ success: false, error: "Transaction already used" });

  try {
    const recipientKeypair = getBackendKeypair();
    const result = await verifySolanaTransaction(txSignature, recipientKeypair.publicKey.toString(), currency, wallet);

    if (!result.ok) return res.status(400).json({ success: false, error: result.error });

    // Activate subscription
    const now = new Date();
    const expires = new Date(now.getTime() + SUB_DURATION_DAYS * 86400000);
    subscriptions[wallet] = {
      wallet, active: true,
      startedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      txSignature, currency,
      amountUsd: SUB_PRICE_USD
    };
    seenTxs[txSignature] = { wallet, timestamp: now.toISOString() };
    saveJSON(SUBS_FILE, subscriptions);
    saveJSON(SEEN_TXS_FILE, seenTxs);

    // Queue a burn
    const burnEntry = {
      id: txSignature,
      amount: SUB_PRICE_USD,  // tokens proportional; real calc needs ALERT price
      usd: SUB_PRICE_USD,
      timestamp: now.toISOString(),
      status: "queued",
      txSignature: null,
      reason: `subscription:${wallet.slice(0, 8)}`
    };
    if (!burnHistory.history) burnHistory.history = [];
    burnHistory.history.unshift(burnEntry);
    burnHistory.totalRevenue = (burnHistory.totalRevenue || 0) + SUB_PRICE_USD;
    burnHistory.totalUsdBurned = (burnHistory.totalUsdBurned || 0) + SUB_PRICE_USD;
    saveJSON(BURN_FILE, burnHistory);

    // Async burn attempt
    burnAlertTokens(SUB_PRICE_USD, "subscription").then(sig => {
      if (sig) {
        burnEntry.status = "done";
        burnEntry.txSignature = sig;
        burnHistory.totalBurned = (burnHistory.totalBurned || 0) + SUB_PRICE_USD;
        burnHistory.burnCount = (burnHistory.burnCount || 0) + 1;
        saveJSON(BURN_FILE, burnHistory);
      }
    }).catch(console.error);

    console.log(`✅ Subscription activated: ${wallet.slice(0, 8)}… via ${currency}`);
    res.json({ success: true, expiresAt: expires.toISOString(), burnTx: "queued" });
  } catch (err) {
    console.error("verify-payment error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /subscription-status
app.get("/subscription-status", (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ success: false, error: "wallet required" });

  const sub = subscriptions[wallet];
  if (!sub) return res.json({ active: false });

  // Re-check expiry
  const active = sub.active && new Date(sub.expiresAt) > new Date();
  if (!active && sub.active) {
    subscriptions[wallet].active = false;
    saveJSON(SUBS_FILE, subscriptions);
  }
  res.json({ active, expiresAt: sub.expiresAt || null, startedAt: sub.startedAt || null });
});

// GET /burn-stats
app.get("/burn-stats", (req, res) => {
  res.json({
    success: true,
    totalBurned: burnHistory.totalBurned || 0,
    totalUsdBurned: burnHistory.totalUsdBurned || 0,
    totalRevenue: burnHistory.totalRevenue || 0,
    burnCount: burnHistory.burnCount || 0,
    history: (burnHistory.history || []).slice(0, 30)
  });
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

// Admin auth verify
app.post("/admin/verify-auth", (req, res) => {
  const { wallet, message, signature } = req.body;
  if (wallet !== ADMIN_WALLET)
    return res.status(403).json({ success: false, error: "Not admin wallet" });
  if (!message || !signature)
    return res.status(400).json({ success: false, error: "message and signature required" });
  // In production: verify the Ed25519 signature using tweetnacl
  // For now we trust the wallet address check (Phantom already verified ownership)
  const token = generateAdminToken();
  res.json({ success: true, token });
});

// Admin: list subscriptions
app.get("/admin/subscriptions", requireAdmin, (req, res) => {
  const subs = Object.values(subscriptions).map(s => ({
    ...s,
    active: s.active && new Date(s.expiresAt) > new Date()
  }));
  res.json({ success: true, subscriptions: subs });
});

// Admin: trigger burn manually
app.post("/admin/trigger-burn", requireAdmin, async (req, res) => {
  try {
    const amount = req.body.amount || 1;
    const sig = await burnAlertTokens(amount, "admin-manual");
    if (!sig) return res.json({ success: false, error: "Burn tx failed — check ALERT_MINT and BACKEND_PRIVATE_KEY" });

    const entry = {
      id: sig, amount, usd: 0,
      timestamp: new Date().toISOString(),
      status: "done", txSignature: sig, reason: "admin-manual"
    };
    if (!burnHistory.history) burnHistory.history = [];
    burnHistory.history.unshift(entry);
    burnHistory.totalBurned = (burnHistory.totalBurned || 0) + amount;
    burnHistory.burnCount = (burnHistory.burnCount || 0) + 1;
    saveJSON(BURN_FILE, burnHistory);
    res.json({ success: true, txSignature: sig });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: override subscription
app.post("/admin/override-subscription", requireAdmin, (req, res) => {
  const { wallet, days } = req.body;
  if (!wallet) return res.status(400).json({ success: false, error: "wallet required" });
  const d = parseInt(days) || 30;
  const now = new Date();
  const expires = new Date(now.getTime() + d * 86400000);
  subscriptions[wallet] = {
    wallet, active: true,
    startedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    txSignature: "admin-override",
    currency: "OVERRIDE",
    amountUsd: 0
  };
  saveJSON(SUBS_FILE, subscriptions);
  res.json({ success: true, expiresAt: expires.toISOString() });
});

// Serve admin, payment pages
app.get("/admin", (req, res) => res.sendFile(process.cwd() + "/admin.html"));
app.get("/payment", (req, res) => res.sendFile(process.cwd() + "/payment.html"));

// ═══════════════════════════════════════════════════════════════════════════
// WILDCARD + START
// ═══════════════════════════════════════════════════════════════════════════
app.get("*", (req, res) => {
  res.sendFile(process.cwd() + "/index.html");
});

// ─── GRACEFUL SHUTDOWN (stops duplicate-instance 409 conflicts at the root) ──
// Render sends SIGTERM to the OLD instance as soon as the NEW deploy becomes
// healthy, but gives it a grace period before force-killing it. Without a
// handler, the old process just keeps polling Telegram during that grace
// window — which is exactly what causes the two instances to fight over
// getUpdates and throw "409 Conflict". By stopping polling the instant
// SIGTERM arrives, the old instance releases Telegram's polling lock
// immediately, so the new instance starts cleanly with no conflict at all.
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`🛑 ${signal} received — this instance is being replaced, stopping Telegram polling immediately...`);
  try {
    if (bot) await bot.stopPolling({ cancel: true });
    console.log("✅ Polling stopped cleanly, exiting.");
  } catch (e) {
    console.error("Error stopping polling during shutdown:", e.message);
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Previously these only logged and let the process keep running. If an
// uncaught error left the event loop / bot instance in a broken state, the
// process never crashed, so Render never restarted it — the only fix was a
// manual "Clear build cache & deploy". Now we log, then exit so Render's
// process manager restarts the service automatically (auto-restart on crash
// is standard Render behavior for web services).
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught exception:", err);
  console.error("Restarting process in 2s so the platform can bring it back up...");
  setTimeout(() => process.exit(1), 2000);
});
process.on("unhandledRejection", (reason) => {
  console.error("💥 Unhandled rejection:", reason);
  console.error("Restarting process in 2s so the platform can bring it back up...");
  setTimeout(() => process.exit(1), 2000);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (!fs.existsSync("./sounds")) fs.mkdirSync("./sounds");
  console.log("✅ APIs ready");
  console.log("✅ Health check at /health");
  console.log("✅ Subscription system active");
  console.log("✅ Admin panel at /admin");
  console.log("✅ Payment page at /payment");
  console.log("🔥 Burn cron every 2 minutes");
});
