
(function() {
  'use strict';
  console.log('C@S Content: Script loaded v6.0 (Split Dashboard)');
  let pollInterval = null;
  let injected = false;
  let injectScriptReady = false;
  let currentOverlay = null;
  let alertCountdownInterval = null;
  let alertAudio = null;
  let escKeyHandler = null;
  let lastSuccessfulPoll = Date.now();
  let zenModeStyleElement = null;
  let splitLayoutActive = false;
  let woltPanelElement = null;
  let splitStyleElement = null;
  let currentWoltOrders = [];
  init();
  async function init() {
    const isSimulator = window.location.protocol === 'chrome-extension:';
    const settings = await chrome.storage.local.get(['pollIntervalSeconds', 'alertDurationSeconds', 'alertOverlay', 'woltOverlay']);
    if (!settings.alertDurationSeconds) {
      await chrome.storage.local.set({ alertDurationSeconds: 10 });
    }
    if (isSimulator) {
      console.log('C@S Content: Running in SIMULATOR mode');
      
      const urlParams = new URLSearchParams(window.location.search);
      const isSplitTest = urlParams.get('split') === 'true';
      
      console.log('Simulator - URL params:', window.location.search);
      console.log('Simulator - isSplitTest:', isSplitTest);
      
      if (isSplitTest) {
        console.log('Simulator - Running SPLIT test mode');
        await applySplitLayout(50);
        splitLayoutActive = true;
        
        setTimeout(async () => {
          const woltSoundDataUrl = await MediaDB.getMediaAsDataURL('woltSoundData');
          const woltVideoDataUrl = await MediaDB.getMediaAsDataURL('woltVideoData');
          const woltImageDataUrl = await MediaDB.getMediaAsDataURL('woltImageData');
          
          showAlertOverlay({
            count: 3,
            orderType: 'wolt',
            soundData: woltSoundDataUrl,
            videoData: woltVideoDataUrl,
            imageData: woltImageDataUrl,
            oldestOrderTimestamp: Date.now() - (5 * 60 * 1000),
            isSimulator: true,
            alertOverlay: settings.alertOverlay,
            woltOverlay: settings.woltOverlay
          });
        }, 500);
        
        setTimeout(async () => {
          const soundDataUrl = await MediaDB.getMediaAsDataURL('soundData');
          const videoDataUrl = await MediaDB.getMediaAsDataURL('videoData');
          const imageDataUrl = await MediaDB.getMediaAsDataURL('imageData');
          
          showAlertOverlay({
            count: 5,
            soundData: soundDataUrl,
            videoData: videoDataUrl,
            imageData: imageDataUrl,
            oldestOrderTimestamp: Date.now() - (8 * 60 * 1000),
            isSimulator: true,
            alertOverlay: settings.alertOverlay,
            woltOverlay: settings.woltOverlay
          });
        }, 3000);
      } else {
        console.log('Simulator - Running NORMAL test mode');
        let soundDataUrl = null;
        let videoDataUrl = null;
        let imageDataUrl = null;
        if (typeof MediaDB !== 'undefined') {
          try {
            soundDataUrl = await MediaDB.getMediaAsDataURL('soundData');
            videoDataUrl = await MediaDB.getMediaAsDataURL('videoData');
            imageDataUrl = await MediaDB.getMediaAsDataURL('imageData');
          } catch (e) {
            console.warn('C@S Content: Failed to fetch media from IndexedDB', e);
          }
        }
        if (imageDataUrl && !videoDataUrl) {
          videoDataUrl = null;
        }
        setTimeout(() => {
          showAlertOverlay({
            count: 5,
            soundData: soundDataUrl,
            videoData: videoDataUrl,
            imageData: imageDataUrl,
            oldestOrderTimestamp: Date.now() - (8 * 60 * 1000),
            isSimulator: true,
            alertOverlay: settings.alertOverlay,
            woltOverlay: settings.woltOverlay
          });
        }, 500);
      }
      chrome.storage.onChanged.addListener(handleStorageChange);
      window.addEventListener('beforeunload', cleanup);
      return;
    }
    injectPageScript();
    startPolling(settings.pollIntervalSeconds || 30);
    const modeSettings = await chrome.storage.local.get(['zenModeEnabled', 'splitModeEnabled', 'splitRatio']);
    if (modeSettings.zenModeEnabled) {
      applyZenMode(true);
    }
    if (modeSettings.splitModeEnabled) {
      applySplitLayout(modeSettings.splitRatio || 50);
    }
    chrome.storage.onChanged.addListener(handleStorageChange);
    window.addEventListener('beforeunload', cleanup);
  }
  function handleStorageChange(changes, area) {
    if (area === 'local') {
      if (changes.pollIntervalSeconds) {
        startPolling(changes.pollIntervalSeconds.newValue);
      }
      if (changes.zenModeEnabled) {
        applyZenMode(changes.zenModeEnabled.newValue);
      }
      if (changes.splitModeEnabled) {
        if (changes.splitModeEnabled.newValue) {
          chrome.storage.local.get(['splitRatio']).then(s => applySplitLayout(s.splitRatio || 50));
        } else {
          removeSplitLayout();
        }
      }
      if (changes.splitRatio && splitLayoutActive) {
        updateSplitRatio(changes.splitRatio.newValue);
      }
    }
  }
  function cleanup() {
    if (pollInterval) clearInterval(pollInterval);
    closeAlertOverlay();
    removeSplitLayout();
  }
  function startPolling(seconds) {
    const intervalSec = Math.max(1, Math.min(60, parseInt(seconds, 10) || 30));
    if (pollInterval) clearInterval(pollInterval);
    triggerPageRefresh();
    pollInterval = setInterval(() => {
      triggerPageRefresh();
    }, intervalSec * 1000);
  }
  let currentOrderCount = 0;
  let currentOldestTimestamp = null;
  let currentWoltCount = 0;
  let currentWoltOldestTimestamp = null;
  function injectPageScript() {
    if (injected) return;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function() { 
      injected = true; 
      this.remove(); 
    };
    (document.head || document.documentElement).appendChild(script);
  }
  async function sendConfigToInject() {
    if (!injectScriptReady) {
      console.log('C@S Content: Inject script not ready yet, skipping config send');
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
      if (response?.success && response.config) {
        window.postMessage({
          type: 'COLLECT_STORE_CONFIG_UPDATE',
          config: {
            completedStatuses: response.config.completedStatuses,
            collectKeywords: response.config.collectKeywords,
            collectCodes: response.config.collectCodes,
            shippingKeywords: response.config.shippingKeywords
          }
        }, '*');
        console.log('C@S Content: Config sent to inject script');
      }
    } catch (error) {
      console.warn('C@S Content: Could not send config to inject:', error);
    }
  }
  function triggerPageRefresh() {
    window.postMessage({ type: 'COLLECT_STORE_TRIGGER_REFRESH' }, '*');
  }
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'COLLECT_STORE_DATA') {
      lastSuccessfulPoll = Date.now();
      if (event.data.data) {
        currentOrderCount = event.data.data.collectCount || 0;
        currentOldestTimestamp = event.data.data.oldestOrderTimestamp || null;
        currentWoltCount = event.data.data.woltCount || 0;
        currentWoltOldestTimestamp = event.data.data.woltOldestTimestamp || null;
        if (splitLayoutActive && event.data.data.woltOrders) {
          currentWoltOrders = event.data.data.woltOrders;
          updateWoltPanel(currentWoltOrders);
        }
      }
      chrome.runtime.sendMessage({ action: 'updateOrders', data: event.data.data });
    }
    if (event.source === window && event.data?.type === 'COLLECT_STORE_READY') {
      console.log('C@S Content: Received READY signal from inject.js');
      injectScriptReady = true;
      sendConfigToInject();
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'triggerCheck') {
      triggerPageRefresh();
      sendResponse({ success: true });
    } else if (message.action === 'showAlert') {
      showAlertOverlay(message.data);
      sendResponse({ success: true });
    } else if (message.action === 'updateModes') {
      if (message.data) {
        applyZenMode(message.data.zenModeEnabled);
        if (message.data.splitModeEnabled) {
          applySplitLayout(message.data.splitRatio || 50);
        } else {
          removeSplitLayout();
        }
      }
      sendResponse({ success: true });
    } else if (message.action === 'previewSplit') {
      if (splitLayoutActive && message.data?.splitRatio) {
        updateSplitRatio(message.data.splitRatio);
      }
      sendResponse({ success: true });
    } else if (message.action === 'applySplit') {
      if (message.data) {
        applyZenMode(message.data.zenModeEnabled);
        if (message.data.splitModeEnabled) {
          applySplitLayout(message.data.splitRatio || 50);
        } else {
          removeSplitLayout();
        }
      }
      sendResponse({ success: true });
    }
    return true;
  });
  function applyZenMode(enabled) {
    if (enabled) {
      if (zenModeStyleElement) return;
      zenModeStyleElement = document.createElement('style');
      zenModeStyleElement.id = 'cs-zen-mode-styles';
      zenModeStyleElement.textContent = `
        .sapUshellShellHead,
        #shell-header,
        .sapUshellShellBG,
        #__jsview1--pov_QuickFilters,
        #__jsview1--navC,
        #__jsview1--oBarH,
        .sapUshellShellHeadItm,
        .sapUshellShellHeadSearchContainer,
        [id*="--pov_QuickFilters"],
        [id*="--navC"],
        [id*="--oBarH"] {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
          min-height: 0 !important;
          overflow: hidden !important;
        }
        #__jsview1--pageOrderView-cont,
        [id*="--pageOrderView-cont"] {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          height: 100vh !important;
          width: var(--cs-sap-width, 100vw) !important;
          z-index: 9999 !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .sapMList,
        .sapMListUl,
        [id*="--listItems-listUl"] {
          max-height: none !important;
          height: auto !important;
        }
        .sapUshellApplicationContainer,
        .sapMShellContent {
          padding: 0 !important;
          margin: 0 !important;
        }
      `;
      document.head.appendChild(zenModeStyleElement);
      console.log('C@S Content: Zen Mode enabled');
    } else {
      if (zenModeStyleElement) {
        zenModeStyleElement.remove();
        zenModeStyleElement = null;
        console.log('C@S Content: Zen Mode disabled');
      }
    }
  }
  function applySplitLayout(ratio) {
    if (splitLayoutActive) {
      updateSplitRatio(ratio);
      return;
    }
    console.log('C@S Content: Applying Split Layout with ratio:', ratio);
    splitStyleElement = document.createElement('style');
    splitStyleElement.id = 'cs-split-layout-styles';
    splitStyleElement.textContent = `
      :root {
        --cs-split-ratio: ${ratio};
        --cs-sap-width: ${ratio}%;
        --cs-wolt-width: ${100 - ratio}%;
      }
      #cs-split-wrapper {
        position: fixed !important;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex !important;
        flex-direction: row;
        z-index: 10000;
        background: #1a1a2e;
      }
      #cs-sap-panel {
        width: var(--cs-sap-width);
        height: 100%;
        overflow: auto;
        position: relative;
        background: #fff;
        box-shadow: inset -40px 0 40px -20px rgba(0, 0, 0, 0.15);
      }
      #cs-wolt-panel {
        width: var(--cs-wolt-width);
        height: 100%;
        overflow-y: auto;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        padding: 16px;
        box-sizing: border-box;
      }
      .cs-wolt-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: rgba(0, 188, 212, 0.15);
        border-radius: 12px;
        margin-bottom: 16px;
        border: 1px solid rgba(0, 188, 212, 0.3);
      }
      .cs-wolt-header-icon {
        font-size: 28px;
      }
      .cs-wolt-header-title {
        font-size: 1.4rem;
        font-weight: 700;
        color: #00bcd4;
        margin: 0;
      }
      .cs-wolt-header-count {
        margin-left: auto;
        background: #00bcd4;
        color: #1a1a2e;
        font-weight: 700;
        font-size: 1.2rem;
        padding: 6px 14px;
        border-radius: 20px;
      }
      .cs-wolt-card {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        padding: 14px 16px;
        margin-bottom: 12px;
        border-left: 4px solid #00bcd4;
        transition: all 0.2s ease;
      }
      .cs-wolt-card:hover {
        background: rgba(255, 255, 255, 0.1);
        transform: translateX(4px);
      }
      .cs-wolt-card-urgent {
        border-left-color: #e74c3c;
        animation: urgent-pulse 2s infinite;
      }
      @keyframes urgent-pulse {
        0%, 100% { background: rgba(231, 76, 60, 0.1); }
        50% { background: rgba(231, 76, 60, 0.2); }
      }
      .cs-wolt-card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .cs-wolt-card-order-id {
        font-weight: 600;
        color: #fff;
        font-size: 1rem;
      }
      .cs-wolt-card-time {
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.7);
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .cs-wolt-card-time-urgent {
        color: #e74c3c;
        font-weight: 600;
      }
      .cs-wolt-card-info {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        font-size: 0.9rem;
        color: rgba(255, 255, 255, 0.8);
      }
      .cs-wolt-card-tag {
        background: rgba(0, 188, 212, 0.2);
        color: #00bcd4;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 0.8rem;
        font-weight: 500;
      }
      .cs-wolt-empty {
        text-align: center;
        padding: 40px 20px;
        color: rgba(255, 255, 255, 0.5);
      }
      .cs-wolt-empty-icon {
        font-size: 48px;
        margin-bottom: 12px;
        opacity: 0.3;
      }
      .cs-wolt-empty-text {
        font-size: 1.1rem;
      }
      body.cs-split-active {
        overflow: hidden !important;
      }
      body.cs-split-active .sapUshellApplicationContainer,
      body.cs-split-active #__jsview1--pageOrderView-cont,
      body.cs-split-active [id*="--pageOrderView-cont"] {
        position: relative !important;
        width: 100% !important;
        height: 100% !important;
        top: auto !important;
        left: auto !important;
        right: auto !important;
        bottom: auto !important;
      }
    `;
    document.head.appendChild(splitStyleElement);
    const wrapper = document.createElement('div');
    wrapper.id = 'cs-split-wrapper';
    const sapPanel = document.createElement('div');
    sapPanel.id = 'cs-sap-panel';
    woltPanelElement = document.createElement('div');
    woltPanelElement.id = 'cs-wolt-panel';
    woltPanelElement.innerHTML = createWoltPanelHTML([]);
    wrapper.appendChild(sapPanel);
    wrapper.appendChild(woltPanelElement);
    const sapContainer = document.querySelector('.sapUshellApplicationContainer') || 
                         document.querySelector('#__jsview1--pageOrderView-cont') ||
                         document.querySelector('[id*="--pageOrderView-cont"]');
    if (sapContainer) {
      const originalParent = sapContainer.parentNode;
      document.body.appendChild(wrapper);
      sapPanel.appendChild(sapContainer);
    } else {
      document.body.appendChild(wrapper);
    }
    document.body.classList.add('cs-split-active');
    splitLayoutActive = true;
    console.log('C@S Content: Split Layout activated');
  }
  function updateSplitRatio(ratio) {
    if (!splitStyleElement) return;
    document.documentElement.style.setProperty('--cs-split-ratio', ratio);
    document.documentElement.style.setProperty('--cs-sap-width', `${ratio}%`);
    document.documentElement.style.setProperty('--cs-wolt-width', `${100 - ratio}%`);
    console.log('C@S Content: Split ratio updated to:', ratio);
  }
  function removeSplitLayout() {
    if (!splitLayoutActive) return;
    console.log('C@S Content: Removing Split Layout');
    const sapPanel = document.getElementById('cs-sap-panel');
    const wrapper = document.getElementById('cs-split-wrapper');
    if (sapPanel && sapPanel.firstChild) {
      document.body.insertBefore(sapPanel.firstChild, wrapper);
    }
    if (wrapper) wrapper.remove();
    if (splitStyleElement) {
      splitStyleElement.remove();
      splitStyleElement = null;
    }
    document.body.classList.remove('cs-split-active');
    woltPanelElement = null;
    splitLayoutActive = false;
    console.log('C@S Content: Split Layout removed');
  }
  function createWoltPanelHTML(orders) {
    const count = orders?.length || 0;
    let cardsHTML = '';
    if (count === 0) {
      cardsHTML = '';
    } else {
      cardsHTML = orders.map(order => {
        const now = Date.now();
        const orderTime = order.timestamp || now;
        const minutesPending = Math.floor((now - orderTime) / 60000);
        const isUrgent = minutesPending >= 10;
        const timeDisplay = minutesPending < 1 ? 'Juuri saapunut' : `${minutesPending} min sitten`;
        return `
          <div class="cs-wolt-card ${isUrgent ? 'cs-wolt-card-urgent' : ''}">
            <div class="cs-wolt-card-header">
              <span class="cs-wolt-card-order-id">${order.orderId || 'Tilaus'}</span>
              <span class="cs-wolt-card-time ${isUrgent ? 'cs-wolt-card-time-urgent' : ''}">
                ⏱ ${timeDisplay}
              </span>
            </div>
            <div class="cs-wolt-card-info">
              ${order.shippingType ? `<span class="cs-wolt-card-tag">${order.shippingType}</span>` : ''}
              ${order.customerName ? `<span>${order.customerName}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }
    return `
      <div class="cs-wolt-cards">
        ${cardsHTML}
      </div>
    `;
  }
  function updateWoltPanel(orders) {
    if (!woltPanelElement) return;
    woltPanelElement.innerHTML = createWoltPanelHTML(orders);
  }
  function createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.classes) options.classes.forEach(c => el.classList.add(c));
    if (options.text) el.textContent = options.text;
    if (options.id) el.id = options.id;
    if (options.styles) Object.assign(el.style, options.styles);
    if (options.attrs) Object.entries(options.attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }
  function closeAlertOverlay() {
    if (alertCountdownInterval) clearInterval(alertCountdownInterval);
    if (alertAudio) { 
      alertAudio.pause(); 
      alertAudio.currentTime = 0; 
      alertAudio = null; 
    }
    if (escKeyHandler) document.removeEventListener('keydown', escKeyHandler);
    if (currentOverlay) { 
      currentOverlay.style.opacity = '0';
      setTimeout(() => {
        if (currentOverlay) { currentOverlay.remove(); currentOverlay = null; }
      }, 300);
    }
  }
  
  async function showSplitPanelAlert(data) {
    const isWoltOrder = data.orderType === 'wolt';
    const targetPanel = isWoltOrder ? document.getElementById('cs-wolt-panel') : document.getElementById('cs-sap-panel');
    
    if (!targetPanel) {
      console.warn('Split panel not found, falling back to overlay');
      closeAlertOverlay();
      return showAlertOverlay(data);
    }
    
    if (data.soundData && data.soundData.startsWith('data:audio/')) {
      alertAudio = new Audio(data.soundData);
      alertAudio.play().catch(e => console.warn('Audio blocked', e));
    }
    
    const settings = await chrome.storage.local.get(['alertDurationSeconds']);
    let seconds = parseInt(settings.alertDurationSeconds, 10) || 10;
    const customization = (isWoltOrder && data.woltOverlay) ? data.woltOverlay : data.alertOverlay;
    
    const existingAlert = targetPanel.querySelector('.cs-split-alert');
    if (existingAlert) existingAlert.remove();
    
    const alert = createElement('div', { classes: ['cs-split-alert'] });
    if (isWoltOrder) alert.classList.add('wolt-alert');
    
    const counterCard = createElement('div', { classes: ['cs-split-counter'] });
    counterCard.appendChild(createElement('span', { classes: ['cs-split-count'], text: String(data.count || 1) }));
    alert.appendChild(counterCard);
    
    const title = createElement('div', { classes: ['cs-split-title'], text: isWoltOrder ? 'Wolt-tilausta' : 'Collectia' });
    alert.appendChild(title);
    
    targetPanel.appendChild(alert);
    requestAnimationFrame(() => { alert.style.opacity = '1'; });
    
    setTimeout(() => {
      alert.style.opacity = '0';
      setTimeout(() => alert.remove(), 300);
    }, seconds * 1000);
  }
  async function showAlertOverlay(data) {
    console.log('showAlertOverlay called with data:', data);
    
    const splitSettings = await chrome.storage.local.get(['splitModeEnabled']);
    const isSplitModeActive = splitSettings.splitModeEnabled && splitLayoutActive;
    
    if (isSplitModeActive) {
      showSplitPanelAlert(data);
      return;
    }
    
    closeAlertOverlay();
    
    if (data.soundData && data.soundData.startsWith('data:audio/')) {
      alertAudio = new Audio(data.soundData);
      alertAudio.play().catch(e => console.warn('Audio blocked', e));
    }
    const settings = await chrome.storage.local.get(['alertDurationSeconds', 'alertOverlay']);
    let seconds = parseInt(settings.alertDurationSeconds, 10) || 10;
    const isWoltOrder = data.orderType === 'wolt';
    console.log('isWoltOrder:', isWoltOrder, 'data.woltOverlay:', data.woltOverlay);
    
    const customization = (isWoltOrder && data.woltOverlay) ? data.woltOverlay : (data.alertOverlay || {
      position: 'bottom-center',
      mainTitle: 'Uusia collecteja!',
      subTitle: 'Nyt keräämään!!',
      brandTag: 'C@S',
      counterLabel: 'Odottaa keräystä',
      fontSize: 'large'
    });
    
    console.log('Using customization:', customization);
    
    const overlay = createElement('div', { id: 'cs-modern-overlay' });
    currentOverlay = overlay;
    if (isWoltOrder) {
      overlay.classList.add('wolt-alert');
      console.log('Added wolt-alert class');
    }
    const bgLayer = createElement('div', { classes: ['cs-bg-layer'] });
    let hasMedia = false;
    if (data.videoData && data.videoData.startsWith('data:video/')) {
      const vid = createElement('video', { 
        classes: ['cs-media'], 
        attrs: { autoplay: '', loop: '', playsinline: '', muted: '' } 
      });
      vid.src = data.videoData;
      bgLayer.appendChild(vid);
      hasMedia = true;
    } else if (data.imageData && data.imageData.startsWith('data:image/')) {
      const img = createElement('img', { classes: ['cs-media'] });
      img.src = data.imageData;
      bgLayer.appendChild(img);
      hasMedia = true;
    }
    if (!hasMedia) {
      bgLayer.style.background = 'radial-gradient(circle at center, #2C3E50 0%, #000000 100%)';
      const icon = createElement('div', { text: '📦', styles: { 
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        fontSize: '150px', opacity: '0.2'
      }});
      bgLayer.appendChild(icon);
    }
    overlay.appendChild(bgLayer);
    overlay.appendChild(createElement('div', { classes: ['cs-gradient-overlay'] }));
    const positionClass = `pos-${customization.position || 'bottom-center'}`;
    const hud = createElement('div', { classes: ['cs-hud-container', positionClass] });
    const sizeClass = `size-${customization.fontSize || 'large'}`;
    const textGroup = createElement('div', { classes: ['cs-text-group', sizeClass] });
    if (customization.brandTag) {
      textGroup.appendChild(createElement('div', { classes: ['cs-brand-tag'], text: customization.brandTag }));
    }
    if (customization.mainTitle) {
      textGroup.appendChild(createElement('div', { classes: ['cs-main-title'], text: customization.mainTitle }));
    }
    if (customization.subTitle) {
      textGroup.appendChild(createElement('div', { classes: ['cs-sub-title'], text: customization.subTitle }));
    }
    if (textGroup.children.length > 0) {
      hud.appendChild(textGroup);
    }
    const counterCard = createElement('div', { classes: ['cs-counter-card', sizeClass] });
    counterCard.appendChild(createElement('span', { classes: ['cs-count-num'], text: String(data.count || 1) }));
    if (customization.counterLabel) {
      counterCard.appendChild(createElement('span', { classes: ['cs-count-label'], text: customization.counterLabel }));
    }
    hud.appendChild(counterCard);
    overlay.appendChild(hud);
    const closeBtn = createElement('button', { classes: ['cs-close-fab'], text: '×' });
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeAlertOverlay();
    });
    overlay.appendChild(closeBtn);
    const track = createElement('div', { classes: ['cs-progress-track'] });
    const bar = createElement('div', { classes: ['cs-progress-bar'] });
    track.appendChild(bar);
    overlay.appendChild(track);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
    const totalSeconds = seconds;
    let remaining = seconds;
    alertCountdownInterval = setInterval(() => {
      remaining--;
      const pct = (remaining / totalSeconds) * 100;
      bar.style.width = `${pct}%`;
      if (remaining <= 0) {
        clearInterval(alertCountdownInterval);
        alertCountdownInterval = null;
        if (data.isSimulator) {
          showSimulatorPostAlert();
        } else {
          closeAlertOverlay();
        }
      }
    }, 1000);
    escKeyHandler = (e) => { if (e.key === 'Escape') closeAlertOverlay(); };
    document.addEventListener('keydown', escKeyHandler);
  }
  function showSimulatorPostAlert() {
    if (!currentOverlay) return;
    if (alertCountdownInterval) {
      clearInterval(alertCountdownInterval);
      alertCountdownInterval = null;
    }
    const progressTrack = currentOverlay.querySelector('.cs-progress-track');
    if (progressTrack) progressTrack.style.opacity = '0';
    const hud = currentOverlay.querySelector('.cs-hud-container');
    if (hud) {
      hud.innerHTML = '';
      hud.className = 'cs-hud-container pos-center';
      const completeMsg = createElement('div', {
        classes: ['cs-text-group', 'size-large'],
        styles: { textAlign: 'center' }
      });
      const replayBtn = createElement('button', {
        text: '↻ Toista uudelleen',
        classes: ['cs-close-fab'],
        styles: {
          position: 'relative',
          top: 'auto',
          right: 'auto',
          width: 'auto',
          height: 'auto',
          padding: '12px 24px',
          borderRadius: '8px',
          fontSize: '16px',
          marginTop: '20px',
          cursor: 'pointer'
        }
      });
      replayBtn.onclick = () => {
        closeAlertOverlay();
        setTimeout(() => location.reload(), 300);
      };
      hud.appendChild(completeMsg);
      hud.appendChild(replayBtn);
    }
  }
})();
