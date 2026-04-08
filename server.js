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

// 🔐 YOUR KEYS
const TELEGRAM_BOT_TOKEN = "8550627220:AAEbfPYDOCz64sAeTo4GUrm88mNgwsUTiEQ";
const CMC_API_KEY = "2e4699c5c9614df5801eed04b36ba057";

const DEXSCREENER_TOKEN_PAIRS = "https://api.dexscreener.com/token-pairs/v1/solana/";
const DEXSCREENER_SEARCH      = "https://api.dexscreener.com/latest/dex/search?q=";
const TRENDING_API            = "https://api.dexscreener.com/latest/dex/search?q=solana";
const JUPITER_PRICE_API       = "https://api.jup.ag/price/v2?ids=";
const COINGECKO_SEARCH        = "https://api.coingecko.com/api/v3/search?query=";
const COINGECKO_COIN_DATA     = "https://api.coingecko.com/api/v3/coins/";
const GECKO_TERMINAL_API      = "https://api.geckoterminal.com/api/v2/networks/solana/tokens/";
const SOLSCAN_TOPHOLDERS      = "https://api.solscan.io/v2/token/holders?tokenAddress=";

const ALERTS_FILE       = "./alerts.json";
const WATCHLIST_FILE    = "./watchlist.json";
const USERNAME_MAP_FILE = "./username_chatid_map.json";
const MUTE_FILE         = "./muted_users.json";

function loadData(file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file));
  return {};
}
function saveData(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let alerts           = loadData(ALERTS_FILE);
let watchlists       = loadData(WATCHLIST_FILE);
let usernameChatIdMap = loadData(USERNAME_MAP_FILE);
let mutedUsers       = loadData(MUTE_FILE);

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
if (TELEGRAM_BOT_TOKEN !== "YOUR_BOT_TOKEN_HERE") {
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  console.log("🤖 Telegram bot started");
}

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
    if (process.platform === "win32")       playerProcess = exec(`start "" "${soundFile}"`);
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

// ✅ FIXED: Alert ke saath Telegram par VOICE MESSAGE bhejo (OGG Opus = auto-play hota hai)
function sendAlertSound(chatId) {
  if (!bot) return;

  // Priority 1: User-specific OGG voice file check karo
  const soundDir = "./sounds";
  const userOgg = path.join(soundDir, `${chatId}.ogg`);
  const userMp3 = path.join(soundDir, `${chatId}.mp3`);
  const userWav = path.join(soundDir, `${chatId}.wav`);
  const userM4a = path.join(soundDir, `${chatId}.m4a`);

  // Priority 2: Global default beep files
  const defaultOgg = "./beep.ogg";
  const defaultMp3 = "./beep.mp3";

  // ✅ sendVoice() use karo — OGG Opus file auto-play hoti hai Telegram mein
  // sendAudio() = manual play, sendVoice() = auto-play with notification sound

  if (fs.existsSync(userOgg)) {
    // User ka custom OGG voice file
    bot.sendVoice(chatId, fs.createReadStream(userOgg), {
      caption: "🔊 Price Alert!"
    }).catch(e => {
      console.log("User voice send error:", e.message);
      _sendFallbackAudio(chatId, defaultOgg, defaultMp3);
    });
  } else if (fs.existsSync(defaultOgg)) {
    // ✅ Default beep.ogg — ye auto-play hogi
    bot.sendVoice(chatId, fs.createReadStream(defaultOgg), {
      caption: "🔊 Price Alert!"
    }).catch(e => {
      console.log("Default voice send error:", e.message);
      // Fallback to MP3 audio
      if (fs.existsSync(defaultMp3)) {
        bot.sendAudio(chatId, fs.createReadStream(defaultMp3), {
          caption: "🔊 Price Alert Sound"
        }).catch(err => console.log("Audio fallback error:", err.message));
      }
    });
  } else if (fs.existsSync(userMp3)) {
    bot.sendAudio(chatId, fs.createReadStream(userMp3), {
      caption: "🔊 Price Alert Sound"
    }).catch(e => console.log("User mp3 send error:", e.message));
  } else if (fs.existsSync(defaultMp3)) {
    bot.sendAudio(chatId, fs.createReadStream(defaultMp3), {
      caption: "🔊 Price Alert Sound"
    }).catch(e => console.log("Default mp3 send error:", e.message));
  } else if (fs.existsSync(userWav) || fs.existsSync(userM4a)) {
    const f = fs.existsSync(userWav) ? userWav : userM4a;
    bot.sendAudio(chatId, fs.createReadStream(f), {
      caption: "🔊 Price Alert Sound"
    }).catch(e => console.log("Alt audio send error:", e.message));
  } else {
    console.log("⚠️ No sound file found. beep.ogg ya beep.mp3 project folder mein rakhein.");
  }

  // Server-side beep bhi (optional, server par bajega)
  playSound(chatId);
}

// Internal helper for fallback
function _sendFallbackAudio(chatId, oggPath, mp3Path) {
  if (fs.existsSync(oggPath)) {
    bot.sendVoice(chatId, fs.createReadStream(oggPath), {
      caption: "🔊 Price Alert!"
    }).catch(e => console.log("Fallback voice error:", e.message));
  } else if (fs.existsSync(mp3Path)) {
    bot.sendAudio(chatId, fs.createReadStream(mp3Path), {
      caption: "🔊 Price Alert Sound"
    }).catch(e => console.log("Fallback audio error:", e.message));
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
  if (!bot) return;
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

          // ✅ Pehle text alert bhejo
          bot.sendMessage(chatId,
            `🚨 *PRICE ALERT!*\nToken: \`${addr.slice(0,6)}...\`\nDirection: ${direction}\nTarget: $${targetPrice}\nCurrent: $${market.price}\n\n[View Chart](${market.chartUrl})`,
            options
          );

          // ✅ Phir VOICE MESSAGE bhejo — OGG Opus = auto-play hoga Telegram mein
          sendAlertSound(chatId);

          delete alerts[chatId][addr];
          saveData(ALERTS_FILE, alerts);
        }
      }
    }
  }
}
setInterval(checkAllAlerts, 10000);

