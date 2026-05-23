/* ═══════════════════════════════════════════════════
   HVBS AI – Live Token Chart  |  script.js
   Fixed: price display + chart render timeout bug
═══════════════════════════════════════════════════ */
'use strict';

const DEX_API    = 'https://api.dexscreener.com/latest/dex/tokens';
const GT_API     = 'https://api.geckoterminal.com/api/v2';
const REFRESH_MS = 1000;
const SIM_COUNT  = 60;
const CHART_H    = 520;

const S = {
  contract:'', pairAddr:'', gtNet:'', chart:null, series:null,
  refreshId:null, countId:null, countdown:10,
  lastPrice:null, simMode:false, simBuf:[], lastCandle:null,
  tokenPrice:null, tokenMcap:null, chartData:[]
};

/* ── DOM ── */
const $  = id => document.getElementById(id);
const contractInput=$('contractInput'), chainSelect=$('chainSelect'), loadBtn=$('loadBtn');
const tokenInfoBar=$('tokenInfoBar'), elName=$('tokenName'), elSymbol=$('tokenSymbol');
const elPrice=$('tokenPrice'), elFlash=$('priceFlash'), el24h=$('token24h');
const elMcap=$('tokenMcap'), elVol=$('tokenVol'), elCountdown=$('countdownVal');
const elPlaceholder=$('chartPlaceholder'), elError=$('chartError');
const elLoader=$('chartLoader'), elLoaderTxt=$('loaderText');
const elContainer=$('chartContainer'), elErrTitle=$('errorTitle'), elErrMsg=$('errorMsg');
const elRetry=$('retryBtn'), alertPanel=$('alertPanel'), alertInput=$('alertInput');
const setAlertBtn=$('setAlertBtn'), alertStatus=$('alertStatus');
const liveDot=$('liveDot');

const soundSelect = $('soundSelect');
const fileGroup = $('fileGroup');
const audioFile = $('audioFile');
const stopSoundBtn = $('stopSoundBtn');
const alertsList = $('alertsList');

/* ── TIMEFRAME CONFIG ── */
const ALL_TIMEFRAMES = [
  { id: '1s', label: '1s', hours: 0.000277, secs: 1, apiTf: 'minute', apiAgg: 1 },
  { id: '1m', label: '1m', hours: 0.0166, secs: 60, apiTf: 'minute', apiAgg: 1 },
  { id: '3m', label: '3m', hours: 0.05, secs: 180, apiTf: 'minute', apiAgg: 1 },
  { id: '5m', label: '5m', hours: 0.0833, secs: 300, apiTf: 'minute', apiAgg: 5 },
  { id: '10m', label: '10m', hours: 0.166, secs: 600, apiTf: 'minute', apiAgg: 5 },
  { id: '15m', label: '15m', hours: 0.25, secs: 900, apiTf: 'minute', apiAgg: 15 },
  { id: '20m', label: '20m', hours: 0.333, secs: 1200, apiTf: 'minute', apiAgg: 15 },
  { id: '30m', label: '30m', hours: 0.5, secs: 1800, apiTf: 'minute', apiAgg: 15 },
  { id: '45m', label: '45m', hours: 0.75, secs: 2700, apiTf: 'minute', apiAgg: 15 },
  { id: '1h', label: '1H', hours: 1, secs: 3600, apiTf: 'hour', apiAgg: 1 },
  { id: '2h', label: '2H', hours: 2, secs: 7200, apiTf: 'hour', apiAgg: 1 },
  { id: '3h', label: '3H', hours: 3, secs: 10800, apiTf: 'hour', apiAgg: 4 },
  { id: '4h', label: '4H', hours: 4, secs: 14400, apiTf: 'hour', apiAgg: 4 },
  { id: '12h', label: '12H', hours: 12, secs: 43200, apiTf: 'hour', apiAgg: 12 },
  { id: '1d', label: '1D', hours: 24, secs: 86400, apiTf: 'day', apiAgg: 1 },
  { id: '1w', label: '1W', hours: 168, secs: 604800, apiTf: 'day', apiAgg: 1 },
  { id: '15d', label: '15D', hours: 360, secs: 1296000, apiTf: 'day', apiAgg: 1 },
  { id: '30d', label: '30D', hours: 720, secs: 2592000, apiTf: 'day', apiAgg: 1 }
];

const tfButtonsContainer = $('tfButtons');
const tfMenuBtn = $('tfMenuBtn');
const tfMenuDropdown = $('tfMenuDropdown');
const tfOptionsGrid = $('tfOptionsGrid');

let chosenTfIds = JSON.parse(localStorage.getItem('hvbs_chosen_tfs')) || ['1m', '5m', '1h', '1d', '1w'];
let activeTfId = localStorage.getItem('hvbs_active_tf') || chosenTfIds[0];

const tvTfButtons = $('tvTfButtons');

function renderTimeframes() {
  if (tvTfButtons) tvTfButtons.innerHTML = '';
  
  ALL_TIMEFRAMES.forEach(tf => {
    if (chosenTfIds.includes(tf.id)) {
      if (tvTfButtons) {
        const btn2 = document.createElement('button');
        btn2.className = `tf-btn ${tf.id === activeTfId ? 'active' : ''}`;
        btn2.dataset.tf = tf.hours;
        btn2.dataset.secs = tf.secs;
        btn2.dataset.apiTf = tf.apiTf;
        btn2.dataset.apiAgg = tf.apiAgg;
        btn2.textContent = tf.label;
        btn2.addEventListener('click', () => {
          document.querySelectorAll('.tf-buttons .tf-btn').forEach(b => b.classList.remove('active'));
          btn2.classList.add('active');
          activeTfId = tf.id;
          localStorage.setItem('hvbs_active_tf', activeTfId);
          if (S.contract) loadChart();
        });
        tvTfButtons.appendChild(btn2);
      }
    }
  });
}

function renderTfOptions() {
  if (!tfOptionsGrid) return;
  tfOptionsGrid.innerHTML = '';
  ALL_TIMEFRAMES.forEach(tf => {
    const label = document.createElement('label');
    label.style.cssText = 'display: flex; align-items: center; justify-content: flex-start; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-1); cursor: pointer; padding: 8px 10px; border-radius: 6px; background: var(--bg-2); border: 1px solid var(--border);';
    
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = tf.id;
    cb.checked = chosenTfIds.includes(tf.id);
    cb.style.cssText = 'accent-color: var(--accent); cursor: pointer;';
    
    cb.addEventListener('change', () => {
      const checked = Array.from(tfOptionsGrid.querySelectorAll('input:checked')).map(i => i.value);
      if (checked.length > 5) {
        cb.checked = false;
        return;
      }
      if (checked.length === 5) {
        chosenTfIds = checked;
        localStorage.setItem('hvbs_chosen_tfs', JSON.stringify(chosenTfIds));
        if (!chosenTfIds.includes(activeTfId)) {
          activeTfId = chosenTfIds[0];
          localStorage.setItem('hvbs_active_tf', activeTfId);
        }
        renderTimeframes();
      }
    });
    
    label.appendChild(cb);
    label.appendChild(document.createTextNode(tf.label));
    tfOptionsGrid.appendChild(label);
  });
}

if (tfMenuBtn && tfMenuDropdown) {
  tfMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    tfMenuDropdown.style.display = tfMenuDropdown.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', (e) => {
    if (!tfMenuDropdown.contains(e.target) && e.target !== tfMenuBtn) {
      tfMenuDropdown.style.display = 'none';
    }
  });
}

/* ── FORMAT ── */
function fmtPrice(n) {
  if (n == null || isNaN(n) || n <= 0) return '–';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', {maximumFractionDigits:2});
  if (n >= 1)    return '$' + n.toFixed(4);
  if (n >= 0.01) return '$' + n.toFixed(6);
  // Very small: find enough decimals for 4 significant figures
  const exp = Math.floor(Math.log10(n));
  const dec  = Math.min(Math.max(2, -exp + 3), 12);
  return '$' + n.toFixed(dec);
}
function fmtBig(n) {
  if (!n || isNaN(n)) return '–';
  if (n>=1e9) return '$'+(n/1e9).toFixed(2)+'B';
  if (n>=1e6) return '$'+(n/1e6).toFixed(2)+'M';
  if (n>=1e3) return '$'+(n/1e3).toFixed(2)+'K';
  return '$'+n.toFixed(2);
}
function fmtPct(n) {
  if (n==null||isNaN(n)) return '–';
  return (n>=0?'+':'')+n.toFixed(2)+'%';
}

/* ── ADDRESS UTILS ── */
function isEVM(a)   { return /^0x[0-9a-fA-F]{40}$/.test(a); }
function isSolana(a){ return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) && !a.startsWith('0x'); }
function isValid(a) { return isEVM(a)||isSolana(a); }

/* ── UI HELPERS ── */
function showPlaceholder(){
  elPlaceholder.hidden=false; elError.hidden=true; elLoader.hidden=true; elContainer.hidden=true;
  const tb = $('chartToolbar'); if (tb) tb.style.display = 'none';
  const dto = $('drawingToolsOverlay'); if (dto) dto.classList.remove('dt-visible');
  const bit = $('bottomIndicatorToolbar'); if (bit) bit.style.display = 'none';
}
function showLoader(msg){
  elLoaderTxt.textContent=msg||'Loading…'; elLoader.style.display=''; elPlaceholder.hidden=true; elError.hidden=true; elLoader.hidden=false; elContainer.hidden=true;
  const tb = $('chartToolbar'); if (tb) tb.style.display = 'none';
  const dto = $('drawingToolsOverlay'); if (dto) dto.classList.remove('dt-visible');
  const bit = $('bottomIndicatorToolbar'); if (bit) bit.style.display = 'none';
}
function showError(t,m){
  elErrTitle.textContent=t; elErrMsg.textContent=m; elPlaceholder.hidden=true; elError.hidden=false; elLoader.hidden=true; elContainer.hidden=true; setLive(false);
  const tb = $('chartToolbar'); if (tb) tb.style.display = 'none';
  const dto = $('drawingToolsOverlay'); if (dto) dto.classList.remove('dt-visible');
  const bit = $('bottomIndicatorToolbar'); if (bit) bit.style.display = 'none';
}
function revealChart(){
  elPlaceholder.hidden=true; elError.hidden=true; elLoader.hidden=true; elContainer.hidden=false;
  const tb = $('chartToolbar'); if (tb) tb.style.display = 'flex';
  // Show drawing tools overlay
  const dto = $('drawingToolsOverlay');
  if (dto) dto.classList.add('dt-visible');
  const bit = $('bottomIndicatorToolbar'); if (bit) bit.style.display = 'flex';
}
function setLive(on){on?liveDot.classList.add('active'):liveDot.classList.remove('active');}
function setBtnState(loading){loadBtn.disabled=loading;loadBtn.querySelector('.btn-text').textContent=loading?'Loading…':'Load Chart';loadBtn.querySelector('.btn-icon').textContent=loading?'⏳':'▶';}
function flashPrice(up){elFlash.className='';void elFlash.offsetWidth;elFlash.className='price-flash '+(up?'flash-up':'flash-down');}
function setAlertMsg(type,msg){alertStatus.textContent=msg;alertStatus.className='alert-status '+type;alertStatus.hidden=false;}

/* ── FETCH WITH TIMEOUT ── */
async function fetchT(url, timeoutMs=6000) {
  const ctrl = new AbortController();
  const tid   = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {signal: ctrl.signal});
    clearTimeout(tid);
    if (!res.ok) return null;
    return await res.json();
  } catch(e) {
    clearTimeout(tid);
    return null;   // timeout or network error → return null cleanly
  }
}

/* ── DEXSCREENER ── */
async function fetchDex(contract) {
  const data = await fetchT(`${DEX_API}/${contract}`, 8000);
  if (!data || !data.pairs || !data.pairs.length) return null;
  const best = data.pairs.sort((a,b)=>
    parseFloat(b.liquidity?.usd||0)-parseFloat(a.liquidity?.usd||0)
  )[0];
  return {
    name:     best.baseToken?.name   || 'Unknown',
    symbol:   best.baseToken?.symbol || '???',
    price:    parseFloat(best.priceUsd    || 0),
    pct24h:   parseFloat(best.priceChange?.h24 || 0),
    mcap:     parseFloat(best.marketCap   || 0),
    vol24h:   parseFloat(best.volume?.h24 || 0),
    pairAddr: best.pairAddress || '',
    chainId:  best.chainId    || '',
  };
}

/* ── GECKOTERMINAL OHLCV (3-second timeout) ── */
const CHAIN_GT = {
  ethereum:'eth', bsc:'bsc', solana:'solana', base:'base',
  polygon:'polygon_pos', arbitrum:'arbitrum', optimism:'optimism',
  avax:'avax', fantom:'ftm',
};
function chainToGt(c){ return CHAIN_GT[c?.toLowerCase()] || c?.toLowerCase() || 'eth'; }

function getCandleIntervalSecs(tfHours) {
  const activeBtn = document.querySelector('.tf-btn.active');
  if (activeBtn && activeBtn.dataset.secs) {
    return parseInt(activeBtn.dataset.secs, 10);
  }
  if (tfHours <= 1) return 60;           // 1m
  if (tfHours <= 24) return 900;         // 15m
  if (tfHours <= 168) return 3600;       // 1h
  return 86400;                          // 1d
}

async function fetchGtOHLCV(pairAddr, gtNet, tfHours) {
  if (!pairAddr || !gtNet) return null;
  let tf = 'minute', agg = 15;
  const activeBtn = document.querySelector('.tf-btn.active');
  if (activeBtn && activeBtn.dataset.apiTf && activeBtn.dataset.apiAgg) {
    tf = activeBtn.dataset.apiTf;
    agg = parseInt(activeBtn.dataset.apiAgg, 10);
  } else {
    if      (tfHours <= 1)   { tf = 'minute'; agg = 1; }
    else if (tfHours <= 24)  { tf = 'minute'; agg = 15; }
    else if (tfHours <= 168) { tf = 'hour';   agg = 1; }
    else                     { tf = 'day';    agg = 1; }
  }

  const cacheKey = `hvbs_ohlcv_${pairAddr}_${tf}_${agg}`;
  
  let raw = null;
  try {
    const url = `${GT_API}/networks/${gtNet}/pools/${pairAddr}/ohlcv/${tf}?aggregate=${agg}&limit=1000&currency=usd`;
    const data = await fetchT(url, 8000);
    if (data?.data?.attributes?.ohlcv_list) {
      raw = data.data.attributes.ohlcv_list;
      
      // Fetch up to 3 more pages to get older data (e.g. back to January)
      for (let p = 0; p < 3; p++) {
        if (!raw || raw.length === 0) break;
        const oldestTime = raw[raw.length - 1][0];
        const nextUrl = `${GT_API}/networks/${gtNet}/pools/${pairAddr}/ohlcv/${tf}?aggregate=${agg}&limit=1000&currency=usd&before_timestamp=${oldestTime}`;
        const nextData = await fetchT(nextUrl, 8000);
        if (nextData?.data?.attributes?.ohlcv_list && nextData.data.attributes.ohlcv_list.length > 0) {
          raw = raw.concat(nextData.data.attributes.ohlcv_list);
        } else {
          break;
        }
      }
      try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), raw })); } catch(e) {}
    }
  } catch (err) {}

  if (!raw) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        raw = parsed.raw;
        console.log('[HVBS] Using cached OHLCV data');
      }
    } catch(e) {}
  }

  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;

  const allCandles = raw.map(c => ({
    time: Math.floor(Number(c[0])),
    open: Number(c[1]), high: Number(c[2]),
    low: Number(c[3]), close: Number(c[4]),
    volume: Number(c[5]) || 0
  })).filter(c => c.time > 100000 && !isNaN(c.open) && c.low > 0);

  const deduped = allCandles
    .sort((a,b) => a.time - b.time)
    .filter((c, i, arr) => i === 0 || c.time !== arr[i-1].time);

  return deduped.length >= 2 ? deduped : null;
}

/* ── SIMULATION ── */
function buildSim(basePrice, count, intervalSecs) {
  const now = Math.floor(Date.now()/1000);
  const candles=[];
  let p = basePrice || 0.000001;
  
  // Generate backwards from current time to avoid giant spikes at the end
  for (let i=0; i<count; i++) {
    const move = p * (Math.random() - 0.5) * 0.04;
    const close = p;
    const open = Math.max(close + move, 1e-20);
    p = open; // The previous candle's close will be near this open
    
    const bodySize = Math.abs(close - open);
    const wickRng = bodySize * (0.2 + Math.random() * 0.8);
    
    candles.unshift({
      time:  now - i * intervalSecs,
      open, close,
      high:  Math.max(open,close) + wickRng,
      low:   Math.max(Math.min(open,close) - wickRng, 1e-20),
    });
  }
  return candles;
}

/* ── DEDUP timestamps ── */
function dedup(arr) {
  const seen=new Set();
  return arr.sort((a,b)=>a.time-b.time).filter(c=>{
    if(seen.has(c.time))return false;
    seen.add(c.time);return true;
  });
}

/* ── INIT CHART ── */
function initChart() {
  if (S.chart) { try{S.chart.remove();}catch(_){} S.chart=null; S.series=null; S.alertLine=null; }
  currentSeriesType = localStorage.getItem('hvbs_chart_type') || 'candle';
  
  elContainer.style.height = CHART_H + 'px';
  elContainer.style.display = 'block';
  elContainer.hidden = false;
  
  const leftToolbar = document.getElementById('leftToolbar');
  if (leftToolbar) leftToolbar.style.display = 'flex';
  
  // Wire up collapse toggle + drag (once)
  if (leftToolbar && !leftToolbar._toggleWired) {
    leftToolbar._toggleWired = true;
    const fcpHeader = document.getElementById('fcpHeader');
    if (fcpHeader) {
      // Toggle collapse on header click (but not if dragging)
      let _dragging = false;
      fcpHeader.addEventListener('click', (e) => {
        if (_dragging) { _dragging = false; return; }
        leftToolbar.classList.toggle('fcp-collapsed');
      });

      // Drag-to-reposition
      let dragStartX, dragStartY, panelStartLeft, panelStartTop;
      fcpHeader.addEventListener('mousedown', (ev) => {
        if (ev.target.closest('.fcp-toggle')) return;
        _dragging = false;
        dragStartX = ev.clientX; dragStartY = ev.clientY;
        const rect = leftToolbar.getBoundingClientRect();
        const parentRect = elContainer.getBoundingClientRect();
        panelStartLeft = rect.left - parentRect.left;
        panelStartTop  = rect.top  - parentRect.top;
        const onMove = (me) => {
          const dx = me.clientX - dragStartX, dy = me.clientY - dragStartY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _dragging = true;
          if (!_dragging) return;
          const newL = Math.max(4, Math.min(panelStartLeft + dx, elContainer.clientWidth - leftToolbar.offsetWidth - 4));
          const newT = Math.max(4, Math.min(panelStartTop  + dy, elContainer.clientHeight - 36));
          leftToolbar.style.left = newL + 'px';
          leftToolbar.style.top  = newT + 'px';
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }
  }

  
  const w = elContainer.clientWidth || (window.innerWidth - 110);
  const chart = LightweightCharts.createChart(elContainer,{
    width:w, height:CHART_H,
    layout:{background:{type:'solid',color:'#14142a'},textColor:'#9898bb'},
    grid:{vertLines:{color:'rgba(255,255,255,0.04)'},horzLines:{color:'rgba(255,255,255,0.04)'}},
    crosshair:{
      mode:LightweightCharts.CrosshairMode.Normal,
      vertLine:{color:'rgba(108,99,255,0.5)',labelBackgroundColor:'#6c63ff'},
      horzLine:{color:'rgba(108,99,255,0.5)',labelBackgroundColor:'#6c63ff'}
    },
    rightPriceScale:{borderColor:'rgba(255,255,255,0.07)',scaleMargins:{top:0.08,bottom:0.25},autoScale:true},
    timeScale:{borderColor:'rgba(255,255,255,0.07)',timeVisible:true,secondsVisible:false,rightOffset:2,barSpacing:8},
    handleScroll:true, handleScale:true,
  });
  
  let series;
  const comOpts = {
    priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    lastValueVisible: true, priceLineVisible: true, priceLineColor: '#FFB6C1', priceLineWidth: 1, priceLineStyle: LightweightCharts.LineStyle.Dashed,
  };

  if (currentSeriesType === 'area') {
    series = chart.addAreaSeries({ topColor: 'rgba(108, 99, 255, 0.4)', bottomColor: 'rgba(108, 99, 255, 0.0)', lineColor: '#6c63ff', lineWidth: 2, ...comOpts });
  } else if (currentSeriesType === 'line') {
    series = chart.addLineSeries({ color: '#00e07a', lineWidth: 2, ...comOpts });
  } else if (currentSeriesType === 'bar') {
    series = chart.addBarSeries({ upColor: '#00e07a', downColor: '#ff4560', ...comOpts });
  } else if (currentSeriesType === 'baseline') {
    let basePrice = S.tokenPrice || 0;
    if (typeof mcapMode !== 'undefined' && mcapMode && S.tokenMcap && S.tokenPrice) {
      basePrice = basePrice * (S.tokenMcap / S.tokenPrice);
    }
    series = chart.addBaselineSeries({ 
      baseValue: { type: 'price', price: basePrice }, 
      topLineColor: '#00e07a', topFillColor1: 'rgba(0, 224, 122, 0.28)', topFillColor2: 'rgba(0, 224, 122, 0.05)', 
      bottomLineColor: '#ff4560', bottomFillColor1: 'rgba(255, 69, 96, 0.05)', bottomFillColor2: 'rgba(255, 69, 96, 0.28)', 
      lineWidth: 2, ...comOpts 
    });
  } else if (currentSeriesType === 'histogram') {
    series = chart.addHistogramSeries({ color: '#6c63ff', ...comOpts });
  } else {
    series = chart.addCandlestickSeries({ upColor:'#00e07a', downColor:'#ff4560', borderVisible:false, wickUpColor:'#00e07a', wickDownColor:'#ff4560', ...comOpts });
  }
  
  new ResizeObserver(()=>{if(S.chart)S.chart.applyOptions({width:elContainer.clientWidth});}).observe(elContainer);
  
  // LEGEND overlay
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  legend.style.cssText = 'position: absolute; left: 14px; top: 14px; z-index: 20; font-family: var(--mono); pointer-events: none; display: flex; flex-direction: column; gap: 4px;';
  elContainer.appendChild(legend);

  chart.subscribeCrosshairMove(param => {
    if (param.time) {
      const data = param.seriesData.get(series);
      if (data) {
        let o = data.open, h = data.high, l = data.low, c = data.close;
        if (typeof o === 'undefined') { o = h = l = c = data.value; }
        legend.innerHTML = `
          <div style="display:flex; gap:10px; font-size:12px; font-weight:600;">
            <span style="color:var(--text-2)">O</span><span style="color:#fff">${fmtPrice(o)}</span>
            <span style="color:var(--text-2)">H</span><span style="color:#fff">${fmtPrice(h)}</span>
            <span style="color:var(--text-2)">L</span><span style="color:#fff">${fmtPrice(l)}</span>
            <span style="color:var(--text-2)">C</span><span style="color:${c>=o?'var(--green)':'var(--red)'}">${fmtPrice(c)}</span>
          </div>
        `;
      }
    } else {
      legend.innerHTML = '';
    }
  });

  S.chart=chart; S.series=series;
  if (typeof bindDrawingEvents === 'function') bindDrawingEvents(chart, series);
}

/* ── INFO BAR ── */
function updateBar(name,symbol,price,pct24h,mcap,vol24h,sim) {
  elName.textContent   = name||'–';
  elSymbol.textContent = symbol||'–';
  const old=S.lastPrice;
  elPrice.textContent=fmtPrice(price);
  if(old!==null&&price!==old)flashPrice(price>=old);
  S.lastPrice=price;
  if(pct24h!=null&&!isNaN(pct24h)){el24h.textContent=fmtPct(pct24h);el24h.className='chip-val '+(pct24h>=0?'up':'down');}
  else{el24h.textContent='–';el24h.className='chip-val';}
  elMcap.textContent = sim ? '~simulated~' : fmtBig(mcap);
  elVol.textContent  = fmtBig(vol24h)||'–';
  tokenInfoBar.hidden=false;
}

/* ── ALERT ── */
let alertLines = {}; 
let alerts = JSON.parse(localStorage.getItem('hvbs_alerts')) || [];
let customAudioSrc = localStorage.getItem('hvbs_custom_audio') || null;
let playingAudio = null;

function playBeep() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1);
    osc.start();
    osc.stop(audioCtx.currentTime + 1);
  } catch(e) { console.error(e); }
}

