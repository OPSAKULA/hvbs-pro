/* ═══════════════════════════════════════════════════════
   HVBS AI – CANDLE POPUP
   Zoom-in detail card on button mouseenter/click
   Zoom-out instantly on mouseleave
═══════════════════════════════════════════════════════ */
(function initCandlePopup() {

  /* ── SVG candle chart generator ── */
  function makeSVG(candles) {
    const W = 130, H = 82, pad = 7;
    const aH = Math.max(...candles.map(c => c.h));
    const aL = Math.min(...candles.map(c => c.l));
    const rng = aH - aL || 1;
    const n = candles.length;
    const slot = (W - pad * 2) / n;
    const bw = Math.min(16, slot * 0.52);
    const yc = v => pad + (1 - (v - aL) / rng) * (H - pad * 2);
    let s = '';
    candles.forEach((cd, i) => {
      const cx = pad + slot * i + slot / 2;
      const col = cd.g === 'bull' ? '#00e07a' : '#ff4560';
      const wc  = cd.g === 'bull' ? '#009c54' : '#aa2030';
      const bt  = Math.min(yc(cd.o), yc(cd.c));
      const bb  = Math.max(yc(cd.o), yc(cd.c));
      const bh  = Math.max(bb - bt, 2);
      // upper wick
      s += `<line x1="${cx}" y1="${yc(cd.h)}" x2="${cx}" y2="${bt}" stroke="${wc}" stroke-width="1.5"/>`;
      // lower wick
      s += `<line x1="${cx}" y1="${bb}" x2="${cx}" y2="${yc(cd.l)}" stroke="${wc}" stroke-width="1.5"/>`;
      if (cd.doji) {
        // doji: thin horizontal bar
        s += `<rect x="${cx-bw/2}" y="${(bt+bb)/2-0.8}" width="${bw}" height="1.6" fill="${col}" rx="1"/>`;
        s += `<line x1="${cx-bw/2-3}" y1="${(bt+bb)/2}" x2="${cx+bw/2+3}" y2="${(bt+bb)/2}" stroke="${col}" stroke-width="1.5"/>`;
      } else {
        s += `<rect x="${cx-bw/2}" y="${bt}" width="${bw}" height="${bh}" fill="${col}" rx="2" opacity="0.92"/>`;
      }
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
  }

  /* ── All 27 pattern definitions ── */
  const CDP = {
    hammer:           { signal:'🟢', label:'Hammer',            type:'Bullish Reversal',  count:'1 Candle',   desc:'Small body near top, long lower wick (≥2× body). Buying pressure reversing a downtrend.', data:[{o:70,c:80,h:83,l:32,g:'bull'}] },
    inv_hammer:       { signal:'🟢', label:'Inverted Hammer',   type:'Bullish Reversal',  count:'1 Candle',   desc:'Small body near bottom, long upper wick. Buyers pushed price up — bullish sign after downtrend.', data:[{o:50,c:60,h:92,l:47,g:'bull'}] },
    bull_engulf:      { signal:'🟢', label:'Bullish Engulfing', type:'Bullish Reversal',  count:'2 Candles',  desc:'Small red followed by large green that fully engulfs it. Strong bullish reversal signal.', data:[{o:66,c:54,h:68,l:52,g:'bear'},{o:50,c:72,h:74,l:48,g:'bull'}] },
    piercing:         { signal:'🟢', label:'Piercing Line',     type:'Bullish Reversal',  count:'2 Candles',  desc:'Green opens below previous low, closes above its midpoint. Bulls are taking control.', data:[{o:74,c:52,h:76,l:50,g:'bear'},{o:46,c:66,h:68,l:44,g:'bull'}] },
    morning_star:     { signal:'🟢', label:'Morning Star',      type:'Bullish Reversal',  count:'3 Candles',  desc:'Large red, small star body, large green. Classic 3-candle bottom reversal pattern.', data:[{o:80,c:58,h:82,l:56,g:'bear'},{o:56,c:52,h:58,l:50,g:'bear'},{o:53,c:76,h:78,l:51,g:'bull'}] },
    morning_doji:     { signal:'🟢', label:'Morning Doji Star', type:'Bullish Reversal',  count:'3 Candles',  desc:'Red candle, doji in the middle, large green. Even stronger than Morning Star.', data:[{o:80,c:58,h:82,l:56,g:'bear'},{o:57,c:57,h:63,l:51,doji:true,g:'bull'},{o:58,c:78,h:80,l:56,g:'bull'}] },
    bull_harami:      { signal:'🟢', label:'Bullish Harami',    type:'Bullish Reversal',  count:'2 Candles',  desc:'Large red followed by smaller green inside it. Downtrend momentum is slowing down.', data:[{o:82,c:50,h:84,l:48,g:'bear'},{o:56,c:68,h:70,l:54,g:'bull'}] },
    bull_harami_cross:{ signal:'🟢', label:'Bull Harami Cross', type:'Bullish Reversal',  count:'2 Candles',  desc:'Large red followed by doji inside it. Stronger reversal signal than Bullish Harami.', data:[{o:82,c:50,h:84,l:48,g:'bear'},{o:65,c:65,h:72,l:58,doji:true,g:'bull'}] },
    three_white:      { signal:'🟢', label:'3 White Soldiers',  type:'Bullish Cont.',     count:'3 Candles',  desc:'Three consecutive green candles, each opening within prior body, closing at new highs.', data:[{o:38,c:58,h:60,l:36,g:'bull'},{o:52,c:72,h:74,l:50,g:'bull'},{o:66,c:86,h:88,l:64,g:'bull'}] },
    bull_belt:        { signal:'🟢', label:'Bullish Belt Hold', type:'Bullish Reversal',  count:'1 Candle',   desc:'Opens at session low (no lower wick), closes near the high. Strong single-candle signal.', data:[{o:28,c:78,h:80,l:28,g:'bull'}] },
    bull_kick:        { signal:'🟢', label:'Bullish Kicking',   type:'Bullish Reversal',  count:'2 Candles',  desc:'Red marubozu then gap-up green marubozu. No wicks on either. Very strong signal.', data:[{o:72,c:50,h:73,l:50,g:'bear'},{o:62,c:86,h:86,l:62,g:'bull'}] },
    bull_meet:        { signal:'🟢', label:'Bullish Meeting Ln',type:'Bullish Reversal',  count:'2 Candles',  desc:'Red and green candles close at the exact same price. Selling pressure appears exhausted.', data:[{o:76,c:54,h:78,l:52,g:'bear'},{o:40,c:54,h:56,l:38,g:'bull'}] },
    tower_bot:        { signal:'🟢', label:'Tower Bottom',      type:'Bullish Reversal',  count:'5 Candles',  desc:'Large red → 3 small bodies → large green. Tower-like structure signals strong bullish reversal.', data:[{o:84,c:60,h:86,l:58,g:'bear'},{o:60,c:56,h:62,l:54,g:'bear'},{o:55,c:57,h:59,l:53,g:'bull'},{o:57,c:54,h:59,l:52,g:'bear'},{o:53,c:80,h:82,l:51,g:'bull'}] },
    three_stars_s:    { signal:'🟢', label:'3 Stars in South',  type:'Bullish Reversal',  count:'3 Candles',  desc:'Three red candles with decreasing body and narrowing range. Bearish momentum exhausting.', data:[{o:80,c:52,h:82,l:38,g:'bear'},{o:68,c:48,h:70,l:42,g:'bear'},{o:56,c:46,h:58,l:44,g:'bear'}] },
    frypat_bot:       { signal:'🟢', label:'Frypan Bottom',     type:'Bullish Reversal',  count:'5+ Candles', desc:'Prices round down forming a bowl shape then gap up. Rare but powerful reversal pattern.', data:[{o:72,c:62,h:74,l:60,g:'bear'},{o:60,c:52,h:62,l:50,g:'bear'},{o:51,c:49,h:53,l:47,g:'bear'},{o:49,c:56,h:58,l:47,g:'bull'},{o:57,c:72,h:74,l:55,g:'bull'}] },
    hanging:          { signal:'🔴', label:'Hanging Man',       type:'Bearish Reversal',  count:'1 Candle',   desc:'Same shape as Hammer but appears in uptrend. Long lower wick shows bears are testing support.', data:[{o:78,c:68,h:80,l:30,g:'bear'}] },
    shooting:         { signal:'🔴', label:'Shooting Star',     type:'Bearish Reversal',  count:'1 Candle',   desc:'Small body near bottom, long upper wick. Buyers pushed price up but sellers regained control.', data:[{o:60,c:48,h:94,l:45,g:'bear'}] },
    bear_engulf:      { signal:'🔴', label:'Bearish Engulfing', type:'Bearish Reversal',  count:'2 Candles',  desc:'Small green followed by large red that fully engulfs it. Strong bearish reversal signal.', data:[{o:48,c:62,h:64,l:46,g:'bull'},{o:65,c:43,h:67,l:40,g:'bear'}] },
    dark_cloud:       { signal:'🔴', label:'Dark Cloud Cover',  type:'Bearish Reversal',  count:'2 Candles',  desc:'Green then red opens above high, closes below midpoint. Classic bearish reversal signal.', data:[{o:48,c:74,h:76,l:46,g:'bull'},{o:79,c:57,h:81,l:54,g:'bear'}] },
    evening_star:     { signal:'🔴', label:'Evening Star',      type:'Bearish Reversal',  count:'3 Candles',  desc:'Large green, small star, large red. Classic 3-candle top reversal pattern.', data:[{o:40,c:72,h:74,l:38,g:'bull'},{o:74,c:78,h:82,l:72,g:'bull'},{o:77,c:54,h:79,l:52,g:'bear'}] },
    evening_doji:     { signal:'🔴', label:'Evening Doji Star', type:'Bearish Reversal',  count:'3 Candles',  desc:'Green candle, doji at top, large red. Stronger than Evening Star — strong top reversal.', data:[{o:40,c:72,h:74,l:38,g:'bull'},{o:74,c:74,h:81,l:67,doji:true,g:'bear'},{o:73,c:50,h:75,l:48,g:'bear'}] },
    bear_harami:      { signal:'🔴', label:'Bearish Harami',    type:'Bearish Reversal',  count:'2 Candles',  desc:'Large green followed by smaller red inside it. Uptrend momentum may be slowing.', data:[{o:40,c:84,h:86,l:38,g:'bull'},{o:72,c:60,h:74,l:58,g:'bear'}] },
    bear_harami_cross:{ signal:'🔴', label:'Bear Harami Cross', type:'Bearish Reversal',  count:'2 Candles',  desc:'Large green followed by doji inside it. Stronger reversal signal than Bearish Harami.', data:[{o:40,c:84,h:86,l:38,g:'bull'},{o:64,c:64,h:72,l:56,doji:true,g:'bear'}] },
    three_black:      { signal:'🔴', label:'3 Black Crows',     type:'Bearish Cont.',     count:'3 Candles',  desc:'Three consecutive red candles, each opening within prior body, closing at new lows.', data:[{o:82,c:62,h:84,l:60,g:'bear'},{o:66,c:46,h:68,l:44,g:'bear'},{o:50,c:30,h:52,l:28,g:'bear'}] },
    bear_belt:        { signal:'🔴', label:'Bearish Belt Hold', type:'Bearish Reversal',  count:'1 Candle',   desc:'Opens at session high (no upper wick), closes near the low. Strong single-candle bearish signal.', data:[{o:84,c:36,h:84,l:34,g:'bear'}] },
    bear_kick:        { signal:'🔴', label:'Bearish Kicking',   type:'Bearish Reversal',  count:'2 Candles',  desc:'Green marubozu then gap-down red marubozu. No wicks on either. Very strong bearish signal.', data:[{o:40,c:72,h:72,l:40,g:'bull'},{o:60,c:36,h:60,l:36,g:'bear'}] },
    bear_meet:        { signal:'🔴', label:'Bearish Meeting Ln',type:'Bearish Reversal',  count:'2 Candles',  desc:'Green and red candles close at the same price. Buying momentum appears exhausted.', data:[{o:42,c:70,h:72,l:40,g:'bull'},{o:82,c:70,h:84,l:67,g:'bear'}] },
    tower_top:        { signal:'🔴', label:'Tower Top',         type:'Bearish Reversal',  count:'5 Candles',  desc:'Large green → 3 small bodies → large red. Tower-like top signals a strong bearish reversal.', data:[{o:40,c:72,h:74,l:38,g:'bull'},{o:70,c:74,h:76,l:68,g:'bull'},{o:73,c:70,h:76,l:68,g:'bear'},{o:71,c:74,h:76,l:69,g:'bull'},{o:75,c:42,h:77,l:40,g:'bear'}] },
    upsidegap2:       { signal:'🔴', label:'Upside Gap 2 Crows',type:'Bearish Reversal',  count:'3 Candles',  desc:'Green candle, red gaps up above it, second red engulfs the first. Bearish reversal at top.', data:[{o:44,c:68,h:70,l:42,g:'bull'},{o:76,c:64,h:80,l:62,g:'bear'},{o:79,c:56,h:81,l:54,g:'bear'}] },
    adv_block:        { signal:'🔴', label:'Advance Block',     type:'Bearish Reversal',  count:'3 Candles',  desc:'Three green candles with diminishing bodies and long upper wicks. Bulls losing momentum.', data:[{o:38,c:72,h:76,l:36,g:'bull'},{o:66,c:82,h:92,l:64,g:'bull'},{o:78,c:87,h:97,l:76,g:'bull'}] },
    bear_brkaway:     { signal:'🔴', label:'Bearish Breakaway', type:'Bearish Reversal',  count:'5 Candles',  desc:'4 green candles with a gap, then large red breaks down. Strong top reversal pattern.', data:[{o:40,c:58,h:60,l:38,g:'bull'},{o:65,c:74,h:76,l:63,g:'bull'},{o:71,c:80,h:82,l:69,g:'bull'},{o:77,c:86,h:88,l:75,g:'bull'},{o:84,c:56,h:85,l:54,g:'bear'}] },
    dumpling_top:     { signal:'🔴', label:'Dumpling Top',      type:'Bearish Reversal',  count:'5+ Candles', desc:'Prices form a dome shape then gap down. Rare but powerful long-term top reversal pattern.', data:[{o:52,c:68,h:70,l:50,g:'bull'},{o:65,c:76,h:78,l:63,g:'bull'},{o:74,c:72,h:78,l:70,g:'bear'},{o:70,c:60,h:72,l:58,g:'bear'},{o:58,c:42,h:60,l:40,g:'bear'}] },
    stick_sand:       { signal:'🔴', label:'Stick Sandwich',    type:'Bearish Cont.',     count:'3 Candles',  desc:'Red → Green → Red where first and last red close at same level. Bearish continuation signal.', data:[{o:74,c:52,h:76,l:50,g:'bear'},{o:50,c:70,h:72,l:48,g:'bull'},{o:72,c:52,h:74,l:50,g:'bear'}] },
  };

  /* ── Popup element refs ── */
  const popup = document.getElementById('candleDetailPopup');
  const elSig = document.getElementById('cdpSignal');
  const elLbl = document.getElementById('cdpLabel');
  const elTyp = document.getElementById('cdpType');
  const elCnt = document.getElementById('cdpCount');
  const elSvg = document.getElementById('cdpSvg');
  const elDsc = document.getElementById('cdpDesc');
  if (!popup) return;

  let hideTimer = null;

  function showPopup(btn, key) {
    const d = CDP[key];
    if (!d) return;
    clearTimeout(hideTimer);

    /* Fill in data */
    elSig.textContent = d.signal;
    elLbl.textContent = d.label;
    elTyp.textContent = d.type;
    elTyp.className   = 'cdp-type-badge ' + (d.signal === '🟢' ? 'bull' : 'bear');
    elCnt.textContent = '📊 ' + d.count;
    elSvg.innerHTML   = makeSVG(d.data);
    elDsc.textContent = d.desc;

    /* Position to the right of the button */
    const r = btn.getBoundingClientRect();
    let left = r.right + 10;
    let top  = r.top   - 10;

    /* Keep within viewport */
    if (left + 220 > window.innerWidth)  left = r.left - 220;
    if (top  + 265 > window.innerHeight) top  = window.innerHeight - 265;
    if (top < 4) top = 4;

    popup.style.left = left + 'px';
    popup.style.top  = top  + 'px';
    popup.classList.add('cdp-visible');
  }

  function hidePopup() {
    hideTimer = setTimeout(() => popup.classList.remove('cdp-visible'), 80);
  }

  /* ── Wire up all candle buttons ── */
  Object.keys(CDP).forEach(key => {
    const btn = document.getElementById('cBtn_' + key);
    if (!btn) return;
    btn.addEventListener('mouseenter', () => showPopup(btn, key));
    btn.addEventListener('mouseleave', hidePopup);
    btn.addEventListener('click',      () => showPopup(btn, key));
  });

  /* Keep popup open while hovering over it */
  popup.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  popup.addEventListener('mouseleave', hidePopup);

})();