// ========== MAIN API ENDPOINT ==========
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
  if (!chatId) return res.status(404).json({ success: false, error: "Username not found. Please join the bot first by clicking the join button, then send /start to @hvbs_scanner_bot." });
  const price = parseFloat(targetPrice);
  if (isNaN(price)) return res.status(400).json({ success: false, error: "Invalid price" });
  const dir = (direction || 'above').toLowerCase();
  if (!alerts[chatId]) alerts[chatId] = {};
  alerts[chatId][tokenAddress] = { price, direction: dir };
  saveData(ALERTS_FILE, alerts);
  if (bot) {
    if (mutedUsers[chatId]) {
      bot.sendMessage(chatId, `🔔 *Alert Set via Web!*\nToken: \`${tokenAddress.slice(0,6)}...\`\nTarget: $${price} (${dir})\n\n⚠️ *Your alerts are currently muted.* You will not receive notifications. Use /unmute to enable alerts.`, { parse_mode: "Markdown" });
    } else {
      bot.sendMessage(chatId, `🔔 *Alert Set via Web!*\nToken: \`${tokenAddress.slice(0,6)}...\`\nTarget: $${price} (${dir})\n\nYou will receive a Telegram message + sound when this hits!`, { parse_mode: "Markdown" });
    }
  }
  res.json({ success: true, message: `Alert set for @${cleanUsername}` });
});

// ========== SOUND ENDPOINTS ==========
app.post("/api/upload-sound/:chatId", upload.single("sound"), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No file" });
  const chatId = req.params.chatId;
  const exts = [".mp3", ".wav", ".m4a", ".ogg"];
  for (let ext of exts) {
    const oldPath = path.join("./sounds", `${chatId}${ext}`);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  res.json({ success: true });
});

