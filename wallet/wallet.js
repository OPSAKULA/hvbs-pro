/**
 * HVBS AI Non-Custodial Wallet Manager
 * Targets Robinhood Chain Testnet (Chain ID 46630) and Mainnet (Chain ID 4663)
 */

const walletConfig = {
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

// Global State
let activeNetwork = 'testnet'; // default to testnet
let decryptedWallet = null; // In-memory ethers.Wallet instance (cleared on lock)
let walletAddress = null; // Public wallet address

/**
 * Derives a cryptographic key from a user password using PBKDF2.
 */
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  return crypto.subtle.deriveKey(
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
}

/**
 * Encrypts clear-text data using AES-GCM (256-bit).
 */
async function encryptData(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    enc.encode(plaintext)
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv))
  };
}

/**
 * Decrypts AES-GCM encrypted data.
 */
async function decryptData(encryptedObj, password) {
  try {
    const salt = new Uint8Array(atob(encryptedObj.salt).split("").map(c => c.charCodeAt(0)));
    const iv = new Uint8Array(atob(encryptedObj.iv).split("").map(c => c.charCodeAt(0)));
    const ciphertext = new Uint8Array(atob(encryptedObj.ciphertext).split("").map(c => c.charCodeAt(0)));
    const key = await deriveKey(password, salt);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    throw new Error("Invalid password or corrupted wallet file.");
  }
}

/**
 * Saves encrypted wallet data to LocalStorage.
 */
function saveWalletToStorage(encryptedData, address) {
  localStorage.setItem('hvbs_wallet_data', JSON.stringify(encryptedData));
  localStorage.setItem('hvbs_wallet_address', address);
  walletAddress = address;
}

/**
 * Checks if a wallet is already created/imported in LocalStorage.
 */
function hasSavedWallet() {
  return localStorage.getItem('hvbs_wallet_data') !== null;
}

/**
 * Gets the current public address of the saved wallet.
 */
function getSavedAddress() {
  return localStorage.getItem('hvbs_wallet_address');
}

/**
 * Persists the unlocked wallet's key material into sessionStorage so that
 * a page refresh doesn't force the user to unlock again. sessionStorage is
 * cleared automatically when the tab/window is closed, so this only lasts
 * for the current browser session.
 */
function saveSessionUnlock(secret) {
  try {
    sessionStorage.setItem('hvbs_session_secret', secret);
  } catch (e) {
    console.warn("Could not persist session unlock:", e);
  }
}

/**
 * Attempts to silently restore an unlocked wallet from sessionStorage.
 * Returns the restored ethers.Wallet instance, or null if none was saved.
 */
function restoreSessionWallet() {
  let secret;
  try {
    secret = sessionStorage.getItem('hvbs_session_secret');
  } catch (e) {
    return null;
  }
  if (!secret) return null;

  try {
    const provider = new ethers.JsonRpcProvider(walletConfig[activeNetwork].rpcUrl);
    decryptedWallet = secret.trim().split(/\s+/).length >= 12
      ? ethers.Wallet.fromPhrase(secret, provider)
      : new ethers.Wallet(secret, provider);
    walletAddress = decryptedWallet.address;
    document.dispatchEvent(new CustomEvent('hvbs-wallet-unlocked', { detail: { address: walletAddress } }));
    return decryptedWallet;
  } catch (e) {
    console.warn("Failed to restore session wallet:", e);
    sessionStorage.removeItem('hvbs_session_secret');
    return null;
  }
}

/**
 * Locks the wallet by purging decrypted instances from memory.
 */
function lockWallet() {
  decryptedWallet = null;
  try { sessionStorage.removeItem('hvbs_session_secret'); } catch (e) {}
  document.dispatchEvent(new CustomEvent('hvbs-wallet-locked'));
}

/**
 * Unlocks the saved wallet using the user password.
 */
async function unlockWallet(password) {
  const dataStr = localStorage.getItem('hvbs_wallet_data');
  if (!dataStr) throw new Error("No wallet exists.");
  
  const encryptedObj = JSON.parse(dataStr);
  const decryptedText = await decryptData(encryptedObj, password);
  
  const payload = JSON.parse(decryptedText);
  const provider = new ethers.JsonRpcProvider(walletConfig[activeNetwork].rpcUrl);
  
  if (payload.phrase) {
    decryptedWallet = ethers.Wallet.fromPhrase(payload.phrase, provider);
  } else if (payload.privateKey) {
    decryptedWallet = new ethers.Wallet(payload.privateKey, provider);
  } else {
    throw new Error("Invalid wallet database format.");
  }
  
  walletAddress = decryptedWallet.address;
  saveSessionUnlock(payload.phrase || payload.privateKey);
  document.dispatchEvent(new CustomEvent('hvbs-wallet-unlocked', { detail: { address: walletAddress } }));
  return decryptedWallet;
}

/**
 * Generates a brand new non-custodial wallet (Phase 3).
 * Returns mnemonic phrase for the user to back up before committing.
 */
function generateWallet() {
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    mnemonic: wallet.mnemonic.phrase,
    privateKey: wallet.privateKey
  };
}

/**
 * Commits a newly created wallet by encrypting and saving it.
 */