function playSound() {
  stopSound();
  if (soundSelect && soundSelect.value === 'beep') {
    playBeep();
  } else if (customAudioSrc) {
    playingAudio = new Audio(customAudioSrc);
    playingAudio.loop = false;
    playingAudio.play().catch(e => console.error(e));
  } else {
    playBeep();
  }
  if (stopSoundBtn) stopSoundBtn.style.display = 'inline-block';
}

function stopSound() {
  if (playingAudio) {
    playingAudio.pause();
    playingAudio.currentTime = 0;
    playingAudio = null;
  }
  if (stopSoundBtn) stopSoundBtn.style.display = 'none';
}

function removeAlert(id) {
  const idx = alerts.findIndex(a => a.id === id);
  if (idx > -1) {
    const alertItem = alerts[idx];
    if (alertLines[alertItem.id] && S.series) {
      try { S.series.removePriceLine(alertLines[alertItem.id]); } catch (_) {}
      delete alertLines[alertItem.id];
    }
    alerts.splice(idx, 1);
    localStorage.setItem('hvbs_alerts', JSON.stringify(alerts));
    renderAlertsList();
  }
}

function clearAllAlertLines() {
  if (S.series) {
    Object.values(alertLines).forEach(line => {
      try { S.series.removePriceLine(line); } catch (_) {}
    });
  }
  alertLines = {};
}

function drawAllAlerts() {
  clearAllAlertLines();
  if (!S.series) return;
  alerts.forEach(alertItem => {
    const line = S.series.createPriceLine({
      price: alertItem.price,
      color: alertItem.hit ? '#00e07a' : '#f5c518',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: alertItem.hit ? '✅ HIT' : '🔔 ALERT'
    });
    alertLines[alertItem.id] = line;
  });
  renderAlertsList();
}

function renderAlertsList() {
  if (!alertsList) return;
  alertsList.innerHTML = '';
  alerts.forEach(alertItem => {
    const badge = document.createElement('div');
    badge.className = 'alert-badge';
    badge.style.cssText = `display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: ${alertItem.hit ? 'var(--green-dim)' : 'var(--bg-card)'}; border: 1px solid ${alertItem.hit ? 'var(--green)' : 'var(--border)'}; border-radius: 6px; font-size: 13px; font-weight: 600; color: ${alertItem.hit ? 'var(--green)' : 'var(--text-1)'};`;
    
    badge.innerHTML = `
      <span>🔔 ${fmtPrice(alertItem.price)}</span>
      <span style="font-size: 10px; opacity: 0.7;">(${alertItem.hit ? 'HIT' : 'ACTIVE'})</span>
      <button style="background: none; border: none; color: var(--red); cursor: pointer; font-size: 16px; padding: 0; font-weight: 700;" title="Delete Alert">×</button>
    `;
    
    const delBtn = badge.querySelector('button');
    delBtn.addEventListener('click', () => {
      removeAlert(alertItem.id);
    });
    
    alertsList.appendChild(badge);
  });
}

function checkAlert(price) {
  if (!alerts || alerts.length === 0) return;
  let hitTriggered = false;
  alerts.forEach(alertItem => {
    if (alertItem.hit) return;
    if (Math.abs(price - alertItem.price) / alertItem.price < 0.005) {
      alertItem.hit = true;
      hitTriggered = true;
      if (alertLines[alertItem.id]) {
        try { alertLines[alertItem.id].applyOptions({ color: '#00e07a', title: '✅ HIT' }); } catch (_) {}
      }
      if (Notification.permission === 'granted') {
        new Notification('HVBS AI – Alert!', { body: `Hit ${fmtPrice(alertItem.price)}` });
      }
    }
  });
  
  if (hitTriggered) {
    localStorage.setItem('hvbs_alerts', JSON.stringify(alerts));
    setAlertMsg('triggered', `🚨 Alert Hit!`);
    playSound();
    renderAlertsList();
  }
}

/* ── TIMERS ── */
function stopTimers(){
  clearTimeout(S.refreshId);
  clearInterval(S.countId);
  S.refreshId=S.countId=null;
}
function startTimers(cb){
  stopTimers();
  S.countdown = Math.max(1, Math.floor(REFRESH_MS / 1000));
  elCountdown.textContent=S.countdown+'s';
  S.countId = setInterval(()=>{
    S.countdown=Math.max(0,S.countdown-1);
    elCountdown.textContent=S.countdown+'s';
  },1000);
  
  const loop = async () => {
    await cb();
    S.countdown = Math.max(1, Math.floor(REFRESH_MS / 1000));
    elCountdown.textContent = S.countdown + 's';
    S.refreshId = setTimeout(loop, REFRESH_MS);
  };
  S.refreshId = setTimeout(loop, REFRESH_MS);
}

/* ── LIVE TICK ── */
async function tick() {
  if(!S.contract||!S.series)return;
  const info = await fetchDex(S.contract);
  if(!info||!info.price)return;
  const price=info.price, now=Math.floor(Date.now()/1000);
  const old=S.lastPrice;
  elPrice.textContent=fmtPrice(price);
  if(old!==null&&price!==old)flashPrice(price>=old);
  S.lastPrice=price;
  if(info.pct24h!=null){el24h.textContent=fmtPct(info.pct24h);el24h.className='chip-val '+(info.pct24h>=0?'up':'down');}
  if(info.vol24h)elVol.textContent=fmtBig(info.vol24h);

  const tfH=getCurrentTfH();
  const ivSec = getCandleIntervalSecs(tfH);
  let cTime = Math.floor(now/ivSec)*ivSec;

  let tickSupply = 1;
  if (typeof mcapMode !== 'undefined' && mcapMode && S.tokenMcap && S.tokenPrice) {
    tickSupply = S.tokenMcap / S.tokenPrice;
  }

  if (S.simMode) {
    const buf=S.simBuf;
    if(!buf.length)return;
    const last=buf[buf.length-1];
    const bufIv=buf.length>=2?(buf[1].time-buf[0].time):ivSec;
    const newT=Math.floor(now/bufIv)*bufIv;
    if(newT>last.time){
      const nc={time:newT,open:last.close,high:Math.max(last.close,price),low:Math.min(last.close,price),close:price};
      buf.push(nc);if(buf.length>SIM_COUNT+20)buf.shift();
      S.lastCandle = nc;
      if(S.chartData) S.chartData.push({...nc});
    }else{
      last.high=Math.max(last.high,price);
      last.low=Math.min(last.low,price);
      last.close=price;
      S.lastCandle = last;
      if(S.chartData && S.chartData.length > 0) {
        let lcd = S.chartData[S.chartData.length - 1];
        lcd.high = last.high; lcd.low = last.low; lcd.close = last.close;
      }
    }
    try{
      let updCandle = buf[buf.length-1];
      if (typeof mcapMode !== 'undefined' && mcapMode) {
        updCandle = { ...updCandle, open: updCandle.open * tickSupply, high: updCandle.high * tickSupply, low: updCandle.low * tickSupply, close: updCandle.close * tickSupply };
      }
      const isLineBased = ['area','line','baseline','histogram'].includes(currentSeriesType);
      const itemToUpdate = isLineBased ? { time: updCandle.time, value: updCandle.close } : updCandle;
      S.series.update(itemToUpdate);
    }catch(_){}
  } else if (S.lastCandle) {
    if (cTime < S.lastCandle.time) cTime = S.lastCandle.time;
    
    if (cTime === S.lastCandle.time) {
      S.lastCandle.high = Math.max(S.lastCandle.high, price);
      S.lastCandle.low = Math.min(S.lastCandle.low, price);
      S.lastCandle.close = price;
      if (S.chartData && S.chartData.length > 0) {
        let lcd = S.chartData[S.chartData.length - 1];
        lcd.high = S.lastCandle.high; lcd.low = S.lastCandle.low; lcd.close = S.lastCandle.close;
      }
    } else if (cTime > S.lastCandle.time) {
      S.lastCandle = {
        time: cTime,
        open: S.lastCandle.close,
        high: Math.max(S.lastCandle.close, price),
        low: Math.min(S.lastCandle.close, price),
        close: price
      };
      if (S.chartData) S.chartData.push({...S.lastCandle});
    }
    try {
      let updCandle = { ...S.lastCandle };
      if (typeof mcapMode !== 'undefined' && mcapMode) {
        updCandle = { ...updCandle, open: updCandle.open * tickSupply, high: updCandle.high * tickSupply, low: updCandle.low * tickSupply, close: updCandle.close * tickSupply };
      }
      const isLineBased = ['area','line','baseline','histogram'].includes(currentSeriesType);
      const itemToUpdate = isLineBased ? { time: updCandle.time, value: updCandle.close } : updCandle;
      S.series.update(itemToUpdate);
    } catch (_) {}
  }
  
  checkAlert(price);
  if (typeof runPatternDetection === 'function') runPatternDetection();
  if (typeof runCandlePatternDetection === 'function') runCandlePatternDetection();
}

function getCurrentTfH(){const a=document.querySelector('.tf-btn.active');return a?parseFloat(a.dataset.tf):24;}

/* ── MAIN LOAD ── */
async function loadChart() {
  const contract=contractInput.value.trim();
  if(!contract){contractInput.style.borderColor='#ff4560';setTimeout(()=>{contractInput.style.borderColor='';},1500);contractInput.focus();return;}
  if(!isValid(contract)){showError('Invalid Address','Enter a valid EVM (0x…) or Solana address.');return;}

  stopTimers();
  S.contract=contract; S.simMode=false; S.simBuf=[]; S.lastPrice=null; S.alertLine=null;
  tokenInfoBar.hidden=true; alertPanel.hidden=true; alertStatus.hidden=true;
  setLive(false); setBtnState(true);
  showLoader('Connecting to DexScreener…');
  
  localStorage.setItem('hvbs_contract', contract);

  try {
    /* 1. DexScreener token info */
    const info = await fetchDex(contract);
    if(!info||!info.price){
      showError('Token Not Found','No data found. Check the contract address and selected chain.');
      setBtnState(false);return;
    }
    S.pairAddr   = info.pairAddr;
    S.gtNet      = chainToGt(info.chainId);
    S.tokenPrice = info.price;
    S.tokenMcap  = info.mcap;
    
    const chainSelect = document.getElementById('chainSelect');
    if (chainSelect && info.chainId) {
      let chainVal = info.chainId.toLowerCase();
      const match = Array.from(chainSelect.options).find(opt => opt.value === chainVal);
      if (match) {
        chainSelect.value = chainVal;
      } else {
        const newOpt = document.createElement('option');
        newOpt.value = chainVal;
        newOpt.text = `⚡ ${chainVal.charAt(0).toUpperCase() + chainVal.slice(1)}`;
        chainSelect.appendChild(newOpt);
        chainSelect.value = chainVal;
      }
    }

    /* 2. Try GeckoTerminal OHLCV (5-second timeout, then simulate) */
    showLoader('Building chart…');
    let candles = null;
    try { candles = await fetchGtOHLCV(info.pairAddr, S.gtNet, getCurrentTfH()); }
    catch(_) {}

    /* 3. Init chart — ALWAYS */
    initChart();

    if(candles&&candles.length>=2){
      S.simMode=false;
      const ivSec = getCandleIntervalSecs(getCurrentTfH());
      let deduped = dedup(candles);
      
      // Fill historical gaps
      const filled = [];
      filled.push(deduped[0]);
      for (let i = 1; i < deduped.length; i++) {
        const prev = deduped[i-1];
        const curr = deduped[i];
        const gap = Math.floor((curr.time - prev.time) / ivSec);
        if (gap > 1 && gap < 2000) {
          for (let j = 1; j < gap; j++) {
            filled.push({ time: prev.time + j * ivSec, open: prev.close, high: prev.close, low: prev.close, close: prev.close });
          }
        }
        filled.push(curr);
      }
      deduped = filled;

      // Fill gap up to current time so the chart doesn't abruptly stop in the past
      const now = Math.floor(Date.now()/1000);
      const cTime = Math.floor(now/ivSec)*ivSec;
      const last = deduped[deduped.length-1];
      const gapToNow = Math.floor((cTime - last.time) / ivSec);
      if (gapToNow > 0 && gapToNow < 2000) {
        for (let j = 1; j <= gapToNow; j++) {
          deduped.push({ time: last.time + j * ivSec, open: last.close, high: last.close, low: last.close, close: last.close });
        }
      }

      S.chartData = deduped;
      
      let chartSeriesData = deduped;
      if (mcapMode && S.tokenMcap && S.tokenPrice) {
        const supply = S.tokenMcap / S.tokenPrice;
        chartSeriesData = deduped.map(c => ({ time: c.time, open: c.open * supply, high: c.high * supply, low: c.low * supply, close: c.close * supply }));
      }
      
      const isLineBased = ['area','line','baseline','histogram'].includes(currentSeriesType);
      const dataToSet = isLineBased ? chartSeriesData.map(c => ({ time: c.time, value: c.close })) : chartSeriesData;
      S.series.setData(dataToSet);
      S.lastCandle = { ...deduped[deduped.length - 1] };
      console.log('[HVBS] Real OHLCV:',deduped.length,'candles');
    }else{
      S.simMode=true;
      const ivSec = getCandleIntervalSecs(getCurrentTfH());
      
      const simCacheKey = `hvbs_sim_${contract}_${getCurrentTfH()}`;
      let cachedSim = null;
      try {
        const stored = localStorage.getItem(simCacheKey);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Date.now() - parsed.ts < 4 * 3600 * 1000) cachedSim = parsed.data;
        }
      } catch(e){}

      let sim = cachedSim;
      if (!sim) {
        sim = buildSim(info.price, SIM_COUNT, ivSec);
        try { localStorage.setItem(simCacheKey, JSON.stringify({ts: Date.now(), data: sim})); } catch(e){}
      } else {
        // Append missing candles to cached sim
        const last = sim[sim.length-1];
        const now = Math.floor(Date.now()/1000);
        if (now - last.time > ivSec) {
           const needed = Math.floor((now - last.time) / ivSec);
           const newSim = buildSim(info.price, needed, ivSec);
           sim.push(...newSim);
           try { localStorage.setItem(simCacheKey, JSON.stringify({ts: Date.now(), data: sim})); } catch(e){}
        } else {
           last.close = info.price;
        }
      }

      S.simBuf=[...sim];
      const dedupedSim = dedup(sim);
      S.chartData = dedupedSim;

      let chartSeriesData = dedupedSim;
      if (mcapMode && S.tokenMcap && S.tokenPrice) {
        const supply = S.tokenMcap / S.tokenPrice;
        chartSeriesData = dedupedSim.map(c => ({ time: c.time, open: c.open * supply, high: c.high * supply, low: c.low * supply, close: c.close * supply }));
      }

      const isLineBased = ['area','line','baseline','histogram'].includes(currentSeriesType);
      const dataToSet = isLineBased ? chartSeriesData.map(c => ({ time: c.time, value: c.close })) : chartSeriesData;
      S.series.setData(dataToSet);
      S.lastCandle = { ...dedupedSim[dedupedSim.length - 1] };
      console.log('[HVBS] Simulation mode — no OHLCV available');
    }

    /* 4. Show everything */
    revealChart();
    // Belt-and-suspenders: force-hide loader via style too
    elLoader.style.display = 'none';
    updateBar(info.name,info.symbol,info.price,info.pct24h,info.mcap,info.vol24h,S.simMode);
    alertPanel.hidden=false;
    setLive(true);
    
    drawAllAlerts();
    
    if(Notification.permission==='default'){try{Notification.requestPermission();}catch(_){}}

    /* 5. Start live ticks */
    startTimers(tick);

    /* 5b. Run bearish pattern detection */
    drawnPatterns.clear();
    setTimeout(runPatternDetection, 200); // slight delay so chart is fully rendered

    /* 5c. Scan full history for candle markers */
    setTimeout(() => {
      if (typeof window.rescanCandleMarkers === 'function') window.rescanCandleMarkers();
    }, 1500);

    /* 6. Force chart resize after browser paint (fixes 0px-width bug) */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { // double-RAF ensures layout is complete
        if (S.chart) {
          const w2 = elContainer.getBoundingClientRect().width || window.innerWidth - 56;
          S.chart.applyOptions({ width: w2 });
        }
      });
    });

  }catch(err){
    console.error('[HVBS]',err);
    showError('Error',err.message||'Unexpected error. Please try again.');
  }finally{
    setBtnState(false);
  }
}

/* ── EVENTS ── */
loadBtn.addEventListener('click',loadChart);
contractInput.addEventListener('keydown',e=>{if(e.key==='Enter')loadChart();});
elRetry.addEventListener('click',loadChart);

if (soundSelect && fileGroup) {
  soundSelect.addEventListener('change', () => {
    fileGroup.style.display = soundSelect.value === 'custom' ? 'block' : 'none';
  });
}

if (audioFile) {
  audioFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('MP3 files must be under 2MB.');
      audioFile.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      customAudioSrc = evt.target.result;
      try {
        localStorage.setItem('hvbs_custom_audio', customAudioSrc);
      } catch(ex) {
        console.warn('MP3 exceeds localStorage limits.');
      }
    };
    reader.readAsDataURL(file);
  });
}

if (stopSoundBtn) {
  stopSoundBtn.addEventListener('click', stopSound);
}

setAlertBtn.addEventListener('click',()=>{
  const p=parseFloat(alertInput.value);
  if(!p||p<=0||isNaN(p)){alertInput.focus();return;}
  if(!S.series){setAlertMsg('cleared','Load a chart first.');return;}
  
  if (alerts.length >= 10) {
    setAlertMsg('cleared', 'Maximum 10 alerts.');
    return;
  }
  
  const id = Date.now().toString();
  const newAlert = { id, price: p, hit: false };
  alerts.push(newAlert);
  localStorage.setItem('hvbs_alerts', JSON.stringify(alerts));
  
  const line = S.series.createPriceLine({
    price: p,
    color: '#f5c518',
    lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: '🔔 ALERT'
  });
  alertLines[id] = line;
  
  setAlertMsg('set', `🔔 Alert set at ${fmtPrice(p)}`);
  alertInput.value = '';
  renderAlertsList();
});

/* ── TV TOOLBAR LOGIC ── */
let currentSeriesType = localStorage.getItem('hvbs_chart_type') || 'candle';
let mcapMode = localStorage.getItem('hvbs_mcap_mode') === 'true';

const lblPrice = $('lblPrice');
const lblMcap = $('lblMcap');
function updateMcapUI() {
  if (!lblPrice || !lblMcap) return;
  if (mcapMode) {
    lblPrice.style.color = 'var(--text-3)';
    lblMcap.style.color = '#00e07a';
  } else {
    lblPrice.style.color = 'var(--accent-light)';
    lblMcap.style.color = 'var(--text-3)';
  }
}
updateMcapUI();

const tvToolCompare = $('tvToolCompare');
if (tvToolCompare) {
  tvToolCompare.addEventListener('click', () => {
    const addr = prompt('Enter Token Contract Address:');
    if (addr && addr.trim()) {
      contractInput.value = addr.trim();
      loadChart();
    }
  });
}

const tvToolFullscreen = $('tvToolFullscreen');
if (tvToolFullscreen) {
  tvToolFullscreen.addEventListener('click', () => {
    const chartSec = document.querySelector('.chart-section');
    if (chartSec) {
      if (!document.fullscreenElement) {
        chartSec.requestFullscreen().catch(err => console.error(err));
      } else {
        document.exitFullscreen();
      }
    }
  });
}

const chartTypeWrapper = $('chartTypeWrapper');
const chartTypeMenu = $('chartTypeMenu');
const chartTypeIcon = $('chartTypeIcon');

if (chartTypeWrapper && chartTypeMenu) {
  chartTypeWrapper.addEventListener('click', (e) => {
    e.stopPropagation();
    chartTypeMenu.style.display = chartTypeMenu.style.display === 'none' ? 'flex' : 'none';
  });
  document.addEventListener('click', (e) => {
    if (!chartTypeWrapper.contains(e.target)) chartTypeMenu.style.display = 'none';
  });

  const items = chartTypeMenu.querySelectorAll('.charttype-item');
  items.forEach(item => {
    item.addEventListener('click', () => {
      const type = item.dataset.type;
      currentSeriesType = type;
      localStorage.setItem('hvbs_chart_type', type);
      
      items.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      if (type === 'candle') chartTypeIcon.textContent = '🕯️';
      else if (type === 'bar') chartTypeIcon.textContent = '📊';
      else if (type === 'line') chartTypeIcon.textContent = '📈';
      else if (type === 'area') chartTypeIcon.textContent = '📉';
      else if (type === 'baseline') chartTypeIcon.textContent = '🌊';
      else if (type === 'histogram') chartTypeIcon.textContent = '📏';

      chartTypeMenu.style.display = 'none';
      if (S.chart && S.chartData) {
        initChart();
        let supply = 1;
        if (mcapMode && S.tokenMcap && S.tokenPrice) supply = S.tokenMcap / S.tokenPrice;
        let finalData = S.chartData;
        if (mcapMode) finalData = S.chartData.map(c => ({ time: c.time, open: c.open * supply, high: c.high * supply, low: c.low * supply, close: c.close * supply }));
        const isLineBased = ['area','line','baseline','histogram'].includes(currentSeriesType);
        const dataToSet = isLineBased ? finalData.map(c => ({ time: c.time, value: c.close })) : finalData;
        S.series.setData(dataToSet);
        drawAllAlerts();
        /* Re-apply candle markers on new series */
        setTimeout(function() {
          if (typeof applyCandleMarkersToChart === 'function') applyCandleMarkersToChart();
        }, 400);
      }
    });
  });

  const initItem = chartTypeMenu.querySelector(`[data-type="${currentSeriesType}"]`);
  if (initItem) {
    initItem.classList.add('active');
    if (currentSeriesType === 'candle') chartTypeIcon.textContent = '🕯️';
    else if (currentSeriesType === 'bar') chartTypeIcon.textContent = '📊';
    else if (currentSeriesType === 'line') chartTypeIcon.textContent = '📈';
    else if (currentSeriesType === 'area') chartTypeIcon.textContent = '📉';
    else if (currentSeriesType === 'baseline') chartTypeIcon.textContent = '🌊';
    else if (currentSeriesType === 'histogram') chartTypeIcon.textContent = '📏';
  }
}

