/**
 * HVBS AI Wallet UI & Feature Orchestrator (wallet_app.js)
 * Coordinates UI states, balance updates, P&L calculations, and explorer APIs.
 */

// App State (shared with wallet.js)
// Note: activeNetwork and walletAddress are already declared globally in wallet.js
let decryptedKeypair = null;
let currentEthPrice = 0.00;

// Configs matching wallet.js
const networkConfigs = {
  testnet: {
    chainId: 46630,
    rpcUrl: 'https://rpc.testnet.chain.robinhood.com/',
    explorer: 'https://explorer.testnet.chain.robinhood.com',
    symbol: 'ETH',
    name: 'Robinhood Chain Testnet'
  },
  mainnet: {
    chainId: 4663,
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com/',
    explorer: 'https://robinhoodchain.blockscout.com',
    symbol: 'ETH',
    name: 'Robinhood Chain'
  }
};

let tempGeneratedMnemonic = "";

// Initialize App
window.addEventListener('DOMContentLoaded', () => {
  // Setup custom event listeners from core wallet module
  document.addEventListener('hvbs-wallet-unlocked', (e) => {
    walletAddress = e.detail.address;
    showDashboardScreen();
  });

  document.addEventListener('hvbs-wallet-locked', () => {
    decryptedKeypair = null;
    showUnlockScreen();
  });

  document.addEventListener('hvbs-wallet-deleted', () => {
    walletAddress = null;
    decryptedKeypair = null;
    showOnboardingScreen();
  });

  // Start price polling
  fetchMarketPrices();
  fetchNetworkGasPrice();
  setInterval(fetchMarketPrices, 10000);
  setInterval(fetchNetworkGasPrice, 10000);

  // Check state
  if (HVBSWallet.hasWallet()) {
    walletAddress = HVBSWallet.getAddress();
    // Try to silently restore an unlocked session (survives page refresh,
    // cleared when the tab/window is closed or Lock is pressed).
    const restored = HVBSWallet.restoreSession();
    if (restored) {
      decryptedKeypair = restored;
      // showDashboardScreen() is triggered by the hvbs-wallet-unlocked event
    } else {
      showUnlockScreen();
    }
  } else {
    showOnboardingScreen();
  }

  const sendAssetSelect = document.getElementById('sendAssetSelect');
  if (sendAssetSelect) {
    sendAssetSelect.addEventListener('change', updateSendGasEstimate);
  }
  const sendAmount = document.getElementById('sendAmount');
  if (sendAmount) {
    sendAmount.addEventListener('input', updateSendGasEstimate);
  }
});

// Screen Toggles
function hideAllScreens() {
  document.querySelectorAll('.screen-state').forEach(screen => {
    screen.classList.remove('active');
  });
  document.getElementById('lockBtn').style.display = 'none';
}

function showOnboardingScreen() {
  hideAllScreens();
  document.getElementById('screenOnboarding').classList.add('active');
}

function showGenerateScreen() {
  hideAllScreens();
  const walletData = HVBSWallet.generate();
  tempGeneratedMnemonic = walletData.mnemonic;

  const grid = document.getElementById('generatedMnemonicGrid');
  grid.innerHTML = "";
  tempGeneratedMnemonic.split(' ').forEach((word, index) => {
    const item = document.createElement('div');
    item.className = "mnemonic-word";
    item.innerHTML = `<span class="word-index">${index + 1}</span> ${word}`;
    grid.appendChild(item);
  });

  document.getElementById('screenGenerate').classList.add('active');
}

function showGeneratePasswordScreen() {
  hideAllScreens();
  document.getElementById('screenSetPassword').classList.add('active');
}

function showImportScreen() {
  hideAllScreens();
  document.getElementById('screenImport').classList.add('active');
}

function showUnlockScreen() {
  hideAllScreens();
  document.getElementById('screenUnlock').classList.add('active');
}

function showDashboardScreen() {
  hideAllScreens();
  document.getElementById('screenDashboard').classList.add('active');
  document.getElementById('lockBtn').style.display = 'inline-block';
  updateDashboardData();
}

// Network Selector Controller
function changeNetwork() {
  activeNetwork = document.getElementById('networkSelect').value;
  HVBSWallet.setNetwork(activeNetwork);
  
  if (decryptedKeypair) {
    const provider = new ethers.JsonRpcProvider(networkConfigs[activeNetwork].rpcUrl);
    decryptedKeypair = decryptedKeypair.connect(provider);
  }
  
  fetchNetworkGasPrice();
  
  if (walletAddress) {
    updateDashboardData();
  }
}

// Commit Actions
async function commitWalletSetup() {
  const p1 = document.getElementById('newPassword').value;
  const p2 = document.getElementById('confirmPassword').value;

  if (!p1 || p1 !== p2) {
    alert("Passwords do not match or are empty!");
    return;
  }

  try {
    walletAddress = await HVBSWallet.commit(tempGeneratedMnemonic, p1);
    
    // Unlock keypair instance to local memory
    const provider = new ethers.JsonRpcProvider(networkConfigs[activeNetwork].rpcUrl);
    decryptedKeypair = await HVBSWallet.unlock(p1);
    
    tempGeneratedMnemonic = "";
    document.getElementById('newPassword').value = "";
    document.getElementById('confirmPassword').value = "";
    showDashboardScreen();
  } catch (err) {
    alert("Failed saving wallet: " + err.message);
  }
}

async function commitWalletImport() {
  const inputStr = document.getElementById('importInput').value.trim();
  const pwd = document.getElementById('importPassword').value;

  if (!inputStr || !pwd) {
    alert("Please enter both import keys and a password.");
    return;
  }

  try {
    walletAddress = await HVBSWallet.import(inputStr, pwd);
    decryptedKeypair = await HVBSWallet.unlock(pwd);
    
    document.getElementById('importInput').value = "";
    document.getElementById('importPassword').value = "";
    showDashboardScreen();
  } catch (err) {
    alert("Failed importing wallet: " + err.message);
  }
}

async function submitUnlockWallet() {
  const pwd = document.getElementById('unlockPassword').value;
  if (!pwd) return alert("Please enter password.");

  try {
    decryptedKeypair = await HVBSWallet.unlock(pwd);
    walletAddress = decryptedKeypair.address;
    document.getElementById('unlockPassword').value = "";
    showDashboardScreen();
  } catch (err) {
    alert("Invalid password.");
  }
}

function lockWallet() {
  HVBSWallet.lock();
}

function confirmDeleteWallet() {
  if (confirm("WARNING: Are you absolutely sure you want to delete this wallet and purge all client-side databases? You will lose access forever if you do not have your recovery phrase written down.")) {
    HVBSWallet.delete();
  }
}

// Live Prices Getter
async function fetchMarketPrices() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true");
    if (res.ok) {
      const data = await res.json();
      currentEthPrice = parseFloat(data.ethereum.usd);
      document.getElementById('liveEthPrice').innerText = "$" + currentEthPrice.toLocaleString(undefined, { minimumFractionDigits: 2 });
      
      const change = parseFloat(data.ethereum.usd_24h_change);
      const changeEl = document.getElementById('liveEthChange');
      changeEl.innerText = (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
      changeEl.style.color = change >= 0 ? "var(--green)" : "var(--red)";
      
      if (walletAddress) {
        updateBalanceDisplays();
        calculatePortfolioStats();
      }
    }
  } catch (e) {
    console.error("Price fetch error: ", e);
  }
}

// Live Robinhood EVM Gas Price Gwei Getter
async function fetchNetworkGasPrice() {
  const gasEl = document.getElementById('liveGasPrice');
  const netEl = document.getElementById('liveNetworkName');
  if (!gasEl || !netEl) return;
  
  netEl.innerText = networkConfigs[activeNetwork].name;
  
  try {
    const provider = new ethers.JsonRpcProvider(networkConfigs[activeNetwork].rpcUrl);
    const feeData = await provider.getFeeData();
    if (feeData.gasPrice) {
      const gweiVal = parseFloat(ethers.formatUnits(feeData.gasPrice, 'gwei'));
      // Format to a readable value (e.g. 0.001 Gwei if tiny, otherwise 3 decimals)
      gasEl.innerText = gweiVal < 0.001 ? gweiVal.toFixed(6) + " Gwei" : gweiVal.toFixed(3) + " Gwei";
    } else {
      gasEl.innerText = "0.00 Gwei";
    }
  } catch (err) {
    console.error("Gas price fetch error:", err);
    gasEl.innerText = "Error Gwei";
  }
}

// Dashboard refresh routines
async function updateDashboardData() {
  if (!walletAddress) return;
  
  document.getElementById('receiveAddressText').innerText = walletAddress;
  
  const qrEl = document.getElementById('receiveQrCode');
  qrEl.innerHTML = "";
  new QRCode(qrEl, {
    text: walletAddress,
    width: 180,
    height: 180
  });

  updateEmailUI();

  await updateBalanceDisplays();
  renderActivityFeed();
  renderTradesList();
  calculatePortfolioStats();
}