app.get("/api/sound-status/:chatId", (req, res) => {
  const chatId = req.params.chatId;
  let hasCustom = false;
  for (let ext of [".mp3", ".wav", ".m4a", ".ogg"]) {
    if (fs.existsSync(path.join("./sounds", `${chatId}${ext}`))) { hasCustom = true; break; }
  }
  res.json({ hasCustom, isPlaying: !!activeSounds[chatId] });
});

app.post("/api/stop-sound/:chatId", (req, res) => {
  const stopped = stopSound(req.params.chatId);
  res.json({ success: stopped, message: stopped ? "Sound stopped" : "No active sound" });
});

// ========== TELEGRAM BOT HANDLERS ==========
if (bot) {
  const notificationReminded = {};
  function sendNotificationReminder(chatId) {
    if (!notificationReminded[chatId]) {
      bot.sendMessage(chatId, "🔔 *Notification Reminder*\n\nTo receive price alerts with sound, please ensure Telegram notifications are enabled on your device.\n\nGo to Telegram Settings → Notifications and Sounds → Enable for this bot.\n\nYou can also mute/unmute alerts using:\n`/mute` – disable all alerts\n`/unmute` – enable alerts\n\n_This message will not appear again._", { parse_mode: "Markdown" });
      notificationReminded[chatId] = true;
    }
  }

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    if (username) {
      usernameChatIdMap[chatId] = username.toLowerCase();
      saveData(USERNAME_MAP_FILE, usernameChatIdMap);
    }
    bot.sendMessage(chatId,
      `🚀 *HVBS Pro Bot*\n\n✅ You are now registered!\nUsername: @${username || "unknown"}\nChat ID: \`${chatId}\`\n\n*Commands:*\n/trending\n/search <symbol>\n/alerts <address> <price> [above|below]\n/forcecheck\n/testbeep\n/mute – Disable all price alerts\n/unmute – Enable price alerts\n/myalerts\n/clearalerts\n/removealert <address>\n/checkprice <address>\n/stopsound\n/watchlist\n/add <address>\n/remove <address>\n/setalert – Set custom notification sound`,
      { parse_mode: "Markdown" }
    );
    setTimeout(() => sendNotificationReminder(chatId), 2000);
  });

  bot.on('message', (msg) => {
    const username = msg.from?.username;
    const chatId = msg.chat.id;
    if (username && !usernameChatIdMap[chatId]) {
      usernameChatIdMap[chatId] = username.toLowerCase();
      saveData(USERNAME_MAP_FILE, usernameChatIdMap);
    }
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `📖 *Help*\n• /search pippin\n• /alerts So111... 0.02 above\n• /forcecheck\n• /testbeep\n• /mute – turn off alerts\n• /unmute – turn on alerts\n• /stopsound\n• /setalert – set custom notification sound`, { parse_mode: "Markdown" });
  });

  // ✅ FIXED: /testbeep bhi voice message bhejta hai
  bot.onText(/\/testbeep/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🔊 Testing alert sound...");
    sendAlertSound(chatId);
  });

  bot.onText(/\/forcecheck/, async (msg) => {
    await checkAllAlerts();
    bot.sendMessage(msg.chat.id, "✅ Force check done.");
  });

  bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const result = await searchTokenBySymbol(match[1].trim());
    if (result?.address) {
      bot.sendMessage(chatId, `🔍 *Found:* ${result.symbol}\nAddress: \`${result.address}\`\nPrice: $${result.price}\n[View](${result.url})`, { parse_mode: "Markdown" });
    } else {
      bot.sendMessage(chatId, `❌ No token found for "${match[1].trim()}".`);
    }
  });

  bot.onText(/\/clearalerts/, (msg) => {
    const chatId = msg.chat.id;
    if (alerts[chatId]) { delete alerts[chatId]; saveData(ALERTS_FILE, alerts); bot.sendMessage(chatId, "✅ All alerts cleared."); }
    else bot.sendMessage(chatId, "📭 No active alerts.");
  });

  bot.onText(/\/stopsound/, (msg) => {
    const chatId = msg.chat.id;
    if (stopSound(chatId)) bot.sendMessage(chatId, "🔇 Sound stopped.");
    else bot.sendMessage(chatId, "No active sound.");
  });

  bot.onText(/\/mute/, (msg) => {
    const chatId = msg.chat.id;
    mutedUsers[chatId] = true;
    saveData(MUTE_FILE, mutedUsers);
    bot.sendMessage(chatId, "🔇 *Alerts muted.* You will no longer receive price alerts. Use /unmute to enable again.", { parse_mode: "Markdown" });
  });

  bot.onText(/\/unmute/, (msg) => {
    const chatId = msg.chat.id;
    delete mutedUsers[chatId];
    saveData(MUTE_FILE, mutedUsers);
    bot.sendMessage(chatId, "🔔 *Alerts unmuted.* You will now receive price alerts.", { parse_mode: "Markdown" });
  });

  bot.onText(/\/checkprice (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const market = await getMarketData(match[1].trim(), 2);
    if (market) bot.sendMessage(chatId, `💰 Price: $${market.price}`);
    else bot.sendMessage(chatId, "❌ Price fetch failed.");
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
    await bot.editMessageText(text, { chat_id: chatId, message_id: msgSend.message_id, parse_mode: "Markdown", disable_web_page_preview: true });
  });

  bot.onText(/\/add (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const address = match[1].trim();
    if (!watchlists[chatId]) watchlists[chatId] = [];
    if (!watchlists[chatId].includes(address)) {
      watchlists[chatId].push(address);
      saveData(WATCHLIST_FILE, watchlists);
      bot.sendMessage(chatId, `✅ Added \`${address.slice(0,6)}...\``, { parse_mode: "Markdown" });
    } else bot.sendMessage(chatId, `⚠️ Already in watchlist.`);
  });

  bot.onText(/\/remove (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const address = match[1].trim();
    if (watchlists[chatId]?.includes(address)) {
      watchlists[chatId] = watchlists[chatId].filter(a => a !== address);
      saveData(WATCHLIST_FILE, watchlists);
      bot.sendMessage(chatId, `🗑 Removed \`${address.slice(0,6)}...\``, { parse_mode: "Markdown" });
    } else bot.sendMessage(chatId, `❌ Not found.`);
  });

  bot.onText(/\/watchlist/, async (msg) => {
    const chatId = msg.chat.id;
    const list = watchlists[chatId] || [];
    if (!list.length) return bot.sendMessage(chatId, "📭 Empty.");
    let text = "*📋 Your Watchlist*\n\n";
    for (let addr of list.slice(0, 15)) {
      const market = await getMarketData(addr);
      if (market) text += `\`${addr.slice(0,6)}...\` – $${market.price} | ${market.priceChange24h}%\n`;
      else text += `\`${addr.slice(0,6)}...\` – (no data)\n`;
    }
    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  bot.onText(/\/myalerts/, (msg) => {
    const chatId = msg.chat.id;
    const userAlerts = alerts[chatId] || {};
    const entries = Object.entries(userAlerts);
    if (entries.length === 0) return bot.sendMessage(chatId, "📭 No active alerts.");
    let text = "*🔔 Your active alerts:*\n\n";
    for (let [addr, { price, direction }] of entries) {
      text += `• \`${addr.slice(0,6)}...\` – $${price} (${direction})\n`;
    }
    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  bot.onText(/\/removealert (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const address = match[1].trim();
    if (alerts[chatId]?.[address]) {
      delete alerts[chatId][address];
      saveData(ALERTS_FILE, alerts);
      bot.sendMessage(chatId, `🗑 Removed alert for \`${address.slice(0,6)}...\``, { parse_mode: "Markdown" });
    } else bot.sendMessage(chatId, `❌ No active alert.`);
  });

  bot.onText(/\/alerts (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const parts = match[1].trim().split(/\s+/);
    if (parts.length < 2) return bot.sendMessage(chatId, "❌ Usage: `/alerts <address> <price> [above|below]`", { parse_mode: "Markdown" });
    const address = parts[0];
    const targetPrice = parseFloat(parts[1]);
    let direction = (parts[2] || 'above').toLowerCase();
    if (direction !== 'above' && direction !== 'below') direction = 'above';
    if (isNaN(targetPrice)) return bot.sendMessage(chatId, "❌ Invalid price.");
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return bot.sendMessage(chatId, "❌ Invalid address.");
    if (!alerts[chatId]) alerts[chatId] = {};
    alerts[chatId][address] = { price: targetPrice, direction };
    saveData(ALERTS_FILE, alerts);
    sendNotificationReminder(chatId);
    bot.sendMessage(chatId, `🔔 Alert set for \`${address.slice(0,6)}...\` at $${targetPrice} (${direction}).`, { parse_mode: "Markdown" });
    const market = await getMarketData(address);
    if (market) {
      let already = (direction === 'above' && market.price >= targetPrice) || (direction === 'below' && market.price <= targetPrice);
      if (already) {
        bot.sendMessage(chatId, `⚠️ Price already meets condition! Current: $${market.price}. Alert triggered.`);
        const options = {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "🔇 Stop Sound", callback_data: "stop_sound" }]]
          }
        };
        bot.sendMessage(chatId,
          `🚨 *PRICE ALERT!*\nToken: \`${address.slice(0,6)}...\`\nDirection: ${direction}\nTarget: $${targetPrice}\nCurrent: $${market.price}\n\n[View Chart](${market.chartUrl})`,
          options
        );
        // ✅ Voice message bhejo
        sendAlertSound(chatId);
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
    await bot.editMessageText(response, { chat_id: chatId, message_id: msgSend.message_id, parse_mode: "Markdown", disable_web_page_preview: true });
  });

  // ✅ FIXED: /setalert — ReadStream use karo, file path nahi
  bot.onText(/\/setalert/, (msg) => {
    const chatId = msg.chat.id;
    const voicePath = './beep.ogg';
    if (!fs.existsSync(voicePath)) {
      bot.sendMessage(chatId, "❌ Voice file not found. Please ensure beep.ogg exists in the server folder.");
      return;
    }
    bot.sendVoice(chatId, fs.createReadStream(voicePath), {
      caption: "🔊 *Ye tumhara alert sound hai!*\n\n📱 *Phone par notification sound set karne ke liye:*\n1️⃣ Is voice message ko tap karo\n2️⃣ Upar ⋮ (teen dots) tap karo\n3️⃣ *'Set as notification sound'* select karo\n\n✅ Iske baad jab bhi price alert aayega, ye sound bajega!",
      parse_mode: "Markdown"
    }).catch(err => {
      console.error("Voice send error:", err.message);
      bot.sendMessage(chatId, "❌ Voice file send karne mein error. Check karo beep.ogg sahi OGG Opus format mein hai.");
    });
  });

  // Callback query handler
  bot.on('callback_query', (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    if (data === 'stop_sound') {
      if (stopSound(chatId)) {
        bot.sendMessage(chatId, "🔇 Sound stopped.");
      } else {
        bot.sendMessage(chatId, "No active sound to stop.");
      }
      bot.answerCallbackQuery(callbackQuery.id);
    } else if (data === 'test_stop') {
      bot.answerCallbackQuery(callbackQuery.id, { text: "Test button works!", show_alert: false });
      bot.sendMessage(chatId, "Test button received!");
    }
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  if (!fs.existsSync("./sounds")) fs.mkdirSync("./sounds");
  console.log("✅ APIs: DexScreener v2 + Jupiter v2 + GeckoTerminal + CoinGecko + TopHolders + BuyersSellers");
  console.log("✅ Fix: Alert sound ab sendVoice() se bheja jaata hai — OGG Opus auto-play hoga Telegram mein");
});
