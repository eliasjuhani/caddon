importScripts('idb.js');

const DEFAULT_CONFIG = {
  pollIntervalSeconds: 30,
  soundEnabled: true,
  alertDurationSeconds: 15,
  completedStatuses: [
    'PC', 'COMPLETED', 'PICKED', 'CANCELLED', 'DELIVERED', 'HANDED OVER',
    'VALMIS', 'NOUDETTU', 'TOIMITETTU', 'PERUTTU', 'LUOVUTETTU',
    'LASKUTETTU', 'ARCHIVED', 'ARKISTOITU', 'DONE'
  ],
  collectKeywords: ['collect', 'pickup', 'pick-up', 'store', 'click & collect'],
  collectCodes: ['collect', 'pickup', 'zcs', 'c&c', 'cac', 'cas'],
  shippingKeywords: ['home delivery', 'ship', 'delivery', 'hd', 'home'],
  alertOverlay: {
    position: 'bottom-center',
    mainTitle: 'Uusia collecteja!',
    subTitle: 'Nyt keräämään!!',
    brandTag: 'COLLECT@STORE',
    counterLabel: 'Odottaa keräystä',
    fontSize: 'large'
  },
  heartbeat: {
    enabled: false,
    color: 'green',
    intensity: 'medium',
    width: 4
  }
};

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const settings = await chrome.storage.local.get(['pollIntervalSeconds', 'soundEnabled', 'configInitialized']);
    
    if (!settings.configInitialized) {
      await chrome.storage.local.set({ 
        pollIntervalSeconds: DEFAULT_CONFIG.pollIntervalSeconds,
        soundEnabled: DEFAULT_CONFIG.soundEnabled,
        alertDurationSeconds: DEFAULT_CONFIG.alertDurationSeconds,
        completedStatuses: DEFAULT_CONFIG.completedStatuses,
        collectKeywords: DEFAULT_CONFIG.collectKeywords,
        collectCodes: DEFAULT_CONFIG.collectCodes,
        shippingKeywords: DEFAULT_CONFIG.shippingKeywords,
        alertOverlay: DEFAULT_CONFIG.alertOverlay,
        heartbeat: DEFAULT_CONFIG.heartbeat,
        configInitialized: true
      });
    }
  } catch (error) {
    console.error('Collect@Store Background: Failed to initialize settings:', error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case 'checkNow':
          await forwardCheckToContent();
          sendResponse({ success: true });
          break;
          
        case 'updateOrders':
          await handleOrderUpdate(message.data);
          sendResponse({ success: true });
          break;
          
        case 'updateSettings':
          sendResponse({ success: true });
          break;
          
        case 'getConfig':
          const config = await chrome.storage.local.get([
            'completedStatuses', 'collectKeywords', 'collectCodes', 
            'shippingKeywords', 'alertOverlay', 'heartbeat'
          ]);
          sendResponse({ 
            success: true, 
            config: {
              completedStatuses: config.completedStatuses || DEFAULT_CONFIG.completedStatuses,
              collectKeywords: config.collectKeywords || DEFAULT_CONFIG.collectKeywords,
              collectCodes: config.collectCodes || DEFAULT_CONFIG.collectCodes,
              shippingKeywords: config.shippingKeywords || DEFAULT_CONFIG.shippingKeywords,
              alertOverlay: config.alertOverlay || DEFAULT_CONFIG.alertOverlay,
              heartbeat: config.heartbeat || DEFAULT_CONFIG.heartbeat
            }
          });
          break;
          
        case 'getDashboardData':
          const dashboardData = await getDashboardData();
          sendResponse({ success: true, data: dashboardData });
          break;
          
        default:
          console.warn('Collect@Store Background: Unknown action:', message.action);
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Collect@Store Background: Message handler error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true;
});

async function forwardCheckToContent() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://launchpad.elkjop.com/*' });
    
    if (tabs.length === 0) {
      await chrome.storage.local.set({
        connectionStatus: 'error',
        lastError: 'Avaa Launchpad',
        lastCheck: Date.now()
      });
      return;
    }
    
    let successCount = 0;
    for (const tab of tabs) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'triggerCheck' });
        if (response?.success) {
          successCount++;
        }
      } catch (e) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['overlay.css']
          });
          
          // Wait a bit for the script to initialize
          await new Promise(r => setTimeout(r, 500));
          
          const retryResponse = await chrome.tabs.sendMessage(tab.id, { action: 'triggerCheck' });
          if (retryResponse?.success) {
            successCount++;
          }
        } catch (injectError) {
        }
      }
    }
    
    if (successCount === 0) {
      await chrome.storage.local.set({
        connectionStatus: 'error',
        lastError: 'Tab ei vastaa',
        lastCheck: Date.now()
      });
    } else {
      // Update connection status on success
      await chrome.storage.local.set({
        connectionStatus: 'connected',
        lastError: null,
        lastCheck: Date.now()
      });
    }
    
  } catch (error) {
    console.error('Collect@Store Background: Error forwarding check:', error);
    throw error;
  }
}