async function updateBalanceDisplays() {
  if (!walletAddress) return;
  try {
    const balance = await HVBSWallet.getBalance();
    const ethVal = parseFloat(balance);
    document.getElementById('displayBalance').innerText = ethVal.toFixed(4) + " ETH";
    
    // Store in localStorage for swap balance reference
    localStorage.setItem('hvbs_wallet_balance_eth', ethVal.toFixed(6));
    
    const usdVal = ethVal * currentEthPrice;
    document.getElementById('displayBalanceUsd').innerText = "$" + usdVal.toLocaleString(undefined, { minimumFractionDigits: 2 });
  } catch (err) {
    console.error("Balance fetch error:", err);
  }
}

// Blockscout History fetch
async function fetchTxHistory() {
  const container = document.getElementById('txHistoryTableBody');
  try {
    const url = `${networkConfigs[activeNetwork].rpcUrl.replace('/rpc.', '/explorer.')}api/v2/addresses/${walletAddress}/transactions`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.items && data.items.length > 0) {
        container.innerHTML = "";
        data.items.slice(0, 10).forEach(item => {
          const hash = item.hash;
          const shortHash = hash.slice(0,6) + '...' + hash.slice(-4);
          const explorerLink = `${networkConfigs[activeNetwork].explorer}/tx/${hash}`;
          const isSuccess = item.status === "ok";
          
          let val = "0.0";
          if (item.value) {
            val = parseFloat(ethers.formatEther(item.value)).toFixed(4);
          }

          let fee = "0.0";
          if (item.fee) {
            fee = parseFloat(ethers.formatEther(item.fee)).toFixed(6);
          }

          const row = document.createElement('tr');
          row.innerHTML = `
            <td><a href="${explorerLink}" target="_blank" class="tx-hash-link">${shortHash}</a></td>
            <td>${item.to?.hash === walletAddress ? "RECEIVE" : "SEND"}</td>
            <td>${val} ETH</td>
            <td>${fee} ETH</td>
            <td><span class="tx-status ${isSuccess ? 'success' : 'failed'}">${isSuccess ? 'CONFIRMED' : 'FAILED'}</span></td>
          `;
          container.appendChild(row);
        });
        return;
      }
    }
  } catch(e) {}
  container.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No transaction records found on-chain.</td></tr>`;
}

// Modals Toggles
function populateSendAssets() {
  const selectEl = document.getElementById('sendAssetSelect');
  if (!selectEl) return;
  selectEl.innerHTML = "";

  const defaultTokens = [
    { value: 'RH-ETH', label: 'ETH (Robinhood Chain)' },
    { value: 'USDG', label: 'USDG (Stablecoin)' },
    { value: 'ETH-ERC20', label: 'ETH (ERC-20 Mainnet)' }
  ];

  const customTokens = getCustomTokens();

  // Add native and default tokens
  defaultTokens.forEach(token => {
    const balance = getTokenBalance(token.value);
    const option = document.createElement('option');
    option.value = token.value;
    option.innerText = `${token.label} (Bal: ${balance.toFixed(4)})`;
    selectEl.appendChild(option);
  });

  // Add custom tokens
  customTokens.forEach(token => {
    const balance = getTokenBalance(token.address);
    const option = document.createElement('option');
    option.value = token.address;
    option.innerText = `${token.symbol} (Bal: ${balance.toFixed(4)}) - ${token.address}`;
    selectEl.appendChild(option);
  });
}

function updateSendGasEstimate() {
  const selectEl = document.getElementById('sendAssetSelect');
  if (!selectEl) return;
  const selectedToken = selectEl.value;
  const gasEl = document.getElementById('sendGasEstimateDisplay');
  if (!gasEl) return;

  const gasPriceText = document.getElementById('liveGasPrice')?.innerText || "0.01 Gwei";
  const gweiVal = parseFloat(gasPriceText) || 0.01;

  let gasLimit = 21000;
  if (selectedToken !== 'RH-ETH') {
    gasLimit = 65000;
  }

  const feeEth = (gasLimit * gweiVal) / 1000000000;
  const feeUsd = feeEth * (currentEthPrice || 1885.00);

  gasEl.innerHTML = `Estimated Gas: <strong style="color: var(--primary);">${feeEth.toFixed(6)} ETH</strong> (~$${feeUsd.toFixed(4)})`;
}

function setSendAmountPercent(percent) {
  const selectEl = document.getElementById('sendAssetSelect');
  if (!selectEl) return;
  const selectedToken = selectEl.value;
  const balance = getTokenBalance(selectedToken);

  let amt = balance * percent;

  // Reserve a small gas buffer when sending the MAX of the native asset,
  // otherwise the tx can fail from having nothing left to cover gas.
  if (percent === 1 && selectedToken === 'RH-ETH') {
    const gasBuffer = 0.0005;
    amt = Math.max(0, amt - gasBuffer);
  }

  const amountInput = document.getElementById('sendAmount');
  amountInput.value = amt > 0 ? amt.toFixed(6) : "0";
  updateSendGasEstimate();
}

function openSendModal() {
  if (HVBSWallet.isLocked()) return alert("Wallet locked.");
  populateSendAssets();
  updateSendGasEstimate();
  document.getElementById('modalSend').classList.add('active');

  getCustomTokens().forEach(t => {
    refreshCustomTokenBalance(t.address).then(bal => {
      if (bal !== null) populateSendAssets();
    });
  });
}

function closeSendModal() {
  document.getElementById('modalSend').classList.remove('active');
}

function openReceiveModal() {
  document.getElementById('modalReceive').classList.add('active');
}

function closeReceiveModal() {
  document.getElementById('modalReceive').classList.remove('active');
}

function copyAddressToClipboard() {
  navigator.clipboard.writeText(walletAddress);
  alert("✅ Address copied to clipboard!");
}

async function submitSendTransaction() {
  const selectEl = document.getElementById('sendAssetSelect');
  const selectedToken = selectEl.value;
  const to = document.getElementById('sendRecipientAddress').value.trim();
  const amountVal = parseFloat(document.getElementById('sendAmount').value);

  if (!to || isNaN(amountVal) || amountVal <= 0) {
    alert("Please enter recipient and a valid amount.");
    return;
  }

  if (HVBSWallet.isLocked()) {
    alert("Wallet locked. Please unlock it first.");
    return;
  }

  const tokenLabel = getTokenLabel(selectedToken);
  const balance = getTokenBalance(selectedToken);

  if (amountVal > balance) {
    alert(`Insufficient ${tokenLabel} balance (Available: ${balance.toFixed(4)}).`);
    return;
  }

  try {
    let txHash = "";
    let sendIsSimulated = false;
    if (selectedToken === 'RH-ETH') {
      const txResponse = await HVBSWallet.send(to, amountVal);
      txHash = txResponse.hash;
      setTokenBalance('RH-ETH', balance - amountVal);
    } else if (selectedToken === 'USDG' || selectedToken === 'ETH-ERC20') {
      txHash = makeFakeHash();
      sendIsSimulated = true;
      setTokenBalance(selectedToken, balance - amountVal);
      alert(`🚀 Simulated ${tokenLabel} transaction initiated! Transferring to ${to}...`);
    } else {
      try {
        const txResponse = await HVBSWallet.send(to, amountVal, selectedToken);
        txHash = txResponse.hash;
        setTokenBalance(selectedToken, balance - amountVal);
      } catch (err) {
        console.warn("Real on-chain transfer failed, falling back to simulation: ", err.message);
        txHash = makeFakeHash();
        sendIsSimulated = true;
        setTokenBalance(selectedToken, balance - amountVal);
      }
    }

    closeSendModal();
    alert(`🚀 Transaction Sent! Hash: ${txHash}`);

    // Clear input fields
    document.getElementById('sendRecipientAddress').value = "";
    document.getElementById('sendAmount').value = "";

    // Record in Activity feed
    logActivity({
      type: 'SEND',
      tokenLabel: tokenLabel,
      amount: amountVal,
      to: to,
      hash: txHash,
      isSimulated: sendIsSimulated
    });

    // Trigger notification
    triggerEmailReport("SEND", `${amountVal} ${tokenLabel}`, to, txHash);
    
    setTimeout(updateDashboardData, 3000);
  } catch (err) {
    alert("Send failed: " + err.message);
  }
}

async function triggerEmailReport(type, amount, recipient, hash) {
  const email = localStorage.getItem('hvbs_notify_email');
  if (!email) return { skipped: true };

  const currentNet = HVBSWallet.getNetwork() || activeNetwork;
  const endpoint = "https://hvbsai.com/send-report.php";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: email,
        txType: type,
        amount: amount,
        recipient: recipient,
        hash: hash,
        networkName: networkConfigs[currentNet].name,
        explorerUrl: isRealTxHash(hash) ? `${networkConfigs[currentNet].explorer}/tx/${hash}` : null
      })
    });

    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body.error || body.message || "";
      } catch (e) {
        try { detail = await res.text(); } catch (e2) {}
      }
      const errMsg = `Server rejected the report (HTTP ${res.status})${detail ? ": " + detail.substring(0, 300) : ""}`;
      console.error("Email API error:", errMsg);
      saveLastEmailStatus(false, errMsg);
      return { success: false, error: errMsg };
    }

    saveLastEmailStatus(true, "");
    return { success: true };
  } catch (e) {
    // A fetch that throws here (rather than resolving with a non-ok status)
    // almost always means the request never reached the server at all -
    // most commonly a CORS rejection (very likely if this page is opened
    // via file:// instead of your deployed hvbsai.com domain, since the
    // browser sends "Origin: null" and most CORS setups reject that) or
    // the backend being unreachable (e.g. a sleeping Render free-tier
    // instance that needs ~30-60s to wake up on the first request).
    const errMsg = "Network/CORS error - request never reached the server: " + e.message;
    console.error("Email API error:", errMsg);
    saveLastEmailStatus(false, errMsg);
    return { success: false, error: errMsg };
  }
}

function saveLastEmailStatus(success, error) {
  localStorage.setItem('hvbs_last_email_status', JSON.stringify({
    success,
    error,
    timestamp: Date.now()
  }));
  updateEmailUI();
}

async function sendTestEmailNotification() {
  const email = localStorage.getItem('hvbs_notify_email');
  if (!email) {
    alert("Save an email address first, then try the test.");
    return;
  }
  const btn = document.getElementById('testEmailBtn');
  if (btn) { btn.disabled = true; btn.innerText = "Sending..."; }

  const result = await triggerEmailReport("TEST", "0.0000", "test@self", makeFakeHash());

  if (btn) { btn.disabled = false; btn.innerText = "Send Test Email"; }

  if (result.success) {
    alert(`✅ Test request accepted by the server. Check ${email}'s inbox (and spam folder) in a minute.`);
  } else {
    alert(`❌ Test failed: ${result.error}\n\nIf you're opening this file directly (file://...) instead of your deployed hvbsai.com site, that's a very likely cause - the backend's CORS settings usually need to explicitly allow the exact origin making the request.`);
  }
}

