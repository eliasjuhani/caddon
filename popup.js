(function() {
  'use strict';

  let orderCountEl, lastCheckEl, statusBadge, refreshBtn, 
      pollIntervalInput, alertDurationInput, soundEnabledInput,
      connectionDot, connectionText, soundFileInput, imageFileInput, 
      soundFileName, imageFileName, testAlertBtn, woltCountEl;

  let woltSoundFileInput, woltImageFileInput, woltSoundFileName, woltImageFileName;
  
  let splitModeEnabled;
  
  let monitorFrame, monitorLeft, monitorRight, monitorDivider;
  let splitRatioLeft, splitRatioRight;
  let currentSplitRatio = 50;

  let editorMainTitle, editorSubTitle, 
      editorBrandTag, editorCounterLabel, editorResetBtn, editorEmphasisAnim;
  
  let woltMainTitle, woltSubTitle, woltBrandTag, woltCounterLabel;
  
  let currentPosition = 'center';
  let currentFontSize = 'large';

  let pollIntervalValue, alertDurationValue;

  let domReady = false;

  const DEFAULT_ALERT_OVERLAY = {
    position: 'center',
    mainTitle: 'Collect',
    subTitle: '',
    brandTag: '',
    counterLabel: '',
    fontSize: 'large',
    emphasisAnim: false
  };
  const DEFAULT_WOLT_OVERLAY = {
    position: 'center',
    mainTitle: 'Wolt',
    subTitle: '',
    brandTag: '',
    counterLabel: '',
    fontSize: 'large',
    emphasisAnim: false
  };
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && domReady) {
      if (changes.collectCount || changes.woltCount || changes.lastCheck || changes.connectionStatus || 
          changes.storeName) {
        loadState();
      }
    }
  });

  document.addEventListener('DOMContentLoaded', initPopup);

  async function initPopup() {
    try {
      orderCountEl = document.getElementById('order-count');
      woltCountEl = document.getElementById('wolt-count');
      lastCheckEl = document.getElementById('last-check');
      statusBadge = document.getElementById('status-badge');
      refreshBtn = document.getElementById('refresh-btn');
      pollIntervalInput = document.getElementById('poll-interval');
      alertDurationInput = document.getElementById('alert-duration');
      soundEnabledInput = document.getElementById('sound-enabled');
      connectionDot = document.getElementById('connection-status');
      connectionText = document.getElementById('connection-text');
      soundFileInput = document.getElementById('sound-file');
      imageFileInput = document.getElementById('image-file');
      soundFileName = document.getElementById('sound-file-name');
      imageFileName = document.getElementById('image-file-name');
      testAlertBtn = document.getElementById('test-alert');
      const testWoltAlertBtn = document.getElementById('test-wolt-alert');
      
      woltSoundFileInput = document.getElementById('wolt-sound-file');
      woltImageFileInput = document.getElementById('wolt-image-file');
      woltSoundFileName = document.getElementById('wolt-sound-file-name');
      woltImageFileName = document.getElementById('wolt-image-file-name');
      
      splitModeEnabled = document.getElementById('split-mode-enabled');
      
      monitorFrame = document.getElementById('monitor-frame');
      monitorLeft = document.getElementById('monitor-left');
      monitorRight = document.getElementById('monitor-right');
      monitorDivider = document.getElementById('monitor-divider');
      splitRatioLeft = document.getElementById('split-ratio-left');
      splitRatioRight = document.getElementById('split-ratio-right');
      
      pollIntervalValue = document.getElementById('poll-interval-value');
      alertDurationValue = document.getElementById('alert-duration-value');
      
      editorMainTitle = document.getElementById('editor-main-title');
      editorSubTitle = document.getElementById('editor-sub-title');
      editorBrandTag = document.getElementById('editor-brand-tag');
      editorCounterLabel = document.getElementById('editor-counter-label');
      editorResetBtn = document.getElementById('editor-reset');
      editorEmphasisAnim = document.getElementById('editor-emphasis-anim');
      
      woltMainTitle = document.getElementById('wolt-main-title');
      woltSubTitle = document.getElementById('wolt-sub-title');
      woltBrandTag = document.getElementById('wolt-brand-tag');
      woltCounterLabel = document.getElementById('wolt-counter-label');
      
      domReady = true;
      
      await loadState();
      await loadSettings();
      await loadEditorSettings();
      await loadWoltSettings();
      await loadSplitSettings();
      setupEventListeners();
      setupTabNavigation();
      setupSplitControl();
      setupEditorGrids();
      toggleEditorControls();
      
    } catch (error) {
      console.error('Popup: Initialization failed:', error);
    }
  }

  async function loadState() {
    try {
      const state = await chrome.storage.local.get([
        'collectCount', 'woltCount', 'storeName', 'lastCheck', 'lastError', 'connectionStatus'
      ]);
      updateUI(state);
    } catch (error) {
      console.error('Popup: Failed to load state:', error);
    }
  }

  async function loadSettings() {
    try {
      const settings = await chrome.storage.local.get([
        'pollIntervalSeconds', 'alertDurationSeconds', 'soundEnabled', 
        'soundFileName', 'imageFileName'
      ]);
      
      const pollInterval = settings.pollIntervalSeconds || 30;
      const alertDuration = settings.alertDurationSeconds || 10;
      
      if (pollIntervalInput) {
        pollIntervalInput.value = String(Math.min(60, Math.max(1, pollInterval)));
        if (pollIntervalValue) pollIntervalValue.textContent = String(Math.min(60, Math.max(1, pollInterval)));
      }
      if (alertDurationInput) {
        alertDurationInput.value = String(Math.min(20, Math.max(1, alertDuration)));
        if (alertDurationValue) alertDurationValue.textContent = String(Math.min(20, Math.max(1, alertDuration)));
      }
      if (soundEnabledInput) soundEnabledInput.checked = settings.soundEnabled !== false;
      if (soundFileName && settings.soundFileName) soundFileName.textContent = settings.soundFileName;
      if (imageFileName && settings.imageFileName) imageFileName.textContent = settings.imageFileName;
    } catch (error) {
      console.error('Popup: Failed to load settings:', error);
    }
  }

  function updateUI(state) {
    const count = parseInt(state.collectCount, 10) || 0;
    const woltCount = parseInt(state.woltCount, 10) || 0;
    
    if (orderCountEl) orderCountEl.textContent = String(count);
    if (woltCountEl) woltCountEl.textContent = String(woltCount);
    
    if (lastCheckEl && state.lastCheck) {
      const date = new Date(state.lastCheck);
      lastCheckEl.textContent = date.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
    }
    
    updateConnectionStatus(state.connectionStatus, state.lastError);
  }

  function updateConnectionStatus(status, error) {
    if (!connectionDot || !connectionText) return;
    connectionDot.className = 'status-indicator';
    switch(status) {
      case 'connected':
        connectionDot.classList.add('connected');
        connectionText.textContent = 'Yhdistetty';
        break;
      case 'error':
        connectionDot.classList.add('disconnected');
        connectionText.textContent = error || 'Virhe';
        break;
      default:
        connectionDot.classList.add('unknown');
        connectionText.textContent = 'Tuntematon';
    }
  }

  async function handleFileChange(event, storageKey, fileNameKey, displayElement, mediaType) {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (displayElement) displayElement.textContent = 'Tallennetaan...';
    
    try {
      const maxSize = 50 * 1024 * 1024;
      if (file.size > maxSize) { 
        throw new Error('Tiedosto on liian suuri (Max 50MB)');
      }

      const blob = new Blob([file], { type: file.type });
      await MediaDB.saveMedia(storageKey, blob, mediaType, file.name);
      
      await chrome.storage.local.set({ 
        [fileNameKey]: file.name,
        [`${storageKey}Exists`]: true
      });
      
      if (displayElement) {
        displayElement.textContent = `${file.name} (${MediaDB.formatBytes(file.size)})`;
      }
      
      console.log(`Popup: Saved ${mediaType} to IndexedDB: ${file.name}`);
      
    } catch (err) {
      console.error(`Popup: Error saving ${mediaType}:`, err);
      if (displayElement) displayElement.textContent = 'Virhe: ' + err.message;
      alert('Virhe: ' + err.message);
    }
  }

  function setupEventListeners() {
    if (refreshBtn) refreshBtn.addEventListener('click', handleRefreshClick);
    
    // Dashboard button
    const dashboardBtn = document.getElementById('dashboard-btn');
    if (dashboardBtn) dashboardBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    });
    
    if (pollIntervalInput) {
      pollIntervalInput.addEventListener('input', (e) => {
        if (pollIntervalValue) pollIntervalValue.textContent = e.target.value;
      });
      pollIntervalInput.addEventListener('change', autoSaveSettings);
    }
    
    if (alertDurationInput) {
      alertDurationInput.addEventListener('input', (e) => {
        if (alertDurationValue) alertDurationValue.textContent = e.target.value;
      });
      alertDurationInput.addEventListener('change', autoSaveSettings);
    }
    
    if (soundEnabledInput) soundEnabledInput.addEventListener('change', autoSaveSettings);
    
    if (soundFileInput) soundFileInput.addEventListener('change', (e) => handleFileChange(e, 'soundData', 'soundFileName', soundFileName, 'audio'));
    if (imageFileInput) imageFileInput.addEventListener('change', (e) => handleFileChange(e, 'imageData', 'imageFileName', imageFileName, 'image'));
    
    if (woltSoundFileInput) woltSoundFileInput.addEventListener('change', (e) => handleFileChange(e, 'woltSoundData', 'woltSoundFileName', woltSoundFileName, 'audio'));
    if (woltImageFileInput) woltImageFileInput.addEventListener('change', (e) => handleFileChange(e, 'woltImageData', 'woltImageFileName', woltImageFileName, 'image'));
    
    if (splitModeEnabled) {
      splitModeEnabled.addEventListener('change', () => {
        saveSplitSettingsAndApply();
        toggleEditorControls();
      });
    }
    
    if (testAlertBtn) testAlertBtn.addEventListener('click', handleTestAlert);
    
    if (editorMainTitle) editorMainTitle.addEventListener('input', debounce(autoSaveEditor, 500));
    if (editorSubTitle) editorSubTitle.addEventListener('input', debounce(autoSaveEditor, 500));
    if (editorBrandTag) editorBrandTag.addEventListener('input', debounce(autoSaveEditor, 500));
    if (editorCounterLabel) editorCounterLabel.addEventListener('input', debounce(autoSaveEditor, 500));
    if (editorEmphasisAnim) editorEmphasisAnim.addEventListener('change', autoSaveEditor);
    
    if (woltMainTitle) woltMainTitle.addEventListener('input', debounce(autoSaveEditor, 500));
    if (woltSubTitle) woltSubTitle.addEventListener('input', debounce(autoSaveEditor, 500));
    if (woltBrandTag) woltBrandTag.addEventListener('input', debounce(autoSaveEditor, 500));
    if (woltCounterLabel) woltCounterLabel.addEventListener('input', debounce(autoSaveEditor, 500));
    
    if (editorResetBtn) editorResetBtn.addEventListener('click', handleEditorReset);
  }
  
  function setupEditorGrids() {
    const positionButtons = document.querySelectorAll('.position-btn');
    positionButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const position = btn.dataset.position;
        
        positionButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        currentPosition = position;
        autoSaveEditor();
      });
    });
    
    const sizeButtons = document.querySelectorAll('.size-btn');
    sizeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const size = btn.dataset.size;
        
        sizeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        currentFontSize = size;
        autoSaveEditor();
      });
    });
  }
  
  function setupSplitControl() {
    if (!monitorDivider || !monitorFrame || !monitorLeft) return;
    
    let isDragging = false;
    
    const startDrag = (e) => {
      isDragging = true;
      monitorDivider.classList.add('dragging');
      e.preventDefault();
    };
    
    const doDrag = (e) => {
      if (!isDragging) return;
      
      const rect = monitorFrame.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = clientX - rect.left;
      const percentage = Math.max(20, Math.min(80, (x / rect.width) * 100));
      
      currentSplitRatio = Math.round(percentage);
      updateSplitVisual(currentSplitRatio);
      
      sendSplitPreview(currentSplitRatio);
    };
    
    const endDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      monitorDivider.classList.remove('dragging');
      
      saveSplitSettingsAndApply();
    };
    
    monitorDivider.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', endDrag);
    
    monitorDivider.addEventListener('touchstart', startDrag);
    document.addEventListener('touchmove', doDrag);
    document.addEventListener('touchend', endDrag);
  }
  
  function updateSplitVisual(ratio) {
    if (monitorLeft) {
      monitorLeft.style.width = `${ratio}%`;
    }
    if (splitRatioLeft) {
      splitRatioLeft.textContent = String(Math.round(ratio));
    }
    if (splitRatioRight) {
      splitRatioRight.textContent = String(Math.round(100 - ratio));
    }
  }
  
  async function sendSplitPreview(ratio) {
    try {
      const tabs = await chrome.tabs.query({ url: 'https://launchpad.elkjop.com/*' });
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'previewSplit', 
          data: { splitRatio: ratio } 
        }).catch(() => {});
      }
    } catch (e) {
    }
  }
  
  async function saveSplitSettingsAndApply() {
    try {
      await saveSplitSettings();
      
      const tabs = await chrome.tabs.query({ url: 'https://launchpad.elkjop.com/*' });
      for (const tab of tabs) {
        await chrome.tabs.sendMessage(tab.id, { 
          action: 'applySplit', 
          data: { 
            splitRatio: currentSplitRatio,
            splitModeEnabled: splitModeEnabled?.checked || false
          } 
        });
      }
    } catch (e) {
    }
  }
  
  function toggleEditorControls() {
    const isSplitMode = splitModeEnabled?.checked || false;
    const muokkaaTab = document.querySelector('.tab-btn[data-tab="editor"]');
    if (muokkaaTab) {
      muokkaaTab.style.display = isSplitMode ? 'none' : '';
    }
    const positionSection = document.querySelector('.position-grid')?.parentElement;
    const sizeSection = document.querySelector('.size-selector')?.parentElement;
    
    if (positionSection) {
      const positionTitle = positionSection.querySelector('.section-title');
      const positionDesc = positionSection.querySelector('.section-desc');
      const positionGrid = positionSection.querySelector('.position-grid');
      const divider = positionSection.querySelector('.editor-divider');
      
      if (isSplitMode) {
        if (positionTitle) positionTitle.style.display = 'none';
        if (positionDesc) positionDesc.style.display = 'none';
        if (positionGrid) positionGrid.style.display = 'none';
        if (divider) divider.style.display = 'none';
      } else {
        if (positionTitle) positionTitle.style.display = '';
        if (positionDesc) positionDesc.style.display = '';
        if (positionGrid) positionGrid.style.display = '';
        if (divider) divider.style.display = '';
      }
    }
    
    if (sizeSection) {
      const sizeTitle = Array.from(sizeSection.querySelectorAll('.section-title')).find(el => el.textContent.includes('Koko'));
      const sizeSelector = sizeSection.querySelector('.size-selector');
      const divider = sizeSelector?.nextElementSibling;
      
      if (isSplitMode) {
        if (sizeTitle) sizeTitle.style.display = 'none';
        if (sizeSelector) sizeSelector.style.display = 'none';
        if (divider && divider.classList.contains('editor-divider')) divider.style.display = 'none';
      } else {
        if (sizeTitle) sizeTitle.style.display = '';
        if (sizeSelector) sizeSelector.style.display = '';
        if (divider && divider.classList.contains('editor-divider')) divider.style.display = '';
      }
    }
  }
  
  function setupTabNavigation() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');
    
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        

        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanels.forEach(p => p.classList.remove('active'));
        
        btn.classList.add('active');
        const targetPanel = document.querySelector(`[data-panel="${targetTab}"]`);
        if (targetPanel) targetPanel.classList.add('active');
      });
    });
  }
  
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }


  async function loadEditorSettings() {
    try {
      const settings = await chrome.storage.local.get(['alertOverlay', 'woltOverlay']);
      const alertOverlay = settings.alertOverlay || DEFAULT_ALERT_OVERLAY;
      const woltOverlay = settings.woltOverlay || DEFAULT_WOLT_OVERLAY;
      
      currentPosition = alertOverlay.position || 'center';
      currentFontSize = alertOverlay.fontSize || 'large';
      
      const positionButtons = document.querySelectorAll('.position-btn');
      positionButtons.forEach(btn => {
        if (btn.dataset.position === currentPosition) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      
      const sizeButtons = document.querySelectorAll('.size-btn');
      sizeButtons.forEach(btn => {
        if (btn.dataset.size === currentFontSize) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      
      if (editorMainTitle) editorMainTitle.value = alertOverlay.mainTitle || '';
      if (editorSubTitle) editorSubTitle.value = alertOverlay.subTitle || '';
      if (editorBrandTag) editorBrandTag.value = alertOverlay.brandTag || '';
      if (editorCounterLabel) editorCounterLabel.value = alertOverlay.counterLabel || '';
      if (editorEmphasisAnim) editorEmphasisAnim.checked = alertOverlay.emphasisAnim || false;
      
      if (woltMainTitle) woltMainTitle.value = woltOverlay.mainTitle || '';
      if (woltSubTitle) woltSubTitle.value = woltOverlay.subTitle || '';
      if (woltBrandTag) woltBrandTag.value = woltOverlay.brandTag || '';
      if (woltCounterLabel) woltCounterLabel.value = woltOverlay.counterLabel || '';
      
    } catch (error) {
      console.error('Popup: Failed to load editor settings:', error);
    }
  }
  
  async function autoSaveEditor() {
    try {
      const alertOverlay = {
        position: currentPosition,
        fontSize: currentFontSize,
        mainTitle: editorMainTitle?.value || '',
        subTitle: editorSubTitle?.value || '',
        brandTag: editorBrandTag?.value || '',
        counterLabel: editorCounterLabel?.value || '',
        emphasisAnim: editorEmphasisAnim?.checked || false
      };
      
      const woltOverlay = {
        position: currentPosition,
        fontSize: currentFontSize,
        mainTitle: woltMainTitle?.value || '',
        subTitle: woltSubTitle?.value || '',
        brandTag: woltBrandTag?.value || '',
        counterLabel: woltCounterLabel?.value || '',
        emphasisAnim: editorEmphasisAnim?.checked || false
      };
      
      await chrome.storage.local.set({ alertOverlay, woltOverlay });
      
    } catch (error) {
      console.error('Popup: Failed to auto-save editor settings:', error);
    }
  }
  
  async function loadWoltSettings() {
    try {
      const settings = await chrome.storage.local.get([
        'woltSoundFileName', 'woltImageFileName'
      ]);
      
      if (woltSoundFileName && settings.woltSoundFileName) {
        woltSoundFileName.textContent = settings.woltSoundFileName;
      }
      if (woltImageFileName && settings.woltImageFileName) {
        woltImageFileName.textContent = settings.woltImageFileName;
      }
    } catch (error) {
      console.error('Popup: Failed to load Wolt settings:', error);
    }
  }

  async function loadSplitSettings() {
    try {
      const settings = await chrome.storage.local.get(['splitRatio', 'splitModeEnabled']);
      
      currentSplitRatio = settings.splitRatio || 50;
      updateSplitVisual(currentSplitRatio);
      
      if (splitModeEnabled) splitModeEnabled.checked = settings.splitModeEnabled || false;
    } catch (error) {
      console.error('Popup: Failed to load split settings:', error);
    }
  }

  async function saveSplitSettings() {
    try {
      const settings = {
        splitRatio: currentSplitRatio,
        splitModeEnabled: splitModeEnabled?.checked || false
      };
      
      await chrome.storage.local.set(settings);
      
      try {
        const tabs = await chrome.tabs.query({ url: 'https://launchpad.elkjop.com/*' });
        for (const tab of tabs) {
          await chrome.tabs.sendMessage(tab.id, { action: 'updateModes', data: settings });
        }
      } catch (e) {
      }
      
      console.log('Popup: Split settings saved', settings);
    } catch (error) {
      console.error('Popup: Failed to save split settings:', error);
    }
  }

  async function handleEditorReset() {
    currentPosition = DEFAULT_ALERT_OVERLAY.position;
    currentFontSize = DEFAULT_ALERT_OVERLAY.fontSize;
    
    const positionButtons = document.querySelectorAll('.position-btn');
    positionButtons.forEach(btn => {
      if (btn.dataset.position === currentPosition) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    
    const sizeButtons = document.querySelectorAll('.size-btn');
    sizeButtons.forEach(btn => {
      if (btn.dataset.size === currentFontSize) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    
    if (editorMainTitle) editorMainTitle.value = DEFAULT_ALERT_OVERLAY.mainTitle;
    if (editorSubTitle) editorSubTitle.value = DEFAULT_ALERT_OVERLAY.subTitle;
    if (editorBrandTag) editorBrandTag.value = DEFAULT_ALERT_OVERLAY.brandTag;
    if (editorCounterLabel) editorCounterLabel.value = DEFAULT_ALERT_OVERLAY.counterLabel;
    if (editorEmphasisAnim) editorEmphasisAnim.checked = DEFAULT_ALERT_OVERLAY.emphasisAnim;
    
    if (woltMainTitle) woltMainTitle.value = DEFAULT_WOLT_OVERLAY.mainTitle;
    if (woltSubTitle) woltSubTitle.value = DEFAULT_WOLT_OVERLAY.subTitle;
    if (woltBrandTag) woltBrandTag.value = DEFAULT_WOLT_OVERLAY.brandTag;
    if (woltCounterLabel) woltCounterLabel.value = DEFAULT_WOLT_OVERLAY.counterLabel;
    
    await autoSaveEditor();
    
    if (editorResetBtn) {
      editorResetBtn.textContent = 'Palautettu!';
      setTimeout(() => { editorResetBtn.textContent = 'Palauta oletukset'; }, 1500);
    }
  }
  
  async function autoSaveSettings() {
    try {
      const pollIntervalSeconds = Math.max(1, Math.min(60, parseInt(pollIntervalInput?.value, 10) || 30));
      const alertDurationSeconds = Math.max(1, Math.min(20, parseInt(alertDurationInput?.value, 10) || 10));
      
      await chrome.storage.local.set({ 
        pollIntervalSeconds, 
        alertDurationSeconds,
        soundEnabled: soundEnabledInput?.checked || false
      });
      await chrome.runtime.sendMessage({ action: 'updateSettings' });
    } catch (e) {
      console.error('Popup: Failed to auto-save settings:', e);
    }
  }

  async function handleRefreshClick() {
    if (!refreshBtn || !statusBadge) return;
    refreshBtn.disabled = true;
    statusBadge.textContent = '...';
    statusBadge.className = 'badge badge-checking';
    
    try {
      await chrome.runtime.sendMessage({ action: 'checkNow' });
      await new Promise(r => setTimeout(r, 1000));
      await loadState();
      statusBadge.textContent = 'OK';
      statusBadge.className = 'badge badge-success';
    } catch (e) {
      statusBadge.textContent = 'Virhe';
      statusBadge.className = 'badge badge-error';
    }
    refreshBtn.disabled = false;
  }

  async function handleTestAlert() {
    const btn = document.getElementById('test-alert');
    if (btn) btn.disabled = true;
    
    try {
      const tabs = await chrome.tabs.query({ url: 'https://launchpad.elkjop.com/*' });
      const settings = await chrome.storage.local.get(['alertOverlay', 'woltOverlay', 'splitModeEnabled']);
      const isSplitMode = settings.splitModeEnabled || false;
      
      if (tabs.length > 0) {
        console.log('Test Alert - Split mode:', isSplitMode);
        console.log('Test Alert - woltOverlay:', settings.woltOverlay);
        console.log('Test Alert - alertOverlay:', settings.alertOverlay);
        
        if (isSplitMode) {
          const [woltSoundData, woltVideoData, woltImageData] = await Promise.all([
            MediaDB.getMediaAsDataURL('woltSoundData'),
            MediaDB.getMediaAsDataURL('woltVideoData'),
            MediaDB.getMediaAsDataURL('woltImageData')
          ]);
          
          await chrome.tabs.sendMessage(tabs[0].id, {
            action: 'showAlert',
            data: {
              count: 3,
              orderType: 'wolt',
              soundData: woltSoundData,
              videoData: woltVideoData,
              imageData: woltImageData,
              alertOverlay: settings.alertOverlay || DEFAULT_ALERT_OVERLAY,
              woltOverlay: settings.woltOverlay || DEFAULT_WOLT_OVERLAY
            }
          });
          
          await new Promise(r => setTimeout(r, 12000));
          
          const [soundData, videoData, imageData] = await Promise.all([
            MediaDB.getMediaAsDataURL('soundData'),
            MediaDB.getMediaAsDataURL('videoData'),
            MediaDB.getMediaAsDataURL('imageData')
          ]);
          
          await chrome.tabs.sendMessage(tabs[0].id, {
            action: 'showAlert',
            data: {
              count: 5,
              soundData: soundData,
              videoData: videoData,
              imageData: imageData,
              alertOverlay: settings.alertOverlay || DEFAULT_ALERT_OVERLAY,
              woltOverlay: settings.woltOverlay || DEFAULT_WOLT_OVERLAY
            }
          });
        } else {
          const [soundData, videoData, imageData] = await Promise.all([
            MediaDB.getMediaAsDataURL('soundData'),
            MediaDB.getMediaAsDataURL('videoData'),
            MediaDB.getMediaAsDataURL('imageData')
          ]);
          
          await chrome.tabs.sendMessage(tabs[0].id, {
            action: 'showAlert',
            data: {
              count: 5,
              soundData: soundData,
              videoData: videoData,
              imageData: imageData,
              alertOverlay: settings.alertOverlay || DEFAULT_ALERT_OVERLAY,
              woltOverlay: settings.woltOverlay || DEFAULT_WOLT_OVERLAY
            }
          });
        }
        
        chrome.tabs.update(tabs[0].id, { active: true });
      } else {
        console.log('No SAP tab found, isSplitMode:', isSplitMode);
        const url = isSplitMode ? 'alert.html?split=true' : 'alert.html';
        await chrome.tabs.create({ url });
      }
      
    } catch (error) {
      console.error('Test failed:', error);
      alert('Testi epäonnistui: ' + error.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

})();
