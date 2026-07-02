/**
 * subscription.js — Frontend Subscription Logic
 * HVBS Solana Subscription Alert System
 * No secrets in this file. All env vars are server-side.
 */

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const BACKEND_URL    = window.location.origin;   // Render backend URL auto-detected
const ADMIN_WALLET   = "DKaLRLF17JeAnHpYsBgRZnNVFPnKC2gnDn5cHUtLMsAz";
const SUB_PRICE_USD  = 3;                         // $3/month

// USDC & USDT Mint addresses (Solana mainnet)
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

// ─── STATE ────────────────────────────────────────────────────────────────────
let walletAddress   = null;
let selectedCurrency = "SOL";
let solPrice        = 0;

// HVBS Extension ID (Pasted actual Chrome Extension ID from developer console)
const HVBS_EXTENSION_ID = "kcnpmhpeadncriproeagjmgdijblhhjek";

// ─── PHANTOM / HVBS WALLET CONNECT ─────────────────────────────────────────────
async function connectWallet() {
  // 1. Try to connect to our custom HVBS Extension first
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(HVBS_EXTENSION_ID, { type: "CONNECT_WALLET" }, (res) => {
          // Check for lastError to prevent uncaught runtime errors if ID doesn't exist
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(res);
          }
        });
      });
      if (response && response.success) {
        walletAddress = response.walletAddress;
        onWalletConnected(walletAddress);
        showToast("✅ HVBS Wallet Connected!", "success");
        return walletAddress;
      }
    } catch (e) {
      console.log("HVBS extension not active or pending unlock, falling back to Phantom.");
    }
  }

  // 2. Fallback to Phantom Wallet if HVBS extension is not present/unlocked
  if (typeof window.solana === "undefined" || !window.solana.isPhantom) {
    showToast("⚠️ Wallet not found! Please install Phantom or HVBS Wallet.", "error");
    window.open("https://phantom.app/", "_blank");
    return null;
  }
  try {
    const response = await window.solana.connect();
    walletAddress = response.publicKey.toString();
    onWalletConnected(walletAddress);
    return walletAddress;
  } catch (err) {
    showToast("❌ Wallet connection cancelled", "error");
    return null;
  }
}

async function disconnectWallet() {
  if (window.solana) {
    await window.solana.disconnect();
  }
  walletAddress = null;
  onWalletDisconnected();
}

// Auto-reconnect on page load
async function autoConnect() {
  if (typeof window.solana !== "undefined" && window.solana.isPhantom) {
    try {
      const response = await window.solana.connect({ onlyIfTrusted: true });
      walletAddress = response.publicKey.toString();
      onWalletConnected(walletAddress);
    } catch (e) { /* not previously connected */ }
  }
}

// ─── WALLET EVENT CALLBACKS ───────────────────────────────────────────────────
function onWalletConnected(address) {
  // Update all connect buttons
  document.querySelectorAll("[data-connect-btn]").forEach(btn => {
    btn.textContent = address.slice(0, 4) + "..." + address.slice(-4);
    btn.classList.add("connected");
  });
  document.querySelectorAll("[data-wallet-address]").forEach(el => {
    el.textContent = address;
  });
  document.querySelectorAll("[data-show-connected]").forEach(el => {
    el.style.display = "block";
  });
  document.querySelectorAll("[data-hide-connected]").forEach(el => {
    el.style.display = "none";
  });

  // Check subscription status
  checkSubscriptionStatus(address);

  // Check admin
  if (address === ADMIN_WALLET) {
    document.querySelectorAll("[data-admin-only]").forEach(el => {
      el.style.display = "block";
    });
  }
}

function onWalletDisconnected() {
  document.querySelectorAll("[data-connect-btn]").forEach(btn => {
    btn.textContent = "Connect Wallet";
    btn.classList.remove("connected");
  });
  document.querySelectorAll("[data-show-connected]").forEach(el => {
    el.style.display = "none";
  });
  document.querySelectorAll("[data-hide-connected]").forEach(el => {
    el.style.display = "block";
  });
  document.querySelectorAll("[data-sub-status]").forEach(el => {
    el.textContent = "";
  });
}