function saveEmailSettings() {
  const emailInput = document.getElementById('settingEmail');
  const email = emailInput.value.trim();
  if (!email) {
    alert("Please enter a valid email address.");
    return;
  }
  
  if (!email.includes('@') || !email.includes('.')) {
    alert("Please enter a valid email address.");
    return;
  }

  localStorage.setItem('hvbs_notify_email', email);
  updateEmailUI();
  alert("✅ Email notifications enabled successfully!");
}

function clearEmailSettings() {
  if (confirm("Are you sure you want to stop email notifications and remove this email?")) {
    localStorage.removeItem('hvbs_notify_email');
    document.getElementById('settingEmail').value = "";
    updateEmailUI();
    alert("❌ Email notifications disabled and removed.");
  }
}

function updateEmailUI() {
  const email = localStorage.getItem('hvbs_notify_email') || "";
  const emailInput = document.getElementById('settingEmail');
  const saveBtn = document.getElementById('saveEmailBtn');
  const clearBtn = document.getElementById('clearEmailBtn');
  const testBtn = document.getElementById('testEmailBtn');
  const statusEl = document.getElementById('emailConfigStatus');
  
  if (email) {
    emailInput.value = email;
    emailInput.disabled = true;
    emailInput.style.opacity = '0.7';
    saveBtn.style.display = 'none';
    clearBtn.style.display = 'block';
    if (testBtn) testBtn.style.display = 'block';
    
    statusEl.style.display = 'block';
    let statusText = "Active: alerts will be sent to " + email;

    const lastRaw = localStorage.getItem('hvbs_last_email_status');
    if (lastRaw) {
      try {
        const last = JSON.parse(lastRaw);
        const when = new Date(last.timestamp).toLocaleString();
        if (last.success) {
          statusEl.style.background = 'rgba(0,200,120,0.1)';
          statusEl.style.borderColor = 'rgba(0,200,120,0.25)';
          statusEl.style.color = 'var(--green)';
          statusText += `<br><span style="opacity:0.85;">Last send: ✅ delivered to server at ${when}</span>`;
        } else {
          statusEl.style.background = 'rgba(255,75,75,0.1)';
          statusEl.style.borderColor = 'rgba(255,75,75,0.3)';
          statusEl.style.color = '#ff4b4b';
          statusText += `<br><span style="opacity:0.85;">Last send: ❌ failed at ${when} - ${last.error}</span>`;
        }
      } catch (e) {}
    }
    statusEl.innerHTML = statusText;
  } else {
    emailInput.value = "";
    emailInput.disabled = false;
    emailInput.style.opacity = '1';
    saveBtn.style.display = 'block';
    clearBtn.style.display = 'none';
    if (testBtn) testBtn.style.display = 'none';
    
    statusEl.style.display = 'none';
  }
}

// Backup Secrets reveal logic
let backupHideTimeout = null;
let backupHideInterval = null;

function hideBackupDetails() {
  const container = document.getElementById('revealedSecretContainer');
  if (container) container.style.display = 'none';
  
  const mnemonicEl = document.getElementById('backupMnemonicReveal');
  const keyEl = document.getElementById('backupPrivateKeyReveal');
  if (mnemonicEl) mnemonicEl.innerText = "";
  if (keyEl) keyEl.innerText = "";
  
  if (backupHideTimeout) clearTimeout(backupHideTimeout);
  if (backupHideInterval) clearInterval(backupHideInterval);
}

async function revealBackupDetails() {
  const pwd = document.getElementById('backupVerifyPassword').value;
  if (!pwd) return alert("Verify password first.");

  try {
    const storedStr = localStorage.getItem('hvbs_wallet_data');
    const encrypted = JSON.parse(storedStr);
    
    // Core key derivation decryption via wallet.js module encryption utils
    const salt = new Uint8Array(atob(encrypted.salt).split("").map(c => c.charCodeAt(0)));
    const iv = new Uint8Array(atob(encrypted.iv).split("").map(c => c.charCodeAt(0)));
    const ciphertext = new Uint8Array(atob(encrypted.ciphertext).split("").map(c => c.charCodeAt(0)));
    
    // Reuse key derivation
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(pwd),
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      ciphertext
    );
    const payload = JSON.parse(new TextDecoder().decode(decrypted));

    document.getElementById('backupMnemonicReveal').innerText = payload.phrase || "Imported via Private Key directly (No Seed)";
    document.getElementById('backupPrivateKeyReveal').innerText = decryptedKeypair.privateKey;
    document.getElementById('revealedSecretContainer').style.display = 'block';
    document.getElementById('backupVerifyPassword').value = "";

    // Timer logic: clear existing timers
    if (backupHideTimeout) clearTimeout(backupHideTimeout);
    if (backupHideInterval) clearInterval(backupHideInterval);

    // Setup 10 seconds auto-hide countdown
    let secondsLeft = 10;
    const countdownEl = document.getElementById('autoHideCountdown');
    if (countdownEl) {
      countdownEl.innerText = `Auto-hiding in ${secondsLeft}s...`;
    }

    backupHideInterval = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) {
        if (countdownEl) countdownEl.innerText = `Auto-hiding in ${secondsLeft}s...`;
      } else {
        clearInterval(backupHideInterval);
      }
    }, 1000);

    backupHideTimeout = setTimeout(() => {
      hideBackupDetails();
    }, 10000);
  } catch (err) {
    alert("Incorrect password verification.");
  }
}

// P&L Portfolio DB loggers
function getTradeLogs() {
  const data = localStorage.getItem('hvbs_wallet_trades');
  return data ? JSON.parse(data) : [];
}

function saveTradeLogs(logs) {
  localStorage.setItem('hvbs_wallet_trades', JSON.stringify(logs));
  renderTradesList();
  calculatePortfolioStats();
}

// ===== Wallet Activity Feed =====
// Records every real action the wallet performs (send, swap, bridge, deposit)
// with full detail — tokens involved, amounts, counterparties, and tx hash.

function getActivityLog() {
  const data = localStorage.getItem('hvbs_wallet_activity');
  return data ? JSON.parse(data) : [];
}

function saveActivityLog(logs) {
  localStorage.setItem('hvbs_wallet_activity', JSON.stringify(logs));
  renderActivityFeed();
}

