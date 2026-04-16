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

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// 🔐 YOUR NEW TELEGRAM BOT TOKEN (updated)
const TELEGRAM_BOT_TOKEN = "8550627220:AAG2mrcZRrCsrRWNjX13TfFDaNN-yarMOw4";
const CMC_API_KEY = "2e4699c5c9614df5801eed04b36ba057";

const DEXSCREENER_TOKEN_PAIRS = "https://api.dexscreener.com/token-pairs/v1/solana/";
const DEXSCREENER_SEARCH      = "https://api.dexscreener.com/latest/dex/search?q=";
const TRENDING_API            = "https://api.dexscreener.com/latest/dex/search?q=solana";
const JUPITER_PRICE_API       = "https://api.jup.ag/price/v2?ids=";
const COINGECKO_SEARCH        = "https://api.coingecko.com/api/v3/search?query=";
const COINGECKO_COIN_DATA     = "https://api.coingecko.com/api/v3/coins/";
const GECKO_TERMINAL_API      = "https://api.geckoterminal.com/api/v2/networks/solana/tokens/";
const SOLSCAN_TOPHOLDERS      = "https://api.solscan.io/v2/token/holders?tokenAddress=";

const ALERTS_FILE    = "./alerts.json";
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

let alerts    = loadData(ALERTS_FILE);
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