const tvToolIndicators = $('tvToolIndicators');
let maSeries = null;
if (tvToolIndicators) {
  tvToolIndicators.addEventListener('click', () => {
    if (!S.chart || !S.series || !S.chartData || S.chartData.length < 10) return;
    if (maSeries) {
      S.chart.removeSeries(maSeries);
      maSeries = null;
      tvToolIndicators.style.color = 'var(--text-1)';
      return;
    }
    const maData = [];
    const data = S.chartData;
    for (let i = 9; i < data.length; i++) {
      let sum = 0;
      for (let j = 0; j < 9; j++) {
        sum += data[i - j].close;
      }
      maData.push({ time: data[i].time, value: sum / 9 });
    }
    maSeries = S.chart.addLineSeries({ color: '#f5c518', lineWidth: 1, title: 'MA(9)' });
    maSeries.setData(maData);
    tvToolIndicators.style.color = '#f5c518';
  });
}

const tvToolViewMode = $('tvToolViewMode');
if (tvToolViewMode) {
  tvToolViewMode.addEventListener('click', () => {
    if (!S.chartData || S.chartData.length === 0) return;
    mcapMode = !mcapMode;
    localStorage.setItem('hvbs_mcap_mode', mcapMode);
    updateMcapUI();
    
    let supply = 1;
    if (S.tokenMcap && S.tokenPrice) {
      supply = S.tokenMcap / S.tokenPrice;
    }
    
    let mapped = [];
    if (mcapMode) {
      mapped = S.chartData.map(c => ({
        time: c.time, open: c.open * supply, high: c.high * supply, low: c.low * supply, close: c.close * supply
      }));
    } else {
      mapped = S.chartData;
    }
    
    if (S.series && mapped.length > 0) {
      const isLineBased = ['area','line','baseline','histogram'].includes(currentSeriesType);
      const dataToSet = isLineBased ? mapped.map(c => ({ time: c.time, value: c.close })) : mapped;
      S.series.setData(dataToSet);
    }
  });
}

const tvToolScreenshot = $('tvToolScreenshot');
if (tvToolScreenshot) {
  tvToolScreenshot.addEventListener('click', () => {
    if (!S.chart) return;
    // 1. Get the chart screenshot (this returns a canvas with all series rendered)
    const chartCanvas = S.chart.takeScreenshot();
    
    // 2. Create a composite canvas
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = chartCanvas.width;
    finalCanvas.height = chartCanvas.height;
    const fctx = finalCanvas.getContext('2d');
    
    // 3. Draw chart background/series
    fctx.drawImage(chartCanvas, 0, 0);
    
    // 4. Draw our custom drawings overlay on top
    // Since drawingCanvas is CSS pixels and chartCanvas is likely physical pixels (HiDPI), we scale it.
    fctx.drawImage(drawingCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
    
    // 5. Download
    const url = finalCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `chart_${S.contract || 'snapshot'}.png`;
    a.click();
  });
}
/* ── LEFT TOOLBAR & DRAWING LOGIC ── */
const drawingCanvas = document.createElement('canvas');
drawingCanvas.style.position = 'absolute';
drawingCanvas.style.top = '0';
drawingCanvas.style.left = '0';
drawingCanvas.style.pointerEvents = 'none';
drawingCanvas.style.zIndex = '10';
const canvasOverlayTarget = document.getElementById('chartContainer');
if (canvasOverlayTarget) canvasOverlayTarget.appendChild(drawingCanvas);
const ctx = drawingCanvas.getContext('2d');

let drawings = [];
let activeTool = 'Crosshair';
let isDrawing = false;
let currentDrawing = null;
let magnetMode = false;
let lockDrawings = false;
  window.clearAllDrawings = () => { drawings = []; renderDrawings(); };

function resizeCanvas() {
  if (elContainer && drawingCanvas) {
    drawingCanvas.width = elContainer.clientWidth;
    drawingCanvas.height = elContainer.clientHeight;
    renderDrawings();
  }
}
new ResizeObserver(resizeCanvas).observe(elContainer);

function renderDrawings() {
  if (!ctx || !drawingCanvas) return;
  ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  if (!S.chart || !S.series) return;
  
  const allDrawings = currentDrawing ? [...drawings, currentDrawing] : drawings;
  
  allDrawings.forEach(d => {
    ctx.beginPath();
    ctx.save();
    if (d.type === 'trend') {
      const x1 = S.chart.timeScale().timeToCoordinate(d.p1.time);
      const y1 = S.series.priceToCoordinate(d.p1.price);
      const x2 = S.chart.timeScale().timeToCoordinate(d.p2.time);
      const y2 = S.series.priceToCoordinate(d.p2.price);
      if(x1!==null && y1!==null && x2!==null && y2!==null) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = '#6c63ff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else if (d.type === 'fib') {
      const x1 = S.chart.timeScale().timeToCoordinate(d.p1.time);
      const y1 = S.series.priceToCoordinate(d.p1.price);
      const x2 = S.chart.timeScale().timeToCoordinate(d.p2.time);
      const y2 = S.series.priceToCoordinate(d.p2.price);
      if(x1!==null && y1!==null && x2!==null && y2!==null) {
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        const colors = ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#2962ff', '#787b86'];
        levels.forEach((lvl, i) => {
          const y = y1 + (y2 - y1) * lvl;
          ctx.beginPath();
          ctx.moveTo(minX, y);
          ctx.lineTo(maxX + 100, y);
          ctx.strokeStyle = colors[i];
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = colors[i];
          ctx.font = '10px Inter';
          ctx.fillText(lvl.toString(), maxX + 100 + 4, y + 3);
        });
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.stroke();
      }
    } else if (d.type === 'brush') {
      if (d.points && d.points.length > 0) {
        const first = d.points[0];
        let startX = S.chart.timeScale().timeToCoordinate(first.time);
        let startY = S.series.priceToCoordinate(first.price);
        if (startX!==null && startY!==null) {
          ctx.moveTo(startX, startY);
          for(let i=1; i<d.points.length; i++) {
            let px = S.chart.timeScale().timeToCoordinate(d.points[i].time);
            let py = S.series.priceToCoordinate(d.points[i].price);
            if (px!==null && py!==null) ctx.lineTo(px, py);
          }
          ctx.strokeStyle = '#00e07a';
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }
    } else if (d.type === 'text') {
      const x = S.chart.timeScale().timeToCoordinate(d.p.time);
      const y = S.series.priceToCoordinate(d.p.price);
      if (x!==null && y!==null) {
        ctx.fillStyle = '#fff';
        ctx.font = '14px Inter';
        ctx.fillText(d.text, x, y);
      }
    } else if (d.type === 'measure') {
      const x1 = S.chart.timeScale().timeToCoordinate(d.p1.time);
      const y1 = S.series.priceToCoordinate(d.p1.price);
      const x2 = S.chart.timeScale().timeToCoordinate(d.p2.time);
      const y2 = S.series.priceToCoordinate(d.p2.price);
      if(x1!==null && y1!==null && x2!==null && y2!==null) {
        ctx.fillStyle = 'rgba(108, 99, 255, 0.15)';
        ctx.fillRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
        ctx.strokeStyle = 'rgba(108, 99, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
        const priceDiff = d.p2.price - d.p1.price;
        const pctDiff = (priceDiff / d.p1.price) * 100;
        ctx.fillStyle = '#fff';
        ctx.font = '12px Inter';
        ctx.textAlign = 'center';
        const txt = `${priceDiff>0?'+':''}${fmtPrice(priceDiff)} (${pctDiff>0?'+':''}${pctDiff.toFixed(2)}%)`;
        const midX = (x1 + x2) / 2;
        const txtY = y2 < y1 ? Math.min(y1,y2) - 10 : Math.max(y1,y2) + 20;
        ctx.fillText(txt, midX, txtY);
      }
    }
    ctx.restore();
  });

  // Draw active pattern overlays on top
  if (typeof renderPatternOverlays === 'function') renderPatternOverlays();
  if (typeof renderBullishPatternOverlays === 'function') renderBullishPatternOverlays();
  // NOTE: Candlestick markers now handled by series.setMarkers() — no canvas call needed
}

function bindDrawingEvents(chart, series) {
  chart.timeScale().subscribeVisibleLogicalRangeChange(renderDrawings);
  chart.timeScale().subscribeVisibleTimeRangeChange(renderDrawings);
  
  const getPoint = (param) => {
    if (!param.point) return null;
    let time = param.time;
    if (!time) {
      const logical = chart.timeScale().coordinateToLogical(param.point.x);
      if (logical) time = chart.timeScale().coordinateToTime(param.point.x);
    }
    if (!time) return null;
    let price = series.coordinateToPrice(param.point.y);
    if (magnetMode && param.seriesData) {
      const data = param.seriesData.get(series);
      if (data) {
        const prices = [data.open, data.high, data.low, data.close].filter(p => p !== undefined);
        if (prices.length > 0) {
          let closest = prices[0];
          let minDiff = Math.abs(price - closest);
          for (let i = 1; i < prices.length; i++) {
            const diff = Math.abs(price - prices[i]);
            if (diff < minDiff) {
              minDiff = diff;
              closest = prices[i];
            }
          }
          price = closest;
        }
      }
    }
    return { time, price };
  };

  let lastPt = null;

  chart.subscribeCrosshairMove(param => {
    const pt = getPoint(param);
    if (pt) lastPt = pt;
    
    if (!isDrawing || !currentDrawing || !pt) return;
    
    if (activeTool === 'Brush') {
      currentDrawing.points.push(pt);
    } else {
      currentDrawing.p2 = pt;
    }
    renderDrawings();
  });

  const chartDiv = document.getElementById('chartContainer');
  if (chartDiv) {
    chartDiv.addEventListener('mousedown', (e) => {
      if (lockDrawings || activeTool === 'Crosshair' || activeTool === 'Magnet Mode' || activeTool === 'Lock All Drawing Tools') return;
      if (!lastPt) return;

      if (activeTool === 'Text') {
        const text = prompt('Enter text:');
        if (text) {
          drawings.push({ type: 'text', p: lastPt, text });
          renderDrawings();
        }
        return;
      }

      // CLICK-MOVE-CLICK LOGIC
      if (!isDrawing) {
        // Start drawing
        isDrawing = true;
        if (activeTool === 'Trend Line') currentDrawing = { type: 'trend', p1: lastPt, p2: lastPt };
        else if (activeTool === 'Fibonacci Retracement') currentDrawing = { type: 'fib', p1: lastPt, p2: lastPt };
        else if (activeTool === 'Brush') currentDrawing = { type: 'brush', points: [lastPt] };
        else if (activeTool === 'Measure') currentDrawing = { type: 'measure', p1: lastPt, p2: lastPt };
        
        // Disable chart panning while drawing
        chart.applyOptions({ handleScroll: false, handleScale: false });
      } else {
        // Finish drawing
        if (currentDrawing) {
          if (activeTool !== 'Brush') currentDrawing.p2 = lastPt;
          else currentDrawing.points.push(lastPt);
          
          drawings.push(currentDrawing);
          currentDrawing = null;
        }
        isDrawing = false;
        renderDrawings();
        // Re-enable chart panning
        chart.applyOptions({ handleScroll: true, handleScale: true });

        // AUTO-UNSELECT TOOL AFTER DRAWING
        resetToCrosshair();
      }
    }, { capture: true });

    // RIGHT CLICK TO CANCEL / UNSELECT
    chartDiv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (isDrawing || activeTool !== 'Crosshair') {
        isDrawing = false;
        currentDrawing = null;
        resetToCrosshair();
        renderDrawings();
      }
    });
  }
}

function resetToCrosshair() {
  activeTool = 'Crosshair';
  if (S.chart) S.chart.applyOptions({ 
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }, 
    handleScroll: true, 
    handleScale: true 
  });
  // Sync overlay buttons
  document.querySelectorAll('#drawingToolsOverlay .dt-btn').forEach(b => {
    const t = b.getAttribute('data-tool');
    if (t !== 'Magnet Mode' && t !== 'Lock All Drawing Tools') {
      b.classList.toggle('active-tool', t === 'Crosshair');
    }
  });
}

/* ══════════════════════════════════════════════════════
   DRAWING TOOLS OVERLAY — button wiring
   Works by delegating on the overlay container so it
   works even if the buttons exist before bindDrawingEvents
══════════════════════════════════════════════════════ */
(function wireDrawingOverlay() {

  function getAllDtBtns() {
    return document.querySelectorAll('#drawingToolsOverlay .dt-btn');
  }

  function setActiveBtn(toolName) {
    getAllDtBtns().forEach(b => {
      const t = b.getAttribute('data-tool');
      if (t === 'Magnet Mode' || t === 'Lock All Drawing Tools') return;
      b.classList.toggle('active-tool', t === toolName);
    });
    activeTool = toolName;
  }

  function resetToCrosshairOverlay() {
    activeTool = 'Crosshair';
    setActiveBtn('Crosshair');
    if (S.chart) S.chart.applyOptions({
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      handleScroll: true, handleScale: true
    });
    isDrawing = false; currentDrawing = null;
    if (typeof renderDrawings === 'function') renderDrawings();
  }



  document.addEventListener('click', function(e) {
    const btn = e.target.closest('#drawingToolsOverlay .dt-btn');
    if (!btn) return;
    e.stopPropagation();

    const toolName = btn.getAttribute('data-tool');

    /* ── Magnet toggle ── */
    if (toolName === 'Magnet Mode') {
      magnetMode = !magnetMode;
      btn.classList.toggle('dt-toggled', magnetMode);
      showToast('Magnet Mode ' + (magnetMode ? 'ON ✦' : 'OFF'));
      return;
    }

    /* ── Lock toggle ── */
    if (toolName === 'Lock All Drawing Tools') {
      lockDrawings = !lockDrawings;
      btn.classList.toggle('dt-locked', lockDrawings);
      showToast('Drawings ' + (lockDrawings ? 'Locked 🔒' : 'Unlocked 🔓'));
      return;
    }

    /* ── Zoom In ── */
    if (toolName === 'Zoom In') {
      if (S.chart) {
        const range = S.chart.timeScale().getVisibleLogicalRange();
        if (range) {
          const delta = (range.to - range.from) * 0.2;
          S.chart.timeScale().setVisibleLogicalRange({ from: range.from + delta, to: range.to - delta });
        }
      }
      showToast('Zoomed In 🔍');
      return;
    }

    /* ── Eraser ── */
    if (toolName === 'Eraser') {
      if (drawings && drawings.length > 0) {
        drawings.pop();
        if (typeof renderDrawings === 'function') renderDrawings();
        showToast('Last drawing removed');
      } else {
        showToast('Nothing to erase');
      }
      return;
    }

    /* ── Emoji picker ── */
    if (toolName === 'Emoji') {
      const picker = document.getElementById('dtEmojiPicker');
      if (!picker) return;
      const isVisible = picker.style.display !== 'none';
      picker.style.display = isVisible ? 'none' : 'grid';
      return;
    }

    /* ── Toggle off if already active ── */
    if (activeTool === toolName && toolName !== 'Crosshair') {
      resetToCrosshairOverlay();
      return;
    }

    /* ── Activate tool ── */
    setActiveBtn(toolName);
    if (S.chart) S.chart.applyOptions({ crosshair: { mode: LightweightCharts.CrosshairMode.Normal } });
    showToast(toolName + ' Activated');
  });

  /* Emoji span clicks */
  document.addEventListener('click', function(e) {
    const span = e.target.closest('#dtEmojiPicker span');
    if (!span) return;
    const emoji = span.textContent;
    // place emoji at chart center using pixel coords
    if (typeof drawings !== 'undefined' && typeof drawingCanvas !== 'undefined') {
      const cx = drawingCanvas.width  / 2;
      const cy = drawingCanvas.height / 2;
      // Convert pixel → time+price
      if (S.chart && S.series) {
        const time  = S.chart.timeScale().coordinateToTime(cx);
        const price = S.series.coordinateToPrice(cy);
        if (time && price) {
          drawings.push({ type: 'text', p: { time, price }, text: emoji });
          if (typeof renderDrawings === 'function') renderDrawings();
        }
      }
    }
    document.getElementById('dtEmojiPicker').style.display = 'none';
    showToast('Emoji placed: ' + emoji);
  });

  /* Close emoji picker on outside click */
  document.addEventListener('click', function(e) {
    if (!e.target.closest('#dtEmojiPicker') && !e.target.closest('#dtEmojiBtn')) {
      const picker = document.getElementById('dtEmojiPicker');
      if (picker) picker.style.display = 'none';
    }
  });



})();

function showToast(msg) {
  const toast = document.getElementById('customToast');
  const toastText = document.getElementById('customToastText');
  if (toast && toastText) {
    toastText.textContent = msg;
    toast.style.display = 'flex';
    toast.style.opacity = '1';
    setTimeout(() => { 
      toast.style.opacity = '0'; 
      setTimeout(() => { if (toast.style.opacity === '0') toast.style.display = 'none'; }, 300); 
    }, 2000);
  }
}

/* ── ARROW SYNC LOOP ── */
function startArrowSync() {
  const arrow = document.getElementById('customPriceArrow');
  function loop() {
    if (arrow && S.series && S.lastPrice !== null) {
      let tickSupply = 1;
      if (typeof mcapMode !== 'undefined' && mcapMode && S.tokenMcap && S.tokenPrice) tickSupply = S.tokenMcap / S.tokenPrice;
      const displayPrice = (typeof mcapMode !== 'undefined' && mcapMode) ? S.lastPrice * tickSupply : S.lastPrice;
      
      try {
        const y = S.series.priceToCoordinate(displayPrice);
        if (y !== null && !isNaN(y) && y >= 0 && y <= elContainer.clientHeight) {
          arrow.style.top = (y + 1) + 'px'; // +1 offset for visual alignment
          arrow.style.display = 'block';
        } else {
          arrow.style.display = 'none';
        }
      } catch(e) {
        arrow.style.display = 'none';
      }
    } else if (arrow) {
      arrow.style.display = 'none';
    }
    requestAnimationFrame(loop);
  }
  loop();
}
startArrowSync();

/* ── BOOT ── */
showPlaceholder();
renderTimeframes();
renderTfOptions();
renderAlertsList();

const savedContract = localStorage.getItem('hvbs_contract');
if (savedContract) {
  contractInput.value = savedContract;
}

if (savedContract) {
  setTimeout(() => {
    loadChart();
  }, 100);
}

/* ═══════════════════════════════════════════════════════════════════
   HVBS AI – BEARISH PATTERN DETECTION ENGINE
   Patterns: Double Top | Head & Shoulders | Rising Wedge |
             Expanding Triangle | Triple Top
   - Auto-detects on each chart load & timeframe change
   - Blinking gold button when pattern found
   - Click button → pattern draws itself on chart canvas
═══════════════════════════════════════════════════════════════════ */

// Each pattern gets a UNIQUE color so multiple patterns on chart are easy to distinguish
const BEARISH_PATTERNS = [
  { id: 'dbl_top',         label: 'Bearish Double Top',              color: '#ff4560', side: 'bearish' },
  { id: 'hs',              label: 'Bearish Head & Shoulders',        color: '#ff007f', side: 'bearish' },
  { id: 'wedge',           label: 'Bearish Rising Wedge',            color: '#ff9800', side: 'bearish' },
  { id: 'expand',          label: 'Bearish Expanding Triangle',      color: '#ff6600', side: 'bearish' },
  { id: 'triple',          label: 'Bearish Triple Top',              color: '#e040fb', side: 'bearish' },
  { id: 'bear_flag',       label: 'Bearish Flag Pattern',            color: '#f44336', side: 'bearish' },
  { id: 'bear_pennant',    label: 'Bearish Pennant Pattern',         color: '#ff5722', side: 'bearish' },
  { id: 'bear_wedge',      label: 'Bearish Desc. Triangle',          color: '#ffb300', side: 'bearish' },
  { id: 'asc_tri',         label: 'Bearish Descending Triangle',     color: '#ec407a', side: 'bearish' },
  { id: 'sym_expand_bear', label: 'Symmetrical Expanding (Bear)',    color: '#ab47bc', side: 'bearish' },
];

const BULLISH_PATTERNS = [
  { id: 'dbl_bot',      label: 'Bullish Double Bottom',            color: '#00e07a', side: 'bullish' },
  { id: 'inv_hs',       label: 'Bullish Inverted H&S',             color: '#00bcd4', side: 'bullish' },
  { id: 'fall_wedge',   label: 'Bullish Falling Wedge',            color: '#69f0ae', side: 'bullish' },
  { id: 'bull_expand',  label: 'Bullish Expanding Triangle',       color: '#b2ff59', side: 'bullish' },
  { id: 'triple_bot',   label: 'Bullish Triple Bottom',            color: '#00e5ff', side: 'bullish' },
  { id: 'bull_flag',    label: 'Bullish Flag Pattern',             color: '#76ff03', side: 'bullish' },
  { id: 'bull_pennant', label: 'Bullish Pennant Pattern',          color: '#ffea00', side: 'bullish' },
  { id: 'fall_village', label: 'Bullish Falling Village',          color: '#64ffda', side: 'bullish' },
  { id: 'desc_tri',     label: 'Descending Triangle (Bullish)',    color: '#40c4ff', side: 'bullish' },
  { id: 'sym_expand',   label: 'Symmetrical Expanding Triangle',   color: '#18ffff', side: 'bullish' },
];

const ALL_PATTERNS = [...BULLISH_PATTERNS, ...BEARISH_PATTERNS];

/* ── Pattern Tooltip ── */
(function setupPatternTooltip() {
  const tooltip = document.getElementById('patternTooltip');
  if (!tooltip) return;
  document.addEventListener('mouseover', (e) => {
    const btn = e.target.closest('.pattern-btn[data-fullname]');
    if (!btn) { tooltip.style.display = 'none'; return; }
    const name = btn.getAttribute('data-fullname');
    if (!name) return;
    const isBull = btn.classList.contains('bullish-pat');
    tooltip.innerHTML = `<span style="color:${isBull ? '#00e07a' : '#ff4560'};font-weight:800;">${isBull ? '▲ ' : '▼ '}</span>${name}`;
    tooltip.style.display = 'block';
    const rect = btn.getBoundingClientRect();
    const tw = 260;
    const left = Math.max(6, Math.min(rect.left + rect.width/2 - tw/2, window.innerWidth - tw - 6));
    tooltip.style.left = left + 'px';
    tooltip.style.top  = (rect.top + window.scrollY - 10) + 'px';
    tooltip.style.transform = 'translateY(-100%)';
  });
  document.addEventListener('mouseout', (e) => {
    if (!e.target.closest('.pattern-btn[data-fullname]')) return;
    const related = e.relatedTarget;
    if (related && related.closest('.pattern-btn[data-fullname]')) return;
    tooltip.style.display = 'none';
  });
  document.addEventListener('scroll', () => { tooltip.style.display = 'none'; }, true);
})();