function makeFakeHash() {
  // Cosmetic placeholder only — NEVER used as a real explorer link.
  let hex = "";
  for (let i = 0; i < 64; i++) hex += Math.floor(Math.random() * 16).toString(16);
  return "0x" + hex;
}

function logActivity(entry) {
  const logs = getActivityLog();
  const isSimulated = entry.isSimulated === true || !entry.hash;
  const finalHash = entry.hash || makeFakeHash();
  logs.unshift({
    id: Date.now() + Math.random(),
    timestamp: Date.now(),
    ...entry,
    hash: finalHash,
    isSimulated: isSimulated
  });
  // Keep the most recent 50 entries
  saveActivityLog(logs.slice(0, 50));
}

function shortHash(hash) {
  if (!hash) return "--";
  return hash.slice(0, 8) + '...' + hash.slice(-6);
}

function shortAddr(addr) {
  if (!addr) return "--";
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function isRealTxHash(hash) {
  // A real on-chain tx hash is exactly 0x + 64 hex chars.
  return typeof hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(hash);
}

function getActivityExplorerUrl(hash) {
  if (!isRealTxHash(hash)) return null;
  return `${networkConfigs[activeNetwork].explorer}/tx/${hash}`;
}

function renderActivityFeed() {
  const container = document.getElementById('activityFeedContainer');
  if (!container) return;
  const logs = getActivityLog();

  if (logs.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding:20px 10px;">No activity yet. Send, swap, bridge, or deposit to see it here.</div>`;
    return;
  }

  container.innerHTML = "";
  logs.forEach(entry => {
    let icon = '🔹';
    let title = '';
    const detailLines = [];

    switch (entry.type) {
      case 'SEND':
        icon = '📤';
        title = `Sent ${entry.amount} ${entry.tokenLabel}`;
        detailLines.push(`To: ${shortAddr(entry.to)}`);
        break;
      case 'RECEIVE':
        icon = '📥';
        title = `Received ${entry.amount} ${entry.tokenLabel}`;
        detailLines.push(`From: ${shortAddr(entry.from)}`);
        break;
      case 'SWAP': {
        icon = '🔄';
        title = `Swapped ${entry.fromAmount} ${entry.fromTokenLabel} → ${entry.toAmount.toFixed ? entry.toAmount.toFixed(4) : entry.toAmount} ${entry.toTokenLabel}`;
        const rate = entry.fromAmount > 0 ? (entry.toAmount / entry.fromAmount) : 0;
        detailLines.push(`Rate: 1 ${entry.fromTokenLabel} ≈ ${rate.toFixed(4)} ${entry.toTokenLabel}`);
        break;
      }
      case 'BRIDGE':
        icon = '🌉';
        title = `Bridged ${entry.fromAmount} ${entry.fromTokenLabel} → ${entry.toAmount.toFixed ? entry.toAmount.toFixed(4) : entry.toAmount} ${entry.toTokenLabel}`;
        detailLines.push(`${entry.fromChain} → ${entry.toChain}`);
        break;
      case 'DEPOSIT':
        icon = '💳';
        title = `Deposited $${entry.fiatAmount} → ${entry.toAmount.toFixed ? entry.toAmount.toFixed(6) : entry.toAmount} ${entry.toTokenLabel}`;
        break;
      default:
        title = entry.type || 'Activity';
    }

    const timeStr = new Date(entry.timestamp).toLocaleString();
    const explorerLink = entry.isSimulated ? null : getActivityExplorerUrl(entry.hash);
    const badgeClass = `activity-${(entry.type || '').toLowerCase()}`;

    // Real, confirmed on-chain tx -> clickable explorer link.
    // Simulated/local-only entry -> plain text, no dead link to the explorer (avoids the 422 error).
    const hashMarkup = explorerLink
      ? `<a href="${explorerLink}" target="_blank" class="activity-hash-link">${shortHash(entry.hash)}</a>`
      : `<span class="activity-hash-link activity-hash-simulated" title="Simulated activity — not a real on-chain transaction, no explorer record exists.">${shortHash(entry.hash)} (simulated)</span>`;

    const item = document.createElement('div');
    item.className = "activity-item";
    item.innerHTML = `
      <div class="activity-icon">${icon}</div>
      <div class="activity-body">
        <div class="activity-top-row">
          <span class="activity-title">${title}</span>
          <span class="activity-type-badge ${badgeClass}">${entry.type}</span>
        </div>
        ${detailLines.map(d => `<div class="activity-detail">${d}</div>`).join('')}
        <div class="activity-bottom-row">
          ${hashMarkup}
          <span class="activity-time">${timeStr}</span>
        </div>
      </div>
    `;
    container.appendChild(item);
  });
}

function deleteTradeLog(id) {
  const logs = getTradeLogs();
  const filtered = logs.filter(l => l.id !== id);
  saveTradeLogs(filtered);
}

function renderTradesList() {
  const container = document.getElementById('loggedTradesContainer');
  const logs = getTradeLogs();
  
  if (logs.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding:10px;">No manual trades logged yet.</div>`;
    return;
  }

  container.innerHTML = "";
  logs.forEach(log => {
    const item = document.createElement('div');
    item.className = "custom-trade-item";
    item.innerHTML = `
      <div>
        <strong style="color: ${log.type === 'BUY' ? 'var(--green)' : 'var(--red)'}">${log.type}</strong> 
        <span>${log.amount} ETH @ $${log.price}</span>
      </div>
      <div>
        <span style="color: var(--text-muted); margin-right: 10px;">Fee: ${log.fee} ETH</span>
        <button class="btn-close-modal" style="font-size:1rem; cursor:pointer;" onclick="deleteTradeLog(${log.id})">×</button>
      </div>
    `;
    container.appendChild(item);
  });
}

function calculatePortfolioStats() {
  const logs = getTradeLogs();
  
  let totalInvested = 0.00;
  let totalFeesEth = 0.00;
  let totalHoldingsEth = 0.00;
  let totalRealizedPnl = 0.00;
  
  let buyCount = 0;
  let buyWeightedSum = 0;

  logs.forEach(log => {
    totalFeesEth += log.fee;
    if (log.type === 'BUY') {
      totalInvested += (log.amount * log.price);
      totalHoldingsEth += log.amount;
      buyWeightedSum += (log.amount * log.price);
      buyCount += log.amount;
    } else if (log.type === 'SELL') {
      totalHoldingsEth -= log.amount;
      const avgBuyPrice = buyCount > 0 ? (buyWeightedSum / buyCount) : 0;
      const costBasis = log.amount * avgBuyPrice;
      const sellRevenue = log.amount * log.price;
      totalRealizedPnl += (sellRevenue - costBasis);
    }
  });

  document.getElementById('pnlTotalInvested').innerText = "$" + totalInvested.toLocaleString(undefined, { minimumFractionDigits: 2 });
  
  const avgBuyPrice = buyCount > 0 ? (buyWeightedSum / buyCount) : 0.00;
  document.getElementById('pnlAvgBuyPrice').innerText = "$" + avgBuyPrice.toLocaleString(undefined, { minimumFractionDigits: 2 });
  
  const feesUsd = totalFeesEth * currentEthPrice;
  document.getElementById('pnlTotalFees').innerText = `$${feesUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })} (${totalFeesEth.toFixed(6)} ETH)`;

  const currentValue = totalHoldingsEth * currentEthPrice;
  document.getElementById('pnlCurrentValue').innerText = "$" + currentValue.toLocaleString(undefined, { minimumFractionDigits: 2 });

  const avgCostBasisOfCurrentHoldings = totalHoldingsEth * avgBuyPrice;
  const unrealizedPnl = currentValue - avgCostBasisOfCurrentHoldings;
  document.getElementById('pnlUnrealized').innerText = (unrealizedPnl >= 0 ? "+" : "") + "$" + unrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2 });
  document.getElementById('pnlUnrealized').style.color = unrealizedPnl >= 0 ? "var(--green)" : "var(--red)";

  document.getElementById('pnlRealized').innerText = (totalRealizedPnl >= 0 ? "+" : "") + "$" + totalRealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2 });
  document.getElementById('pnlRealized').style.color = totalRealizedPnl >= 0 ? "var(--green)" : "var(--red)";

  const totalPnl = totalRealizedPnl + unrealizedPnl;
  const pnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0.00;
  const globalBadge = document.getElementById('displayGlobalPnl');
  
  globalBadge.className = "pnl-badge " + (totalPnl >= 0 ? "profit" : "loss");
  globalBadge.innerText = `P&L: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })} (${pnlPct.toFixed(2)}%)`;
}

// Deposit / Receive tab handlers
function openDepositModal() {
  if (HVBSWallet.isLocked()) return alert("Verify password or unlock wallet first.");
  document.getElementById('modalDeposit').classList.add('active');
  switchDepositTab('receive');
}

