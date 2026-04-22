const fs = require('fs');

const file = 'c:\\Users\\Pari-Gulu\\Desktop\\HVBS-Final\\pro-alerts.html';
let content = fs.readFileSync(file, 'utf8');

// 1. Audio Settings Mute Button
content = content.replace(
  `<input type="file" id="audioUpload" accept="audio/mp3, audio/wav, audio/mpeg, audio/ogg" onchange="handleAudioUpload(event)">`,
  `<button id="muteBtn" onclick="toggleMute()" style="background:rgba(16,185,129,0.2); color:#34d399; border:1px solid rgba(16,185,129,0.3); padding:8px 14px; border-radius:8px; font-size:0.85rem; cursor:pointer; transition:all 0.2s;">🔊 Sound ON</button>\n          <input type="file" id="audioUpload" accept="audio/mp3, audio/wav, audio/mpeg, audio/ogg" onchange="handleAudioUpload(event)">`
);

// 2. Table Headers
content = content.replace(
  `<th>Value (USD)</th>`,
  `<th>Current Hit</th>\n              <th>Total History (Buy/Sell)</th>`
);

// 3. Colspan
content = content.replace(
  `<td colspan="5" style="text-align:center; color: var(--text-muted); padding: 3rem 1rem;">`,
  `<td colspan="6" style="text-align:center; color: var(--text-muted); padding: 3rem 1rem;">`
);

// 4. Variables and toggleMute
content = content.replace(
  `    let seenTrades = new Set();\n    const MAX_TRACKERS = 20;`,
  `    let seenTrades = new Set();\n    let walletStats = {};\n    const MAX_TRACKERS = 20;`
);

content = content.replace(
  `    const SOUND_COOLDOWN_MS = 15000; // 15 seconds between sounds`,
  `    const SOUND_COOLDOWN_MS = 15000; // 15 seconds between sounds\n    let isMuted = false;\n\n    function toggleMute() {\n      isMuted = !isMuted;\n      const btn = document.getElementById('muteBtn');\n      if (isMuted) {\n        btn.innerHTML = '🔇 Sound Muted';\n        btn.style.background = 'rgba(239,68,68,0.15)';\n        btn.style.color = '#f87171';\n        btn.style.borderColor = 'rgba(239,68,68,0.3)';\n        stopSound(); // stop if playing\n      } else {\n        btn.innerHTML = '🔊 Sound ON';\n        btn.style.background = 'rgba(16,185,129,0.2)';\n        btn.style.color = '#34d399';\n        btn.style.borderColor = 'rgba(16,185,129,0.3)';\n      }\n    }`
);

fs.writeFileSync(file, content);
console.log('File patched successfully');