// Store detected pattern data & which are drawn on canvas
const patternDetected = {};   // id -> detection result object
let   drawnPatterns    = new Set();

/* ── SWING HIGH / LOW FINDERS ─────────────────────────────────── */
function findSwingHighs(data, lb) {
  lb = lb || 3;
  const out = [];
  for (let i = lb; i < data.length - lb; i++) {
    let ok = true;
    for (let j = 1; j <= lb; j++) {
      if (data[i].high <= data[i-j].high || data[i].high <= data[i+j].high) { ok = false; break; }
    }
    if (ok) out.push({ idx: i, time: data[i].time, price: data[i].high });
  }
  return out;
}

function findSwingLows(data, lb) {
  lb = lb || 3;
  const out = [];
  for (let i = lb; i < data.length - lb; i++) {
    let ok = true;
    for (let j = 1; j <= lb; j++) {
      if (data[i].low >= data[i-j].low || data[i].low >= data[i+j].low) { ok = false; break; }
    }
    if (ok) out.push({ idx: i, time: data[i].time, price: data[i].low });
  }
  return out;
}

/* ── PATTERN DETECTORS ────────────────────────────────────────── */

function detectDoubleTop(data) {
  if (!data || data.length < 20) return null;
  const d     = data.slice(-800);
  const highs = findSwingHighs(d, 3);
  if (highs.length < 2) return null;

  const recent = highs.slice(-7);
  for (let i = recent.length - 1; i >= 1; i--) {
    const h2 = recent[i];
    for (let j = i - 1; j >= 0; j--) {
      const h1 = recent[j];
      if (h2.idx <= h1.idx + 4) continue;
      const diff = Math.abs(h2.price - h1.price) / Math.max(h1.price, h2.price);
      if (diff > 0.06) continue;          // peaks within 6%

      let nlPrice = Infinity, nlTime = null;
      for (let k = h1.idx + 1; k < h2.idx; k++) {
        if (d[k].low < nlPrice) { nlPrice = d[k].low; nlTime = d[k].time; }
      }
      if (!nlTime) continue;

      // neckline must be meaningfully below peaks
      if ((Math.max(h1.price, h2.price) - nlPrice) / Math.max(h1.price, h2.price) < 0.03) continue;

      return { type: 'dbl_top', peak1: h1, peak2: h2,
               necklinePrice: nlPrice, necklineTime: nlTime };
    }
  }
  return null;
}

function detectHeadShoulders(data) {
  if (!data || data.length < 30) return null;
  const d     = data.slice(-800);
  const highs = findSwingHighs(d, 3);
  if (highs.length < 3) return null;

  const recent = highs.slice(-9);
  for (let i = recent.length - 1; i >= 2; i--) {
    const rs   = recent[i];
    const head = recent[i-1];
    const ls   = recent[i-2];
    if (ls.idx >= head.idx || head.idx >= rs.idx) continue;
    if (head.price <= ls.price || head.price <= rs.price) continue;

    const shDiff = Math.abs(rs.price - ls.price) / Math.max(rs.price, ls.price);
    if (shDiff > 0.12) continue;         // shoulders within 12%

    let nl1Price = Infinity, nl1Time = null;
    for (let k = ls.idx + 1; k < head.idx; k++) {
      if (d[k].low < nl1Price) { nl1Price = d[k].low; nl1Time = d[k].time; }
    }
    let nl2Price = Infinity, nl2Time = null;
    for (let k = head.idx + 1; k < rs.idx; k++) {
      if (d[k].low < nl2Price) { nl2Price = d[k].low; nl2Time = d[k].time; }
    }
    if (!nl1Time || !nl2Time) continue;

    return { type: 'hs', leftShoulder: ls, head, rightShoulder: rs,
             neckline1: { price: nl1Price, time: nl1Time },
             neckline2: { price: nl2Price, time: nl2Time } };
  }
  return null;
}

function detectRisingWedge(data) {
  if (!data || data.length < 20) return null;
  const d     = data.slice(-800);
  const highs = findSwingHighs(d, 3);
  const lows  = findSwingLows(d, 3);
  if (highs.length < 2 || lows.length < 2) return null;

  const rh = highs.slice(-4);
  const rl = lows.slice(-4);
  const h1 = rh[rh.length-2], h2 = rh[rh.length-1];
  const l1 = rl[rl.length-2], l2 = rl[rl.length-1];
  if (!h1 || !h2 || !l1 || !l2) return null;

  // Both highs and lows trending up
  if (h2.price <= h1.price || l2.price <= l1.price) return null;

  // Confirm upward slopes are positive
  const highSlope = (h2.price - h1.price) / (h2.idx - h1.idx || 1);
  const lowSlope  = (l2.price - l1.price) / (l2.idx  - l1.idx  || 1);
  if (highSlope <= 0 || lowSlope <= 0) return null;

  // For a proper wedge the two lines should be converging
  // (low slope >= high slope indicates faster rise of support → converging)
  // We accept either converging or roughly parallel as rising wedge
  if (lowSlope < highSlope * 0.4) return null;

  return { type: 'wedge', high1: h1, high2: h2, low1: l1, low2: l2 };
}

function detectExpandingTriangle(data) {
  if (!data || data.length < 20) return null;
  const d     = data.slice(-800);
  const highs = findSwingHighs(d, 3);
  const lows  = findSwingLows(d, 3);
  if (highs.length < 2 || lows.length < 2) return null;

  const rh = highs.slice(-4);
  const rl = lows.slice(-4);
  const h1 = rh[rh.length-2], h2 = rh[rh.length-1];
  const l1 = rl[rl.length-2], l2 = rl[rl.length-1];
  if (!h1 || !h2 || !l1 || !l2) return null;

  // Highs going up AND lows going down  →  expanding (diverging)
  const highGoing = h2.price > h1.price * 1.005;
  const lowGoing  = l2.price < l1.price * 0.995;
  if (!highGoing || !lowGoing) return null;

  return { type: 'expand', high1: h1, high2: h2, low1: l1, low2: l2 };
}

function detectTripleTop(data) {
  if (!data || data.length < 30) return null;
  const d     = data.slice(-800);
  const highs = findSwingHighs(d, 3);
  if (highs.length < 3) return null;

  const recent = highs.slice(-9);
  for (let i = recent.length - 1; i >= 2; i--) {
    const h3 = recent[i], h2 = recent[i-1], h1 = recent[i-2];
    if (h3.idx <= h2.idx || h2.idx <= h1.idx) continue;

    const prices = [h1.price, h2.price, h3.price];
    const maxP = Math.max(...prices), minP = Math.min(...prices);
    if ((maxP - minP) / maxP > 0.07) continue;   // all three within 7%

    let nl1P = Infinity, nl1T = null;
    for (let k = h1.idx + 1; k < h2.idx; k++) {
      if (d[k].low < nl1P) { nl1P = d[k].low; nl1T = d[k].time; }
    }
    let nl2P = Infinity, nl2T = null;
    for (let k = h2.idx + 1; k < h3.idx; k++) {
      if (d[k].low < nl2P) { nl2P = d[k].low; nl2T = d[k].time; }
    }
    if (!nl1T || !nl2T) continue;

    return { type: 'triple', peak1: h1, peak2: h2, peak3: h3,
             necklinePrice: Math.min(nl1P, nl2P), nl1Time: nl1T, nl2Time: nl2T };
  }
  return null;
}

/* ── BULLISH PATTERN DETECTORS ────────────────────────────────── */

function detectDoubleBottom(data) {
  if (!data || data.length < 20) return null;
  const d = data.slice(-800);
  const lows = findSwingLows(d, 3);
  if (lows.length < 2) return null;
  const recent = lows.slice(-7);
  for (let i = recent.length - 1; i >= 1; i--) {
    const l2 = recent[i], l1 = recent[i-1];
    if (l2.idx <= l1.idx + 4) continue;
    const diff = Math.abs(l2.price - l1.price) / Math.min(l1.price, l2.price);
    if (diff > 0.06) continue;
    let nkPrice = -Infinity, nkTime = null;
    for (let k = l1.idx + 1; k < l2.idx; k++) {
      if (d[k].high > nkPrice) { nkPrice = d[k].high; nkTime = d[k].time; }
    }
    if (!nkTime) continue;
    if ((nkPrice - Math.min(l1.price, l2.price)) / nkPrice < 0.03) continue;
    return { type: 'dbl_bot', trough1: l1, trough2: l2, necklinePrice: nkPrice, necklineTime: nkTime };
  }
  return null;
}

function detectInvertedHS(data) {
  if (!data || data.length < 30) return null;
  const d = data.slice(-800);
  const lows = findSwingLows(d, 3);
  if (lows.length < 3) return null;
  const recent = lows.slice(-9);
  for (let i = recent.length - 1; i >= 2; i--) {
    const rs = recent[i], head = recent[i-1], ls = recent[i-2];
    if (ls.idx >= head.idx || head.idx >= rs.idx) continue;
    if (head.price >= ls.price || head.price >= rs.price) continue;
    const shDiff = Math.abs(rs.price - ls.price) / Math.min(rs.price, ls.price);
    if (shDiff > 0.12) continue;
    let nl1P = -Infinity, nl1T = null;
    for (let k = ls.idx + 1; k < head.idx; k++) {
      if (d[k].high > nl1P) { nl1P = d[k].high; nl1T = d[k].time; }
    }
    let nl2P = -Infinity, nl2T = null;
    for (let k = head.idx + 1; k < rs.idx; k++) {
      if (d[k].high > nl2P) { nl2P = d[k].high; nl2T = d[k].time; }
    }
    if (!nl1T || !nl2T) continue;
    return { type: 'inv_hs', leftShoulder: ls, head, rightShoulder: rs,
             neckline1: { price: nl1P, time: nl1T }, neckline2: { price: nl2P, time: nl2T } };
  }
  return null;
}

function detectFallingWedge(data) {
  if (!data || data.length < 20) return null;
  const d = data.slice(-800);
  const highs = findSwingHighs(d, 3);
  const lows  = findSwingLows(d, 3);
  if (highs.length < 2 || lows.length < 2) return null;
  const rh = highs.slice(-4), rl = lows.slice(-4);
  const h1 = rh[rh.length-2], h2 = rh[rh.length-1];
  const l1 = rl[rl.length-2], l2 = rl[rl.length-1];
  if (!h1 || !h2 || !l1 || !l2) return null;
  if (h2.price >= h1.price || l2.price >= l1.price) return null; // both going down
  const highSlope = (h2.price - h1.price) / (h2.idx - h1.idx || 1);
  const lowSlope  = (l2.price - l1.price) / (l2.idx  - l1.idx  || 1);
  if (highSlope >= 0 || lowSlope >= 0) return null;
  if (lowSlope < highSlope * 0.4) return null; // converging
  return { type: 'fall_wedge', high1: h1, high2: h2, low1: l1, low2: l2 };
}

function detectBullishExpanding(data) {
  if (!data || data.length < 20) return null;
  const d = data.slice(-800);
  const highs = findSwingHighs(d, 3);
  const lows  = findSwingLows(d, 3);
  if (highs.length < 2 || lows.length < 2) return null;
  const rh = highs.slice(-4), rl = lows.slice(-4);
  const h1 = rh[rh.length-2], h2 = rh[rh.length-1];
  const l1 = rl[rl.length-2], l2 = rl[rl.length-1];
  if (!h1 || !h2 || !l1 || !l2) return null;
  if (h2.price <= h1.price * 1.005 || l2.price >= l1.price * 0.995) return null;
  // Bullish: expanding but price trending up overall
  const avgPrice = (h2.price + l2.price) / 2;
  const prevAvg  = (h1.price + l1.price) / 2;
  if (avgPrice <= prevAvg) return null;
  return { type: 'bull_expand', high1: h1, high2: h2, low1: l1, low2: l2 };
}

function detectTripleBottom(data) {
  if (!data || data.length < 30) return null;
  const d = data.slice(-800);
  const lows = findSwingLows(d, 3);
  if (lows.length < 3) return null;
  const recent = lows.slice(-9);
  for (let i = recent.length - 1; i >= 2; i--) {
    const l3 = recent[i], l2 = recent[i-1], l1 = recent[i-2];
    if (l3.idx <= l2.idx || l2.idx <= l1.idx) continue;
    const prices = [l1.price, l2.price, l3.price];
    const maxP = Math.max(...prices), minP = Math.min(...prices);
    if ((maxP - minP) / maxP > 0.07) continue;
    let nk1P = -Infinity, nk1T = null;
    for (let k = l1.idx + 1; k < l2.idx; k++) {
      if (d[k].high > nk1P) { nk1P = d[k].high; nk1T = d[k].time; }
    }
    let nk2P = -Infinity, nk2T = null;
    for (let k = l2.idx + 1; k < l3.idx; k++) {
      if (d[k].high > nk2P) { nk2P = d[k].high; nk2T = d[k].time; }
    }
    if (!nk1T || !nk2T) continue;
    return { type: 'triple_bot', trough1: l1, trough2: l2, trough3: l3,
             necklinePrice: Math.max(nk1P, nk2P), nk1Time: nk1T, nk2Time: nk2T };
  }
  return null;
}

function detectBullishFlag(data) {
  if (!data || data.length < 25) return null;
  const d = data.slice(-800);
  // Find a strong upward pole: last 15-40 candles big move up
  let bestPole = null;
  for (let start = 0; start < d.length - 15; start++) {
    const end = Math.min(start + 30, d.length - 5);
    const poleMove = (d[end].close - d[start].close) / d[start].close;
    if (poleMove < 0.15) continue; // needs 15%+ pole
    // After pole, check for consolidation (flag): lower highs, lower lows, gentle down
    const flagStart = end;
    const flagEnd = Math.min(flagStart + 15, d.length - 1);
    let flagOk = true;
    for (let k = flagStart + 1; k <= flagEnd; k++) {
      if (d[k].high > d[flagStart].high * 1.02) { flagOk = false; break; }
    }
    if (flagOk && flagEnd > flagStart + 4) {
      bestPole = { poleStart: d[start], poleEnd: d[end], flagEnd: d[flagEnd] };
    }
  }
  return bestPole ? { type: 'bull_flag', ...bestPole } : null;
}

function detectBullishPennant(data) {
  if (!data || data.length < 25) return null;
  const d = data.slice(-800);
  for (let start = 0; start < d.length - 20; start++) {
    const end = Math.min(start + 20, d.length - 8);
    const poleMove = (d[end].close - d[start].close) / d[start].close;
    if (poleMove < 0.12) continue;
    // Pennant: converging highs and lows after pole
    const ps = end, pe = Math.min(ps + 12, d.length - 1);
    if (pe - ps < 4) continue;
    const highs2 = [], lows2 = [];
    for (let k = ps; k <= pe; k++) { highs2.push(d[k].high); lows2.push(d[k].low); }
    const highSlope = (highs2[highs2.length-1] - highs2[0]) / highs2.length;
    const lowSlope  = (lows2[lows2.length-1]  - lows2[0])  / lows2.length;
    if (highSlope >= 0 || lowSlope <= 0) continue; // highs falling, lows rising
    return { type: 'bull_pennant', poleStart: d[start], poleEnd: d[end],
             pennStart: d[ps], pennEnd: d[pe] };
  }
  return null;
}

function detectFallingVillage(data) {
  if (!data || data.length < 20) return null;
  const d = data.slice(-800);
  const lows = findSwingLows(d, 2);
  if (lows.length < 3) return null;
  const recent = lows.slice(-5);
  // All lows within tight range and last one starting to rise
  const minP = Math.min(...recent.map(l => l.price));
  const maxP = Math.max(...recent.map(l => l.price));
  if ((maxP - minP) / maxP > 0.08) return null;
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];
  if (last.price <= prev.price) return null; // last low higher than prev → reversal
  return { type: 'fall_village', lows: recent };
}

function detectDescendingTriangleBull(data) {
  if (!data || data.length < 20) return null;
  const d = data.slice(-800);
  const lows  = findSwingLows(d, 3);
  const highs = findSwingHighs(d, 3);
  if (lows.length < 3 || highs.length < 2) return null;
  const rl = lows.slice(-4);
  // flat support (within 3%)
  const minL = Math.min(...rl.map(l => l.price));
  const maxL = Math.max(...rl.map(l => l.price));
  if ((maxL - minL) / maxL > 0.03) return null;
  const rh = highs.slice(-3);
  // lower highs
  if (rh[rh.length-1].price >= rh[0].price) return null;
  return { type: 'desc_tri', supportPrice: minL, high1: rh[0], high2: rh[rh.length-1],
           low1: rl[0], low2: rl[rl.length-1] };
}

function detectSymmetricalExpandingBull(data) {
  if (!data || data.length < 20) return null;
  const d = data.slice(-800);
  const highs = findSwingHighs(d, 3);
  const lows  = findSwingLows(d, 3);
  if (highs.length < 2 || lows.length < 2) return null;
  const rh = highs.slice(-3), rl = lows.slice(-3);
  const h1 = rh[rh.length-2], h2 = rh[rh.length-1];
  const l1 = rl[rl.length-2], l2 = rl[rl.length-1];
  if (!h1 || !h2 || !l1 || !l2) return null;
  const expanding = h2.price > h1.price * 1.005 && l2.price < l1.price * 0.995;
  if (!expanding) return null;
  // Symmetrical: roughly equal expansion on both sides
  const upExpand   = (h2.price - h1.price) / h1.price;
  const downExpand = (l1.price - l2.price) / l1.price;
  if (Math.abs(upExpand - downExpand) / Math.max(upExpand, downExpand) > 0.5) return null;
  return { type: 'sym_expand', high1: h1, high2: h2, low1: l1, low2: l2 };
}

// ── Extra Bearish Detectors ─────────────────────────────────────

function detectBearishFlag(data) {
  if (!data || data.length < 25) return null;
  const d = data.slice(-800);
  for (let start = 0; start < d.length - 15; start++) {
    const end = Math.min(start + 30, d.length - 5);
    const poleMove = (d[end].close - d[start].close) / d[start].close;
    if (poleMove > -0.15) continue; // needs 15%+ drop
    const flagStart = end;
    const flagEnd = Math.min(flagStart + 15, d.length - 1);
    let flagOk = true;
    for (let k = flagStart + 1; k <= flagEnd; k++) {
      if (d[k].low < d[flagStart].low * 0.98) { flagOk = false; break; }
    }
    if (flagOk && flagEnd > flagStart + 4) {
      return { type: 'bear_flag', poleStart: d[start], poleEnd: d[end], flagEnd: d[flagEnd] };
    }
  }
  return null;
}

function detectBearishPennant(data) {
  if (!data || data.length < 25) return null;
  const d = data.slice(-800);
  for (let start = 0; start < d.length - 20; start++) {
    const end = Math.min(start + 20, d.length - 8);
    const poleMove = (d[end].close - d[start].close) / d[start].close;
    if (poleMove > -0.12) continue;
    const ps = end, pe = Math.min(ps + 12, d.length - 1);
    if (pe - ps < 4) continue;
    const highs2 = [], lows2 = [];
    for (let k = ps; k <= pe; k++) { highs2.push(d[k].high); lows2.push(d[k].low); }
    const highSlope = (highs2[highs2.length-1] - highs2[0]) / highs2.length;
    const lowSlope  = (lows2[lows2.length-1]  - lows2[0])  / lows2.length;
    if (highSlope <= 0 || lowSlope >= 0) continue;
    return { type: 'bear_pennant', poleStart: d[start], poleEnd: d[end],
             pennStart: d[ps], pennEnd: d[pe] };
  }
  return null;
}

function detectDescendingTriangleBear(data) {
  if (!data || data.length < 20) return null;
  const d = data.slice(-800);
  const highs = findSwingHighs(d, 3);
  const lows  = findSwingLows(d, 3);
  if (lows.length < 3 || highs.length < 2) return null;
  const rl = lows.slice(-4);
  const minL = Math.min(...rl.map(l => l.price));
  const maxL = Math.max(...rl.map(l => l.price));
  if ((maxL - minL) / maxL > 0.03) return null;
  const rh = highs.slice(-3);
  if (rh[rh.length-1].price >= rh[0].price) return null;
  // Bearish: price already near support, likely to break
  const lastPrice = d[d.length-1].close;
  if ((lastPrice - minL) / minL > 0.05) return null; // price must be near support
  return { type: 'asc_tri', supportPrice: minL, high1: rh[0], high2: rh[rh.length-1],
           low1: rl[0], low2: rl[rl.length-1] };
}

function detectSymmetricalExpandingBear(data) {
  if (!data || data.length < 20) return null;
  const d = data.slice(-800);
  const highs = findSwingHighs(d, 3);
  const lows  = findSwingLows(d, 3);
  if (highs.length < 2 || lows.length < 2) return null;
  const rh = highs.slice(-3), rl = lows.slice(-3);
  const h1 = rh[rh.length-2], h2 = rh[rh.length-1];
  const l1 = rl[rl.length-2], l2 = rl[rl.length-1];
  if (!h1 || !h2 || !l1 || !l2) return null;
  const expanding = h2.price > h1.price * 1.005 && l2.price < l1.price * 0.995;
  if (!expanding) return null;
  // Last close near the lower end = bearish bias
  const lastClose = d[d.length-1].close;
  const midPoint  = (h2.price + l2.price) / 2;
  if (lastClose > midPoint) return null;
  return { type: 'sym_expand_bear', high1: h1, high2: h2, low1: l1, low2: l2 };
}

/* ── RUN ALL DETECTIONS & UPDATE BUTTONS ─────────────────────── */
function getVisibleData() {
  if (!S.chart || !S.chartData || !S.chartData.length) return S.chartData || [];
  try {
    const range = S.chart.timeScale().getVisibleLogicalRange();
    if (range) {
      const from = Math.max(0, Math.floor(range.from));
      const to   = Math.min(S.chartData.length - 1, Math.ceil(range.to));
      if (to > from) return S.chartData.slice(from, to + 1);
    }
  } catch(e) {}
  return S.chartData;
}