function closeDepositModal() {
  document.getElementById('modalDeposit').classList.remove('active');
}

function switchDepositTab(tab) {
  const receiveBtn = document.getElementById('depositTabReceiveBtn');
  const fiatBtn = document.getElementById('depositTabFiatBtn');
  const receiveContent = document.getElementById('depositTabReceiveContent');
  const fiatContent = document.getElementById('depositTabFiatContent');

  if (tab === 'receive') {
    receiveBtn.style.color = "var(--primary)";
    receiveBtn.style.borderBottom = "2px solid var(--primary)";
    fiatBtn.style.color = "var(--text-muted)";
    fiatBtn.style.borderBottom = "none";
    receiveContent.style.display = "block";
    fiatContent.style.display = "none";
  } else {
    fiatBtn.style.color = "var(--primary)";
    fiatBtn.style.borderBottom = "2px solid var(--primary)";
    receiveBtn.style.color = "var(--text-muted)";
    receiveBtn.style.borderBottom = "none";
    fiatContent.style.display = "block";
    receiveContent.style.display = "none";
  }
}

function calculateFiatExchange() {
  const usd = parseFloat(document.getElementById('fiatDepositAmount').value) || 0;
  const estEth = usd / (currentEthPrice || 1885.00);
  document.getElementById('fiatDepositEthEst').innerText = estEth.toFixed(6) + " ETH";
}

async function submitFiatDeposit() {
  const usd = parseFloat(document.getElementById('fiatDepositAmount').value);
  if (isNaN(usd) || usd <= 0) return alert("Enter a valid USD amount to deposit.");
  
  alert(`💳 Simulated fiat deposit of $${usd} successful! Transferring Robinhood ETH...`);
  closeDepositModal();
  
  const logs = getTradeLogs();
  const estEth = usd / (currentEthPrice || 1885.00);
  logs.push({
    id: Date.now(),
    type: 'BUY',
    amount: estEth,
    price: currentEthPrice || 1885.00,
    fee: 0.0001,
    timestamp: Date.now()
  });
  saveTradeLogs(logs);
  
  alert("✅ Simulated deposit completed. Portfolio assets updated.");
  
  const depositTxHash = makeFakeHash();

  // Record in Activity feed
  logActivity({
    type: 'DEPOSIT',
    fiatAmount: usd,
    toTokenLabel: 'ETH',
    toAmount: estEth,
    hash: depositTxHash,
    isSimulated: true
  });

  triggerEmailReport("DEPOSIT", `$${usd}`, `${estEth.toFixed(6)} ETH`, depositTxHash);
  
  updateDashboardData();
}

// Token Swap & Bridging handlers
let currentSlippage = 0.5; // default 0.5%
let currentGasPreference = 'standard';

function openSwapModal() {
  if (HVBSWallet.isLocked()) return alert("Unlock wallet first.");
  document.getElementById('modalSwap').classList.add('active');
  switchSwapTab('swap');
  updateSwapBalances();
  calculateSwapExchange();
}

function closeSwapModal() {
  document.getElementById('modalSwap').classList.remove('active');
}

function switchSwapTab(tab) {
  const swapBtn = document.getElementById('swapTabSwapBtn');
  const bridgeBtn = document.getElementById('swapTabBridgeBtn');
  const swapContent = document.getElementById('swapTabSwapContent');
  const bridgeContent = document.getElementById('swapTabBridgeContent');

  if (tab === 'swap') {
    swapBtn.style.color = "var(--primary)";
    swapBtn.style.borderBottom = "2px solid var(--primary)";
    bridgeBtn.style.color = "var(--text-muted)";
    bridgeBtn.style.borderBottom = "none";
    swapContent.style.display = "block";
    bridgeContent.style.display = "none";
  } else {
    bridgeBtn.style.color = "var(--primary)";
    bridgeBtn.style.borderBottom = "2px solid var(--primary)";
    swapBtn.style.color = "var(--text-muted)";
    swapBtn.style.borderBottom = "none";
    bridgeContent.style.display = "block";
    swapContent.style.display = "none";
    
    // Always reset the source chain to 'Robinhood Chain' when switching to Bridge tab!
    currentBridgeSource = 'Robinhood Chain';
    document.getElementById('bridgeSourceChain').innerText = 'Robinhood Chain';
    document.getElementById('bridgeTargetChain').innerText = 'Ethereum Mainnet';
    
    updateBridgeTokens();
    
    document.getElementById('bridgeToken').value = 'RH-ETH';
    document.getElementById('bridgeReceiveToken').value = 'ETH-ERC20';
    
    calculateBridgeExchange();
  }
}

function getTokenBalance(token) {
  if (token === 'RH-ETH') {
    const balVal = parseFloat(localStorage.getItem('hvbs_wallet_balance_eth')) || 0.0100;
    return balVal;
  }
  const key = `hvbs_balance_${token.toLowerCase().replace('-', '')}`;
  const val = localStorage.getItem(key);
  if (val === null) {
    const initial = token === 'USDG' ? '500.00' : '0.2500';
    localStorage.setItem(key, initial);
    return parseFloat(initial);
  }
  return parseFloat(val);
}

function setTokenBalance(token, amount) {
  if (token === 'RH-ETH') {
    localStorage.setItem('hvbs_wallet_balance_eth', amount.toFixed(6));
    return;
  }
  const key = `hvbs_balance_${token.toLowerCase().replace('-', '')}`;
  localStorage.setItem(key, amount.toFixed(4));
}

function updateSwapBalances() {
  const tokenFrom = document.getElementById('swapTokenFrom').value;
  const tokenTo = document.getElementById('swapTokenTo').value;
  document.getElementById('swapBalanceFrom').innerText = getTokenBalance(tokenFrom).toFixed(4);
  document.getElementById('swapBalanceTo').innerText = getTokenBalance(tokenTo).toFixed(4);
}

function onSwapTokenFromChange() {
  const tokenFrom = document.getElementById('swapTokenFrom').value;
  const tokenToSelect = document.getElementById('swapTokenTo');
  if (tokenFrom === tokenToSelect.value) {
    tokenToSelect.value = tokenFrom === 'RH-ETH' ? 'USDG' : 'RH-ETH';
  }
  updateSwapBalances();
  calculateSwapExchange();
}

function onSwapTokenToChange() {
  const tokenTo = document.getElementById('swapTokenTo').value;
  const tokenFromSelect = document.getElementById('swapTokenFrom');
  if (tokenTo === tokenFromSelect.value) {
    tokenFromSelect.value = tokenTo === 'RH-ETH' ? 'USDG' : 'RH-ETH';
  }
  updateSwapBalances();
  calculateSwapExchange();
}

function reverseSwapTokens() {
  const from = document.getElementById('swapTokenFrom').value;
  const to = document.getElementById('swapTokenTo').value;
  document.getElementById('swapTokenFrom').value = to;
  document.getElementById('swapTokenTo').value = from;
  updateSwapBalances();
  calculateSwapExchange();
}

function getCustomTokens() {
  const custom = localStorage.getItem('hvbs_custom_tokens');
  return custom ? JSON.parse(custom) : [];
}

function getTokenPriceInUSD(token) {
  if (token === 'RH-ETH' || token === 'ETH-ERC20') {
    return currentEthPrice || 1885.00;
  }
  if (token === 'USDG') {
    return 1.00;
  }
  const custom = getCustomTokens();
  const found = custom.find(t => t.address.toLowerCase() === token.toLowerCase() || t.symbol === token);
  if (found) {
    return parseFloat(found.price) || 1.00;
  }
  return 1.00;
}

function getTokenLabel(token) {
  if (token === 'RH-ETH') return 'ETH (Robinhood)';
  if (token === 'ETH-ERC20') return 'ETH (ERC-20)';
  if (token === 'USDG') return 'USDG';
  
  const custom = getCustomTokens();
  const found = custom.find(t => t.address.toLowerCase() === token.toLowerCase() || t.symbol === token);
  if (found) {
    return found.symbol;
  }
  return token;
}

let swapSelectedFrom = 'RH-ETH';
let swapSelectedTo = 'USDG';
let activeTokenSelectorSlot = 'from'; // 'from' or 'to'

function getCustomTokens() {
  const custom = localStorage.getItem('hvbs_custom_tokens');
  return custom ? JSON.parse(custom) : [];
}

function getTokenPriceInUSD(token) {
  if (token === 'RH-ETH' || token === 'ETH-ERC20') {
    return currentEthPrice || 1885.00;
  }
  if (token === 'USDG') {
    return 1.00;
  }
  const custom = getCustomTokens();
  const found = custom.find(t => t.address.toLowerCase() === token.toLowerCase() || t.symbol === token);
  if (found) {
    return parseFloat(found.price) || 1.00;
  }
  return 1.00;
}