function initBot() {
  if (botInitialized) return;
  try {
    if (TELEGRAM_BOT_TOKEN === "YOUR_BOT_TOKEN_HERE") {
      console.error("❌ Telegram bot token not set!");
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
    
    bot.on('polling_error', (error) => {
      console.error("Polling error:", error.code, error.message);
      if (error.code === 'EFATAL' || error.message.includes('409')) {
        console.log("Attempting to restart polling...");
        setTimeout(() => {
          bot.stopPolling().then(() => {
            bot.startPolling();
          }).catch(e => console.error("Restart failed:", e));
        }, 5000);
      }
    });
    
    bot.on('error', (error) => {
      console.error("Bot error:", error);
    });
    
    bot.getMe().then((botInfo) => {
      console.log(`🤖 Telegram bot started as @${botInfo.username}`);
      botInitialized = true;
    }).catch((err) => {
      console.error("❌ Failed to connect to Telegram API:", err.message);
      bot = null;
    });
    
  } catch (err) {
    console.error("❌ Bot initialization error:", err);
    bot = null;
  }
}

initBot();

const activeSounds = {};

function stopSound(chatId) {
  if (activeSounds[chatId]) {
    if (activeSounds[chatId].type === 'beep' && activeSounds[chatId].intervalId) {
      clearInterval(activeSounds[chatId].intervalId);
    } else if (activeSounds[chatId].type === 'custom' && activeSounds[chatId].process) {
      try {
        if (process.platform === 'win32') {
          exec(`taskkill /F /PID ${activeSounds[chatId].process.pid}`, () => {});
        } else {
          activeSounds[chatId].process.kill('SIGTERM');
        }
      } catch(e) {}
    }
    delete activeSounds[chatId];
    return true;
  }
  return false;
}

function playSound(chatId) {
  stopSound(chatId);
  const soundDir = "./sounds";
  const exts = [".mp3", ".wav", ".m4a"];
  let soundFile = null;
  for (let ext of exts) {
    const testPath = path.join(soundDir, `${chatId}${ext}`);
    if (fs.existsSync(testPath)) { soundFile = testPath; break; }
  }
  if (soundFile) {
    let playerProcess;
    if (process.platform === "win32")      playerProcess = exec(`start "" "${soundFile}"`);
    else if (process.platform === "darwin") playerProcess = exec(`afplay "${soundFile}"`);
    else                                    playerProcess = exec(`aplay "${soundFile}"`);
    activeSounds[chatId] = { type: 'custom', process: playerProcess };
  } else {
    let beepCount = 0;
    const beepInterval = setInterval(() => {
      if (beepCount >= 60) {
        clearInterval(beepInterval);
        if (activeSounds[chatId]?.type === 'beep') delete activeSounds[chatId];
        return;
      }
      if (process.platform === "win32") exec(`powershell -c "[System.Console]::Beep(880,300)"`, () => {});
      else process.stdout.write('\x07');
      beepCount++;
    }, 1000);
    activeSounds[chatId] = { type: 'beep', intervalId: beepInterval };
  }
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
            liquidity:      p.liquidity?.usd      || 0,
            volume24h:      p.volume?.h24          || 0,
            priceChange24h: p.priceChange?.h24     || 0,
            marketCap:      p.marketCap            || 0,
            symbol:         p.baseToken?.symbol    || "?",
            name:           p.baseToken?.name      || "",
            chartUrl:       p.url || `https://dexscreener.com/solana/${mint}`,
            buyCount:       p.txns?.h24?.buys      || 0,
            sellCount:      p.txns?.h24?.sells     || 0,
            pairAddress:    p.pairAddress           || ""
          };
        }
      }
    } catch(e) {}

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
            liquidity:      p.liquidity?.usd      || 0,
            volume24h:      p.volume?.h24          || 0,
            priceChange24h: p.priceChange?.h24     || 0,
            marketCap:      p.marketCap            || 0,
            symbol:         p.baseToken?.symbol    || "?",
            name:           p.baseToken?.name      || "",
            chartUrl:       p.url || `https://dexscreener.com/solana/${mint}`,
            buyCount:       p.txns?.h24?.buys      || 0,
            sellCount:      p.txns?.h24?.sells     || 0,
            pairAddress:    p.pairAddress           || ""
          };
        }
      }
    } catch(e) {}

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
    } catch(e) {}

    try {
      const geckoRes = await axios.get(`${GECKO_TERMINAL_API}${mint}`, { timeout: 5000 });
      const attrs = geckoRes.data?.data?.attributes;
      if (attrs) {
        const price = parseFloat(attrs.price_usd);
        if (price && price > 0) {
          return {
            price,
            liquidity:      parseFloat(attrs.total_reserve_in_usd) || 0,
            volume24h:      parseFloat(attrs.volume_usd?.h24) || 0,
            priceChange24h: parseFloat(attrs.price_change_percentage?.h24) || 0,
            marketCap:      parseFloat(attrs.market_cap_usd) || 0,
            symbol:         attrs.symbol || "?",
            name:           attrs.name || "",
            chartUrl:       `https://dexscreener.com/solana/${mint}`,
            buyCount: 0, sellCount: 0, pairAddress: ""
          };
        }
      }
    } catch(e) {}

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
  } catch(e) { console.log("Solscan holders error:", e.message); }
  try {
    const heliusRes = await axios.post(`https://mainnet.helius-rpc.com/?api-key=35d9c070-00bd-4523-acd7-6b728e9c1127`, {
      jsonrpc: "2.0", id: 1, method: "getTokenLargestAccounts", params: [mint]
    }, { timeout: 7000 });
    const accounts = heliusRes.data?.result?.value || [];
    return accounts.slice(0, 10).map((acc, i) => ({ rank: i + 1, address: acc.address || "Unknown", amount: acc.uiAmount || 0, percentage: "N/A", isContract: false }));
  } catch(e) { console.log("Helius holders error:", e.message); }
  return [];
}

