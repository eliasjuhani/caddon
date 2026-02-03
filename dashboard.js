(function() {
  'use strict';

  console.log('Dashboard: Initializing v3.0');

  // DOM Elements
  const collectCountEl = document.getElementById('collectCount');
  const woltCountEl = document.getElementById('woltCount');
  const collectChangeEl = document.getElementById('collectChange');
  const woltChangeEl = document.getElementById('woltChange');
  const collectTimeEl = document.getElementById('collectTime');
  const woltTimeEl = document.getElementById('woltTime');
  const statusIndicatorEl = document.getElementById('statusIndicator');
  const statusTextEl = document.getElementById('statusText');
  const refreshBtn = document.getElementById('refreshBtn');
  const collectCard = document.getElementById('collectCard');
  const woltCard = document.getElementById('woltCard');

  // State
  let previousData = { collect: 0, wolt: 0 };
  let updateInterval = null;

  // Initialize
  init();

  async function init() {
    console.log('Dashboard: Starting initialization');
    
    if (typeof chrome !== 'undefined' && chrome.storage) {
      setStatus('connected', 'Aktiivinen');
      await updateDashboard();
      
      // Auto-refresh every 3 seconds
      updateInterval = setInterval(updateDashboard, 3000);
      
      // Listen for storage changes
      chrome.storage.onChanged.addListener(handleStorageChange);
    } else {
      setStatus('error', 'Ei yhteyttä');
    }

    // Refresh button
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.classList.add('spinning');
        await updateDashboard();
        setTimeout(() => refreshBtn.classList.remove('spinning'), 800);
      });
    }
  }

  function handleStorageChange(changes, area) {
    if (area === 'local' && (changes.collectCount || changes.woltCount)) {
      updateDashboard();
    }
  }

  async function updateDashboard() {
    try {
      const storage = await chrome.storage.local.get(['collectCount', 'woltCount']);
      
      const collectCount = parseInt(storage.collectCount, 10) || 0;
      const woltCount = parseInt(storage.woltCount, 10) || 0;
      
      // Update counts with animations
      updateCount(collectCountEl, collectChangeEl, collectCard, collectCount, previousData.collect, 'collect');
      updateCount(woltCountEl, woltChangeEl, woltCard, woltCount, previousData.wolt, 'wolt');
      
      // Store previous data
      previousData = { collect: collectCount, wolt: woltCount };
      
      // Update timestamps
      const now = new Date().toLocaleTimeString('fi-FI', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
      if (collectTimeEl) collectTimeEl.textContent = now;
      if (woltTimeEl) woltTimeEl.textContent = now;
      
      setStatus('connected', 'Aktiivinen');
    } catch (error) {
      console.error('Dashboard: Error updating:', error);
      setStatus('error', 'Virhe');
    }
  }

  function updateCount(element, changeEl, cardEl, newValue, oldValue, type) {
    if (!element) return;
    
    const currentValue = parseInt(element.textContent, 10) || 0;
    
    if (currentValue !== newValue) {
      element.textContent = newValue;
      
      // Animate count change
      element.classList.remove('animate');
      void element.offsetWidth;
      element.classList.add('animate');
      
      // Show change indicator and card alert
      if (oldValue !== undefined && currentValue !== 0) {
        const diff = newValue - oldValue;
        if (diff !== 0 && changeEl) {
          changeEl.textContent = diff > 0 ? `+${diff}` : String(diff);
          changeEl.className = 'count-change show ' + (diff > 0 ? 'positive' : 'negative');
          
          // Card alert animation
          if (cardEl && diff > 0) {
            cardEl.classList.remove('alert');
            void cardEl.offsetWidth;
            cardEl.classList.add('alert');
          }
          
          // Hide change after 3 seconds
          setTimeout(() => {
            if (changeEl) changeEl.classList.remove('show');
          }, 3000);
        }
      }
    }
  }

  function setStatus(status, text) {
    if (statusIndicatorEl) {
      statusIndicatorEl.className = 'status-dot ' + status;
    }
    if (statusTextEl) {
      statusTextEl.textContent = text;
    }
  }

  // Cleanup
  window.addEventListener('beforeunload', () => {
    if (updateInterval) clearInterval(updateInterval);
  });
})();