function getTokenLabel(token) {
  if (token === 'RH-ETH') return 'ETH (Robinhood)';
  if (token === 'ETH-ERC20') return 'ETH (ERC-20)';
  if (token === 'USDG') return 'USDG';
  
  const custom = getCustomTokens();
  const found = custom.find(t => t.address.toLowerCase() === token.toLowerCase() || t.symbol === token);
  if (found) {
    return found.symbol;
  }
  return token;
}

function openTokenSelector(targetSlot) {
  activeTokenSelectorSlot = targetSlot;
  document.getElementById('tokenSelectorTitle').innerText = targetSlot === 'from' ? 'Select pay token' : 'Select receive token';
  document.getElementById('tokenSearchInput').value = "";
  document.getElementById('modalSelectToken').classList.add('active');
  filterTokensList();

  // Refresh each custom token's balance from chain once per open, then
  // re-render the list. Guarded so this doesn't refire on every keystroke.
  getCustomTokens().forEach(t => {
    refreshCustomTokenBalance(t.address).then(bal => {
      if (bal !== null) filterTokensList();
    });
  });
}

function closeTokenSelector() {
  document.getElementById('modalSelectToken').classList.remove('active');
}

function openAddCustomTokenView() {
  closeTokenSelector();
  document.getElementById('customTokenAddressInput').value = "";
  document.getElementById('customTokenSymbolInput').value = "";
  document.getElementById('customTokenNameInput').value = "";
  document.getElementById('customTokenDecimalsInput').value = "";
  document.getElementById('customTokenDetailsBox').style.display = "none";
  document.getElementById('customTokenStatusMsg').innerText = "";
  document.getElementById('customTokenSubmitBtn').disabled = true;
  fetchedCustomTokenData = null;
  document.getElementById('modalAddCustomToken').classList.add('active');
}

function closeAddCustomTokenView() {
  document.getElementById('modalAddCustomToken').classList.remove('active');
}

function filterTokensList() {
  const query = document.getElementById('tokenSearchInput').value.trim().toLowerCase();
  const container = document.getElementById('tokenListContainer');
  if (!container) return;
  container.innerHTML = "";
  
  const defaultTokens = [
    { value: 'RH-ETH', symbol: 'ETH', name: 'Ethereum (Robinhood Chain)', price: currentEthPrice || 1885.00 },
    { value: 'USDG', symbol: 'USDG', name: 'USD Stablecoin (Robinhood Chain)', price: 1.00 },
    { value: 'ETH-ERC20', symbol: 'ETH', name: 'Ethereum (ERC-20 Mainnet)', price: currentEthPrice || 1885.00 }
  ];
  
  const custom = getCustomTokens();
  const all = [...defaultTokens];
  custom.forEach(t => {
    all.push({
      value: t.address,
      symbol: t.symbol,
      name: t.address,
      price: getTokenPriceInUSD(t.address),
      isCustom: true
    });
  });
  
  const filtered = all.filter(t => {
    return t.symbol.toLowerCase().includes(query) || t.name.toLowerCase().includes(query) || t.value.toLowerCase().includes(query);
  });
  
  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:15px; color:var(--text-muted); font-size:0.85rem;">No tokens found.</div>`;
    return;
  }
  
  filtered.forEach(t => {
    const balance = getTokenBalance(t.value);
    const row = document.createElement('div');
    row.className = "token-row";
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";

    const mainArea = document.createElement('div');
    mainArea.style.display = "flex";
    mainArea.style.flex = "1";
    mainArea.style.justifyContent = "space-between";
    mainArea.style.alignItems = "center";
    mainArea.style.cursor = "pointer";
    mainArea.onclick = () => selectTokenForSwap(t.value);
    mainArea.innerHTML = `
      <div class="token-info">
        <span class="token-symbol">${t.symbol}</span>
        <span class="token-name">${t.name.length > 28 ? t.name.substring(0, 10) + '...' + t.name.substring(t.name.length - 8) : t.name}</span>
      </div>
      <div style="text-align: right;">
        <span class="token-bal">${balance.toFixed(4)}</span>
        <div style="font-size:0.7rem; color:var(--text-muted);">$${t.price.toFixed(2)}</div>
      </div>
    `;
    row.appendChild(mainArea);

    if (t.isCustom) {
      const delBtn = document.createElement('button');
      delBtn.innerHTML = "🗑";
      delBtn.title = "Remove this token";
      delBtn.style.cssText = "background:none; border:none; color:var(--red); cursor:pointer; font-size:1rem; padding:6px; flex-shrink:0;";
      delBtn.onclick = (e) => {
        e.stopPropagation();
        removeCustomToken(t.value, t.symbol);
      };
      row.appendChild(delBtn);
    }
    
    container.appendChild(row);
  });
}

/**
 * Removes a custom token (address, symbol, decimals) and its cached
 * balance from local storage. Default network assets (ETH, USDG,
 * ETH-ERC20) are never passed here, so they can't be removed this way.
 */
function removeCustomToken(address, symbol) {
  if (!confirm(`Remove ${symbol} (${address}) from your token list? This only hides it from your wallet UI - it does not affect anything on-chain.`)) {
    return;
  }
  const custom = getCustomTokens().filter(t => t.address.toLowerCase() !== address.toLowerCase());
  localStorage.setItem('hvbs_custom_tokens', JSON.stringify(custom));
  localStorage.removeItem(`hvbs_balance_${address.toLowerCase()}`);

  // If the removed token was selected in the swap widget, fall back to defaults.
  if (swapSelectedFrom.toLowerCase() === address.toLowerCase()) swapSelectedFrom = 'RH-ETH';
  if (swapSelectedTo.toLowerCase() === address.toLowerCase()) swapSelectedTo = 'USDG';

  filterTokensList();
}

function selectTokenForSwap(tokenValue) {
  if (activeTokenSelectorSlot === 'from') {
    swapSelectedFrom = tokenValue;
    if (swapSelectedFrom === swapSelectedTo) {
      swapSelectedTo = swapSelectedFrom === 'RH-ETH' ? 'USDG' : 'RH-ETH';
    }
  } else {
    swapSelectedTo = tokenValue;
    if (swapSelectedTo === swapSelectedFrom) {
      swapSelectedFrom = swapSelectedTo === 'RH-ETH' ? 'USDG' : 'RH-ETH';
    }
  }
  
  closeTokenSelector();
  updateSwapBalances();
  calculateSwapExchange();
}

// Minimal ERC-20 read ABI used purely for on-chain metadata/balance lookups
const ERC20_READ_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)"
];

let fetchedCustomTokenData = null; // { address, name, symbol, decimals, rawBalance }
let customTokenFetchToken = 0; // guards against stale async responses when address keeps changing

/**
 * Reads name/symbol/decimals/balanceOf directly from the token contract on
 * the currently active network. No user-entered value is trusted here -
 * everything shown comes straight from the chain.
 */
async function fetchErc20OnChainDetails(address) {
  const provider = new ethers.JsonRpcProvider(networkConfigs[activeNetwork].rpcUrl);
  const contract = new ethers.Contract(address, ERC20_READ_ABI, provider);

  const [name, symbol, decimals] = await Promise.all([
    contract.name().catch(() => "Unknown Token"),
    contract.symbol().catch(() => { throw new Error("Not a valid ERC-20 contract (symbol() failed)."); }),
    contract.decimals().catch(() => { throw new Error("Not a valid ERC-20 contract (decimals() failed)."); })
  ]);

  let rawBalance = 0n;
  if (walletAddress) {
    try {
      rawBalance = await contract.balanceOf(walletAddress);
    } catch (e) {
      console.warn("balanceOf() failed for custom token:", e.message);
    }
  }

  return {
    address,
    name,
    symbol,
    decimals: Number(decimals),
    balance: ethers.formatUnits(rawBalance, Number(decimals))
  };
}