// ─── SUBSCRIPTION STATUS CHECK ────────────────────────────────────────────────
async function checkSubscriptionStatus(address) {
  try {
    const res = await fetch(`${BACKEND_URL}/subscription-status?wallet=${address}`);
    const data = await res.json();

    document.querySelectorAll("[data-sub-status]").forEach(el => {
      if (data.active) {
        el.innerHTML = `<span class="badge-pro">✅ PRO Active — expires ${new Date(data.expiresAt).toLocaleDateString()}</span>`;
      } else {
        el.innerHTML = `<span class="badge-free">⚡ Free Plan</span>`;
      }
    });

    // Save to localStorage for quick access
    localStorage.setItem("sub_status", JSON.stringify(data));
    return data;
  } catch (e) {
    console.error("Subscription check failed:", e);
    return { active: false };
  }
}

// ─── FETCH SOL PRICE ─────────────────────────────────────────────────────────
async function fetchSolPrice() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const data = await res.json();
    solPrice = data.solana?.usd || 0;
    return solPrice;
  } catch (e) {
    // Fallback to Jupiter
    try {
      const jupRes = await fetch("https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112");
      const jupData = await jupRes.json();
      solPrice = parseFloat(jupData.data?.["So11111111111111111111111111111111111111112"]?.price) || 0;
      return solPrice;
    } catch (e2) { return 0; }
  }
}

// ─── CALCULATE PAYMENT AMOUNT ─────────────────────────────────────────────────
async function getPaymentAmount(currency) {
  const price = await fetchSolPrice();
  if (currency === "SOL") {
    if (!price || price === 0) return null;
    return (SUB_PRICE_USD / price).toFixed(6);
  }
  // USDC and USDT are 1:1 USD (6 decimals)
  return SUB_PRICE_USD.toFixed(2);
}

// ─── SEND PAYMENT TRANSACTION ─────────────────────────────────────────────────
async function sendPayment(recipientAddress, currency) {
  if (!walletAddress) {
    showToast("Please connect your wallet first", "error");
    return null;
  }

  const amount = await getPaymentAmount(currency);
  if (!amount) {
    showToast("Could not fetch SOL price. Try again.", "error");
    return null;
  }

  try {
    // Build transaction via backend
    const buildRes = await fetch(`${BACKEND_URL}/build-payment-tx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: walletAddress, currency, amount })
    });
    const buildData = await buildRes.json();
    if (!buildData.success) throw new Error(buildData.error);

    // Deserialize transaction
    const txBuffer = Buffer.from(buildData.transaction, "base64");

    // Sign and send via Phantom
    const signed = await window.solana.signAndSendTransaction(
      new Uint8Array(txBuffer)
    );
    return signed.signature;
  } catch (err) {
    // Fallback: simple SOL transfer (for SOL payments)
    if (currency === "SOL") {
      return await sendSolPayment(recipientAddress, amount);
    }
    throw err;
  }
}

// Fallback SOL transfer using @solana/web3.js CDN
async function sendSolPayment(recipient, solAmount) {
  const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } =
    window.solanaWeb3 || {};
  if (!Connection) throw new Error("Solana Web3.js not loaded");

  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const fromPub = new PublicKey(walletAddress);
  const toPub = new PublicKey(recipient);
  const lamports = Math.round(parseFloat(solAmount) * LAMPORTS_PER_SOL);

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: fromPub });
  tx.add(SystemProgram.transfer({ fromPubkey: fromPub, toPubkey: toPub, lamports }));

  const signed = await window.solana.signAndSendTransaction(tx);
  return signed.signature;
}

// ─── VERIFY PAYMENT ──────────────────────────────────────────────────────────
async function verifyPayment(txSignature, currency, showUI = true) {
  if (showUI) showLoadingOverlay("Verifying payment on-chain…");
  try {
    const res = await fetch(`${BACKEND_URL}/verify-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: walletAddress, txSignature, currency })
    });
    const data = await res.json();
    if (showUI) hideLoadingOverlay();
    return data;
  } catch (e) {
    if (showUI) hideLoadingOverlay();
    return { success: false, error: e.message };
  }
}