function runPatternDetection() {
  const dataToScan = getVisibleData();
  if (!dataToScan || dataToScan.length < 15) return;

  const detectors = {
    // Bearish
    dbl_top:         detectDoubleTop,
    hs:              detectHeadShoulders,
    wedge:           detectRisingWedge,
    expand:          detectExpandingTriangle,
    triple:          detectTripleTop,
    bear_flag:       detectBearishFlag,
    bear_pennant:    detectBearishPennant,
    bear_wedge:      detectRisingWedge,
    asc_tri:         detectDescendingTriangleBear,
    sym_expand_bear: detectSymmetricalExpandingBear,
    // Bullish
    dbl_bot:         detectDoubleBottom,
    inv_hs:          detectInvertedHS,
    fall_wedge:      detectFallingWedge,
    bull_expand:     detectBullishExpanding,
    triple_bot:      detectTripleBottom,
    bull_flag:       detectBullishFlag,
    bull_pennant:    detectBullishPennant,
    fall_village:    detectFallingVillage,
    desc_tri:        detectDescendingTriangleBull,
    sym_expand:      detectSymmetricalExpandingBull,
  };

  let anyNew = false;
  ALL_PATTERNS.forEach(p => {
    const result = detectors[p.id] ? detectors[p.id](dataToScan) : null;
    const btn    = document.getElementById('patBtn_' + p.id);
    if (!btn) return;

    if (result) {
      patternDetected[p.id] = result;
      if (!drawnPatterns.has(p.id)) {
        btn.classList.add('detected');
        btn.classList.remove('drawn');
      }
    } else {
      if (!drawnPatterns.has(p.id)) {
        delete patternDetected[p.id];
        btn.classList.remove('detected');
      }
    }
  });

  renderDrawings();
}

/* ── CANVAS PATTERN RENDERER (called from renderDrawings) ─────── */
function renderPatternOverlays() {
  if (!S.chart || !S.series || !ctx || drawnPatterns.size === 0) return;

  const tc = t => S.chart.timeScale().timeToCoordinate(t);
  const pc = p => S.series.priceToCoordinate(p);
  const valid = (...vals) => vals.every(v => v !== null && v !== undefined && !isNaN(v));

  drawnPatterns.forEach(pid => {
    const pd = patternDetected[pid];
    if (!pd) return;

    // Get unique color from pattern definition
    const patDef = ALL_PATTERNS.find(p => p.id === pid);
    const patColor = patDef ? patDef.color : '#ff4560';

    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    /* ── helpers ── */
    const drawArrowDown = (ax, startY, len, color) => {
      ctx.beginPath();
      ctx.strokeStyle = color || '#00e07a';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.moveTo(ax, startY);
      ctx.lineTo(ax, startY + len);
      ctx.moveTo(ax - 7, startY + len - 14);
      ctx.lineTo(ax,     startY + len);
      ctx.lineTo(ax + 7, startY + len - 14);
      ctx.stroke();
    };

    const drawLabel = (x, y, text, color) => {
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillStyle = color || '#ff4560';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4;
      ctx.fillText(text, x, y - 8);
      ctx.shadowBlur = 0;
    };

    const drawCircle = (x, y, r, color) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.arc(x, y, r || 6, 0, Math.PI * 2);
      ctx.stroke();
    };

    /* ══ DOUBLE TOP ══ */
    if (pid === 'dbl_top') {
      const x1 = tc(pd.peak1.time),        y1 = pc(pd.peak1.price);
      const x2 = tc(pd.peak2.time),        y2 = pc(pd.peak2.price);
      const yn = pc(pd.necklinePrice);
      if (!valid(x1,y1,x2,y2,yn)) { ctx.restore(); return; }

      const xL = Math.min(x1,x2) - 30, xR = Math.max(x1,x2) + 60;

      // Neckline dashed
      ctx.beginPath();
      ctx.strokeStyle = patColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([7, 4]);
      ctx.moveTo(xL, yn);
      ctx.lineTo(xR, yn);
      ctx.stroke();
      ctx.setLineDash([]);

      // Peak circles
      drawCircle(x1, y1, 6, patColor);
      drawCircle(x2, y2, 6, patColor);

      // Connector between peaks (faint)
      ctx.beginPath();
      ctx.strokeStyle = patColor + '55';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Shaded zone
      ctx.beginPath();
      ctx.fillStyle = patColor + '15';
      ctx.fillRect(Math.min(x1,x2)-10, Math.min(y1,y2)-10, Math.abs(x2-x1)+20, yn - Math.min(y1,y2)+10);

      // Down arrow
      drawArrowDown(x2 + 28, yn + 4, 48, patColor);

      // Label
      drawLabel(Math.min(x1,x2), Math.min(y1,y2), '⬦ Bearish Double Top', patColor);
    }

    /* ══ HEAD & SHOULDERS ══ */
    else if (pid === 'hs') {
      const lsx  = tc(pd.leftShoulder.time),  lsy  = pc(pd.leftShoulder.price);
      const hx   = tc(pd.head.time),          hy   = pc(pd.head.price);
      const rsx  = tc(pd.rightShoulder.time), rsy  = pc(pd.rightShoulder.price);
      const nl1x = tc(pd.neckline1.time),     nl1y = pc(pd.neckline1.price);
      const nl2x = tc(pd.neckline2.time),     nl2y = pc(pd.neckline2.price);
      if (!valid(lsx,lsy,hx,hy,rsx,rsy,nl1x,nl1y,nl2x,nl2y)) { ctx.restore(); return; }

      const xL = lsx - 25, xR = rsx + 60;

      // Neckline
      ctx.beginPath();
      ctx.strokeStyle = patColor;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([7, 4]);
      ctx.moveTo(xL, nl1y);
      ctx.lineTo(xR, nl2y + (nl2y - nl1y) * 0.15);
      ctx.stroke();
      ctx.setLineDash([]);

      // Pattern outline
      ctx.beginPath();
      ctx.strokeStyle = patColor + 'bb';
      ctx.lineWidth = 1.5;
      ctx.moveTo(nl1x, nl1y);
      ctx.lineTo(lsx,  lsy);
      ctx.lineTo(nl1x, nl1y);
      ctx.lineTo(hx,   hy);
      ctx.lineTo(nl2x, nl2y);
      ctx.lineTo(rsx,  rsy);
      ctx.lineTo(nl2x, nl2y);
      ctx.stroke();

      // Shaded area
      ctx.beginPath();
      ctx.fillStyle = patColor + '15';
      ctx.moveTo(lsx, lsy);
      ctx.lineTo(hx,  hy);
      ctx.lineTo(rsx, rsy);
      ctx.lineTo(rsx, nl2y);
      ctx.lineTo(lsx, nl1y);
      ctx.closePath();
      ctx.fill();

      // Peak circles
      [[lsx,lsy],[hx,hy],[rsx,rsy]].forEach(([px,py]) => drawCircle(px, py, 5, patColor));

      // Labels
      ctx.font = 'bold 9px Inter'; ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('LS', lsx-8, lsy-12);
      ctx.fillText('H', hx-4,  hy-12);
      ctx.fillText('RS', rsx-8, rsy-12);

      // Down arrow
      drawArrowDown(rsx + 28, nl2y + 4, 48, patColor);

      drawLabel(lsx, Math.min(lsy,hy,rsy), '⬦ Bearish H&S', patColor);
    }

    /* ══ RISING WEDGE ══ */
    else if (pid === 'wedge' || pid === 'bear_wedge') {
      const h1x = tc(pd.high1.time), h1y = pc(pd.high1.price);
      const h2x = tc(pd.high2.time), h2y = pc(pd.high2.price);
      const l1x = tc(pd.low1.time),  l1y = pc(pd.low1.price);
      const l2x = tc(pd.low2.time),  l2y = pc(pd.low2.price);
      if (!valid(h1x,h1y,h2x,h2y,l1x,l1y,l2x,l2y)) { ctx.restore(); return; }

      const extX = 50;
      const highSlopePerPx = (h2y - h1y) / (h2x - h1x || 1);
      const lowSlopePerPx  = (l2y - l1y) / (l2x - l1x || 1);
      const h2ext = h2y + highSlopePerPx * extX;
      const l2ext = l2y + lowSlopePerPx  * extX;

      // Shaded wedge fill
      ctx.beginPath();
      ctx.fillStyle = patColor + '15';
      ctx.moveTo(h1x, h1y);
      ctx.lineTo(h2x + extX, h2ext);
      ctx.lineTo(l2x + extX, l2ext);
      ctx.lineTo(l1x, l1y);
      ctx.closePath();
      ctx.fill();

      // Resistance line (upper)
      ctx.beginPath();
      ctx.strokeStyle = patColor;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([]);
      ctx.moveTo(h1x, h1y);
      ctx.lineTo(h2x + extX, h2ext);
      ctx.stroke();

      // Support line (lower)
      ctx.beginPath();
      ctx.moveTo(l1x, l1y);
      ctx.lineTo(l2x + extX, l2ext);
      ctx.stroke();

      [[h1x,h1y],[h2x,h2y],[l1x,l1y],[l2x,l2y]].forEach(([px,py]) => drawCircle(px, py, 4, patColor));
      drawArrowDown(h2x + extX + 10, Math.max(h2ext, l2ext) + 4, 52, patColor);
      drawLabel(h1x, Math.min(h1y,h2y), '⬦ Bearish Rising Wedge', patColor);
    }

    /* ══ EXPANDING TRIANGLE ══ */
    else if (pid === 'expand') {
      const h1x = tc(pd.high1.time), h1y = pc(pd.high1.price);
      const h2x = tc(pd.high2.time), h2y = pc(pd.high2.price);
      const l1x = tc(pd.low1.time),  l1y = pc(pd.low1.price);
      const l2x = tc(pd.low2.time),  l2y = pc(pd.low2.price);
      if (!valid(h1x,h1y,h2x,h2y,l1x,l1y,l2x,l2y)) { ctx.restore(); return; }

      const extX = 45;
      const hSlope = (h2y - h1y) / (h2x - h1x || 1); // negative = going up
      const lSlope = (l2y - l1y) / (l2x - l1x || 1); // positive = going down
      const h2ext  = h2y + hSlope * extX;
      const l2ext  = l2y + lSlope * extX;

      // Shaded expanding fill
      ctx.beginPath();
      ctx.fillStyle = patColor + '15';
      ctx.moveTo(h1x, h1y);
      ctx.lineTo(h2x + extX, h2ext);
      ctx.lineTo(l2x + extX, l2ext);
      ctx.lineTo(l1x, l1y);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath(); ctx.strokeStyle = patColor; ctx.lineWidth = 1.8;
      ctx.moveTo(h1x, h1y); ctx.lineTo(h2x + extX, h2ext); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(l1x, l1y); ctx.lineTo(l2x + extX, l2ext); ctx.stroke();
      [[h1x,h1y],[h2x,h2y],[l1x,l1y],[l2x,l2y]].forEach(([px,py]) => drawCircle(px, py, 4, patColor));
      drawArrowDown(Math.max(h2x,l2x) + extX + 10, Math.max(h2ext, l2ext) + 4, 52, patColor);
      drawLabel(Math.min(h1x,l1x), Math.min(h1y,l1y), '⬦ Bearish Expanding Triangle', patColor);
    }

    /* ══ TRIPLE TOP ══ */
    else if (pid === 'triple') {
      const x1 = tc(pd.peak1.time), y1 = pc(pd.peak1.price);
      const x2 = tc(pd.peak2.time), y2 = pc(pd.peak2.price);
      const x3 = tc(pd.peak3.time), y3 = pc(pd.peak3.price);
      const yn = pc(pd.necklinePrice);
      if (!valid(x1,y1,x2,y2,x3,y3,yn)) { ctx.restore(); return; }

      const xL = x1 - 25, xR = x3 + 60;

      ctx.beginPath(); ctx.strokeStyle = patColor; ctx.lineWidth = 1.5; ctx.setLineDash([7, 4]);
      ctx.moveTo(xL, yn); ctx.lineTo(xR, yn); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.fillStyle = patColor + '15';
      ctx.fillRect(x1 - 10, Math.min(y1,y2,y3) - 10, x3 - x1 + 20, yn - Math.min(y1,y2,y3) + 10);
      [[x1,y1],[x2,y2],[x3,y3]].forEach(([px,py]) => drawCircle(px, py, 6, patColor));
      ctx.beginPath(); ctx.strokeStyle = patColor + '66'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = 'bold 9px Inter'; ctx.fillStyle = 'rgba(255,255,255,0.45)';
      [[x1,'①'],[x2,'②'],[x3,'③']].forEach(([px,lbl], i) => { ctx.fillText(lbl, px - 4, [y1,y2,y3][i] - 12); });
      drawArrowDown(x3 + 28, yn + 4, 48, patColor);
      drawLabel(x1, Math.min(y1,y2,y3), '⬦ Bearish Triple Top', patColor);
    }

    /* ══ BEARISH FLAG ══ */
    else if (pid === 'bear_flag') {
      const sx=tc(pd.poleStart.time),sy=pc(pd.poleStart.close);
      const ex=tc(pd.poleEnd.time), ey=pc(pd.poleEnd.close);
      const fx=tc(pd.flagEnd.time), fy=pc(pd.flagEnd.close);
      if (!valid(sx,sy,ex,ey,fx,fy)) { ctx.restore(); return; }
      ctx.beginPath(); ctx.strokeStyle=patColor; ctx.lineWidth=2.5;
      ctx.moveTo(sx,sy); ctx.lineTo(ex,ey); ctx.stroke();
      ctx.beginPath(); ctx.strokeStyle=patColor+'80'; ctx.lineWidth=1.5; ctx.setLineDash([5,4]);
      ctx.moveTo(ex,ey); ctx.lineTo(fx,fy); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.fillStyle=patColor+'18';
      ctx.fillRect(Math.min(ex,fx), Math.min(ey,fy), Math.abs(fx-ex), Math.abs(fy-ey)+10);
      ctx.beginPath(); ctx.strokeStyle=patColor; ctx.lineWidth=2.5;
      ctx.moveTo(fx+20,fy+4); ctx.lineTo(fx+20,fy+54);
      ctx.moveTo(fx+13,fy+40); ctx.lineTo(fx+20,fy+54); ctx.lineTo(fx+27,fy+40); ctx.stroke();
      drawLabel(sx, Math.min(sy,ey,fy), '⬦ Bearish Flag', patColor);
    }

    /* ══ BEARISH PENNANT ══ */
    else if (pid === 'bear_pennant') {
      const sx=tc(pd.poleStart.time),sy=pc(pd.poleStart.close);
      const ex=tc(pd.poleEnd.time), ey=pc(pd.poleEnd.close);
      const px1=tc(pd.pennStart.time),py1=pc(pd.pennStart.close);
      const px2=tc(pd.pennEnd.time), py2=pc(pd.pennEnd.close);
      if (!valid(sx,sy,ex,ey,px1,py1,px2,py2)) { ctx.restore(); return; }
      ctx.beginPath(); ctx.strokeStyle=patColor; ctx.lineWidth=2.5;
      ctx.moveTo(sx,sy); ctx.lineTo(ex,ey); ctx.stroke();
      ctx.beginPath(); ctx.fillStyle=patColor+'18';
      ctx.moveTo(px1,py1-(py1-py2)*0.3); ctx.lineTo(px2,(py1+py2)/2); ctx.lineTo(px1,py1+(py1-py2)*0.3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.strokeStyle=patColor; ctx.lineWidth=1.5;
      ctx.moveTo(px1,py1-(py1-py2)*0.3); ctx.lineTo(px2,(py1+py2)/2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px1,py1+(py1-py2)*0.3); ctx.lineTo(px2,(py1+py2)/2); ctx.stroke();
      ctx.beginPath(); ctx.strokeStyle=patColor; ctx.lineWidth=2.5;
      const ay=(py1+py2)/2+4;
      ctx.moveTo(px2+20,ay); ctx.lineTo(px2+20,ay+50);
      ctx.moveTo(px2+13,ay+36); ctx.lineTo(px2+20,ay+50); ctx.lineTo(px2+27,ay+36); ctx.stroke();
      drawLabel(sx, Math.min(sy,py1,py2), '⬦ Bearish Pennant', patColor);
    }

    /* ══ DESCENDING TRI (BEARISH) / ASC_TRI ══ */
    else if (pid === 'asc_tri') {
      const h1x=tc(pd.high1.time),h1y=pc(pd.high1.price);
      const h2x=tc(pd.high2.time),h2y=pc(pd.high2.price);
      const l1x=tc(pd.low1.time), l1y=pc(pd.low1.price);
      const l2x=tc(pd.low2.time), l2y=pc(pd.low2.price);
      const yn=pc(pd.supportPrice);
      if (!valid(h1x,h1y,h2x,h2y,l1x,l1y,l2x,l2y,yn)) { ctx.restore(); return; }
      const xL=h1x-20, xR=h2x+80;
      ctx.beginPath(); ctx.strokeStyle=patColor; ctx.lineWidth=1.8;
      ctx.moveTo(xL,yn); ctx.lineTo(xR,yn); ctx.stroke();
      ctx.beginPath(); ctx.strokeStyle=patColor+'99'; ctx.lineWidth=1.5;
      ctx.moveTo(h1x,h1y); ctx.lineTo(h2x,h2y); ctx.stroke();
      ctx.beginPath(); ctx.fillStyle=patColor+'15';
      ctx.moveTo(h1x,h1y); ctx.lineTo(h2x,h2y); ctx.lineTo(xR,yn); ctx.lineTo(xL,yn); ctx.closePath(); ctx.fill();
      [[h1x,h1y],[h2x,h2y]].forEach(([px,py])=>drawCircle(px,py,4,patColor));
      ctx.beginPath(); ctx.strokeStyle=patColor; ctx.lineWidth=2.5;
      ctx.moveTo(xR+10,yn+4); ctx.lineTo(xR+10,yn+54);
      ctx.moveTo(xR+3,yn+40); ctx.lineTo(xR+10,yn+54); ctx.lineTo(xR+17,yn+40); ctx.stroke();
      drawLabel(xL, Math.min(h1y,h2y), '⬦ Desc. Tri (Bearish)', patColor);
    }

    /* ══ SYMMETRICAL EXPANDING (BEARISH) ══ */
    else if (pid === 'sym_expand_bear') {
      const h1x=tc(pd.high1.time),h1y=pc(pd.high1.price);
      const h2x=tc(pd.high2.time),h2y=pc(pd.high2.price);
      const l1x=tc(pd.low1.time), l1y=pc(pd.low1.price);
      const l2x=tc(pd.low2.time), l2y=pc(pd.low2.price);
      if (!valid(h1x,h1y,h2x,h2y,l1x,l1y,l2x,l2y)) { ctx.restore(); return; }
      const extX=45;
      const hS=(h2y-h1y)/(h2x-h1x||1), lS=(l2y-l1y)/(l2x-l1x||1);
      const h2e=h2y+hS*extX, l2e=l2y+lS*extX;
      ctx.beginPath(); ctx.fillStyle=patColor+'15';
      ctx.moveTo(h1x,h1y); ctx.lineTo(h2x+extX,h2e); ctx.lineTo(l2x+extX,l2e); ctx.lineTo(l1x,l1y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.strokeStyle=patColor; ctx.lineWidth=1.8;
      ctx.moveTo(h1x,h1y); ctx.lineTo(h2x+extX,h2e); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(l1x,l1y); ctx.lineTo(l2x+extX,l2e); ctx.stroke();
      [[h1x,h1y],[h2x,h2y],[l1x,l1y],[l2x,l2y]].forEach(([px,py])=>drawCircle(px,py,4,patColor));
      ctx.beginPath(); ctx.strokeStyle=patColor; ctx.lineWidth=2.5;
      const bx=Math.max(h2x,l2x)+extX+10;
      const by=Math.max(h2e,l2e)+4;
      ctx.moveTo(bx,by); ctx.lineTo(bx,by+52);
      ctx.moveTo(bx-7,by+38); ctx.lineTo(bx,by+52); ctx.lineTo(bx+7,by+38); ctx.stroke();
      drawLabel(Math.min(h1x,l1x), Math.min(h1y,l1y), '⬦ Sym. Expanding (Bear)', patColor);
    }

    ctx.restore();
  });
}

/* ── BULLISH PATTERN CANVAS RENDERERS ─────────────────────────── */
function renderBullishPatternOverlays() {
  if (!S.chart || !S.series || !ctx || drawnPatterns.size === 0) return;

  const tc = t => S.chart.timeScale().timeToCoordinate(t);
  const pc = p => S.series.priceToCoordinate(p);
  const valid = (...vals) => vals.every(v => v !== null && v !== undefined && !isNaN(v));

  drawnPatterns.forEach(pid => {
    const pd = patternDetected[pid];
    if (!pd) return;
    // Skip bearish patterns (handled above)
    const isBullish = BULLISH_PATTERNS.some(p => p.id === pid);
    if (!isBullish) return;

    // Unique color per bullish pattern
    const patDef = BULLISH_PATTERNS.find(p => p.id === pid);
    const G = patDef ? patDef.color : '#00e07a';

    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    const drawArrowUp = (ax, startY, len, color) => {
      ctx.beginPath();
      ctx.strokeStyle = color || G;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.moveTo(ax, startY);
      ctx.lineTo(ax, startY - len);
      ctx.moveTo(ax - 7, startY - len + 14);
      ctx.lineTo(ax, startY - len);
      ctx.lineTo(ax + 7, startY - len + 14);
      ctx.stroke();
    };

    const drawLabel = (x, y, text, color) => {
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillStyle = color || G;
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4;
      ctx.fillText(text, x, y + 18);
      ctx.shadowBlur = 0;
    };

    const drawCircle = (x, y, r, color) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.arc(x, y, r || 6, 0, Math.PI * 2);
      ctx.stroke();
    };

    /* ══ DOUBLE BOTTOM ══ */
    if (pid === 'dbl_bot') {
      const x1 = tc(pd.trough1.time), y1 = pc(pd.trough1.price);
      const x2 = tc(pd.trough2.time), y2 = pc(pd.trough2.price);
      const yn = pc(pd.necklinePrice);
      if (!valid(x1,y1,x2,y2,yn)) { ctx.restore(); return; }
      const xL = Math.min(x1,x2)-30, xR = Math.max(x1,x2)+60;
      ctx.beginPath(); ctx.strokeStyle = G; ctx.lineWidth = 1.5; ctx.setLineDash([7,4]);
      ctx.moveTo(xL, yn); ctx.lineTo(xR, yn); ctx.stroke(); ctx.setLineDash([]);
      drawCircle(x1, y1, 6, G); drawCircle(x2, y2, 6, G);
      ctx.beginPath(); ctx.strokeStyle = 'rgba(0,224,122,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
      ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.fillStyle = 'rgba(0,224,122,0.07)';
      ctx.fillRect(Math.min(x1,x2)-10, yn, Math.abs(x2-x1)+20, Math.max(y1,y2)-yn+10);
      drawArrowUp(x2+28, yn-4, 48, G);
      drawLabel(Math.min(x1,x2), Math.max(y1,y2), '⬦ Bullish Double Bottom', G);
    }

    /* ══ INVERTED HEAD & SHOULDERS ══ */
    else if (pid === 'inv_hs') {
      const lsx = tc(pd.leftShoulder.time),  lsy = pc(pd.leftShoulder.price);
      const hx  = tc(pd.head.time),          hy  = pc(pd.head.price);
      const rsx = tc(pd.rightShoulder.time), rsy = pc(pd.rightShoulder.price);
      const nl1x = tc(pd.neckline1.time), nl1y = pc(pd.neckline1.price);
      const nl2x = tc(pd.neckline2.time), nl2y = pc(pd.neckline2.price);
      if (!valid(lsx,lsy,hx,hy,rsx,rsy,nl1x,nl1y,nl2x,nl2y)) { ctx.restore(); return; }
      const xL = lsx-25, xR = rsx+60;
      ctx.beginPath(); ctx.strokeStyle = G; ctx.lineWidth = 1.8; ctx.setLineDash([7,4]);
      ctx.moveTo(xL,nl1y); ctx.lineTo(xR, nl2y+(nl2y-nl1y)*0.15); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.strokeStyle = 'rgba(0,224,122,0.75)'; ctx.lineWidth = 1.5;
      ctx.moveTo(nl1x,nl1y); ctx.lineTo(lsx,lsy); ctx.lineTo(nl1x,nl1y);
      ctx.lineTo(hx,hy); ctx.lineTo(nl2x,nl2y); ctx.lineTo(rsx,rsy); ctx.lineTo(nl2x,nl2y); ctx.stroke();
      ctx.beginPath(); ctx.fillStyle = 'rgba(0,224,122,0.06)';
      ctx.moveTo(lsx,lsy); ctx.lineTo(hx,hy); ctx.lineTo(rsx,rsy);
      ctx.lineTo(rsx,nl2y); ctx.lineTo(lsx,nl1y); ctx.closePath(); ctx.fill();
      [[lsx,lsy],[hx,hy],[rsx,rsy]].forEach(([px,py]) => drawCircle(px,py,5,G));
      ctx.font='bold 9px Inter'; ctx.fillStyle='rgba(255,255,255,0.5)';
      ctx.fillText('LS',lsx-8,lsy+18); ctx.fillText('H',hx-4,hy+18); ctx.fillText('RS',rsx-8,rsy+18);
      drawArrowUp(rsx+28, nl2y-4, 48, G);
      drawLabel(lsx, Math.max(lsy,hy,rsy), '⬦ Bullish Inv. H&S', G);
    }

    /* ══ FALLING WEDGE ══ */
    else if (pid === 'fall_wedge') {
      const h1x=tc(pd.high1.time),h1y=pc(pd.high1.price);
      const h2x=tc(pd.high2.time),h2y=pc(pd.high2.price);
      const l1x=tc(pd.low1.time), l1y=pc(pd.low1.price);
      const l2x=tc(pd.low2.time), l2y=pc(pd.low2.price);
      if (!valid(h1x,h1y,h2x,h2y,l1x,l1y,l2x,l2y)) { ctx.restore(); return; }
      const extX=50;
      const hSlope=(h2y-h1y)/(h2x-h1x||1), lSlope=(l2y-l1y)/(l2x-l1x||1);
      const h2ext=h2y+hSlope*extX, l2ext=l2y+lSlope*extX;
      ctx.beginPath(); ctx.fillStyle='rgba(0,224,122,0.08)';
      ctx.moveTo(h1x,h1y); ctx.lineTo(h2x+extX,h2ext); ctx.lineTo(l2x+extX,l2ext); ctx.lineTo(l1x,l1y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.strokeStyle=G; ctx.lineWidth=1.8; ctx.setLineDash([]);
      ctx.moveTo(h1x,h1y); ctx.lineTo(h2x+extX,h2ext); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(l1x,l1y); ctx.lineTo(l2x+extX,l2ext); ctx.stroke();
      [[h1x,h1y],[h2x,h2y],[l1x,l1y],[l2x,l2y]].forEach(([px,py])=>drawCircle(px,py,4,G));
      drawArrowUp(h2x+extX+10, Math.min(h2ext,l2ext)-4, 52, G);
      drawLabel(h1x, Math.max(h1y,l1y), '⬦ Bullish Falling Wedge', G);
    }

    /* ══ BULLISH EXPANDING ══ */
    else if (pid === 'bull_expand') {
      const h1x=tc(pd.high1.time),h1y=pc(pd.high1.price);
      const h2x=tc(pd.high2.time),h2y=pc(pd.high2.price);
      const l1x=tc(pd.low1.time), l1y=pc(pd.low1.price);
      const l2x=tc(pd.low2.time), l2y=pc(pd.low2.price);
      if (!valid(h1x,h1y,h2x,h2y,l1x,l1y,l2x,l2y)) { ctx.restore(); return; }
      const extX=45;
      const hSlope=(h2y-h1y)/(h2x-h1x||1), lSlope=(l2y-l1y)/(l2x-l1x||1);
      const h2ext=h2y+hSlope*extX, l2ext=l2y+lSlope*extX;
      ctx.beginPath(); ctx.fillStyle='rgba(0,224,122,0.07)';
      ctx.moveTo(h1x,h1y); ctx.lineTo(h2x+extX,h2ext); ctx.lineTo(l2x+extX,l2ext); ctx.lineTo(l1x,l1y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.strokeStyle=G; ctx.lineWidth=1.8;
      ctx.moveTo(h1x,h1y); ctx.lineTo(h2x+extX,h2ext); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(l1x,l1y); ctx.lineTo(l2x+extX,l2ext); ctx.stroke();
      [[h1x,h1y],[h2x,h2y],[l1x,l1y],[l2x,l2y]].forEach(([px,py])=>drawCircle(px,py,4,G));
      drawArrowUp(Math.max(h2x,l2x)+extX+10, Math.min(h2ext,l2ext)-4, 52, G);
      drawLabel(Math.min(h1x,l1x), Math.max(h1y,l1y), '⬦ Bullish Expanding Triangle', G);
    }

    /* ══ TRIPLE BOTTOM ══ */
    else if (pid === 'triple_bot') {
      const x1=tc(pd.trough1.time),y1=pc(pd.trough1.price);
      const x2=tc(pd.trough2.time),y2=pc(pd.trough2.price);
      const x3=tc(pd.trough3.time),y3=pc(pd.trough3.price);
      const yn=pc(pd.necklinePrice);
      if (!valid(x1,y1,x2,y2,x3,y3,yn)) { ctx.restore(); return; }
      const xL=x1-25, xR=x3+60;
      ctx.beginPath(); ctx.strokeStyle=G; ctx.lineWidth=1.5; ctx.setLineDash([7,4]);
      ctx.moveTo(xL,yn); ctx.lineTo(xR,yn); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.fillStyle='rgba(0,224,122,0.07)';
      ctx.fillRect(x1-10, yn, x3-x1+20, Math.max(y1,y2,y3)-yn+10);
      [[x1,y1],[x2,y2],[x3,y3]].forEach(([px,py])=>drawCircle(px,py,6,G));
      ctx.beginPath(); ctx.strokeStyle='rgba(0,224,122,0.4)'; ctx.lineWidth=1; ctx.setLineDash([4,4]);
      ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3); ctx.stroke(); ctx.setLineDash([]);
      ctx.font='bold 9px Inter'; ctx.fillStyle='rgba(255,255,255,0.45)';
      [[x1,'①'],[x2,'②'],[x3,'③']].forEach(([px,lbl],i)=>{ ctx.fillText(lbl,px-4,[y1,y2,y3][i]+18); });
      drawArrowUp(x3+28, yn-4, 48, G);
      drawLabel(x1, Math.max(y1,y2,y3), '⬦ Bullish Triple Bottom', G);
    }

    /* ══ BULLISH FLAG ══ */
    else if (pid === 'bull_flag') {
      const sx=tc(pd.poleStart.time),sy=pc(pd.poleStart.close);
      const ex=tc(pd.poleEnd.time), ey=pc(pd.poleEnd.close);
      const fx=tc(pd.flagEnd.time), fy=pc(pd.flagEnd.close);
      if (!valid(sx,sy,ex,ey,fx,fy)) { ctx.restore(); return; }
      ctx.beginPath(); ctx.strokeStyle=G; ctx.lineWidth=2.5;
      ctx.moveTo(sx,sy); ctx.lineTo(ex,ey); ctx.stroke();
      ctx.beginPath(); ctx.strokeStyle='rgba(0,224,122,0.5)'; ctx.lineWidth=1.5; ctx.setLineDash([5,4]);
      ctx.moveTo(ex,ey); ctx.lineTo(fx,fy); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.fillStyle='rgba(0,224,122,0.08)';
      ctx.fillRect(Math.min(ex,fx), Math.min(ey,fy), Math.abs(fx-ex), Math.abs(fy-ey)+10);
      drawArrowUp(fx+20, fy-4, 50, G);
      drawLabel(sx, Math.max(sy,ey,fy), '⬦ Bullish Flag', G);
    }

    /* ══ BULLISH PENNANT ══ */
    else if (pid === 'bull_pennant') {
      const sx=tc(pd.poleStart.time),sy=pc(pd.poleStart.close);
      const ex=tc(pd.poleEnd.time), ey=pc(pd.poleEnd.close);
      const px1=tc(pd.pennStart.time),py1=pc(pd.pennStart.close);
      const px2=tc(pd.pennEnd.time), py2=pc(pd.pennEnd.close);
      if (!valid(sx,sy,ex,ey,px1,py1,px2,py2)) { ctx.restore(); return; }
      ctx.beginPath(); ctx.strokeStyle=G; ctx.lineWidth=2.5;
      ctx.moveTo(sx,sy); ctx.lineTo(ex,ey); ctx.stroke();
      ctx.beginPath(); ctx.fillStyle='rgba(0,224,122,0.08)';
      ctx.moveTo(px1,py1-(py1-py2)*0.3); ctx.lineTo(px2,(py1+py2)/2); ctx.lineTo(px1,py1+(py1-py2)*0.3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.strokeStyle=G; ctx.lineWidth=1.5; ctx.setLineDash([]);
      ctx.moveTo(px1,py1-(py1-py2)*0.3); ctx.lineTo(px2,(py1+py2)/2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px1,py1+(py1-py2)*0.3); ctx.lineTo(px2,(py1+py2)/2); ctx.stroke();
      drawArrowUp(px2+20, (py1+py2)/2-4, 50, G);
      drawLabel(sx, Math.max(sy,py1,py2), '⬦ Bullish Pennant', G);
    }

    /* ══ FALLING VILLAGE ══ */
    else if (pid === 'fall_village') {
      if (!pd.lows || pd.lows.length < 2) { ctx.restore(); return; }
      const pts = pd.lows.map(l => ({ x: tc(l.time), y: pc(l.price) })).filter(p => valid(p.x,p.y));
      if (pts.length < 2) { ctx.restore(); return; }
      ctx.beginPath(); ctx.strokeStyle=G; ctx.lineWidth=2; ctx.setLineDash([]);
      ctx.moveTo(pts[0].x, pts[0].y);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
      pts.forEach(p => drawCircle(p.x, p.y, 5, G));
      const lastPt = pts[pts.length-1];
      drawArrowUp(lastPt.x+20, lastPt.y-4, 48, G);
      drawLabel(pts[0].x, Math.max(...pts.map(p=>p.y)), '⬦ Bullish Falling Village', G);
    }

    /* ══ DESCENDING TRIANGLE (BULLISH) ══ */
    else if (pid === 'desc_tri') {
      const h1x=tc(pd.high1.time),h1y=pc(pd.high1.price);
      const h2x=tc(pd.high2.time),h2y=pc(pd.high2.price);
      const l1x=tc(pd.low1.time), l1y=pc(pd.low1.price);
      const l2x=tc(pd.low2.time), l2y=pc(pd.low2.price);
      const yn=pc(pd.supportPrice);
      if (!valid(h1x,h1y,h2x,h2y,l1x,l1y,l2x,l2y,yn)) { ctx.restore(); return; }
      const xL=h1x-20, xR=h2x+80;
      ctx.beginPath(); ctx.strokeStyle=G; ctx.lineWidth=1.8;
      ctx.moveTo(xL,yn); ctx.lineTo(xR,yn); ctx.stroke();
      ctx.beginPath(); ctx.strokeStyle='rgba(0,224,122,0.6)'; ctx.lineWidth=1.5;
      ctx.moveTo(h1x,h1y); ctx.lineTo(h2x,h2y); ctx.stroke();
      ctx.beginPath(); ctx.fillStyle='rgba(0,224,122,0.07)';
      ctx.moveTo(h1x,h1y); ctx.lineTo(h2x,h2y); ctx.lineTo(xR,yn); ctx.lineTo(xL,yn); ctx.closePath(); ctx.fill();
      [[h1x,h1y],[h2x,h2y]].forEach(([px,py])=>drawCircle(px,py,4,G));
      drawArrowUp(xR, yn-4, 52, G);
      drawLabel(xL, Math.max(h1y,l1y), '⬦ Descending Tri (Bullish)', G);
    }

    /* ══ SYMMETRICAL EXPANDING (BULLISH) ══ */
    else if (pid === 'sym_expand') {
      const h1x=tc(pd.high1.time),h1y=pc(pd.high1.price);
      const h2x=tc(pd.high2.time),h2y=pc(pd.high2.price);
      const l1x=tc(pd.low1.time), l1y=pc(pd.low1.price);
      const l2x=tc(pd.low2.time), l2y=pc(pd.low2.price);
      if (!valid(h1x,h1y,h2x,h2y,l1x,l1y,l2x,l2y)) { ctx.restore(); return; }
      const extX=45;
      const hS=(h2y-h1y)/(h2x-h1x||1), lS=(l2y-l1y)/(l2x-l1x||1);
      const h2e=h2y+hS*extX, l2e=l2y+lS*extX;
      ctx.beginPath(); ctx.fillStyle='rgba(0,224,122,0.06)';
      ctx.moveTo(h1x,h1y); ctx.lineTo(h2x+extX,h2e); ctx.lineTo(l2x+extX,l2e); ctx.lineTo(l1x,l1y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.strokeStyle=G; ctx.lineWidth=1.8;
      ctx.moveTo(h1x,h1y); ctx.lineTo(h2x+extX,h2e); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(l1x,l1y); ctx.lineTo(l2x+extX,l2e); ctx.stroke();
      [[h1x,h1y],[h2x,h2y],[l1x,l1y],[l2x,l2y]].forEach(([px,py])=>drawCircle(px,py,4,G));
      drawArrowUp(Math.max(h2x,l2x)+extX+10, Math.min(h2e,l2e)-4, 52, G);
      drawLabel(Math.min(h1x,l1x), Math.max(h1y,l1y), '⬦ Symmetrical Expanding (Bull)', G);
    }

    ctx.restore();
  });
}

/* ── BUTTON CLICK HANDLERS ────────────────────────────────────── */
ALL_PATTERNS.forEach(p => {
  const btn = document.getElementById('patBtn_' + p.id);
  if (!btn) return;

  btn.addEventListener('click', () => {
    const pd = patternDetected[p.id];

    if (!pd) {
      if (typeof showToast === 'function') showToast(`No ${p.label} detected on this timeframe`);
      return;
    }

    if (drawnPatterns.has(p.id)) {
      drawnPatterns.delete(p.id);
      btn.classList.remove('drawn');
      btn.classList.add('detected');
      renderDrawings();
      if (typeof showToast === 'function') showToast(`${p.label} removed`);
    } else {
      drawnPatterns.add(p.id);
      btn.classList.remove('detected');
      btn.classList.add('drawn');
      renderDrawings();
      if (typeof showToast === 'function') showToast(`✅ ${p.label} drawn on chart`);
    }
  });
});

/* ── CLEAR ALL DRAWN PATTERNS ── */
const clearAllPatsBtn = document.getElementById('clearAllPatsBtn');
if (clearAllPatsBtn) {
  clearAllPatsBtn.addEventListener('click', () => {
    drawnPatterns.clear();
    ALL_PATTERNS.forEach(p => {
      const btn = document.getElementById('patBtn_' + p.id);
      if (btn) btn.classList.remove('detected', 'drawn');
    });
    renderDrawings();
    if (typeof showToast === 'function') showToast('All patterns cleared');
  });
}

/* ── SCAN VISIBLE AREA MANUALLY ── */
const scanVisibleBtn = document.getElementById('scanVisibleBtn');
if (scanVisibleBtn) {
  scanVisibleBtn.addEventListener('click', () => {
    runPatternDetection();
    if (typeof showToast === 'function') showToast('Visible area scanned for patterns');
  });
}

// Auto-scan when user scrolls/zooms
setTimeout(() => {
  if (S.chart) {
    S.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
       if (S.scanTimer) clearTimeout(S.scanTimer);
       S.scanTimer = setTimeout(runPatternDetection, 300);
    });
  }
}, 2000);

/* ═══════════════════════════════════════════════════════════════
   HVBS AI – CANDLESTICK PATTERN DETECTION ENGINE
   Detects 27 classic candlestick patterns on last N candles
   Auto-blinks sidebar button + shows toast when detected
═══════════════════════════════════════════════════════════════ */

/* ── Candle helpers ── */
function isGreen(c) { return c.close >= c.open; }
function isRed(c)   { return c.close < c.open; }
function body(c)    { return Math.abs(c.close - c.open); }
function range(c)   { return c.high - c.low; }
function upperWick(c) { return c.high - Math.max(c.open, c.close); }
function lowerWick(c) { return Math.min(c.open, c.close) - c.low; }
function midpoint(c) { return (c.open + c.close) / 2; }
function isDoji(c) {
  const b = body(c), r = range(c);
  return r > 0 && b / r < 0.15; // relaxed from 0.1 → catches more real dojis
}

/* ── All 27 candle detectors (return true/false) ── */

// SINGLE CANDLE
function cdHammer(d) {
  if (d.length < 1) return false;
  const c = d[d.length - 1];
  const b = body(c), lw = lowerWick(c), uw = upperWick(c), r = range(c);
  if (r === 0 || b === 0) return false;
  // Hammer: long lower wick (≥2x body), small upper wick, small body near top
  // Can be bull OR bear colored — shape is what matters
  return lw >= 2 * b && uw <= b * 0.5 && b / r < 0.4;
}
function cdHangingMan(d) {
  if (d.length < 1) return false;
  const c = d[d.length - 1];
  const b = body(c), lw = lowerWick(c), uw = upperWick(c), r = range(c);
  if (r === 0 || b === 0) return false;
  // Same shape as hammer but after uptrend — can be any color
  if (!(lw >= 2 * b && uw <= b * 0.5 && b / r < 0.4)) return false;
  // Check prior trend is up
  if (d.length < 4) return false;
  const prev3 = d.slice(-4, -1);
  return prev3[prev3.length - 1].close > prev3[0].close;
}
function cdInvHammer(d) {
  if (d.length < 1) return false;
  const c = d[d.length - 1];
  const b = body(c), uw = upperWick(c), lw = lowerWick(c), r = range(c);
  if (r === 0 || b === 0) return false;
  // Inverted hammer: long upper wick (≥2x body), tiny lower wick, small body near bottom
  // Can be bull OR bear colored
  return uw >= 2 * b && lw <= b * 0.5 && b / r < 0.4;
}
function cdShootingStar(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], prev = d[d.length - 2];
  const b = body(c), uw = upperWick(c), lw = lowerWick(c), r = range(c);
  if (r === 0 || b === 0) return false;
  // Long upper wick (≥2x body), small lower wick, after uptrend — can be any color
  return uw >= 2 * b && lw <= b * 0.5 && b / r < 0.4 && prev.close > prev.open;
}
function cdBullBelt(d) {
  if (d.length < 1) return false;
  const c = d[d.length - 1];
  const b = body(c), lw = lowerWick(c), r = range(c);
  if (r === 0) return false;
  return isGreen(c) && lw / r < 0.08 && b / r > 0.6; // slightly relaxed
}
function cdBearBelt(d) {
  if (d.length < 1) return false;
  const c = d[d.length - 1];
  const b = body(c), uw = upperWick(c), r = range(c);
  if (r === 0) return false;
  return isRed(c) && uw / r < 0.08 && b / r > 0.6; // slightly relaxed
}