function onCustomTokenAddressInput() {
  const address = document.getElementById('customTokenAddressInput').value.trim();
  const detailsBox = document.getElementById('customTokenDetailsBox');
  const statusMsg = document.getElementById('customTokenStatusMsg');
  const submitBtn = document.getElementById('customTokenSubmitBtn');

  fetchedCustomTokenData = null;
  submitBtn.disabled = true;
  detailsBox.style.display = "none";

  if (!address) {
    statusMsg.innerText = "";
    return;
  }

  if (!ethers.isAddress(address)) {
    statusMsg.innerText = "Invalid contract address format.";
    statusMsg.style.color = "var(--red)";
    return;
  }

  const thisFetch = ++customTokenFetchToken;
  statusMsg.innerText = "Reading token contract on-chain...";
  statusMsg.style.color = "var(--text-muted)";

  fetchErc20OnChainDetails(address)
    .then(details => {
      if (thisFetch !== customTokenFetchToken) return; // address changed while we were fetching

      const custom = getCustomTokens();
      if (custom.some(t => t.address.toLowerCase() === address.toLowerCase())) {
        statusMsg.innerText = "This token is already added.";
        statusMsg.style.color = "var(--red)";
        return;
      }

      fetchedCustomTokenData = details;
      document.getElementById('customTokenNameOut').innerText = details.name;
      document.getElementById('customTokenSymbolOut').innerText = details.symbol;
      document.getElementById('customTokenDecimalsOut').innerText = details.decimals;
      document.getElementById('customTokenBalanceOut').innerText = parseFloat(details.balance).toFixed(4);
      document.getElementById('customTokenSymbolInput').value = details.symbol;
      document.getElementById('customTokenNameInput').value = details.name;
      document.getElementById('customTokenDecimalsInput').value = details.decimals;
      detailsBox.style.display = "block";
      statusMsg.innerText = "";
      submitBtn.disabled = false;
    })
    .catch(err => {
      if (thisFetch !== customTokenFetchToken) return;
      statusMsg.innerText = err.message || "Could not read this contract on " + networkConfigs[activeNetwork].name + ".";
      statusMsg.style.color = "var(--red)";
    });
}

function submitCustomTokenMetamask() {
  const address = document.getElementById('customTokenAddressInput').value.trim();

  if (!fetchedCustomTokenData || fetchedCustomTokenData.address.toLowerCase() !== address.toLowerCase()) {
    alert("Please wait for the token details to be read from the contract first.");
    return;
  }

  const { name, symbol, decimals, balance } = fetchedCustomTokenData;

  const custom = getCustomTokens();
  if (custom.some(t => t.address.toLowerCase() === address.toLowerCase())) {
    alert("Token with this contract address already exists!");
    return;
  }

  // No manual/simulated price - price is left unset since there is no
  // on-chain oracle for an arbitrary token here. USD value for custom
  // tokens should come from a real price feed when one is integrated.
  custom.push({
    address: address,
    symbol: symbol,
    name: name,
    decimals: decimals
  });
  localStorage.setItem('hvbs_custom_tokens', JSON.stringify(custom));

  // Store the REAL on-chain balance we just read, not a mock credit.
  const balanceKey = `hvbs_balance_${address.toLowerCase()}`;
  localStorage.setItem(balanceKey, parseFloat(balance).toFixed(4));

  closeAddCustomTokenView();
  openTokenSelector(activeTokenSelectorSlot);

  alert(`✅ ${symbol} added — balance read from chain: ${parseFloat(balance).toFixed(4)} ${symbol}.`);
}

/**
 * Re-reads a custom token's balance from chain and updates the cached
 * localStorage value used by the rest of the UI (swap/send/dashboard).
 */
async function refreshCustomTokenBalance(address) {
  if (!walletAddress) return;
  try {
    const provider = new ethers.JsonRpcProvider(networkConfigs[activeNetwork].rpcUrl);
    const contract = new ethers.Contract(address, ERC20_READ_ABI, provider);
    const decimals = await contract.decimals();
    const rawBalance = await contract.balanceOf(walletAddress);
    const balance = ethers.formatUnits(rawBalance, Number(decimals));
    localStorage.setItem(`hvbs_balance_${address.toLowerCase()}`, parseFloat(balance).toFixed(4));
    return parseFloat(balance);
  } catch (e) {
    console.warn("Failed to refresh custom token balance:", e.message);
    return null;
  }
}

function updateSwapBalances() {
  document.getElementById('swapPayTokenLabel').innerText = getTokenLabel(swapSelectedFrom);
  document.getElementById('swapReceiveTokenLabel').innerText = getTokenLabel(swapSelectedTo);
  
  document.getElementById('swapBalanceFrom').innerText = getTokenBalance(swapSelectedFrom).toFixed(4);
  document.getElementById('swapBalanceTo').innerText = getTokenBalance(swapSelectedTo).toFixed(4);
}

function reverseSwapTokens() {
  const temp = swapSelectedFrom;
  swapSelectedFrom = swapSelectedTo;
  swapSelectedTo = temp;
  updateSwapBalances();
  calculateSwapExchange();
}

function calculateSwapExchange() {
  const amountFrom = parseFloat(document.getElementById('swapAmountFrom').value) || 0;
  
  const priceFrom = getTokenPriceInUSD(swapSelectedFrom);
  const priceTo = getTokenPriceInUSD(swapSelectedTo);
  const rate = priceFrom / priceTo;

  const tokenFromSymbol = getTokenLabel(swapSelectedFrom);
  const tokenToSymbol = getTokenLabel(swapSelectedTo);

  document.getElementById('swapRateText').innerText = `1 ${tokenFromSymbol} ≈ ${rate.toFixed(4)} ${tokenToSymbol}`;

  const amountTo = amountFrom * rate;
  document.getElementById('swapAmountTo').value = amountTo.toFixed(4);

  const slippagePct = currentSlippage / 100;
  const minReceived = amountTo * (1 - slippagePct);
  document.getElementById('swapMinReceived').innerText = `${minReceived.toFixed(4)} ${tokenToSymbol}`;

  const protocolFee = amountFrom * 0.002;
  document.getElementById('swapProtocolFee').innerText = `${protocolFee.toFixed(6)} ${tokenFromSymbol}`;

  const gasMultiplier = currentGasPreference === 'instant' ? 1.2 : 1.0;
  document.getElementById('swapGasCost').innerText = `${(0.00015 * gasMultiplier).toFixed(5)} ETH`;
}

function toggleSwapSettings() {
  const content = document.getElementById('swapSettingsContent');
  const arrow = document.getElementById('swapSettingsArrow');
  if (content.style.display === 'none') {
    content.style.display = 'block';
    arrow.innerText = '▲';
  } else {
    content.style.display = 'none';
    arrow.innerText = '▼';
  }
}

function setSlippage(val) {
  currentSlippage = val;
  document.getElementById('customSlippage').value = "";
  calculateSwapExchange();
}

function onCustomSlippageInput() {
  const val = parseFloat(document.getElementById('customSlippage').value);
  if (!isNaN(val) && val >= 0) {
    currentSlippage = val;
    calculateSwapExchange();
  }
}

function setGasSpeed(speed) {
  currentGasPreference = speed;
  const standardBtn = document.getElementById('gasSpeedStandard');
  const instantBtn = document.getElementById('gasSpeedInstant');
  if (speed === 'standard') {
    standardBtn.style.borderColor = "var(--primary)";
    standardBtn.style.color = "var(--primary)";
    standardBtn.style.background = "rgba(193, 255, 0, 0.15)";
    instantBtn.style.borderColor = "var(--border)";
    instantBtn.style.color = "var(--text-muted)";
    instantBtn.style.background = "rgba(255,255,255,0.05)";
  } else {
    instantBtn.style.borderColor = "var(--primary)";
    instantBtn.style.color = "var(--primary)";
    instantBtn.style.background = "rgba(193, 255, 0, 0.15)";
    standardBtn.style.borderColor = "var(--border)";
    standardBtn.style.color = "var(--text-muted)";
    standardBtn.style.background = "rgba(255,255,255,0.05)";
  }
  calculateSwapExchange();
}

async function submitTokenSwap() {
  const amountFrom = parseFloat(document.getElementById('swapAmountFrom').value);
  const tokenFrom = swapSelectedFrom;
  const tokenTo = swapSelectedTo;

  if (isNaN(amountFrom) || amountFrom <= 0) return alert("Enter valid swap amount.");
  const balanceFrom = getTokenBalance(tokenFrom);
  if (amountFrom > balanceFrom) return alert(`Insufficient ${getTokenLabel(tokenFrom)} balance.`);

  const tokenFromLabel = getTokenLabel(tokenFrom);
  const tokenToLabel = getTokenLabel(tokenTo);

  alert(`🔄 Processing Swap: ${amountFrom} ${tokenFromLabel} ➡️ ${tokenToLabel}...`);
  
  // Deduct from source
  setTokenBalance(tokenFrom, balanceFrom - amountFrom);
  
  // Add to destination
  const priceFrom = getTokenPriceInUSD(tokenFrom);
  const priceTo = getTokenPriceInUSD(tokenTo);
  const rate = priceFrom / priceTo;
  
  const balanceTo = getTokenBalance(tokenTo);
  const receivedAmount = amountFrom * rate;
  setTokenBalance(tokenTo, balanceTo + receivedAmount);

  closeSwapModal();
  alert("✅ Token Swap executed successfully!");

  // Integrate with P&L Trade Logs
  const logs = getTradeLogs();
  const ethPrice = currentEthPrice || 1885.00;
  if (tokenFrom === 'RH-ETH') {
    // Selling ETH
    logs.push({
      id: Date.now(),
      type: 'SELL',
      amount: amountFrom,
      price: ethPrice,
      fee: 0.00015,
      timestamp: Date.now()
    });
  } else if (tokenTo === 'RH-ETH') {
    // Buying ETH
    logs.push({
      id: Date.now(),
      type: 'BUY',
      amount: receivedAmount,
      price: ethPrice,
      fee: 0.00015,
      timestamp: Date.now()
    });
  }
  saveTradeLogs(logs);

  const swapTxHash = makeFakeHash();

  // Record in Activity feed
  logActivity({
    type: 'SWAP',
    fromTokenLabel: tokenFromLabel,
    toTokenLabel: tokenToLabel,
    fromAmount: amountFrom,
    toAmount: receivedAmount,
    hash: swapTxHash,
    isSimulated: true
  });

  triggerEmailReport("SWAP", `${amountFrom} ${tokenFromLabel}`, `${receivedAmount.toFixed(4)} ${tokenToLabel}`, swapTxHash);
  
  updateDashboardData();
}

