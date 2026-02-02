
(function() {
  'use strict';
  if (window._collectStoreInit) return;
  window._collectStoreInit = true;
  
  // Detect if this is running in an iframe
  const isInIframe = window.self !== window.top;
  const frameId = isInIframe ? 'iframe' : 'main';
  
  let CONFIG = {
    completedStatuses: [
      'PC', 'COMPLETED', 'PICKED', 'CANCELLED', 'DELIVERED', 'HANDED OVER',
      'VALMIS', 'NOUDETTU', 'TOIMITETTU', 'PERUTTU', 'LUOVUTETTU',
      'LASKUTETTU', 'ARCHIVED', 'ARKISTOITU', 'DONE'
    ],
    collectKeywords: ['collect', 'pickup', 'pick-up', 'store', 'click & collect'],
    collectCodes: ['collect', 'pickup', 'zcs', 'c&c', 'cac', 'cas'],
    shippingKeywords: ['home delivery', 'ship', 'delivery', 'hd', 'home'],
    woltKeywords: ['express', 'ad-hoc', 'adhoc', 'fast', 'wolt', 'pikatilaus'],
    woltCodes: ['express', 'adhoc', 'fast', 'wolt', 'exp']
  };
  window.postMessage({ type: 'COLLECT_STORE_READY', frameId }, '*');
  console.log('C@S Inject: Script ready, frameId:', frameId);
  window.addEventListener('message', handleMessage);
  function handleMessage(event) {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'COLLECT_STORE_TRIGGER_REFRESH') {
      clickRefreshButton();
    }
    if (event.data && event.data.type === 'COLLECT_STORE_CONFIG_UPDATE') {
      if (event.data.config) {
        CONFIG = { ...CONFIG, ...event.data.config };
        console.log('C@S Inject: Configuration updated', CONFIG);
      }
    }
    if (event.data && event.data.type === 'COLLECT_STORE_OPEN_EXPRESS') {
      openExpressTile();
    }
  }
  
  function openExpressTile() {
    try {
      // Try to find and click the Express filter button in SFS view
      if (typeof sap !== 'undefined' && sap.ui && sap.ui.getCore) {
        const core = sap.ui.getCore();
        
        // Try known Express button IDs
        const expressButtonIds = [
          '__jsview4--qf_Express-button',
          '__jsview3--qf_Express-button',
          '__jsview2--qf_Express-button',
          '__jsview1--qf_Express-button',
          '__jsview5--qf_Express-button'
        ];
        
        for (const id of expressButtonIds) {
          const btn = core.byId(id);
          if (btn && typeof btn.firePress === 'function') {
            btn.firePress();
            return true;
          }
        }
        
        // Try to find Express button dynamically
        const allElements = core.byFieldGroupId('');
        if (allElements) {
          for (const el of allElements) {
            const elId = el.getId ? el.getId() : '';
            if (elId.includes('qf_Express') || elId.includes('Express')) {
              if (typeof el.firePress === 'function') {
                el.firePress();
                return true;
              }
            }
          }
        }
      }
      
      // Fallback: Try to find Express button in DOM
      const domSelectors = [
        '[id*="qf_Express"]',
        '[id*="Express-button"]',
        '[title*="Express"]',
        '[aria-label*="Express"]',
        'button[id*="Express"]'
      ];
      
      for (const selector of domSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (el.offsetParent !== null) {
            el.click();
            return true;
          }
        }
      }
      
      // If we're not in SFS view, try to navigate there first
      alert('Express-näkymää ei löytynyt.\nSiirry ensin Pick&Pack -näkymään ja yritä uudelleen.');
      return false;
    } catch (error) {
      return false;
    }
  }
  function sendToContentScript(data) {
    try {
      window.postMessage({ type: 'COLLECT_STORE_DATA', data: data, frameId: frameId }, '*');
    } catch (error) {
      console.error('C@S Inject: Failed to send data:', error);
    }
  }
  function clickRefreshButton() {
    try {
      if (typeof sap === 'undefined' || !sap.ui || !sap.ui.getCore) {
        return tryDOMRefresh();
      }
      
      const core = sap.ui.getCore();
      const knownIds = ['__jsview1--BtnRefresh', '__jsview2--BtnRefresh', '__jsview3--BtnRefresh', '__jsview0--BtnRefresh', '__jsview4--BtnRefresh', '__jsview5--BtnRefresh'];
      
      for (const id of knownIds) {
        const btn = core.byId(id);
        if (btn && typeof btn.firePress === 'function') {
          btn.firePress();
          return true;
        }
      }
      
      // Try to find any refresh button dynamically
      const allElements = core.byFieldGroupId('');
      if (allElements) {
        for (const el of allElements) {
          const elId = el.getId ? el.getId() : '';
          if (elId.includes('BtnRefresh') || elId.includes('btnRefresh') || elId.includes('refresh')) {
            if (typeof el.firePress === 'function') {
              el.firePress();
              return true;
            }
          }
        }
      }
      
      return tryDOMRefresh();
    } catch (error) {
      return tryDOMRefresh();
    }
  }
  
  function tryDOMRefresh() {
    try {
      const refreshBtns = document.querySelectorAll('[id*="Refresh"], [id*="refresh"], button[title*="Refresh"], button[title*="refresh"], button[title*="Päivitä"]');
      for (const btn of refreshBtns) {
        if (btn.offsetParent !== null) {
          btn.click();
          return true;
        }
      }
      
      const icons = document.querySelectorAll('.sapUiIcon[data-sap-ui-icon-content=""], .sapMBtnIcon');
      for (const icon of icons) {
        const parent = icon.closest('button, [role="button"]');
        if (parent && parent.offsetParent !== null) {
          const ariaLabel = parent.getAttribute('aria-label') || '';
          const title = parent.getAttribute('title') || '';
          if (ariaLabel.toLowerCase().includes('refresh') || title.toLowerCase().includes('refresh') ||
              ariaLabel.toLowerCase().includes('päivitä') || title.toLowerCase().includes('päivitä')) {
            parent.click();
            return true;
          }
        }
      }
      
      return false;
    } catch (e) {
      return false;
    }
  }
  function isCollectOrPickupOrder(orderTypeText, orderTypeCode) {
    const textLower = (typeof orderTypeText === 'string') ? orderTypeText.toLowerCase().trim() : '';
    const codeLower = (typeof orderTypeCode === 'string') ? orderTypeCode.toLowerCase().trim() : '';
    if (['order', 'orders', '', 'standard'].includes(textLower)) return false;
    const textHasCollect = CONFIG.collectKeywords.some(k => textLower.includes(k));
    const codeHasCollect = CONFIG.collectCodes.some(c => codeLower.includes(c));
    const isShipping = CONFIG.shippingKeywords.some(k => textLower.includes(k)) && !textHasCollect;
    if (isShipping) return false;
    return textHasCollect || codeHasCollect;
  }
  function isWoltExpressOrder(orderTypeText, orderTypeCode) {
    const textLower = (typeof orderTypeText === 'string') ? orderTypeText.toLowerCase().trim() : '';
    const codeLower = (typeof orderTypeCode === 'string') ? orderTypeCode.toLowerCase().trim() : '';
    const textHasWolt = CONFIG.woltKeywords.some(k => textLower.includes(k));
    const codeHasWolt = CONFIG.woltCodes.some(c => codeLower.includes(c));
    return textHasWolt || codeHasWolt;
  }
  function countCollectOrdersFromResponse(response) {
    try {
      const data = response.modellistItemsData;
      if (!data || !Array.isArray(data) || data.length < 50) return null;
      const numCols = data[0];
      if (typeof numCols !== 'number') return null;
      const headers = data.slice(1, numCols + 1);
      let orderTypeColIndex = headers.indexOf('ORDER_TYPE_TEXT');
      if (orderTypeColIndex === -1) {
        ['ACTUAL_ORDER_TYPE', 'ORDER_TYPE', 'DELIVERY_TYPE'].some(name => {
          const idx = headers.indexOf(name);
          if (idx !== -1) { orderTypeColIndex = idx; return true; }
        });
      }
      const statusCandidates = ['STATUS_TEXT', 'TXT_STATUS', 'GBSTK', 'OVERALL_STATUS', 'STATUS'];
      let statusColIndex = -1;
      for (const name of statusCandidates) {
        const idx = headers.indexOf(name);
        if (idx !== -1) {
          statusColIndex = idx;
          break;
        }
      }
      const orderIdColIndex = headers.indexOf('ORDER_ID') > -1 ? headers.indexOf('ORDER_ID') : headers.indexOf('SALES_ORDER');
      const orderTypeCodeColIndex = headers.indexOf('ORDER_TYPE');
      const isHeaderColIndex = headers.indexOf('IS_HEADER');
      const dateTimeCandidates = ['WADAT_IST', 'PICK_DATE', 'TIME_STAMP', 'CREATED_AT', 'DATE', 'TIME', 'CREATED_DATE'];
      let dateTimeColIndex = -1;
      for (const name of dateTimeCandidates) {
        const idx = headers.indexOf(name);
        if (idx !== -1) {
          dateTimeColIndex = idx;
          break;
        }
      }
      const dataStart = numCols + 1;
      const numRows = Math.floor((data.length - dataStart) / numCols);
      const collectOrders = new Set();
      const woltOrders = new Set();
      const woltOrderDetails = []; 
      let collectOldestTimestamp = null;
      let woltOldestTimestamp = null;
      const customerNameCandidates = ['CUSTOMER_NAME', 'NAME', 'PARTNER_NAME', 'BUYER_NAME', 'KUNNR_NAME'];
      let customerNameColIndex = -1;
      for (const name of customerNameCandidates) {
        const idx = headers.indexOf(name);
        if (idx !== -1) {
          customerNameColIndex = idx;
          break;
        }
      }
      for (let row = 0; row < numRows; row++) {
        const rowStart = dataStart + (row * numCols);
        if (isHeaderColIndex !== -1) {
          const isH = data[rowStart + isHeaderColIndex];
          if (isH === true || isH === 'X' || isH === 'true') continue;
        }
        const orderId = orderIdColIndex !== -1 ? data[rowStart + orderIdColIndex] : `row-${row}`;
        if (collectOrders.has(orderId) || woltOrders.has(orderId)) continue;
        const typeText = orderTypeColIndex !== -1 ? data[rowStart + orderTypeColIndex] : '';
        const typeCode = orderTypeCodeColIndex !== -1 ? data[rowStart + orderTypeCodeColIndex] : '';
        const statusVal = statusColIndex !== -1 ? data[rowStart + statusColIndex] : '';
        const statusNorm = String(statusVal).toUpperCase().trim();
        const isCompleted = CONFIG.completedStatuses.some(s => statusNorm === s || statusNorm.includes(s));
        if (isCompleted || statusNorm === '') continue;
        let orderTimestamp = null;
        if (dateTimeColIndex !== -1) {
          const dateTimeValue = data[rowStart + dateTimeColIndex];
          if (dateTimeValue) {
            try {
              const timestamp = new Date(dateTimeValue).getTime();
              if (!isNaN(timestamp)) {
                orderTimestamp = timestamp;
              }
            } catch (e) {
            }
          }
        }
        const customerName = customerNameColIndex !== -1 ? data[rowStart + customerNameColIndex] : null;
        if (isWoltExpressOrder(typeText, typeCode)) {
          woltOrders.add(orderId);
          woltOrderDetails.push({
            orderId: String(orderId),
            timestamp: orderTimestamp || Date.now(),
            shippingType: typeText || typeCode || 'Express',
            customerName: customerName || ''
          });
          if (orderTimestamp && (woltOldestTimestamp === null || orderTimestamp < woltOldestTimestamp)) {
            woltOldestTimestamp = orderTimestamp;
          }
        }
        else if (isCollectOrPickupOrder(typeText, typeCode)) {
          collectOrders.add(orderId);
          if (orderTimestamp && (collectOldestTimestamp === null || orderTimestamp < collectOldestTimestamp)) {
            collectOldestTimestamp = orderTimestamp;
          }
        }
      }
      const collectCount = collectOrders.size;
      const woltCount = woltOrders.size;
      console.log(`C@S: Found ${collectCount} pending Collect orders, ${woltCount} pending Wolt/Express orders`);
      console.log(`C@S: Collect oldest: ${collectOldestTimestamp ? new Date(collectOldestTimestamp).toISOString() : 'N/A'}`);
      console.log(`C@S: Wolt oldest: ${woltOldestTimestamp ? new Date(woltOldestTimestamp).toISOString() : 'N/A'}`);
      return { 
        collectCount, 
        collectOldestTimestamp,
        woltCount,
        woltOldestTimestamp,
        woltOrders: woltOrderDetails 
      };
    } catch (error) {
      console.error('C@S Inject: Error parsing response:', error);
      return null;
    }
  }
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this._csUrl = url;
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    const xhr = this;
    xhr.addEventListener('load', function() {
      if (!xhr._csUrl || (!xhr._csUrl.includes('zelk_pick_pack') && !xhr._csUrl.includes('ZELK_PICK_PACK'))) return;
      try {
        const response = JSON.parse(xhr.responseText);
        const result = countCollectOrdersFromResponse(response);
        if (result !== null) {
          sendToContentScript({ 
            collectCount: result.collectCount, 
            oldestOrderTimestamp: result.collectOldestTimestamp,
            woltCount: result.woltCount,
            woltOldestTimestamp: result.woltOldestTimestamp,
            woltOrders: result.woltOrders || [],
            storeName: '', 
            pendingOrders: [] 
          });
        }
      } catch (e) {  }
    });
    return originalSend.apply(this, arguments);
  };
  
  // Auto-refresh on both main frame and iframe (needed for split mode)
  setTimeout(clickRefreshButton, 3000);
})();