// ========== BUYERS/SELLERS ==========
async function getBuyersSellers(mint) {
  try {
    const res = await axios.get(`${DEXSCREENER_TOKEN_PAIRS}${mint}`, { timeout: 6000 });
    if (Array.isArray(res.data) && res.data.length > 0) {
      let totalBuys1h = 0, totalSells1h = 0, totalBuys6h = 0, totalSells6h = 0, totalBuys24h = 0, totalSells24h = 0;
      for (const p of res.data) {
        totalBuys1h  += p.txns?.h1?.buys   || 0; totalSells1h += p.txns?.h1?.sells  || 0;
        totalBuys6h  += p.txns?.h6?.buys   || 0; totalSells6h += p.txns?.h6?.sells  || 0;
        totalBuys24h += p.txns?.h24?.buys  || 0; totalSells24h+= p.txns?.h24?.sells || 0;
      }
      return { h1: { buys: totalBuys1h, sells: totalSells1h }, h6: { buys: totalBuys6h, sells: totalSells6h }, h24: { buys: totalBuys24h, sells: totalSells24h } };
    }
  } catch(e) { console.log("Buyers/sellers error:", e.message); }
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
  } catch(e) {}
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
  } catch(e) {}
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
      const market = await getMarketData(addr);
      if (market) {
        let triggered = false;
        if (direction === 'above' && market.price >= targetPrice) triggered = true;
        if (direction === 'below' && market.price <= targetPrice) triggered = true;
        if (triggered) {
          const options = {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔇 Stop Sound", callback_data: "stop_sound" }]
              ]
            }
          };
          bot.sendMessage(chatId,
            `🚨 *PRICE ALERT!*\nToken: \`${addr.slice(0,6)}...\`\nDirection: ${direction}\nTarget: $${targetPrice}\nCurrent: $${market.price}\n\n[View Chart](${market.chartUrl})`,
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
      } catch(e) {}
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
    } catch(e) {}
    res.json({
      success: true, tokenAddress: mint, name: market?.name || market?.symbol || mint.slice(0,6)+"...", symbol: market?.symbol || "?",
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
      bot.sendMessage(chatId, `🔔 *Alert Set via Web!*\nToken: \`${tokenAddress.slice(0,6)}...\`\nTarget: $${price} (${dir})\n\n⚠️ *Your alerts are currently muted.* You will not receive notifications. Use /unmute to enable alerts.`, { parse_mode: "Markdown" }).catch(e => console.error(e));
    } else {
      bot.sendMessage(chatId, `🔔 *Alert Set via Web!*\nToken: \`${tokenAddress.slice(0,6)}...\`\nTarget: $${price} (${dir})\n\nYou will receive a Telegram message + sound when this hits!`, { parse_mode: "Markdown" }).catch(e => console.error(e));
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
    uptime: process.uptime()
  });
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
      bot.sendMessage(chatId, "🔔 *Notification Reminder*\n\nTo receive price alerts with sound, please ensure Telegram notifications are enabled on your device.\n\nGo to Telegram Settings → Notifications and Sounds → Enable for this bot.\n\nYou can also mute/unmute alerts using:\n`/mute` – disable all alerts\n`/unmute` – enable alerts\n\n_This message will not appear again._", { parse_mode: "Markdown" }).catch(e=>{});
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
        ).catch(e => {});
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
      ).catch(e => {});
      return;
    }

    if (text === '📜 History') {
      const userHistory = history[chatId] || [];
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
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) {
          bot.sendMessage(chatId,
            '❌ *Invalid Address!*\nPlease paste a valid Solana token contract address.\n\nExample: `Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump`',
            { parse_mode: 'Markdown' }
          ).catch(e => {});
          return;
        }
        userStates[chatId] = { step: 'waiting_price', direction: state.direction, address: text };
        userStates[chatId] = { step: 'waiting_price', direction: state.direction, address: text };
        
        // --- History Logic ---
        (async () => {
          try {
            const market = await getMarketData(text);
            const symbol = market?.symbol || "?";
            if (!history[chatId]) history[chatId] = [];
            // Remove existing entry for same address to bring to front
            history[chatId] = history[chatId].filter(h => h.address !== text);
            history[chatId].unshift({ address: text, symbol });
            if (history[chatId].length > 10) history[chatId].pop();
            saveData(HISTORY_FILE, history);
          } catch (e) {
            console.error("History update error:", e);
          }
        })();
        // --- End History Logic ---

        bot.sendMessage(chatId,
          `✅ Address saved: \`${text}\`\n\n💰 *Step 2:* Now enter the *Target Price* (in USD):\n\nExample: \`0.02593\``,
          { parse_mode: 'Markdown' }
        ).catch(e => {});
        return;
      }

      // Step 2: Waiting for price
      if (state.step === 'waiting_price') {
        const targetPrice = parseFloat(text);
        if (isNaN(targetPrice) || targetPrice <= 0) {
          bot.sendMessage(chatId,
            '❌ *Invalid Price!*\nPlease enter a valid number.\n\nExample: `0.02593`',
            { parse_mode: 'Markdown' }
          ).catch(e => {});
          return;
        }

        const { address, direction } = state;
        if (!alerts[chatId]) alerts[chatId] = {};
        alerts[chatId][address] = { price: targetPrice, direction };
        saveData(ALERTS_FILE, alerts);
        delete userStates[chatId];

        // Confirm alert and restore keyboard
        sendMainKeyboard(chatId,
          `✅ *Alert Set Successfully!*\n\n📍 Token: \`${address.slice(0,8)}...\`\n📈 Direction: *${direction.toUpperCase()}*\n💰 Target Price: *$${targetPrice}*\n\nYou will be notified when price goes *${direction}* $${targetPrice}! 🎯\n\n_Use the buttons below to set another alert._`
        );

        // Send a separate inline button message to cancel this specific alert
        bot.sendMessage(chatId,
          `🔔 *Alert Active:*\n\`${address.slice(0,8)}...\` → *${direction.toUpperCase()}* $${targetPrice}\n\nTap below to cancel it manually anytime:`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: `❌ Cancel This Alert`, callback_data: `cancel_alert:${address}` }]
              ]
            }
          }
        ).catch(e => {});

        // Check if already triggered
        const market = await getMarketData(address);
        if (market) {
          const already = (direction === 'above' && market.price >= targetPrice) || (direction === 'below' && market.price <= targetPrice);
          if (already) {
            bot.sendMessage(chatId, `⚠️ Current price ($${market.price}) already meets condition! Alert triggered now.`).catch(e => {});
            bot.sendMessage(chatId,
              `🚨 *PRICE ALERT!*\nToken: \`${address.slice(0,8)}...\`\nDirection: ${direction}\nTarget: $${targetPrice}\nCurrent: $${market.price}\n\n[📈 View Chart](${market.chartUrl})`,
              { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔇 Stop Sound', callback_data: 'stop_sound' }]] } }
            ).catch(e => {});
            playSound(chatId);
            delete alerts[chatId][address];
            saveData(ALERTS_FILE, alerts);
          }
        }
        return;
      }
    }
  });
  
  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `📖 *Help*\n• /search pippin\n• /alerts So111... 0.02 above\n• /forcecheck\n• /testbeep\n• /mute – turn off alerts\n• /unmute – turn on alerts\n• /stopsound\n• /setalert – set custom notification sound`, { parse_mode: "Markdown" }).catch(e=>{});
  });
  
  bot.onText(/\/testbeep/, (msg) => {
    playSound(msg.chat.id);
    bot.sendMessage(msg.chat.id, "🔊 Testing sound.").catch(e=>{});
  });
  
  bot.onText(/\/forcecheck/, async (msg) => {
    await checkAllAlerts();
    bot.sendMessage(msg.chat.id, "✅ Force check done.").catch(e=>{});
  });
  
  bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const result = await searchTokenBySymbol(match[1].trim());
    if (result?.address) {
      bot.sendMessage(chatId, `🔍 *Found:* ${result.symbol}\nAddress: \`${result.address}\`\nPrice: $${result.price}\n[View](${result.url})`, { parse_mode: "Markdown" }).catch(e=>{});
    } else {
      bot.sendMessage(chatId, `❌ No token found for "${match[1].trim()}".`).catch(e=>{});
    }
  });
  
  bot.onText(/\/clearalerts/, (msg) => {
    const chatId = msg.chat.id;
    if (alerts[chatId]) { delete alerts[chatId]; saveData(ALERTS_FILE, alerts); bot.sendMessage(chatId, "✅ All alerts cleared.").catch(e=>{}); }
    else bot.sendMessage(chatId, "📭 No active alerts.").catch(e=>{});
  });
  
  bot.onText(/\/stopsound/, (msg) => {
    const chatId = msg.chat.id;
    if (stopSound(chatId)) bot.sendMessage(chatId, "🔇 Sound stopped.").catch(e=>{});
    else bot.sendMessage(chatId, "No active sound.").catch(e=>{});
  });
  
  bot.onText(/\/mute/, (msg) => {
    const chatId = msg.chat.id;
    mutedUsers[chatId] = true;
    saveData(MUTE_FILE, mutedUsers);
    bot.sendMessage(chatId, "🔇 *Alerts muted.* You will no longer receive price alerts. Use /unmute to enable again.", { parse_mode: "Markdown" }).catch(e=>{});
  });
  
  bot.onText(/\/unmute/, (msg) => {
    const chatId = msg.chat.id;
    delete mutedUsers[chatId];
    saveData(MUTE_FILE, mutedUsers);
    bot.sendMessage(chatId, "🔔 *Alerts unmuted.* You will now receive price alerts.", { parse_mode: "Markdown" }).catch(e=>{});
  });
  
  bot.onText(/\/checkprice (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const market = await getMarketData(match[1].trim(), 2);
    if (market) bot.sendMessage(chatId, `💰 Price: $${market.price}`).catch(e=>{});
    else bot.sendMessage(chatId, "❌ Price fetch failed.").catch(e=>{});
  });
  
  bot.onText(/\/trending/, async (msg) => {
    const chatId = msg.chat.id;
    const msgSend = await bot.sendMessage(chatId, "⏳ Fetching...");
    const trending = await getTrendingTokens(10);
    if (!trending.length) return bot.editMessageText("❌ No data.", { chat_id: chatId, message_id: msgSend.message_id });
    let text = "*🔥 Trending Solana Tokens*\n\n";
    trending.forEach((t, i) => {
      text += `${i+1}. *${t.symbol}* – $${parseFloat(t.price).toFixed(8)}\n   💧 $${Math.round(t.liquidity).toLocaleString()} | 📊 $${Math.round(t.volume24h).toLocaleString()}\n   📈 ${t.priceChange}%\n   [View](${t.url})\n\n`;
    });
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgSend.message_id, parse_mode: "Markdown", disable_web_page_preview: true }).catch(e=>console.error(e));
  });
  
  bot.onText(/\/add (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const address = match[1].trim();
    if (!watchlists[chatId]) watchlists[chatId] = [];
    if (!watchlists[chatId].includes(address)) {
      watchlists[chatId].push(address);
      saveData(WATCHLIST_FILE, watchlists);
      bot.sendMessage(chatId, `✅ Added \`${address.slice(0,6)}...\``, { parse_mode: "Markdown" }).catch(e=>{});
    } else bot.sendMessage(chatId, `⚠️ Already in watchlist.`).catch(e=>{});
  });
  
  bot.onText(/\/remove (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const address = match[1].trim();
    if (watchlists[chatId]?.includes(address)) {
      watchlists[chatId] = watchlists[chatId].filter(a => a !== address);
      saveData(WATCHLIST_FILE, watchlists);
      bot.sendMessage(chatId, `🗑 Removed \`${address.slice(0,6)}...\``, { parse_mode: "Markdown" }).catch(e=>{});
    } else bot.sendMessage(chatId, `❌ Not found.`).catch(e=>{});
  });
  
  bot.onText(/\/watchlist/, async (msg) => {
    const chatId = msg.chat.id;
    const list = watchlists[chatId] || [];
    if (!list.length) return bot.sendMessage(chatId, "📭 Empty.").catch(e=>{});
    let text = "*📋 Your Watchlist*\n\n";
    for (let addr of list.slice(0, 15)) {
      const market = await getMarketData(addr);
      if (market) text += `\`${addr.slice(0,6)}...\` – $${market.price} | ${market.priceChange24h}%\n`;
      else text += `\`${addr.slice(0,6)}...\` – (no data)\n`;
    }
    bot.sendMessage(chatId, text, { parse_mode: "Markdown" }).catch(e=>{});
  });
  
  bot.onText(/\/myalerts/, (msg) => {
    const chatId = msg.chat.id;
    const userAlerts = alerts[chatId] || {};
    const entries = Object.entries(userAlerts);
    if (entries.length === 0) return bot.sendMessage(chatId, "📭 No active alerts.").catch(e=>{});
    
    // Send each alert as a separate message with a Cancel button
    bot.sendMessage(chatId, `*🔔 Your Active Alerts (${entries.length}):*`, { parse_mode: "Markdown" }).catch(e=>{});
    for (let [addr, { price, direction }] of entries) {
      const dirEmoji = direction === 'above' ? '📈' : '📉';
      bot.sendMessage(chatId,
        `${dirEmoji} *${direction.toUpperCase()}* Alert\n📍 Token: \`${addr.slice(0,8)}...\`\n💰 Target: *$${price}*`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: `❌ Cancel This Alert`, callback_data: `cancel_alert:${addr}` }]
            ]
          }
        }
      ).catch(e=>{});
    }
  });
  
  bot.onText(/\/removealert (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const address = match[1].trim();
    if (alerts[chatId]?.[address]) {
      delete alerts[chatId][address];
      saveData(ALERTS_FILE, alerts);
      bot.sendMessage(chatId, `🗑 Removed alert for \`${address.slice(0,6)}...\``, { parse_mode: "Markdown" }).catch(e=>{});
    } else bot.sendMessage(chatId, `❌ No active alert.`).catch(e=>{});
  });
  
  bot.onText(/\/alerts (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const parts = match[1].trim().split(/\s+/);
    if (parts.length < 2) return bot.sendMessage(chatId, "❌ Usage: `/alerts <address> <price> [above|below]`", { parse_mode: "Markdown" }).catch(e=>{});
    const address = parts[0];
    const targetPrice = parseFloat(parts[1]);
    let direction = (parts[2] || 'above').toLowerCase();
    if (direction !== 'above' && direction !== 'below') direction = 'above';
    if (isNaN(targetPrice)) return bot.sendMessage(chatId, "❌ Invalid price.").catch(e=>{});
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return bot.sendMessage(chatId, "❌ Invalid address.").catch(e=>{});
    if (!alerts[chatId]) alerts[chatId] = {};
    alerts[chatId][address] = { price: targetPrice, direction };
    saveData(ALERTS_FILE, alerts);
    sendNotificationReminder(chatId);
    bot.sendMessage(chatId, `🔔 Alert set for \`${address.slice(0,6)}...\` at $${targetPrice} (${direction}).`, { parse_mode: "Markdown" }).catch(e=>{});
    const market = await getMarketData(address);
    if (market) {
      let already = (direction === 'above' && market.price >= targetPrice) || (direction === 'below' && market.price <= targetPrice);
      if (already) {
        bot.sendMessage(chatId, `⚠️ Price already meets condition! Current: $${market.price}. Alert triggered.`).catch(e=>{});
        const options = {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "🔇 Stop Sound", callback_data: "stop_sound" }]]
          }
        };
        bot.sendMessage(chatId, `🚨 *PRICE ALERT!*\nToken: \`${address.slice(0,6)}...\`\nDirection: ${direction}\nTarget: $${targetPrice}\nCurrent: $${market.price}\n\n[View Chart](${market.chartUrl})`, options).catch(e=>{});
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
    let response = `🔍 *Token:* \`${address.slice(0,6)}...\`\n\n`;
    if (market) {
      response += `💰 Price: $${market.price}\n💧 Liquidity: ${market.liquidity ? `$${Math.round(market.liquidity).toLocaleString()}` : "N/A"}\n📊 24h Vol: ${market.volume24h ? `$${Math.round(market.volume24h).toLocaleString()}` : "N/A"}\n📈 24h Change: ${market.priceChange24h ? `${market.priceChange24h}%` : "N/A"}\n🏦 Market Cap: ${market.marketCap ? `$${Math.round(market.marketCap).toLocaleString()}` : "N/A"}\n🟢 Buys 24h: ${market.buyCount}\n🔴 Sells 24h: ${market.sellCount}\n\n`;
    } else {
      response += `❌ No market data found.\n\n`;
    }
    response += `🎯 Risk: ${risk.score}/100 – ${risk.level}\n📋 ${risk.reasons.join("\n")}\n\n📈 [View Chart](${market?.chartUrl || `https://dexscreener.com/solana/${address}`})`;
    await bot.editMessageText(response, { chat_id: chatId, message_id: msgSend.message_id, parse_mode: "Markdown", disable_web_page_preview: true }).catch(e=>console.error(e));
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
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" }).catch(e=>{});
  });

  bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    if (data === 'stop_sound') {
      if (stopSound(chatId)) bot.sendMessage(chatId, "🔇 Sound stopped.").catch(e=>{});
      else bot.sendMessage(chatId, "No active sound to stop.").catch(e=>{});
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
          `✅ *Alert Cancelled!*\n\n📍 Token: \`${address.slice(0,8)}...\`\n📈 Direction: *${direction.toUpperCase()}*\n💰 Target was: *$${price}*\n\n_This alert has been removed._`,
          {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            parse_mode: 'Markdown'
          }
        ).catch(e => {});
        bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Alert cancelled successfully!' });
      } else {
        // Alert already triggered or doesn't exist
        bot.editMessageText(
          `⚠️ *Alert Already Removed*\n\n📍 Token: \`${address.slice(0,8)}...\`\n\n_This alert was already triggered or cancelled._`,
          {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            parse_mode: 'Markdown'
          }
        ).catch(e => {});
        bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Alert not found!' });
      }

    } else if (data === 'alert_above') {
      userStates[chatId] = 'waiting_alert_above';
      bot.sendMessage(chatId,
        "📈 *Set Alert – Price Goes ABOVE*\n\nPlease send the *Token Address* and *Target Price* separated by a space.\n\nExample:\n`Dfh5DzRgSvvCFDoYc2ciTk... 0.02593`\n\n_Just paste it and send!_",
        { parse_mode: "Markdown" }
      ).catch(e=>{});
      bot.answerCallbackQuery(callbackQuery.id);

    } else if (data === 'alert_below') {
      userStates[chatId] = 'waiting_alert_below';
      bot.sendMessage(chatId,
        "📉 *Set Alert – Price Goes BELOW*\n\nPlease send the *Token Address* and *Target Price* separated by a space.\n\nExample:\n`Dfh5DzRgSvvCFDoYc2ciTk... 0.02593`\n\n_Just paste it and send!_",
        { parse_mode: "Markdown" }
      ).catch(e=>{});
      bot.answerCallbackQuery(callbackQuery.id);

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
        ).catch(e=>{});
      }
      if (soundExists) bot.sendMessage(chatId, guideMsg, { parse_mode: "Markdown" }).catch(e=>{});
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  if (!fs.existsSync("./sounds")) fs.mkdirSync("./sounds");
  console.log("✅ APIs ready");
  console.log("✅ Health check at /health");
});