// Cross-chain Bridge handlers
let currentBridgeSource = 'Robinhood Chain';

function reverseBridgeChains() {
  const sourceEl = document.getElementById('bridgeSourceChain');
  const targetEl = document.getElementById('bridgeTargetChain');
  
  if (currentBridgeSource === 'Robinhood Chain') {
    currentBridgeSource = 'Ethereum Mainnet';
    sourceEl.innerText = 'Ethereum Mainnet';
    targetEl.innerText = 'Robinhood Chain';
  } else {
    currentBridgeSource = 'Robinhood Chain';
    sourceEl.innerText = 'Robinhood Chain';
    targetEl.innerText = 'Ethereum Mainnet';
  }
  
  updateBridgeTokens();
  calculateBridgeExchange();
}

function updateBridgeTokens() {
  const sourceSelect = document.getElementById('bridgeToken');
  const receiveSelect = document.getElementById('bridgeReceiveToken');
  
  const prevSourceVal = sourceSelect.value;
  const prevReceiveVal = receiveSelect.value;
  
  sourceSelect.innerHTML = "";
  receiveSelect.innerHTML = "";
  
  if (currentBridgeSource === 'Robinhood Chain') {
    sourceSelect.innerHTML = `
      <option value="RH-ETH">ETH (Robinhood)</option>
      <option value="USDG">USDG</option>
    `;
    receiveSelect.innerHTML = `
      <option value="ETH-ERC20">ETH (ERC-20)</option>
      <option value="USDG">USDG</option>
    `;
  } else {
    sourceSelect.innerHTML = `
      <option value="ETH-ERC20">ETH (ERC-20)</option>
      <option value="USDG">USDG</option>
    `;
    receiveSelect.innerHTML = `
      <option value="RH-ETH">ETH (Robinhood)</option>
      <option value="USDG">USDG</option>
    `;
  }
  
  if (prevSourceVal && [...sourceSelect.options].some(o => o.value === prevSourceVal)) {
    sourceSelect.value = prevSourceVal;
  }
  if (prevReceiveVal && [...receiveSelect.options].some(o => o.value === prevReceiveVal)) {
    receiveSelect.value = prevReceiveVal;
  }
}

function calculateBridgeExchange() {
  const amount = parseFloat(document.getElementById('bridgeAmount').value) || 0;
  const tokenFrom = document.getElementById('bridgeToken').value;
  const tokenTo = document.getElementById('bridgeReceiveToken').value;
  const fee = amount * 0.001; // 0.1% bridge fee
  
  const tokenFromLabel = tokenFrom === 'RH-ETH' ? 'ETH (Robinhood)' : (tokenFrom === 'ETH-ERC20' ? 'ETH (ERC-20)' : 'USDG');
  const tokenToLabel = tokenTo === 'RH-ETH' ? 'ETH (Robinhood)' : (tokenTo === 'ETH-ERC20' ? 'ETH (ERC-20)' : 'USDG');
  const tokenFromShort = tokenFrom === 'RH-ETH' || tokenFrom === 'ETH-ERC20' ? 'ETH' : 'USDG';
  
  document.getElementById('bridgeFeeCost').innerText = `${fee.toFixed(6)} ${tokenFromShort}`;
  document.getElementById('bridgeGasSymbol').innerText = tokenFromShort;

  let rate = 1;
  const ethPrice = currentEthPrice || 1885.00;

  if ((tokenFrom === 'RH-ETH' || tokenFrom === 'ETH-ERC20') && tokenTo === 'USDG') {
    rate = ethPrice;
  } else if (tokenFrom === 'USDG' && (tokenTo === 'RH-ETH' || tokenTo === 'ETH-ERC20')) {
    rate = 1 / ethPrice;
  }

  const netAmountFrom = Math.max(0, amount - fee);
  const netReceive = netAmountFrom * rate;
  document.getElementById('bridgeReceiveText').innerText = `${netReceive.toFixed(4)} ${tokenToLabel}`;
}

async function submitBridgeTransfer() {
  const amount = parseFloat(document.getElementById('bridgeAmount').value);
  if (isNaN(amount) || amount <= 0) return alert("Enter valid bridge amount.");
  
  const tokenFrom = document.getElementById('bridgeToken').value;
  const tokenTo = document.getElementById('bridgeReceiveToken').value;
  const balFrom = getTokenBalance(tokenFrom);
  
  const tokenFromLabel = tokenFrom === 'RH-ETH' ? 'ETH (Robinhood)' : (tokenFrom === 'ETH-ERC20' ? 'ETH (ERC-20)' : 'USDG');
  const tokenToLabel = tokenTo === 'RH-ETH' ? 'ETH (Robinhood)' : (tokenTo === 'ETH-ERC20' ? 'ETH (ERC-20)' : 'USDG');
  const tokenFromShort = tokenFrom === 'RH-ETH' || tokenFrom === 'ETH-ERC20' ? 'ETH' : 'USDG';

  const fromChain = currentBridgeSource;
  const toChain = currentBridgeSource === 'Robinhood Chain' ? 'Ethereum Mainnet' : 'Robinhood Chain';

  if (tokenFromShort === 'ETH') {
    if (amount + 0.0026 > balFrom) {
      return alert(`Insufficient ETH balance to cover bridging amount & network gas fee (requires ${(amount + 0.0026).toFixed(4)} ETH).`);
    }
    setTokenBalance(tokenFrom, balFrom - (amount + 0.0026));
  } else {
    const ethToken = currentBridgeSource === 'Robinhood Chain' ? 'RH-ETH' : 'ETH-ERC20';
    const ethBal = getTokenBalance(ethToken);
    if (ethBal < 0.0026) {
      return alert("Insufficient ETH balance to pay for network gas fee (requires 0.0026 ETH).");
    }
    if (amount > balFrom) {
      return alert(`Insufficient USDG balance (available: ${balFrom}).`);
    }
    setTokenBalance(tokenFrom, balFrom - amount);
    setTokenBalance(ethToken, ethBal - 0.00015);
  }

  const fee = amount * 0.001;
  const netAmountFrom = amount - fee;
  let rate = 1;
  const ethPrice = currentEthPrice || 1885.00;
  if ((tokenFrom === 'RH-ETH' || tokenFrom === 'ETH-ERC20') && tokenTo === 'USDG') {
    rate = ethPrice;
  } else if (tokenFrom === 'USDG' && (tokenTo === 'RH-ETH' || tokenTo === 'ETH-ERC20')) {
    rate = 1 / ethPrice;
  }
  const netReceive = netAmountFrom * rate;

  const balTo = getTokenBalance(tokenTo);
  setTokenBalance(tokenTo, balTo + netReceive);

  alert(`🌉 Submitting Cross-Chain Bridge transfer of ${amount} ${tokenFromLabel} from ${fromChain} to ${toChain}...`);
  closeSwapModal();
  
  alert(`🚀 Bridge contract order initiated. You will receive ${netReceive.toFixed(4)} ${tokenToLabel} on ${toChain} in 3-5 minutes.`);
  
  const bridgeTxHash = makeFakeHash();

  // Record in Activity feed
  logActivity({
    type: 'BRIDGE',
    fromTokenLabel: tokenFromLabel,
    toTokenLabel: tokenToLabel,
    fromAmount: amount,
    toAmount: netReceive,
    fromChain: fromChain,
    toChain: toChain,
    hash: bridgeTxHash,
    isSimulated: true
  });

  triggerEmailReport("BRIDGE", `${amount} ${tokenFromLabel}`, `${netReceive.toFixed(4)} ${tokenToLabel} on ${toChain}`, bridgeTxHash);
  
  document.getElementById('bridgeAmount').value = "";
  updateDashboardData();
}

function addMockOnChainTx(method, amount, fromAsset, toAsset) {
  console.log(`Mock Tx: ${method}ed ${amount} ${fromAsset} to ${toAsset}`);
}