// TWO CANDLE
function cdBullEngulf(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], p = d[d.length - 2];
  // Green candle engulfs prior red: current open ≤ prior close AND current close ≥ prior open
  return isRed(p) && isGreen(c) && c.open <= p.close && c.close >= p.open;
}
function cdBearEngulf(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], p = d[d.length - 2];
  // Red candle engulfs prior green
  return isGreen(p) && isRed(c) && c.open >= p.close && c.close <= p.open;
}
function cdPiercing(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], p = d[d.length - 2];
  if (!isRed(p) || !isGreen(c)) return false;
  // Opens at or below prior close, closes above midpoint of prior body
  return c.open <= p.close && c.close > midpoint(p) && c.close < p.open;
}
function cdDarkCloud(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], p = d[d.length - 2];
  if (!isGreen(p) || !isRed(c)) return false;
  // Opens at or above prior close, closes below midpoint of prior body
  return c.open >= p.close && c.close < midpoint(p) && c.close > p.open;
}
function cdBullHarami(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], p = d[d.length - 2];
  return isRed(p) && isGreen(c) &&
         c.open > p.close && c.close < p.open &&
         body(c) < body(p) * 0.7; // relaxed from 0.6
}
function cdBearHarami(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], p = d[d.length - 2];
  return isGreen(p) && isRed(c) &&
         c.open < p.close && c.close > p.open &&
         body(c) < body(p) * 0.7; // relaxed from 0.6
}
function cdBullHaramiCross(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], p = d[d.length - 2];
  // Doji inside prior red candle body
  return isRed(p) && isDoji(c) &&
         Math.max(c.open, c.close) < p.open &&
         Math.min(c.open, c.close) > p.close;
}
function cdBearHaramiCross(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], p = d[d.length - 2];
  // Doji inside prior green candle body
  return isGreen(p) && isDoji(c) &&
         Math.max(c.open, c.close) < p.close &&
         Math.min(c.open, c.close) > p.open;
}
function cdBullMeetLine(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], p = d[d.length - 2];
  if (!isRed(p) || !isGreen(c)) return false;
  return Math.abs(c.close - p.close) / Math.max(c.close, p.close) < 0.003 &&
         body(p) > range(p) * 0.5 && body(c) > range(c) * 0.5;
}
function cdBearMeetLine(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], p = d[d.length - 2];
  if (!isGreen(p) || !isRed(c)) return false;
  return Math.abs(c.close - p.close) / Math.max(c.close, p.close) < 0.003 &&
         body(p) > range(p) * 0.5 && body(c) > range(c) * 0.5;
}
function cdBullKicking(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], p = d[d.length - 2];
  return isRed(p) && isGreen(c) &&
         c.open > p.open * 1.002 && // gap up
         lowerWick(p) / range(p) < 0.05 && upperWick(c) / range(c) < 0.05;
}
function cdBearKicking(d) {
  if (d.length < 2) return false;
  const c = d[d.length - 1], p = d[d.length - 2];
  return isGreen(p) && isRed(c) &&
         c.open < p.open * 0.998 && // gap down
         upperWick(p) / range(p) < 0.05 && lowerWick(c) / range(c) < 0.05;
}
function cdUpsideGap2Crows(d) {
  if (d.length < 3) return false;
  const [a, b2, c] = d.slice(-3);
  return isGreen(a) && isRed(b2) && isRed(c) &&
         b2.open > a.high && // gap
         c.open > b2.open && c.close < b2.close && c.close > a.close;
}
function cdStickSandwich(d) {
  if (d.length < 3) return false;
  const [a, b2, c] = d.slice(-3);
  return isRed(a) && isGreen(b2) && isRed(c) &&
         Math.abs(a.close - c.close) / Math.max(a.close, c.close) < 0.003;
}
function cdAdvBlock(d) {
  if (d.length < 3) return false;
  const [a, b2, c] = d.slice(-3);
  return isGreen(a) && isGreen(b2) && isGreen(c) &&
         body(b2) < body(a) * 0.9 && body(c) < body(b2) * 0.9 &&
         b2.close > a.close && c.close > b2.close &&
         upperWick(c) > body(c) * 0.5;
}
function cdDumplingTop(d) {
  if (d.length < 5) return false;
  const last5 = d.slice(-5);
  // Prices rise then fall, last candle gaps down or breaks support
  const closes = last5.map(x => x.close);
  const peak = Math.max(...closes);
  const peakIdx = closes.indexOf(peak);
  return peakIdx >= 1 && peakIdx <= 3 && closes[closes.length - 1] < closes[0];
}
function cdFrypanBot(d) {
  if (d.length < 5) return false;
  const last5 = d.slice(-5);
  const closes = last5.map(x => x.close);
  const trough = Math.min(...closes);
  const troughIdx = closes.indexOf(trough);
  // Trough in middle, last candle closes higher than first AND is green
  return troughIdx >= 1 && troughIdx <= 3 &&
         closes[closes.length - 1] > closes[0] &&
         isGreen(last5[last5.length - 1]);
}

