
(function() {
  'use strict';
  
  // Detect if running inside an iframe
  const isInIframe = window.self !== window.top;
  
  console.log('C@S Content: Script loaded v6.3 (Split View Fixed)', isInIframe ? '[IFRAME]' : '[MAIN]');
  
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
  let splitDividerElement = null;
  let splitStyleElement = null;
  let currentWoltOrders = [];
  
  // Track data from iframes (in split mode, main page is hidden so only iframes report data)
  // We only use ONE iframe for data (left iframe) to avoid flickering
  let iframeData = { collectCount: 0, woltCount: 0, collectOldestTimestamp: null, woltOldestTimestamp: null, woltOrders: [] };
  
  // Store drag event handlers for cleanup
  let dragHandlers = null;
  
  // Wait for SAP UI elements to be ready before applying layout changes
  function waitForSapUI(callback, maxAttempts = 50) {
    let attempts = 0;
    const checkInterval = setInterval(() => {
      attempts++;
      const sapContainer = document.querySelector('.sapUshellApplicationContainer') || 
                           document.querySelector('#__jsview1--pageOrderView-cont') ||
                           document.querySelector('[id*="--pageOrderView-cont"]') ||
                           document.querySelector('.sapMShellContent');
      
      if (sapContainer) {
        clearInterval(checkInterval);
        callback();
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        // SAP UI not loaded yet - this is normal, just skip silently
      }
    }, 200);
  }
  
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
    
    // Only apply modes if they are explicitly enabled
    if (modeSettings.zenModeEnabled === true) {
      waitForSapUI(() => applyZenMode(true));
    }
    
    if (modeSettings.splitModeEnabled === true) {
      waitForSapUI(() => applySplitLayout(modeSettings.splitRatio || 50));
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
        if (changes.zenModeEnabled.newValue) {
          waitForSapUI(() => applyZenMode(true));
        } else {
          applyZenMode(false);
        }
      }
      if (changes.splitModeEnabled) {
        if (changes.splitModeEnabled.newValue) {
          chrome.storage.local.get(['splitRatio']).then(s => {
            waitForSapUI(() => applySplitLayout(s.splitRatio || 50));
          }).catch(error => {
            console.warn('C@S Content: Could not get split ratio:', error.message);
          });
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
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('inject.js');
      script.onload = function() { 
        injected = true; 
        this.remove(); 
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (error) {
      console.warn('C@S Content: Could not inject script (extension context invalidated):', error.message);
    }
  }
  async function sendConfigToInject() {
    if (!injectScriptReady) {
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
      }
    } catch (error) {
      console.warn('C@S Content: Could not send config:', error);
    }
  }
  function triggerPageRefresh() {
    if (!injectScriptReady) {
      injectPageScript();
      // Retry after a short delay
      setTimeout(() => {
        window.postMessage({ type: 'COLLECT_STORE_TRIGGER_REFRESH' }, '*');
      }, 500);
      return;
    }
    
    window.postMessage({ type: 'COLLECT_STORE_TRIGGER_REFRESH' }, '*');
  }
  // Check if this iframe is the display-only one (should not send data)
  const urlParams = new URLSearchParams(window.location.search);
  const splitRole = urlParams.get('cs-split-role');
  const isDisplayOnlyIframe = isInIframe && splitRole === 'display';
  
  window.addEventListener('message', (event) => {
    // Handle data from inject.js (same window) - this runs in IFRAMES
    if (event.source === window && event.data?.type === 'COLLECT_STORE_DATA') {
      lastSuccessfulPoll = Date.now();
      const incomingData = event.data.data || {};
      
      // Update local state
      currentOrderCount = incomingData.collectCount || 0;
      currentOldestTimestamp = incomingData.oldestOrderTimestamp || null;
      currentWoltCount = incomingData.woltCount || 0;
      currentWoltOldestTimestamp = incomingData.woltOldestTimestamp || null;
      currentWoltOrders = incomingData.woltOrders || [];
      
      // If we're in the display-only iframe, don't send data (avoid duplicates)
      if (isDisplayOnlyIframe) {
        return;
      }
      
      // If we're in an iframe (primary role), send data to parent window
      if (isInIframe) {
        try {
          window.parent.postMessage({ 
            type: 'COLLECT_STORE_IFRAME_DATA', 
            data: incomingData
          }, '*');
        } catch (e) {
          console.warn('C@S Content: Could not send to parent frame:', e);
        }
      } else {
        // Not in iframe (normal mode without split) - send directly to background
        chrome.runtime.sendMessage({ action: 'updateOrders', data: incomingData }).catch(error => {
          console.warn('C@S Content: Extension context invalidated, ignoring:', error.message);
        });
      }
    }
    
    // Handle data from iframes (this runs in MAIN window when split mode is active)
    if (!isInIframe && event.data?.type === 'COLLECT_STORE_IFRAME_DATA') {
      lastSuccessfulPoll = Date.now();
      const incomingData = event.data.data || {};
      
      // Store iframe data
      iframeData = {
        collectCount: incomingData.collectCount || 0,
        woltCount: incomingData.woltCount || 0,
        collectOldestTimestamp: incomingData.oldestOrderTimestamp || null,
        woltOldestTimestamp: incomingData.woltOldestTimestamp || null,
        woltOrders: incomingData.woltOrders || []
      };
      
      // Update local state from iframe
      currentOrderCount = iframeData.collectCount;
      currentOldestTimestamp = iframeData.collectOldestTimestamp;
      currentWoltCount = iframeData.woltCount;
      currentWoltOldestTimestamp = iframeData.woltOldestTimestamp;
      currentWoltOrders = iframeData.woltOrders;
      
      // Send to background
      const dataToSend = {
        collectCount: iframeData.collectCount,
        woltCount: iframeData.woltCount,
        oldestOrderTimestamp: iframeData.collectOldestTimestamp,
        woltOldestTimestamp: iframeData.woltOldestTimestamp,
        woltOrders: iframeData.woltOrders,
        storeName: '',
        pendingOrders: []
      };
      
      chrome.runtime.sendMessage({ action: 'updateOrders', data: dataToSend }).catch(error => {
        console.warn('C@S Content: Extension context invalidated, ignoring:', error.message);
      });
    }
    
    if (event.source === window && event.data?.type === 'COLLECT_STORE_READY') {
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
        // Handle zen mode
        if (message.data.zenModeEnabled) {
          applyZenMode(true);
        } else {
          applyZenMode(false);
        }
        
        // Handle split mode
        if (message.data.splitModeEnabled) {
          if (splitLayoutActive) {
            updateSplitRatio(message.data.splitRatio || 50);
          } else {
            applySplitLayout(message.data.splitRatio || 50);
          }
        } else {
          removeSplitLayout();
        }
      }
      sendResponse({ success: true });
    } else if (message.action === 'previewSplit') {
      if (message.data?.splitRatio) {
        if (splitLayoutActive) {
          updateSplitRatio(message.data.splitRatio);
        }
      }
      sendResponse({ success: true });
    } else if (message.action === 'applySplit') {
      if (message.data) {
        // Handle zen mode
        if (message.data.zenModeEnabled) {
          applyZenMode(true);
        } else {
          applyZenMode(false);
        }
        
        // Handle split mode
        if (message.data.splitModeEnabled) {
          if (splitLayoutActive) {
            // Already active, just update ratio
            updateSplitRatio(message.data.splitRatio || 50);
          } else {
            // Activate split layout
            applySplitLayout(message.data.splitRatio || 50);
          }
        } else {
          // Disable split mode
          removeSplitLayout();
        }
      }
      sendResponse({ success: true });
    }
    return true;
  });
  function applyZenMode(enabled) {
    console.log('C@S Content: applyZenMode called with enabled =', enabled);
    
    if (enabled) {
      if (zenModeStyleElement) {
        return;
      }
      
      // Aggressive CSS - hide ALL SAP navigation and maximize content area
      zenModeStyleElement = document.createElement('style');
      zenModeStyleElement.id = 'cs-zen-mode-styles';
      zenModeStyleElement.textContent = `
        /* Hide ALL top navigation and headers */
        div#toolTopMenu,
        div#screenMenu,
        div#topCenterMenu,
        #shell-header,
        .sapUshellShellHead,
        #shell-hdr,
        .sapMPageHeader,
        .sapMBar-CTX:not(.sapMPageFooter .sapMBar-CTX),
        .sapUshellShellHeadItm,
        .sapUshellShellHeadSearchContainer {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
          overflow: hidden !important;
        }
        
        /* Hide side navigation/menu */
        #shell-split-view,
        #shell-str-view,
        .sapUshellShellCntnt > div:first-child {
          display: none !important;
        }
        
        /* Force main content to fill entire viewport */
        section[id*="pageOrderView-cont"],
        section[id*="PageMain-cont"],
        .sapMPage:not(.sapMMessagePage) {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          margin: 0 !important;
          padding: 0 !important;
          z-index: 100 !important;
        }
        
        /* Ensure page shell doesn't add margins */
        #pageShell,
        div#pageShell {
          padding: 0 !important;
          margin: 0 !important;
        }
        
        /* Keep footer visible at bottom with refresh button */
        .sapMPageFooter {
          position: fixed !important;
          bottom: 0 !important;
          left: 0 !important;
          width: 100% !important;
          z-index: 101 !important;
        }
      `;
      document.head.appendChild(zenModeStyleElement);
      console.log('C@S Content: Zen Mode enabled');
    } else {
      if (zenModeStyleElement) {
        zenModeStyleElement.remove();
        zenModeStyleElement = null;
      }
    }
  }
  function applySplitLayout(ratio) {
    if (isInIframe) {
      return;
    }
    if (splitLayoutActive) {
      updateSplitRatio(ratio);
      return;
    }
    
    // Simple approach: hide original content, show two iframes side by side
    splitStyleElement = document.createElement('style');
    splitStyleElement.id = 'cs-split-layout-styles';
    splitStyleElement.textContent = `
      :root {
        --cs-split-ratio: ${ratio};
        --cs-sap-width: ${ratio}%;
        --cs-wolt-width: ${100 - ratio}%;
      }
      
      /* Hide original page content BUT NOT alert overlays */
      html.cs-split-active body > *:not(#cs-split-container):not(#cs-modern-overlay):not(script):not(style):not(link) {
        display: none !important;
      }
      
      /* Make sure alert overlay is always visible and on top */
      html.cs-split-active #cs-modern-overlay {
        display: flex !important;
        z-index: 2147483647 !important;
      }
      
      /* The split container takes full screen */
      #cs-split-container {
        position: fixed !important;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex !important;
        flex-direction: row !important;
        z-index: 9999;
        background: #fff;
      }
      
      /* Left panel (SAP Launchpad) */
      #cs-split-left {
        width: var(--cs-sap-width);
        height: 100%;
        overflow: hidden;
        border-right: 4px solid rgba(0, 0, 0, 0.15);
      }
      #cs-split-left iframe {
        width: 100%;
        height: 100%;
        border: none;
      }
      
      /* Right panel (SAP Launchpad copy) */
      #cs-split-right {
        width: var(--cs-wolt-width);
        height: 100%;
        overflow: hidden;
      }
      #cs-split-right iframe {
        width: 100%;
        height: 100%;
        border: none;
      }
    `;
    document.head.appendChild(splitStyleElement);
    
    // Create the split container
    const splitContainer = document.createElement('div');
    splitContainer.id = 'cs-split-container';
    
    // Build URLs - left iframe sends data, right iframe is display-only
    const baseUrl = window.location.href.split('?')[0];
    const existingParams = new URLSearchParams(window.location.search);
    
    // Left iframe - primary data source
    const leftParams = new URLSearchParams(existingParams);
    leftParams.set('cs-split-role', 'primary');
    const leftUrl = baseUrl + '?' + leftParams.toString();
    
    // Right iframe - display only (no data sending)
    const rightParams = new URLSearchParams(existingParams);
    rightParams.set('cs-split-role', 'display');
    const rightUrl = baseUrl + '?' + rightParams.toString();
    
    // Create left panel with iframe
    const leftPanel = document.createElement('div');
    leftPanel.id = 'cs-split-left';
    const leftIframe = document.createElement('iframe');
    leftIframe.src = leftUrl;
    leftIframe.id = 'cs-split-iframe-left';
    leftPanel.appendChild(leftIframe);
    
    // Create right panel with iframe  
    const rightPanel = document.createElement('div');
    rightPanel.id = 'cs-split-right';
    const rightIframe = document.createElement('iframe');
    rightIframe.src = rightUrl;
    rightIframe.id = 'cs-split-iframe-right';
    rightPanel.appendChild(rightIframe);
    
    splitContainer.appendChild(leftPanel);
    splitContainer.appendChild(rightPanel);
    document.body.appendChild(splitContainer);
    
    // Store reference for cleanup
    woltPanelElement = splitContainer;
    
    // Add class to html element
    document.documentElement.classList.add('cs-split-active');
    
    splitLayoutActive = true;
  }
  function updateSplitRatio(ratio) {
    if (!splitStyleElement) return;
    document.documentElement.style.setProperty('--cs-split-ratio', ratio);
    document.documentElement.style.setProperty('--cs-sap-width', `${ratio}%`);
    document.documentElement.style.setProperty('--cs-wolt-width', `${100 - ratio}%`);
  }
  function removeSplitLayout() {
    if (!splitLayoutActive) return;
    
    if (dragHandlers) {
      window.removeEventListener('mousemove', dragHandlers.handleMouseMove);
      window.removeEventListener('mouseup', dragHandlers.handleMouseUp);
      window.removeEventListener('mouseleave', dragHandlers.handleMouseUp);
      dragHandlers = null;
    }
    
    // Remove the split container (contains both panels)
    if (woltPanelElement) {
      woltPanelElement.remove();
      woltPanelElement = null;
    }
    
    // Remove the divider (if exists from old implementation)
    if (splitDividerElement) {
      splitDividerElement.remove();
      splitDividerElement = null;
    }
    
    // Remove styles
    if (splitStyleElement) {
      splitStyleElement.remove();
      splitStyleElement = null;
    }
    
    // Remove class from html
    document.documentElement.classList.remove('cs-split-active');
    
    // Reset any inline styles
    document.documentElement.style.removeProperty('--cs-split-ratio');
    document.documentElement.style.removeProperty('--cs-sap-width');
    document.documentElement.style.removeProperty('--cs-wolt-width');
    
    splitLayoutActive = false;
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
  
  async function showAlertOverlay(data) {
    if (isInIframe) {
      return;
    }
    
    // Always use fullscreen overlay (split mode now uses iframe, not custom panels)
    closeAlertOverlay();
    
    if (data.soundData && data.soundData.startsWith('data:audio/')) {
      alertAudio = new Audio(data.soundData);
      alertAudio.play().catch(e => console.warn('Audio blocked', e));
    }
    const settings = await chrome.storage.local.get(['alertDurationSeconds', 'alertOverlay']);
    let seconds = parseInt(settings.alertDurationSeconds, 10) || 10;
    const isWoltOrder = data.orderType === 'wolt';
    
    const customization = (isWoltOrder && data.woltOverlay) ? data.woltOverlay : (data.alertOverlay || {
      position: 'bottom-center',
      mainTitle: 'Uusia collecteja!',
      subTitle: 'Nyt keräämään!!',
      brandTag: 'C@S',
      counterLabel: 'Odottaa keräystä',
      fontSize: 'large'
    });
    
    const overlay = createElement('div', { id: 'cs-modern-overlay' });
    currentOverlay = overlay;
    if (isWoltOrder) {
      overlay.classList.add('wolt-alert');
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
      // Ensure video plays (some browsers block autoplay)
      vid.play().catch(e => console.warn('Video autoplay blocked', e));
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
    
    // Set initial progress bar to 100%
    bar.style.width = '100%';
    
    alertCountdownInterval = setInterval(() => {
      remaining--;
      const pct = Math.max(0, (remaining / totalSeconds) * 100);
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