async function handleOrderUpdate(data) {
  try {
    const collectCount = parseInt(data?.collectCount, 10) || 0;
    const woltCount = parseInt(data?.woltCount, 10) || 0;
    const storeName = data?.storeName || '';
    const pendingOrders = Array.isArray(data?.pendingOrders) ? data.pendingOrders : [];
    
    const prevState = await chrome.storage.local.get(['notifiedCount', 'notifiedWoltCount']);
    const notifiedCount = parseInt(prevState.notifiedCount, 10) || 0;
    const notifiedWoltCount = parseInt(prevState.notifiedWoltCount, 10) || 0;
    
    const hasNewWolt = woltCount > notifiedWoltCount;
    const hasNewCollect = collectCount > notifiedCount;
    
    if (hasNewWolt || hasNewCollect) {
      if (hasNewWolt) {
        const newWoltOrders = woltCount - notifiedWoltCount;
        
        await chrome.storage.local.set({ alertWoltOrderCount: newWoltOrders });
        await showSystemNotification(woltCount, newWoltOrders, 'wolt');
        await showContentAlert(woltCount, newWoltOrders, 'wolt');
      } else if (hasNewCollect) {
        const newOrders = collectCount - notifiedCount;
        
        await chrome.storage.local.set({ alertOrderCount: newOrders });
        await showSystemNotification(collectCount, newOrders, 'collect');
        await showContentAlert(collectCount, newOrders, 'collect');
      }
    }
    
    await chrome.storage.local.set({
      collectCount: collectCount,
      woltCount: woltCount,
      notifiedCount: collectCount,
      notifiedWoltCount: woltCount,
      storeName: storeName,
      connectionStatus: 'connected',
      lastCheck: Date.now(),
      lastError: null,
      pendingOrders: pendingOrders
    });
    
  } catch (error) {
    console.error('Collect@Store Background: Error handling order update:', error);
    throw error;
  }
}

async function showSystemNotification(totalCount, newCount, orderType = 'collect') {
  try {
    const isWolt = orderType === 'wolt';
    const title = isWolt ? 'Uusia Wolt tilauksia!' : 'Uusia tilauksia!';
    const typeLabel = isWolt ? 'Wolt' : 'Collect@Store';
    
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: title,
      message: `${totalCount} ${typeLabel} tilausta odottaa (+${newCount} uutta).`,
      priority: 2,
      requireInteraction: true
    });
  } catch (error) {
    console.error('Collect@Store Background: Failed to create notification:', error);
  }
}

async function showContentAlert(totalCount, newCount, orderType = 'collect') {
  try {
    const settings = await chrome.storage.local.get(['soundEnabled', 'alertOverlay', 'heartbeat']);
    
    if (settings.soundEnabled === false) {
      return;
    }
    
    const isWolt = orderType === 'wolt';
    
    let soundData, imageData, videoData;
    
    if (isWolt) {
      [soundData, imageData] = await Promise.all([
        MediaDB.getMediaAsDataURL('woltSoundData'),
        MediaDB.getMediaAsDataURL('woltImageData')
      ]);
      videoData = null;
      
      if (!soundData) {
        soundData = await MediaDB.getMediaAsDataURL('soundData');
      }
      if (!imageData) {
        imageData = await MediaDB.getMediaAsDataURL('imageData');
      }
    } else {
      [soundData, videoData, imageData] = await Promise.all([
        MediaDB.getMediaAsDataURL('soundData'),
        MediaDB.getMediaAsDataURL('videoData'),
        MediaDB.getMediaAsDataURL('imageData')
      ]);
    }
    
    let alertOverlay = settings.alertOverlay || DEFAULT_CONFIG.alertOverlay;
    if (isWolt) {
      alertOverlay = {
        ...alertOverlay,
        mainTitle: 'Wolt!',
        subTitle: 'Tilaus saapunut!',
        brandTag: 'WOLT'
      };
    }
    
    const tabs = await chrome.tabs.query({ url: 'https://launchpad.elkjop.com/*' });
    
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'showAlert',
          data: {
            count: totalCount,
            newCount: newCount,
            orderType: orderType,
            soundData: soundData, 
            videoData: videoData,
            imageData: imageData,
            alertOverlay: alertOverlay,
            heartbeat: settings.heartbeat || DEFAULT_CONFIG.heartbeat
          }
        });
        return;
      } catch (e) {
      }
    }
    
  } catch (error) {
    console.error('Collect@Store Background: Error showing content alert:', error);
  }

}

/**
 * Get dashboard data for real-time monitoring
 */
async function getDashboardData() {
  try {
    const storage = await chrome.storage.local.get(['collectCount', 'woltCount', 'pendingOrders']);
    
    const collectCount = parseInt(storage.collectCount, 10) || 0;
    const woltCount = parseInt(storage.woltCount, 10) || 0;
    const totalCount = collectCount + woltCount;
    const pendingOrders = storage.pendingOrders || [];
    
    // Find oldest order
    let oldestOrderTime = null;
    if (pendingOrders.length > 0) {
      const timestamps = pendingOrders
        .map(order => order.timestamp)
        .filter(t => t && !isNaN(t));
      
      if (timestamps.length > 0) {
        oldestOrderTime = Math.min(...timestamps);
      }
    }
    
    return {
      collectCount,
      woltCount,
      totalCount,
      oldestOrderTime
    };
  } catch (error) {
    console.error('Collect@Store Background: Error getting dashboard data:', error);
    return {
      collectCount: 0,
      woltCount: 0,
      totalCount: 0,
      oldestOrderTime: null
    };
  }
}