// THREE CANDLE
function cdMorningStar(d) {
  if (d.length < 3) return false;
  const [a, b2, c] = d.slice(-3);
  // Large red, small star body (any color), large green closing above midpoint of red
  return isRed(a) && body(b2) < body(a) * 0.5 &&
         isGreen(c) && c.close > midpoint(a) &&
         body(a) > range(a) * 0.4; // prior candle should have meaningful body
}
function cdEveningStar(d) {
  if (d.length < 3) return false;
  const [a, b2, c] = d.slice(-3);
  // Large green, small star body (any color), large red closing below midpoint of green
  return isGreen(a) && body(b2) < body(a) * 0.5 &&
         isRed(c) && c.close < midpoint(a) &&
         body(a) > range(a) * 0.4;
}
function cdMorningDojiStar(d) {
  if (d.length < 3) return false;
  const [a, b2, c] = d.slice(-3);
  const r2 = range(b2);
  // Near-doji middle candle (body < 20% of range)
  const midIsSmall = r2 > 0 && body(b2) / r2 < 0.2;
  return isRed(a) && midIsSmall && isGreen(c) && c.close > midpoint(a) &&
         body(a) > range(a) * 0.4;
}
function cdEveningDojiStar(d) {
  if (d.length < 3) return false;
  const [a, b2, c] = d.slice(-3);
  const r2 = range(b2);
  // Near-doji middle candle (body < 20% of range)
  const midIsSmall = r2 > 0 && body(b2) / r2 < 0.2;
  return isGreen(a) && midIsSmall && isRed(c) && c.close < midpoint(a) &&
         body(a) > range(a) * 0.4;
}
function cdThreeWhiteSoldiers(d) {
  if (d.length < 3) return false;
  const [a, b2, c] = d.slice(-3);
  return isGreen(a) && isGreen(b2) && isGreen(c) &&
         b2.open > a.open && b2.open < a.close &&
         c.open > b2.open && c.open < b2.close &&
         c.close > b2.close && b2.close > a.close &&
         upperWick(a) < body(a) * 0.3 &&
         upperWick(b2) < body(b2) * 0.3 &&
         upperWick(c) < body(c) * 0.3;
}
function cdThreeBlackCrows(d) {
  if (d.length < 3) return false;
  const [a, b2, c] = d.slice(-3);
  return isRed(a) && isRed(b2) && isRed(c) &&
         b2.open < a.open && b2.open > a.close &&
         c.open < b2.open && c.open > b2.close &&
         c.close < b2.close && b2.close < a.close &&
         lowerWick(a) < body(a) * 0.3 &&
         lowerWick(b2) < body(b2) * 0.3 &&
         lowerWick(c) < body(c) * 0.3;
}
function cdTowerBottom(d) {
  if (d.length < 5) return false;
  const [a, b2, c, e, f] = d.slice(-5);
  return isRed(a) && body(a) > range(a) * 0.6 &&
         body(b2) < body(a) * 0.4 && body(c) < body(a) * 0.4 &&
         body(e) < body(a) * 0.4 &&
         isGreen(f) && body(f) > range(f) * 0.6 && f.close > (a.open + a.close) / 2;
}
function cdTowerTop(d) {
  if (d.length < 5) return false;
  const [a, b2, c, e, f] = d.slice(-5);
  return isGreen(a) && body(a) > range(a) * 0.6 &&
         body(b2) < body(a) * 0.4 && body(c) < body(a) * 0.4 &&
         body(e) < body(a) * 0.4 &&
         isRed(f) && body(f) > range(f) * 0.6 && f.close < (a.open + a.close) / 2;
}
function cdThreeStarsSouth(d) {
  if (d.length < 3) return false;
  const [a, b2, c] = d.slice(-3);
  return isRed(a) && isRed(b2) && isRed(c) &&
         b2.low > a.low && c.low > b2.low &&
         body(b2) < body(a) && body(c) < body(b2) &&
         lowerWick(b2) >= body(b2) * 0.3 && // relaxed from 0.5
         body(c) < body(a) * 0.5;            // relaxed from 0.3
}
function cdBearBreakaway(d) {
  if (d.length < 5) return false;
  const [a, b2, c, e, f] = d.slice(-5);
  return isGreen(a) && isGreen(b2) && b2.open > a.close && // gap
         isGreen(c) && c.close > b2.close &&
         isGreen(e) && e.close > c.close &&
         isRed(f) && f.close < c.close;
}

/* ── ALL CANDLE PATTERNS registry ── */
const CANDLE_PATTERNS = [
  // Bullish
  { id: 'hammer',          label: 'Hammer',              side: 'bull', fn: cdHammer },
  { id: 'inv_hammer',      label: 'Inverted Hammer',     side: 'bull', fn: cdInvHammer },
  { id: 'bull_engulf',     label: 'Bullish Engulfing',   side: 'bull', fn: cdBullEngulf },
  { id: 'piercing',        label: 'Piercing Line',       side: 'bull', fn: cdPiercing },
  { id: 'morning_star',    label: 'Morning Star',        side: 'bull', fn: cdMorningStar },
  { id: 'morning_doji',    label: 'Morning Doji Star',   side: 'bull', fn: cdMorningDojiStar },
  { id: 'bull_harami',     label: 'Bullish Harami',      side: 'bull', fn: cdBullHarami },
  { id: 'bull_harami_cross',label:'Bull Harami Cross',   side: 'bull', fn: cdBullHaramiCross },
  { id: 'three_white',     label: '3 White Soldiers',    side: 'bull', fn: cdThreeWhiteSoldiers },
  { id: 'bull_belt',       label: 'Bullish Belt Hold',   side: 'bull', fn: cdBullBelt },
  { id: 'bull_kick',       label: 'Bullish Kicking',     side: 'bull', fn: cdBullKicking },
  { id: 'bull_meet',       label: 'Bullish Meeting Ln',  side: 'bull', fn: cdBullMeetLine },
  { id: 'tower_bot',       label: 'Tower Bottom',        side: 'bull', fn: cdTowerBottom },
  { id: 'three_stars_s',   label: '3 Stars in South',   side: 'bull', fn: cdThreeStarsSouth },
  { id: 'frypat_bot',      label: 'Frypan Bottom',       side: 'bull', fn: cdFrypanBot },
  // Bearish
  { id: 'hanging',         label: 'Hanging Man',         side: 'bear', fn: cdHangingMan },
  { id: 'shooting',        label: 'Shooting Star',       side: 'bear', fn: cdShootingStar },
  { id: 'bear_engulf',     label: 'Bearish Engulfing',   side: 'bear', fn: cdBearEngulf },
  { id: 'dark_cloud',      label: 'Dark Cloud Cover',    side: 'bear', fn: cdDarkCloud },
  { id: 'evening_star',    label: 'Evening Star',        side: 'bear', fn: cdEveningStar },
  { id: 'evening_doji',    label: 'Evening Doji Star',   side: 'bear', fn: cdEveningDojiStar },
  { id: 'bear_harami',     label: 'Bearish Harami',      side: 'bear', fn: cdBearHarami },
  { id: 'bear_harami_cross',label:'Bear Harami Cross',   side: 'bear', fn: cdBearHaramiCross },
  { id: 'three_black',     label: '3 Black Crows',       side: 'bear', fn: cdThreeBlackCrows },
  { id: 'bear_belt',       label: 'Bearish Belt Hold',   side: 'bear', fn: cdBearBelt },
  { id: 'bear_kick',       label: 'Bearish Kicking',     side: 'bear', fn: cdBearKicking },
  { id: 'bear_meet',       label: 'Bearish Meeting Ln',  side: 'bear', fn: cdBearMeetLine },
  { id: 'tower_top',       label: 'Tower Top',           side: 'bear', fn: cdTowerTop },
  { id: 'upsidegap2',      label: 'Upside Gap 2 Crows',  side: 'bear', fn: cdUpsideGap2Crows },
  { id: 'adv_block',       label: 'Advance Block',       side: 'bear', fn: cdAdvBlock },
  { id: 'bear_brkaway',    label: 'Bearish Breakaway',   side: 'bear', fn: cdBearBreakaway },
  { id: 'dumpling_top',    label: 'Dumpling Top',        side: 'bear', fn: cdDumplingTop },
  { id: 'stick_sand',      label: 'Stick Sandwich',      side: 'bear', fn: cdStickSandwich },
];

/* Expose globally for candle-markers.js */
window.CANDLE_PATTERNS = CANDLE_PATTERNS;

/* Track which were detected last tick to only toast on NEW detections */
const candleDetectedPrev = new Set();

/* ── Run candle pattern detection on each tick ── */
function runCandlePatternDetection() {
  if (!S.chartData || S.chartData.length < 5) return;
  const data = S.chartData;

  const nowDetected = new Set();
  const detectedList = []; // { label, side }

  CANDLE_PATTERNS.forEach(pat => {
    const btn = document.getElementById('cBtn_' + pat.id);
    if (!btn) return;

    let detected = false;
    try { detected = pat.fn(data); } catch(e) {}

    if (detected) {
      nowDetected.add(pat.id);
      btn.classList.add('cdetected');
      detectedList.push({ label: pat.label, side: pat.side });

      // Show toast only when newly detected (not every tick)
      if (!candleDetectedPrev.has(pat.id)) {
        const icon = pat.side === 'bull' ? '🟢' : '🔴';
        const dir  = pat.side === 'bull' ? 'Bullish' : 'Bearish';
        if (typeof showToast === 'function') {
          showToast(`${icon} ${dir}: ${pat.label} detected!`);
        }
      }
    } else {
      btn.classList.remove('cdetected');
    }
  });

  // ── Update chart candle info overlay ──
  const infoEl = document.getElementById('chartCandleInfo');
  if (infoEl) {
    if (detectedList.length === 0) {
      infoEl.style.display = 'none';
      infoEl.innerHTML = '';
    } else {
      infoEl.style.display = 'flex';
      // Max 4 badges to avoid overflow
      const shown = detectedList.slice(0, 4);
      infoEl.innerHTML = shown.map(p => {
        const cls = p.side === 'bull' ? 'bull' : 'bear';
        const icon = p.side === 'bull' ? '▲' : '▼';
        return `<span class="cci-badge ${cls}"><span class="cci-dot"></span>${icon} ${p.label}</span>`;
      }).join('');
      if (detectedList.length > 4) {
        infoEl.innerHTML += `<span class="cci-badge" style="background:rgba(255,215,0,0.08);border:1px solid rgba(255,215,0,0.3);color:#FFD700;">+${detectedList.length - 4} more</span>`;
      }
    }
  }

  // ── Update panel header with detected count ──
  const fcpTitle = document.querySelector('.fcp-title');
  if (fcpTitle) {
    if (detectedList.length > 0) {
      const bullCount = detectedList.filter(p => p.side === 'bull').length;
      const bearCount = detectedList.filter(p => p.side === 'bear').length;
      let countHtml = ' <span style="font-size:8px;font-weight:700;opacity:0.85;">(';
      if (bullCount > 0) countHtml += `<span style="color:#00ff88">${bullCount}▲</span>`;
      if (bullCount > 0 && bearCount > 0) countHtml += ' ';
      if (bearCount > 0) countHtml += `<span style="color:#ff6680">${bearCount}▼</span>`;
      countHtml += ')</span>';
      fcpTitle.innerHTML = '🕯️ CANDLES' + countHtml;
    } else {
      fcpTitle.textContent = '🕯️ CANDLES';
    }
  }

  candleDetectedPrev.clear();
  nowDetected.forEach(id => candleDetectedPrev.add(id));
}

/* Hook into tick so candle detection runs live on every price update */
const _origTick = tick;
// Patch tick to also call candle detection after each price update
(function patchTick() {
  const _tickFn = window.tick;
  // We already call runCandlePatternDetection at end of tick via explicit call below
})();

// Also call it whenever pattern detection runs
const _origRunPD = runPatternDetection;
window.runPatternDetection = function() {
  _origRunPD();
  runCandlePatternDetection();
};

// Run once on load
setTimeout(runCandlePatternDetection, 1500);





/* ═══════════════════════════════════════════════════════════════
   HVBS AI – SMART CANDLE SIGNAL MARKERS  v7
   ▸ TREND CONTEXT validation (core fix):
       Bull reversal patterns → only after prior DOWNTREND
       Bear reversal patterns → only after prior UPTREND
       Continuation patterns → trend-aligned only
   ▸ Price-move confirmation after pattern
   ▸ One marker per candle (strongest priority wins)
   ▸ LightweightCharts setMarkers() → works on all scroll/zoom
═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   TREND DETECTION HELPERS
   lookback = how many candles back to measure the trend
   threshold = minimum % move required to qualify as a trend
   ───────────────────────────────────────────────────────────── */
const TREND_LOOKBACK  = 5;    // reduced from 7 — fewer candles needed to establish trend
const TREND_THRESHOLD = 0.005; // reduced from 0.8% → 0.5% minimum move = valid trend

/**
 * Returns true if there was a clear DOWNTREND before candle at idx.
 * Checks: (a) price was higher N candles ago than now, OR
 *         (b) local high within lookback was significantly above current close.
 */
function _hasPriorDowntrend(data, idx) {
  if (idx < TREND_LOOKBACK) return false;
  const nowClose  = data[idx].close;
  const refClose  = data[idx - TREND_LOOKBACK].close;
  // Method 1: endpoint comparison
  if (refClose > nowClose * (1 + TREND_THRESHOLD)) return true;
  // Method 2: check if local high (within lookback) is above current by threshold
  const windowSlice = data.slice(idx - TREND_LOOKBACK, idx);
  const localHigh = Math.max(...windowSlice.map(x => x.high));
  return localHigh > nowClose * (1 + TREND_THRESHOLD * 1.5);
}

/**
 * Returns true if there was a clear UPTREND before candle at idx.
 * Checks: (a) price was lower N candles ago than now, OR
 *         (b) local low within lookback was significantly below current close.
 */
function _hasPriorUptrend(data, idx) {
  if (idx < TREND_LOOKBACK) return false;
  const nowClose = data[idx].close;
  const refClose = data[idx - TREND_LOOKBACK].close;
  // Method 1: endpoint comparison
  if (nowClose > refClose * (1 + TREND_THRESHOLD)) return true;
  // Method 2: check if local low (within lookback) is below current by threshold
  const windowSlice = data.slice(idx - TREND_LOOKBACK, idx);
  const localLow = Math.min(...windowSlice.map(x => x.low));
  return nowClose > localLow * (1 + TREND_THRESHOLD * 1.5);
}

/* ─────────────────────────────────────────────────────────────
   STRONG PATTERNS — with their trend requirement
   trendReq: 'down' = bullish reversal (needs prior downtrend)
             'up'   = bearish reversal (needs prior uptrend)
             'none' = continuation (no reversal context needed)
   priority: higher number = shown over lower when same candle
   ───────────────────────────────────────────────────────────── */
const STRONG_BULL_PATTERNS = {
  /* Reversal — need prior downtrend */
  morning_doji: { label: 'Morning Doji ★', priority: 10, trendReq: 'down' },
  morning_star:  { label: 'Morning Star',   priority: 9,  trendReq: 'down' },
  bull_engulf:   { label: 'Bull Engulf',    priority: 8,  trendReq: 'down' },
  tower_bot:     { label: 'Tower Bottom',   priority: 8,  trendReq: 'down' },
  piercing:      { label: 'Piercing Line',  priority: 7,  trendReq: 'down' },
  hammer:        { label: 'Hammer',         priority: 6,  trendReq: 'down' },
  inv_hammer:    { label: 'Inv Hammer',     priority: 5,  trendReq: 'down' },
  bull_harami:   { label: 'Bull Harami',    priority: 5,  trendReq: 'down' },
  bull_harami_cross: { label: 'Harami ✚',  priority: 6,  trendReq: 'down' },
  bull_meet:     { label: 'Meeting Line',   priority: 4,  trendReq: 'down' },
  frypat_bot:    { label: 'Frypan Bot',     priority: 7,  trendReq: 'down' },
  /* Continuation — no trend reversal needed */
  three_white:   { label: '3 White Soldiers', priority: 9, trendReq: 'none' },
  bull_kick:     { label: 'Bull Kicking',   priority: 8,  trendReq: 'none' },
  bull_belt:     { label: 'Belt Hold',      priority: 4,  trendReq: 'none' },
};

const STRONG_BEAR_PATTERNS = {
  /* Reversal — need prior uptrend */
  evening_doji:  { label: 'Evening Doji ★', priority: 10, trendReq: 'up' },
  evening_star:  { label: 'Evening Star',   priority: 9,  trendReq: 'up'  },
  bear_engulf:   { label: 'Bear Engulf',    priority: 8,  trendReq: 'up'  },
  tower_top:     { label: 'Tower Top',      priority: 8,  trendReq: 'up'  },
  dark_cloud:    { label: 'Dark Cloud',     priority: 7,  trendReq: 'up'  },
  shooting:      { label: 'Shooting Star',  priority: 6,  trendReq: 'up'  },
  hanging:       { label: 'Hanging Man',    priority: 6,  trendReq: 'up'  },
  bear_harami:   { label: 'Bear Harami',    priority: 5,  trendReq: 'up'  },
  bear_harami_cross: { label: 'Harami ✚',  priority: 6,  trendReq: 'up'  },
  bear_meet:     { label: 'Meeting Line',   priority: 4,  trendReq: 'up'  },
  dumpling_top:  { label: 'Dumpling Top',   priority: 7,  trendReq: 'up'  },
  upsidegap2:    { label: 'Gap 2 Crows',    priority: 6,  trendReq: 'up'  },
  /* Continuation — no trend reversal needed */
  three_black:   { label: '3 Black Crows',  priority: 9,  trendReq: 'none' },
  bear_kick:     { label: 'Bear Kicking',   priority: 8,  trendReq: 'none' },
  bear_belt:     { label: 'Belt Hold',      priority: 4,  trendReq: 'none' },
  adv_block:     { label: 'Adv Block',      priority: 5,  trendReq: 'up'  },
};

/* ─────────────────────────────────────────────────────────────
   12% PRICE ZONE FILTER
   A marker is only shown where price actually moved 12%+
   in a ±8 candle window around the pattern candle.
   
   Exception 1: It's the LATEST candle AND priority ≥ 7
                (real-time signal — always show immediately)
   Exception 2: It's the LATEST candle AND the pattern is a
                strong single-candle signal (hammer, shooting star,
                engulfing, belt hold, kicking, etc.)
                → bypasses 12% so new strong candles always show
   ───────────────────────────────────────────────────────────── */
const ZONE_MOVE_REQUIRED = 0.12;  // 12% minimum swing in surrounding window
const ZONE_HALF_WIN      = 8;     // look ±8 candles around pattern

/* Single-candle and 2-candle patterns that are intrinsically strong
   and should always show on the newest candle regardless of zone swing */
const STRONG_SINGLE_CANDLE_IDS = new Set([
  'hammer', 'inv_hammer', 'hanging', 'shooting',
  'bull_belt', 'bear_belt', 'bull_kick', 'bear_kick',
  'bull_engulf', 'bear_engulf',
  'bull_harami_cross', 'bear_harami_cross',
  'morning_doji', 'evening_doji',
  'morning_star', 'evening_star',
  'three_white', 'three_black',
]);

/**
 * Returns the % swing (high-to-low / low) in a window of candles.
 */
function _zoneSwing(data, idx) {
  const start = Math.max(0, idx - ZONE_HALF_WIN);
  const end   = Math.min(data.length - 1, idx + ZONE_HALF_WIN);
  const slice = data.slice(start, end + 1);
  const hi    = Math.max(...slice.map(x => x.high));
  const lo    = Math.min(...slice.map(x => x.low));
  if (lo === 0) return 0;
  return (hi - lo) / lo;
}

/**
 * True if:
 *   (a) zone swing ≥ 12% (meaningful price movement in this zone), OR
 *   (b) it's the most recent candle AND priority ≥ 7 (live strong signal), OR
 *   (c) it's the most recent candle AND pattern is a strong single-candle type
 *       (these are inherently significant and bypass the 12% zone requirement)
 */
function _zoneQualifies(data, idx, priority, patId) {
  const isLatest = idx >= data.length - 3;
  // Exception 1: live candle with high priority
  if (isLatest && priority >= 7) return true;
  // Exception 2: live candle with strong single/2-candle pattern
  if (isLatest && patId && STRONG_SINGLE_CANDLE_IDS.has(patId)) return true;
  // Main rule: zone must have at least 12% price swing
  return _zoneSwing(data, idx) >= ZONE_MOVE_REQUIRED;
}

/* ─────────────────────────────────────────────────────────────
   POST-PATTERN CONFIRMATION  ← MAIN QUALITY GATE
   After pattern forms, check that price actually moved the
   right way in next few candles.
   
   Rules:
   • Latest candle (live) → always show, no confirmation needed
   • Priority ≥ 8 (strongest) → next 1 candle must move 2% right way
   • Priority 6-7 (medium) → next 2 candles must move 3% right way  
   • Priority < 6 (weak) → next 3 candles must move 4% right way
   
   Uses HIGH/LOW (not just close) so even a wick counts as confirmation.
   ───────────────────────────────────────────────────────────── */
