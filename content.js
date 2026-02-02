
(function() {
  'use strict';
  
  // Detect if running inside an iframe
  const isInIframe = window.self !== window.top;
  
  console.log('C@S Content: Script loaded v6.2 (Split View)', isInIframe ? '[IFRAME]' : '[MAIN]');
  
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
  
  // Track data from both frames separately
  let mainFrameData = { collectCount: 0, woltCount: 0, collectOldestTimestamp: null, woltOldestTimestamp: null, woltOrders: [] };
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
        console.log('C@S Content: SAP UI found, applying layout');
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
    console.log('C@S Content: Triggering page refresh, injectScriptReady:', injectScriptReady);
    
    if (!injectScriptReady) {
      // Inject script not ready yet, try to inject it again
      console.log('C@S Content: Inject script not ready, re-injecting...');
      injectPageScript();
      // Retry after a short delay
      setTimeout(() => {
        window.postMessage({ type: 'COLLECT_STORE_TRIGGER_REFRESH' }, '*');
      }, 500);
      return;
    }
    
    window.postMessage({ type: 'COLLECT_STORE_TRIGGER_REFRESH' }, '*');
  }
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'COLLECT_STORE_DATA') {
      lastSuccessfulPoll = Date.now();
      
      // Store data based on which frame it came from
      const frameId = event.data.frameId || 'main';
      const incomingData = event.data.data || {};
      
      if (frameId === 'main') {
        mainFrameData = {
          collectCount: incomingData.collectCount || 0,
          woltCount: incomingData.woltCount || 0,
          collectOldestTimestamp: incomingData.oldestOrderTimestamp || null,
          woltOldestTimestamp: incomingData.woltOldestTimestamp || null,
          woltOrders: incomingData.woltOrders || []
        };
      } else if (frameId === 'iframe') {
        iframeData = {
          collectCount: incomingData.collectCount || 0,
          woltCount: incomingData.woltCount || 0,
          collectOldestTimestamp: incomingData.oldestOrderTimestamp || null,
          woltOldestTimestamp: incomingData.woltOldestTimestamp || null,
          woltOrders: incomingData.woltOrders || []
        };
      }
      
      // Merge data from both frames - take the maximum count from either frame
      const mergedData = {
        collectCount: Math.max(mainFrameData.collectCount, iframeData.collectCount),
        woltCount: Math.max(mainFrameData.woltCount, iframeData.woltCount),
        oldestOrderTimestamp: [mainFrameData.collectOldestTimestamp, iframeData.collectOldestTimestamp]
          .filter(t => t !== null)
          .sort((a, b) => a - b)[0] || null,
        woltOldestTimestamp: [mainFrameData.woltOldestTimestamp, iframeData.woltOldestTimestamp]
          .filter(t => t !== null)
          .sort((a, b) => a - b)[0] || null,
        woltOrders: [...mainFrameData.woltOrders, ...iframeData.woltOrders],
        storeName: '',
        pendingOrders: []
      };
      
      // Update local state
      currentOrderCount = mergedData.collectCount;
      currentOldestTimestamp = mergedData.oldestOrderTimestamp;
      currentWoltCount = mergedData.woltCount;
      currentWoltOldestTimestamp = mergedData.woltOldestTimestamp;
      currentWoltOrders = mergedData.woltOrders;
      
      // If we're in an iframe (split mode right panel), send data to parent
      if (isInIframe) {
        try {
          window.parent.postMessage({ 
            type: 'COLLECT_STORE_IFRAME_DATA', 
            data: incomingData,
            frameId: 'iframe'
          }, '*');
        } catch (e) {
          console.warn('C@S Content: Could not send to parent frame:', e);
        }
      } else {
        // Main frame sends merged data to background
        chrome.runtime.sendMessage({ action: 'updateOrders', data: mergedData }).catch(error => {
          console.warn('C@S Content: Extension context invalidated, ignoring:', error.message);
        });
      }
    }
    
    // Handle data from iframe content script (in split mode)
    if (!isInIframe && event.data?.type === 'COLLECT_STORE_IFRAME_DATA') {
      const incomingData = event.data.data || {};
      
      console.log('C@S Content: Received data from iframe:', incomingData);
      
      // Update iframe data
      iframeData = {
        collectCount: incomingData.collectCount || 0,
        woltCount: incomingData.woltCount || 0,
        collectOldestTimestamp: incomingData.oldestOrderTimestamp || null,
        woltOldestTimestamp: incomingData.woltOldestTimestamp || null,
        woltOrders: incomingData.woltOrders || []
      };
      
      // Merge and send to background
      const mergedData = {
        collectCount: Math.max(mainFrameData.collectCount, iframeData.collectCount),
        woltCount: Math.max(mainFrameData.woltCount, iframeData.woltCount),
        oldestOrderTimestamp: [mainFrameData.collectOldestTimestamp, iframeData.collectOldestTimestamp]
          .filter(t => t !== null)
          .sort((a, b) => a - b)[0] || null,
        woltOldestTimestamp: [mainFrameData.woltOldestTimestamp, iframeData.woltOldestTimestamp]
          .filter(t => t !== null)
          .sort((a, b) => a - b)[0] || null,
        woltOrders: [...mainFrameData.woltOrders, ...iframeData.woltOrders],
        storeName: '',
        pendingOrders: []
      };
      
      currentOrderCount = mergedData.collectCount;
      currentOldestTimestamp = mergedData.oldestOrderTimestamp;
      currentWoltCount = mergedData.woltCount;
      currentWoltOldestTimestamp = mergedData.woltOldestTimestamp;
      currentWoltOrders = mergedData.woltOrders;
      
      console.log('C@S Content: Merged data after iframe update:', mergedData);
      
      chrome.runtime.sendMessage({ action: 'updateOrders', data: mergedData }).catch(error => {
        console.warn('C@S Content: Extension context invalidated, ignoring:', error.message);
      });
    }
    
    if (event.source === window && event.data?.type === 'COLLECT_STORE_READY') {
      console.log('C@S Content: Received READY signal from inject.js, frameId:', event.data.frameId);
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
    if (enabled) {
      if (zenModeStyleElement) return;
      
      // Add aggressive CSS
      zenModeStyleElement = document.createElement('style');
      zenModeStyleElement.id = 'cs-zen-mode-styles';
      zenModeStyleElement.textContent = `
        /* Hide all shell chrome */
        #shell-header,
        [id*="shell-hdr"],
        #shell-toolArea,
        .sapUshellShellHead,
        .sapUshellShellHeader,
        .sapUshellShellHeadItm,
        .sapUshellAnchorNavigationBar,
        .sapUshellNavigationBar {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
          overflow: hidden !important;
        }
        
        /* Main canvas container - use absolute instead of fixed to work with split mode */
        #canvas,
        .sapUshellShellCanvas {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100% !important;
          height: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          display: flex !important;
          flex-direction: column !important;
        }
        
        /* Page content section - expand to fill */
        .sapMPageEnableScrolling,
        section[id*="pageSearch-cont"],
        section[id*="cont"] {
          flex: 1 !important;
          width: 100% !important;
          height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
        }
        
        /* Footer - keep at bottom */
        .sapMPageFooter,
        footer {
          width: 100% !important;
          margin: 0 !important;
          flex-shrink: 0 !important;
        }
      `;
      document.head.appendChild(zenModeStyleElement);
      
      // Use JavaScript to aggressively hide shell elements
      const hideElements = () => {
        // Hide header/navigation
        const selectors = [
          '#shell-header',
          '[id*="shell-hdr"]',
          '#shell-toolArea',
          '.sapUshellShellHead',
          '.sapUshellShellHeader',
          '.sapUshellAnchorNavigationBar',
          '.sapUshellNavigationBar'
        ];
        
        selectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            el.style.display = 'none';
            el.style.visibility = 'hidden';
            el.style.height = '0';
            el.style.width = '0';
            el.style.overflow = 'hidden';
          });
        });
        
        // Apply layout to canvas
        const canvas = document.querySelector('#canvas') || document.querySelector('.sapUshellShellCanvas');
        if (canvas) {
          canvas.style.position = 'absolute';
          canvas.style.top = '0';
          canvas.style.left = '0';
          canvas.style.right = '0';
          canvas.style.bottom = '0';
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          canvas.style.margin = '0';
          canvas.style.padding = '0';
          canvas.style.display = 'flex';
          canvas.style.flexDirection = 'column';
        }
        
        // Fix page content section
        const pageSection = document.querySelector('.sapMPageEnableScrolling') || 
                           document.querySelector('[id*="pageSearch-cont"]');
        if (pageSection) {
          pageSection.style.flex = '1';
          pageSection.style.width = '100%';
          pageSection.style.margin = '0';
          pageSection.style.padding = '0';
          pageSection.style.background = 'white';
        }
        
        // Fix footer
        const footer = document.querySelector('.sapMPageFooter');
        if (footer) {
          footer.style.width = '100%';
          footer.style.margin = '0';
          footer.style.flexShrink = '0';
        }
      };
      
      // Apply immediately and watch for DOM changes
      hideElements();
      setTimeout(hideElements, 100);
      setTimeout(hideElements, 500);
      setTimeout(hideElements, 1000);
      setTimeout(hideElements, 2000);
      
      // Set up observer to catch dynamically added elements
      const observer = new MutationObserver(hideElements);
      observer.observe(document.body, { childList: true, subtree: true });
      zenModeStyleElement._observer = observer;
      
      console.log('C@S Content: Zen Mode enabled');
    } else {
      if (zenModeStyleElement) {
        if (zenModeStyleElement._observer) {
          zenModeStyleElement._observer.disconnect();
        }
        zenModeStyleElement.remove();
        zenModeStyleElement = null;
        
        // Restore canvas styles
        const canvas = document.querySelector('#canvas') || document.querySelector('.sapUshellShellCanvas');
        if (canvas) {
          canvas.style.removeProperty('position');
          canvas.style.removeProperty('top');
          canvas.style.removeProperty('left');
          canvas.style.removeProperty('right');
          canvas.style.removeProperty('bottom');
          canvas.style.removeProperty('width');
          canvas.style.removeProperty('height');
          canvas.style.removeProperty('display');
          canvas.style.removeProperty('flex-direction');
        }
        
        console.log('C@S Content: Zen Mode disabled');
      }
    }
  }
  function applySplitLayout(ratio) {
    // Don't create split layout inside iframe - it would cause infinite nesting
    if (isInIframe) {
      console.log('C@S Content: Skipping split layout in iframe');
      return;
    }
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
      
      /* Add padding to body to make room for Wolt panel and divider */
      html.cs-split-active body {
        padding-right: calc(var(--cs-wolt-width) + 6px) !important;
        box-sizing: border-box !important;
      }
      
      /* The divider between panels */
      #cs-split-divider {
        position: fixed !important;
        top: 0;
        right: var(--cs-wolt-width);
        width: 4px;
        height: 100vh;
        background: rgba(0, 0, 0, 0.15);
        z-index: 10001;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.1);
      }
      
      /* The right panel with iframe showing SAP */
      #cs-wolt-panel {
        position: fixed !important;
        top: 0;
        right: 0;
        width: var(--cs-wolt-width);
        height: 100vh;
        overflow: hidden;
        background: #fff;
        z-index: 9999;
        box-shadow: -5px 0 20px rgba(0,0,0,0.3);
      }
      #cs-wolt-panel iframe {
        width: 100%;
        height: 100%;
        border: none;
      }
    `;
    document.head.appendChild(splitStyleElement);
    
    // Add the divider between panels (non-draggable, visual only)
    splitDividerElement = document.createElement('div');
    splitDividerElement.id = 'cs-split-divider';
    document.body.appendChild(splitDividerElement);
    
    // Add the right panel with an iframe showing the same SAP page
    woltPanelElement = document.createElement('div');
    woltPanelElement.id = 'cs-wolt-panel';
    const iframe = document.createElement('iframe');
    iframe.src = window.location.href;
    iframe.id = 'cs-split-iframe';
    woltPanelElement.appendChild(iframe);
    document.body.appendChild(woltPanelElement);
    
    // Add class to html element to shrink the page
    document.documentElement.classList.add('cs-split-active');
    
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
    
    // Remove drag event listeners
    if (dragHandlers) {
      window.removeEventListener('mousemove', dragHandlers.handleMouseMove);
      window.removeEventListener('mouseup', dragHandlers.handleMouseUp);
      window.removeEventListener('mouseleave', dragHandlers.handleMouseUp);
      dragHandlers = null;
    }
    
    // Remove the Wolt panel
    if (woltPanelElement) {
      woltPanelElement.remove();
      woltPanelElement = null;
    }
    
    // Remove the divider
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
    console.log('C@S Content: Split Layout removed');
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
    // Don't show alert overlays in iframe - main frame handles it
    if (isInIframe) {
      console.log('C@S Content: Skipping alert overlay in iframe');
      return;
    }
    
    console.log('showAlertOverlay called with data:', data);
    
    // Always use fullscreen overlay (split mode now uses iframe, not custom panels)
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
    
    console.log('Media check - videoData:', data.videoData ? 'present' : 'missing');
    console.log('Media check - imageData:', data.imageData ? 'present' : 'missing');
    
    if (data.videoData && data.videoData.startsWith('data:video/')) {
      console.log('Creating video element');
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
      console.log('Creating image element');
      const img = createElement('img', { classes: ['cs-media'] });
      img.src = data.imageData;
      img.onload = () => console.log('Image loaded successfully');
      img.onerror = (e) => console.error('Image failed to load', e);
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