// ─── ADMIN: SIGNED MESSAGE AUTH ───────────────────────────────────────────────
async function signAdminMessage() {
  if (!walletAddress || walletAddress !== ADMIN_WALLET) {
    showToast("❌ Not authorized as admin", "error");
    return null;
  }
  const message = `HVBS-Admin-Auth-${Date.now()}`;
  const encodedMessage = new TextEncoder().encode(message);
  try {
    const { signature } = await window.solana.signMessage(encodedMessage, "utf8");
    const sigBase64 = btoa(String.fromCharCode(...signature));
    return { message, signature: sigBase64, wallet: walletAddress };
  } catch (e) {
    showToast("❌ Signature rejected", "error");
    return null;
  }
}

// ─── BURN STATS ───────────────────────────────────────────────────────────────
async function loadBurnStats() {
  try {
    const res = await fetch(`${BACKEND_URL}/burn-stats`);
    const data = await res.json();
    document.querySelectorAll("[data-burn-total]").forEach(el => {
      el.textContent = Number(data.totalBurned || 0).toLocaleString();
    });
    document.querySelectorAll("[data-burn-usd]").forEach(el => {
      el.textContent = "$" + Number(data.totalUsdBurned || 0).toFixed(2);
    });
    document.querySelectorAll("[data-burn-txs]").forEach(el => {
      el.textContent = data.burnCount || 0;
    });
    return data;
  } catch (e) { return {}; }
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function showToast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:99999;
      display:flex;flex-direction:column;gap:8px;`;
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  const colors = { info:"#3b82f6", success:"#10b981", error:"#ef4444", warning:"#f59e0b" };
  toast.style.cssText = `
    background:${colors[type]||colors.info};color:#fff;
    padding:12px 20px;border-radius:12px;font-size:14px;
    box-shadow:0 4px 20px rgba(0,0,0,.4);max-width:320px;
    animation:slideIn .3s ease;font-family:inherit;`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; toast.style.transition = "opacity .3s"; setTimeout(() => toast.remove(), 300); }, 3500);
}

function showLoadingOverlay(msg = "Processing…") {
  let overlay = document.getElementById("loading-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "loading-overlay";
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.7);
      display:flex;align-items:center;justify-content:center;z-index:99998;
      flex-direction:column;gap:16px;`;
    overlay.innerHTML = `
      <div style="width:48px;height:48px;border:4px solid #a855f7;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></div>
      <p id="loading-msg" style="color:#fff;font-size:16px;font-family:inherit;">${msg}</p>`;
    document.body.appendChild(overlay);
  } else {
    document.getElementById("loading-msg").textContent = msg;
    overlay.style.display = "flex";
  }
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.style.display = "none";
}

// Add CSS animations
const styleTag = document.createElement("style");
styleTag.textContent = `
@keyframes slideIn { from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)} }
@keyframes spin    { to{transform:rotate(360deg)} }
.badge-pro  { background:#10b981;color:#fff;padding:4px 12px;border-radius:20px;font-size:13px; }
.badge-free { background:#6b7280;color:#fff;padding:4px 12px;border-radius:20px;font-size:13px; }
[data-connect-btn].connected { background:linear-gradient(135deg,#10b981,#059669)!important; }
`;
document.head.appendChild(styleTag);

// ─── AUTO-INIT ────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  autoConnect();

  // Wire up all connect buttons
  document.querySelectorAll("[data-connect-btn]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (walletAddress) disconnectWallet();
      else connectWallet();
    });
  });
});

// Expose globals
window.HVBS = {
  connectWallet, disconnectWallet, checkSubscriptionStatus,
  verifyPayment, sendPayment, loadBurnStats, signAdminMessage,
  getPaymentAmount, fetchSolPrice,
  get walletAddress() { return walletAddress; },
  get selectedCurrency() { return selectedCurrency; },
  set selectedCurrency(v) { selectedCurrency = v; }
};