function _priceConfirmed(data, idx, side, priority) {
  const isLatest = idx >= data.length - 1;
  if (isLatest) return true; // live candle — always show

  let lookAhead, moveReq;
  if (priority >= 8) { lookAhead = 1; moveReq = 0.02; }      // 2% in 1 candle
  else if (priority >= 6) { lookAhead = 2; moveReq = 0.03; } // 3% in 2 candles
  else { lookAhead = 3; moveReq = 0.04; }                     // 4% in 3 candles

  const ahead = data.slice(idx + 1, idx + 1 + lookAhead);
  if (ahead.length === 0) return true;
  const base = data[idx].close;

  if (side === 'bull') {
    // Price must have gone UP by moveReq% (using candle highs)
    return Math.max(...ahead.map(x => x.high)) >= base * (1 + moveReq);
  } else {
    // Price must have gone DOWN by moveReq% (using candle lows)
    return Math.min(...ahead.map(x => x.low)) <= base * (1 - moveReq);
  }
}

/* ─────────────────────────────────────────────────────────────
   CLUSTER PREVENTION
   Don't show two markers of same side within MIN_GAP candles.
   Keeps chart readable — only best signal per zone.
   ───────────────────────────────────────────────────────────── */
const MIN_CLUSTER_GAP = 8; // minimum candles between same-side markers

/* ─────────────────────────────────────────────────────────────
   TREND CONTEXT CHECK
   Returns true if the pattern's trend requirement is satisfied.
   ───────────────────────────────────────────────────────────── */
function _trendContextOk(data, idx, trendReq) {
  if (trendReq === 'down') return _hasPriorDowntrend(data, idx);
  if (trendReq === 'up')   return _hasPriorUptrend(data, idx);
  return true; // 'none' — continuation pattern, no requirement
}

/* ─────────────────────────────────────────────────────────────
   STATE
   ───────────────────────────────────────────────────────────── */
let _cmLastDataLen    = 0;
let _cmCurrentMarkers = [];

/* ─────────────────────────────────────────────────────────────
   MAIN FUNCTION: scan all candles, apply filters, set markers
   Filters applied in order:
     1. Shape match (pattern detected)
     2. Trend context (bull needs prior down, bear needs prior up)
     3. Zone swing ≥ 12% OR strong live signal / single-candle bypass
     4. Price-move confirmation after pattern
     5. Cluster prevention (min 8 candles between same-side markers)
   ───────────────────────────────────────────────────────────── */
function applyCandleMarkersToChart() {
  if (!S.series || !S.chartData || S.chartData.length < TREND_LOOKBACK + 5) return;
  if (!window.CANDLE_PATTERNS || !CANDLE_PATTERNS.length) return;

  const data     = S.chartData;
  const bestBull = new Map(); // candle-idx → { priority, marker, idx }
  const bestBear = new Map();

  for (let i = Math.max(TREND_LOOKBACK, 4); i < data.length; i++) {
    const win = data.slice(Math.max(0, i - 7), i + 1);
    const c   = data[i];

    CANDLE_PATTERNS.forEach(pat => {
      const isBull    = pat.side === 'bull';
      const strongMap = isBull ? STRONG_BULL_PATTERNS : STRONG_BEAR_PATTERNS;
      const meta      = strongMap[pat.id];
      if (!meta) return;

      /* ── 1. Shape detection ── */
      let hit = false;
      try { hit = pat.fn(win); } catch (_e) {}
      if (!hit) return;

      /* ── 2. Trend context ── */
      if (!_trendContextOk(data, i, meta.trendReq)) return;

      /* ── 3. Zone swing ≥ 12% filter (or strong live signal bypass) ── */
      if (!_zoneQualifies(data, i, meta.priority, pat.id)) return;

      /* ── 4. Price-move confirmation after pattern ── */
      if (!_priceConfirmed(data, i, pat.side, meta.priority)) return;

      /* ── 5. Best priority per candle per side ── */
      const bucket   = isBull ? bestBull : bestBear;
      const existing = bucket.get(i);
      if (existing && existing.priority >= meta.priority) return;

      bucket.set(i, {
        priority: meta.priority,
        idx: i,
        marker: {
          time:     c.time,
          position: isBull ? 'belowBar' : 'aboveBar',
          color:    isBull ? '#00e676'  : '#ff1744',
          shape:    isBull ? 'arrowUp'  : 'arrowDown',
          text:     meta.label,
          size:     meta.priority >= 9 ? 3 : 2, // bigger arrow for top-priority
        },
      });
    });
  }

  /* ── Cluster prevention: remove markers too close together (same side) ── */
  function deCluster(bucketMap) {
    // Sort by index
    const sorted = [...bucketMap.values()].sort((a, b) => a.idx - b.idx);
    const kept = [];
    for (const entry of sorted) {
      const last = kept[kept.length - 1];
      if (!last || entry.idx - last.idx >= MIN_CLUSTER_GAP) {
        kept.push(entry);
      } else if (entry.priority > last.priority) {
        // Replace last with higher-priority one in same cluster
        kept[kept.length - 1] = entry;
      }
      // else: skip this one — same zone, lower priority
    }
    return kept;
  }

  const keptBull = deCluster(bestBull);
  const keptBear = deCluster(bestBear);

  /* Merge + sort by time */
  const finalMarkers = [
    ...keptBull.map(v => v.marker),
    ...keptBear.map(v => v.marker),
  ].sort((a, b) => a.time - b.time);

  _cmCurrentMarkers = finalMarkers;
  _cmLastDataLen    = data.length;

  try {
    S.series.setMarkers(finalMarkers);
    console.log('[HVBS v8] Markers set →', finalMarkers.length,
                '| Bull:', keptBull.length, '| Bear:', keptBear.length,
                '| Zone filter: 12% swing required');
  } catch (e) {
    console.error('[HVBS v8] setMarkers error:', e);
  }
}

/* ─────────────────────────────────────────────────────────────
   UTILITIES
   ───────────────────────────────────────────────────────────── */
function clearCandleMarkers() {
  _cmCurrentMarkers = [];
  _cmLastDataLen    = 0;
  if (S.series) {
    try { S.series.setMarkers([]); } catch (_e) {}
  }
}

/* Auto-refresh when live candle arrives */
setInterval(function () {
  if (!S.chartData) return;
  if (S.chartData.length !== _cmLastDataLen) {
    applyCandleMarkersToChart();
  }
}, 2000);

/* Refresh on timeframe change */
document.addEventListener('click', function (e) {
  if (!(e.target && e.target.closest && e.target.closest('.tf-btn'))) return;
  clearCandleMarkers();
  setTimeout(applyCandleMarkersToChart, 3500);
});

/* Public API */
window.rescanCandleMarkers = function () {
  clearCandleMarkers();
  applyCandleMarkersToChart();
};

/* Boot: wait until everything ready */
(function _cmBoot() {
  if (!S.series || !S.chartData ||
      S.chartData.length < TREND_LOOKBACK + 5 ||
      !window.CANDLE_PATTERNS || !CANDLE_PATTERNS.length) {
    setTimeout(_cmBoot, 800);
    return;
  }
  applyCandleMarkersToChart();
})();


/* ── BOTTOM INDICATORS MANAGER ── */
const activeIndicators = {};

function calculateSMA(data, period, source = 'close') {
  const result = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i][source];
    if (i >= period) {
      sum -= data[i - period][source];
      result.push({ time: data[i].time, value: sum / period });
    } else if (i === period - 1) {
      result.push({ time: data[i].time, value: sum / period });
    }
  }
  return result;
}

function calculateEMA(data, period, source = 'close') {
  const result = [];
  if (data.length === 0) return result;
  const k = 2 / (period + 1);
  let ema = data[0][source];
  for (let i = 0; i < data.length; i++) {
    ema = (data[i][source] - ema) * k + ema;
    if (i >= period - 1) {
      result.push({ time: data[i].time, value: ema });
    }
  }
  return result;
}

window.toggleIndicator = function(indName, isActive) {
  if (!S.chart || !S.chartData || S.chartData.length === 0) return;
  
  if (!isActive) {
    if (activeIndicators[indName]) {
      if (Array.isArray(activeIndicators[indName])) {
        activeIndicators[indName].forEach(s => { try{S.chart.removeSeries(s);}catch(e){} });
      } else {
        try{S.chart.removeSeries(activeIndicators[indName]);}catch(e){}
      }
      delete activeIndicators[indName];
    }
    return;
  }
  
  let series;
  if (indName === 'MA') {
    series = S.chart.addLineSeries({ color: '#f5c518', lineWidth: 1.5, title: 'MA(9)' });
    series.setData(calculateSMA(S.chartData, 9));
    activeIndicators[indName] = series;
  } else if (indName === 'EMA') {
    series = S.chart.addLineSeries({ color: '#00e07a', lineWidth: 1.5, title: 'EMA(21)' });
    series.setData(calculateEMA(S.chartData, 21));
    activeIndicators[indName] = series;
  } else if (indName === 'Volume') {
    series = S.chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: '', 
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    const volData = S.chartData.map((c, i) => {
      const prev = i > 0 ? S.chartData[i-1].close : c.open;
      return {
        time: c.time,
        value: c.volume || Math.abs(c.close - c.open) * 1000000 + 100,
        color: c.close >= prev ? 'rgba(0, 224, 122, 0.5)' : 'rgba(255, 69, 96, 0.5)'
      };
    });
    series.setData(volData);
    activeIndicators[indName] = series;
  } else if (indName === 'BOLL') {
    const basis = S.chart.addLineSeries({ color: 'rgba(255, 255, 255, 0.5)', lineWidth: 1, title: 'BOLL Basis', lineStyle: 2 });
    const upper = S.chart.addLineSeries({ color: 'rgba(108, 99, 255, 0.6)', lineWidth: 1, title: 'BOLL Upper' });
    const lower = S.chart.addLineSeries({ color: 'rgba(108, 99, 255, 0.6)', lineWidth: 1, title: 'BOLL Lower' });
    
    const period = 20;
    const stdDevMultiplier = 2;
    const basisData = []; const upperData = []; const lowerData = [];
    
    for (let i = period - 1; i < S.chartData.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += S.chartData[j].close;
      const sma = sum / period;
      
      let sumSq = 0;
      for (let j = i - period + 1; j <= i; j++) sumSq += Math.pow(S.chartData[j].close - sma, 2);
      const stdDev = Math.sqrt(sumSq / period);
      
      const time = S.chartData[i].time;
      basisData.push({ time, value: sma });
      upperData.push({ time, value: sma + stdDevMultiplier * stdDev });
      lowerData.push({ time, value: sma - stdDevMultiplier * stdDev });
    }
    basis.setData(basisData); upper.setData(upperData); lower.setData(lowerData);
    activeIndicators[indName] = [basis, upper, lower];
  } else if (indName === 'MACD') {
    const macdLine = S.chart.addLineSeries({ color: '#2962FF', lineWidth: 1.5, priceScaleId: 'macd', title: 'MACD' });
    const signalLine = S.chart.addLineSeries({ color: '#FF6D00', lineWidth: 1.5, priceScaleId: 'macd', title: 'Signal' });
    const hist = S.chart.addHistogramSeries({ priceScaleId: 'macd' });
    
    S.chart.priceScale('macd').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
    });
    
    const ema12 = calculateEMA(S.chartData, 12);
    const ema26 = calculateEMA(S.chartData, 26);
    const macdData = [];
    const validLen = Math.min(ema12.length, ema26.length);
    for (let i = 0; i < validLen; i++) {
      const idx12 = ema12.length - validLen + i;
      const idx26 = ema26.length - validLen + i;
      macdData.push({ time: ema26[idx26].time, value: ema12[idx12].value - ema26[idx26].value, sourceValue: ema12[idx12].value - ema26[idx26].value });
    }
    const signalData = calculateEMA(macdData, 9, 'sourceValue');
    const histData = [];
    const minLen = Math.min(macdData.length, signalData.length);
    for (let i = 0; i < minLen; i++) {
      const mIdx = macdData.length - minLen + i;
      const sIdx = signalData.length - minLen + i;
      const diff = macdData[mIdx].value - signalData[sIdx].value;
      histData.push({
        time: signalData[sIdx].time,
        value: diff,
        color: diff >= 0 ? 'rgba(38, 166, 154, 0.8)' : 'rgba(239, 83, 80, 0.8)'
      });
    }
    
    macdLine.setData(macdData.map(d=>({time:d.time,value:d.value})));
    signalLine.setData(signalData.map(d=>({time:d.time,value:d.value})));
    hist.setData(histData);
    activeIndicators[indName] = [macdLine, signalLine, hist];
  } else if (indName === 'RSI') {
    const rsiLine = S.chart.addLineSeries({ color: '#E91E63', lineWidth: 1.5, priceScaleId: 'rsi', title: 'RSI(14)' });
    S.chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const rsiData = [];
    let gains = 0, losses = 0;
    const period = 14;
    for (let i = 1; i < S.chartData.length; i++) {
      const change = S.chartData[i].close - S.chartData[i-1].close;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;
      if (i <= period) {
        gains += gain; losses += loss;
        if (i === period) {
          const rs = (gains/period) / (losses/period === 0 ? 0.001 : losses/period);
          rsiData.push({ time: S.chartData[i].time, value: 100 - (100/(1+rs)) });
        }
      } else {
        gains = (gains * (period-1) + gain) / period;
        losses = (losses * (period-1) + loss) / period;
        const rs = gains / (losses === 0 ? 0.001 : losses);
        rsiData.push({ time: S.chartData[i].time, value: 100 - (100/(1+rs)) });
      }
    }
    rsiLine.setData(rsiData);
    activeIndicators[indName] = rsiLine;
  } else if (indName === 'Stoch') {
    const kLine = S.chart.addLineSeries({ color: '#2196F3', lineWidth: 1.5, priceScaleId: 'stoch', title: '%K(14)' });
    const dLine = S.chart.addLineSeries({ color: '#FF9800', lineWidth: 1.5, priceScaleId: 'stoch', title: '%D(3)' });
    S.chart.priceScale('stoch').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const kData = [];
    const period = 14;
    for (let i = period - 1; i < S.chartData.length; i++) {
      let hh = S.chartData[i].high, ll = S.chartData[i].low;
      for (let j = i - period + 1; j < i; j++) {
        if (S.chartData[j].high > hh) hh = S.chartData[j].high;
        if (S.chartData[j].low < ll) ll = S.chartData[j].low;
      }
      const c = S.chartData[i].close;
      const k = hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100;
      kData.push({ time: S.chartData[i].time, value: k, rawK: k });
    }
    const dData = calculateSMA(kData, 3, 'rawK');
    kLine.setData(kData.map(d=>({time:d.time,value:d.value})));
    dLine.setData(dData);
    activeIndicators[indName] = [kLine, dLine];
  } else if (indName === 'ATR') {
    const atrLine = S.chart.addLineSeries({ color: '#9C27B0', lineWidth: 1.5, priceScaleId: 'atr', title: 'ATR(14)' });
    S.chart.priceScale('atr').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const trData = [];
    for (let i = 1; i < S.chartData.length; i++) {
      const h = S.chartData[i].high, l = S.chartData[i].low, pc = S.chartData[i-1].close;
      const tr = Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc));
      trData.push({ time: S.chartData[i].time, value: tr, tr: tr });
    }
    const atrData = calculateSMA(trData, 14, 'tr');
    atrLine.setData(atrData);
    activeIndicators[indName] = atrLine;
  } else if (indName === 'OBV') {
    const obvLine = S.chart.addLineSeries({ color: '#00BCD4', lineWidth: 1.5, priceScaleId: 'obv', title: 'OBV' });
    S.chart.priceScale('obv').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const obvData = [];
    let obv = 0;
    for (let i = 1; i < S.chartData.length; i++) {
      const v = S.chartData[i].volume || 1000;
      if (S.chartData[i].close > S.chartData[i-1].close) obv += v;
      else if (S.chartData[i].close < S.chartData[i-1].close) obv -= v;
      obvData.push({ time: S.chartData[i].time, value: obv });
    }
    obvLine.setData(obvData);
    activeIndicators[indName] = obvLine;
  } else if (indName === 'VWAP') {
    const vwapLine = S.chart.addLineSeries({ color: '#FF4081', lineWidth: 1.5, title: 'VWAP' });
    const vwapData = [];
    let cumPV = 0, cumV = 0;
    for (let i = 0; i < S.chartData.length; i++) {
      const v = S.chartData[i].volume || 1000;
      const tp = (S.chartData[i].high + S.chartData[i].low + S.chartData[i].close) / 3;
      cumPV += tp * v;
      cumV += v;
      vwapData.push({ time: S.chartData[i].time, value: cumV === 0 ? tp : cumPV / cumV });
    }
    vwapLine.setData(vwapData);
    activeIndicators[indName] = vwapLine;
  } else if (indName === 'CCI') {
    const cciLine = S.chart.addLineSeries({ color: '#CDDC39', lineWidth: 1.5, priceScaleId: 'cci', title: 'CCI(20)' });
    S.chart.priceScale('cci').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const period = 20;
    const cciData = [];
    for (let i = period - 1; i < S.chartData.length; i++) {
      let sumTP = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sumTP += (S.chartData[j].high + S.chartData[j].low + S.chartData[j].close) / 3;
      }
      const smaTP = sumTP / period;
      let meanDev = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const tp = (S.chartData[j].high + S.chartData[j].low + S.chartData[j].close) / 3;
        meanDev += Math.abs(tp - smaTP);
      }
      meanDev /= period;
      const tp = (S.chartData[i].high + S.chartData[i].low + S.chartData[i].close) / 3;
      const cci = meanDev === 0 ? 0 : (tp - smaTP) / (0.015 * meanDev);
      cciData.push({ time: S.chartData[i].time, value: cci });
    }
    cciLine.setData(cciData);
    activeIndicators[indName] = cciLine;
  } else if (indName === 'Turnover') {
    const toLine = S.chart.addHistogramSeries({ color: '#FFC107', priceScaleId: 'turnover', title: 'Turnover' });
    S.chart.priceScale('turnover').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const toData = S.chartData.map(c => ({
      time: c.time,
      value: (c.volume || 1000) * c.close,
      color: 'rgba(255, 193, 7, 0.4)'
    }));
    toLine.setData(toData);
    activeIndicators[indName] = toLine;
  } else if (['MTM', 'VR', 'DMA', 'SKDJ', 'PSY', 'BBI', 'BRAR', 'Rate', 'SAR', 'AVL', 'VPVR', 'SRL'].includes(indName)) {
    let color = '#FFFFFF', mathType = 'sma', p1 = 14, sep = true;
    if (indName === 'MTM') { color = '#00E5FF'; mathType = 'diff'; }
    else if (indName === 'VR') { color = '#76FF03'; mathType = 'vol_ratio'; }
    else if (indName === 'DMA') { color = '#F50057'; mathType = 'sma'; sep = false; p1 = 10; }
    else if (indName === 'SKDJ') { color = '#D50000'; mathType = 'sma'; p1 = 5; }
    else if (indName === 'PSY') { color = '#AA00FF'; mathType = 'sma'; p1 = 12; }
    else if (indName === 'BBI') { color = '#FFD600'; mathType = 'sma'; p1 = 3; sep = false; }
    else if (indName === 'BRAR') { color = '#00B0FF'; mathType = 'sma'; p1 = 26; }
    else if (indName === 'Rate') { color = '#FF3D00'; mathType = 'roc'; }
    else if (indName === 'SAR') { color = '#1DE9B6'; mathType = 'sar'; sep = false; }
    else if (indName === 'AVL') { color = '#651FFF'; mathType = 'sma'; p1 = 8; sep = false; }
    else if (indName === 'VPVR') { color = '#3D5AFE'; mathType = 'vpvr'; sep = true; }
    else if (indName === 'SRL') { color = '#00E676'; mathType = 'sma'; p1 = 7; sep = false; }

    const sId = sep ? 'mock_'+indName : 'right';
    let series;
    if (mathType === 'vpvr' || mathType === 'vol_ratio') {
      series = S.chart.addHistogramSeries({ color, priceScaleId: sId, title: indName });
    } else {
      series = S.chart.addLineSeries({ color, lineWidth: 1.5, priceScaleId: sId, title: indName });
    }
    if (sep) S.chart.priceScale(sId).applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    
    let mData = [];
    if (mathType === 'diff') {
      for(let i=p1; i<S.chartData.length; i++) mData.push({time: S.chartData[i].time, value: S.chartData[i].close - S.chartData[i-p1].close});
    } else if (mathType === 'roc') {
      for(let i=p1; i<S.chartData.length; i++) mData.push({time: S.chartData[i].time, value: ((S.chartData[i].close - S.chartData[i-p1].close)/S.chartData[i-p1].close)*100});
    } else if (mathType === 'vpvr' || mathType === 'vol_ratio') {
      mData = S.chartData.map(c => ({time: c.time, value: (c.volume||1000) * (Math.random()*0.5 + 0.5)}));
    } else if (mathType === 'sar') {
      let sar = S.chartData[0].low;
      for(let i=0; i<S.chartData.length; i++) {
        sar += (S.chartData[i].close - sar) * 0.05;
        mData.push({time: S.chartData[i].time, value: sar});
      }
    } else {
      mData = calculateSMA(S.chartData, p1);
    }
    series.setData(mData);
    activeIndicators[indName] = series;
  }
};

/* -- CUSTOM CONTEXT MENU -- */
(function initContextMenu() {
  const ctxMenu = document.getElementById('customContextMenu');
  const chartCont = document.getElementById('chartContainer');
  if (!ctxMenu || !chartCont) return;

  chartCont.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    ctxMenu.style.display = 'block';
    let x = e.clientX;
    let y = e.clientY;
    if (x + ctxMenu.offsetWidth > window.innerWidth) x = window.innerWidth - ctxMenu.offsetWidth - 10;
    if (y + ctxMenu.offsetHeight > window.innerHeight) y = window.innerHeight - ctxMenu.offsetHeight - 10;
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('#customContextMenu')) return;
    ctxMenu.style.display = 'none';
  });

  document.getElementById('ctxResetChart')?.addEventListener('click', () => {
    ctxMenu.style.display = 'none';
    if (window.S && S.chart) {
      S.chart.timeScale().fitContent();
      S.chart.priceScale('right').applyOptions({ autoScale: true });
    }
  });

  document.getElementById('ctxCopyPrice')?.addEventListener('click', () => {
    ctxMenu.style.display = 'none';
    if (window.S && S.lastPrice) navigator.clipboard.writeText(S.lastPrice.toString());
  });

  document.getElementById('ctxClearDrawings')?.addEventListener('click', () => {
    ctxMenu.style.display = 'none';
    if (typeof window.clearAllDrawings === 'function') {
      window.clearAllDrawings();
    }
  });

  document.getElementById('ctxClearPatterns')?.addEventListener('click', () => {
    ctxMenu.style.display = 'none';
    const clearBtn = document.getElementById('clearAllPatsBtn');
    if (clearBtn) clearBtn.click();
  });
})();

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.bit-btn');
  if (!btn) return;
  
  btn.classList.toggle('active');
  const indName = btn.textContent;
  const isActive = btn.classList.contains('active');
  
  if (typeof window.toggleIndicator === 'function') {
    window.toggleIndicator(indName, isActive);
  }
  
  const toast = document.getElementById('customToast');
  const toastTxt = document.getElementById('customToastText');
  if (toast && toastTxt) {
    toastTxt.textContent = isActive ? `${indName} Indicator Enabled` : `${indName} Indicator Disabled`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }
});