async function commitNewWallet(mnemonic, password) {
  const tempWallet = ethers.Wallet.fromPhrase(mnemonic);
  const payload = JSON.stringify({ phrase: mnemonic, privateKey: tempWallet.privateKey });
  const encrypted = await encryptData(payload, password);
  saveWalletToStorage(encrypted, tempWallet.address);
  
  const provider = new ethers.JsonRpcProvider(walletConfig[activeNetwork].rpcUrl);
  decryptedWallet = tempWallet.connect(provider);
  walletAddress = tempWallet.address;
  saveSessionUnlock(mnemonic);
  document.dispatchEvent(new CustomEvent('hvbs-wallet-unlocked', { detail: { address: walletAddress } }));
  return walletAddress;
}

/**
 * Imports a wallet from a mnemonic phrase or private key (Phase 3).
 */
async function importWallet(inputStr, password) {
  const cleanInput = inputStr.trim();
  let tempWallet = null;
  let payload = null;
  
  // Mnemonic phrase detection (usually 12 or 24 words)
  const wordCount = cleanInput.split(/\s+/).length;
  if (wordCount >= 12) {
    tempWallet = ethers.Wallet.fromPhrase(cleanInput);
    payload = JSON.stringify({ phrase: cleanInput, privateKey: tempWallet.privateKey });
  } else {
    // Treat as private key
    let key = cleanInput;
    if (!key.startsWith('0x') && key.length === 64) {
      key = '0x' + key;
    }
    tempWallet = new ethers.Wallet(key);
    payload = JSON.stringify({ privateKey: key });
  }
  
  const encrypted = await encryptData(payload, password);
  saveWalletToStorage(encrypted, tempWallet.address);
  
  const provider = new ethers.JsonRpcProvider(walletConfig[activeNetwork].rpcUrl);
  decryptedWallet = tempWallet.connect(provider);
  walletAddress = tempWallet.address;
  saveSessionUnlock(payload.phrase || tempWallet.privateKey);
  document.dispatchEvent(new CustomEvent('hvbs-wallet-unlocked', { detail: { address: walletAddress } }));
  return walletAddress;
}

/**
 * Fetches the wallet balance for ETH on Robinhood Chain.
 */
async function fetchWalletBalance() {
  if (!walletAddress) return "0.00";
  try {
    const provider = new ethers.JsonRpcProvider(walletConfig[activeNetwork].rpcUrl);
    const balance = await provider.getBalance(walletAddress);
    return ethers.formatEther(balance);
  } catch (e) {
    console.error("Failed to fetch balance:", e);
    return "0.00";
  }
}

/**
 * Sends native coin (ETH) or ERC-20 tokens (Phase 4).
 */
async function sendTransaction(toAddress, amount, tokenContractAddress = null) {
  if (!decryptedWallet) throw new Error("Wallet is locked. Unlock it first.");
  
  const provider = new ethers.JsonRpcProvider(walletConfig[activeNetwork].rpcUrl);
  
  // Verify target address
  if (!ethers.isAddress(toAddress)) {
    throw new Error("Invalid destination EVM address.");
  }
  
  let txHash = "";
  
  if (!tokenContractAddress) {
    // Send Native Coin (ETH)
    const tx = {
      to: toAddress,
      value: ethers.parseEther(amount.toString())
    };
    const response = await decryptedWallet.sendTransaction(tx);
    txHash = response.hash;
  } else {
    // Send ERC-20 Token
    const erc20Abi = [
      "function transfer(address to, uint amount) returns (bool)",
      "function decimals() view returns (uint8)"
    ];
    const contract = new ethers.Contract(tokenContractAddress, erc20Abi, decryptedWallet);
    const decimals = await contract.decimals();
    const parsedAmount = ethers.parseUnits(amount.toString(), decimals);
    
    const response = await contract.transfer(toAddress, parsedAmount);
    txHash = response.hash;
  }
  
  return {
    hash: txHash,
    explorerUrl: `${walletConfig[activeNetwork].explorer}/tx/${txHash}`
  };
}

/**
 * Deletes the local wallet (security purge / resetting).
 */
function deleteWallet() {
  localStorage.removeItem('hvbs_wallet_data');
  localStorage.removeItem('hvbs_wallet_address');
  try { sessionStorage.removeItem('hvbs_session_secret'); } catch (e) {}
  decryptedWallet = null;
  walletAddress = null;
  document.dispatchEvent(new CustomEvent('hvbs-wallet-deleted'));
}

// Attach functions to global window namespace
window.HVBSWallet = {
  config: walletConfig,
  getNetwork: () => activeNetwork,
  setNetwork: (net) => { if (walletConfig[net]) activeNetwork = net; },
  isLocked: () => decryptedWallet === null,
  hasWallet: hasSavedWallet,
  getAddress: () => walletAddress || getSavedAddress(),
  generate: generateWallet,
  commit: commitNewWallet,
  import: importWallet,
  unlock: unlockWallet,
  lock: lockWallet,
  delete: deleteWallet,
  getBalance: fetchWalletBalance,
  send: sendTransaction,
  restoreSession: restoreSessionWallet
};
