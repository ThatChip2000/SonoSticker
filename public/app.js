const state = {
  waStatus: null,
  activeTab: 'video',
  videoFile: null,
  imageFile: null,
  audioFile: null,
  videoObjectUrl: null,
  imageObjectUrl: null,
  audioObjectUrl: null,
  currentPreview: null,
  loopMonitor: {
    video: null,
    audio: null,
  },
};

const $ = (id) => document.getElementById(id);

let toastTimer = null;
function showToast(message, type = 'success') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 5000);
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function setupDropzone(zoneEl, inputEl, onFile) {
  zoneEl.addEventListener('click', () => inputEl.click());
  zoneEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputEl.click();
    }
  });
  zoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    zoneEl.classList.add('drag-over');
  });
  zoneEl.addEventListener('dragleave', () => {
    zoneEl.classList.remove('drag-over');
  });
  zoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    zoneEl.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
  inputEl.addEventListener('change', () => {
    const file = inputEl.files?.[0];
    if (file) onFile(file);
  });
}

function bindRangeAndNumber(rangeEl, numEl, onChange) {
  rangeEl.addEventListener('input', () => {
    numEl.value = rangeEl.value;
    onChange?.(Number(rangeEl.value));
  });
  numEl.addEventListener('input', () => {
    const val = Number(numEl.value);
    if (Number.isFinite(val)) {
      rangeEl.value = String(Math.min(Number(rangeEl.max), Math.max(Number(rangeEl.min), val)));
      onChange?.(val);
    }
  });
}

function setupQuickPills(targetName, rangeEl, numEl) {
  const container = document.querySelector(`.quick-pills[data-target="${targetName}"]`);
  if (!container) return;
  const syncActive = (val) => {
    for (const btn of container.querySelectorAll('.pill-btn')) {
      btn.classList.toggle('active', Number(btn.dataset.val) === Number(val));
    }
  };
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.pill-btn');
    if (!btn) return;
    const val = Number(btn.dataset.val);
    rangeEl.value = String(val);
    numEl.value = String(val);
    syncActive(val);
  });
  rangeEl.addEventListener('input', () => syncActive(rangeEl.value));
  numEl.addEventListener('input', () => syncActive(numEl.value));
}

function stopSegmentLoop(kind) {
  const mediaEl = kind === 'video' ? $('videoPlayer') : $('audioPlayer');
  if (state.loopMonitor[kind]) {
    mediaEl.removeEventListener('timeupdate', state.loopMonitor[kind]);
    state.loopMonitor[kind] = null;
  }
}

function playSegmentLoop(kind, startSec, durationSec) {
  const mediaEl = kind === 'video' ? $('videoPlayer') : $('audioPlayer');
  if (!mediaEl.src) {
    showToast('Primero carga un archivo para reproducir el tramo.', 'error');
    return;
  }
  stopSegmentLoop(kind);

  const start = Math.max(0, Number(startSec) || 0);
  const end = start + Math.max(0.5, Number(durationSec) || 1);

  const onTimeUpdate = () => {
    if (mediaEl.currentTime >= end || mediaEl.currentTime < start - 0.15) {
      mediaEl.currentTime = start;
    }
  };
  state.loopMonitor[kind] = onTimeUpdate;
  mediaEl.addEventListener('timeupdate', onTimeUpdate);
  mediaEl.currentTime = start;
  mediaEl.play().catch(() => {});
}

function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  for (const btn of tabBtns) {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      state.activeTab = target;
      for (const b of tabBtns) {
        const active = b.dataset.tab === target;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      }
      for (const p of panels) {
        p.classList.toggle('active', p.dataset.panel === target);
      }
    });
  }
}

function setupVideoTab() {
  const player = $('videoPlayer');
  const fitSelect = $('videoFitMode');
  const startRange = $('videoStartRange');
  const startNum = $('videoStartNum');
  const durRange = $('videoDurationRange');
  const durNum = $('videoDurationNum');

  bindRangeAndNumber(startRange, startNum);
  bindRangeAndNumber(durRange, durNum);
  setupQuickPills('videoDuration', durRange, durNum);

  $('videoFpsRange').addEventListener('input', (e) => {
    $('videoFpsVal').textContent = `${e.target.value} fps`;
  });
  $('videoQualityRange').addEventListener('input', (e) => {
    $('videoQualityVal').textContent = `${e.target.value}%`;
  });
  $('videoVolumeRange').addEventListener('input', (e) => {
    $('videoVolumeVal').textContent = `${e.target.value}%`;
  });

  const syncFitClass = () => {
    player.className = fitSelect.value === 'contain' ? 'contain-fit' : 'cover-fit';
  };
  syncFitClass();
  fitSelect.addEventListener('change', syncFitClass);

  setupDropzone($('videoDropzone'), $('videoFileInput'), (file) => {
    stopSegmentLoop('video');
    state.videoFile = file;
    $('videoFileName').textContent = `${file.name} (${formatKB(file.size)})`;
    if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
    state.videoObjectUrl = URL.createObjectURL(file);
    player.src = state.videoObjectUrl;
    $('videoEditorBody').classList.remove('hidden');
  });

  player.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(player.duration) && player.duration > 0) {
      const maxStart = Math.max(0, Number((player.duration - 0.5).toFixed(1)));
      startRange.max = String(maxStart);
      startNum.max = String(player.duration.toFixed(1));
      if (Number(startNum.value) > maxStart) {
        startRange.value = '0';
        startNum.value = '0';
      }
    }
  });

  $('videoUseCurrentBtn').addEventListener('click', () => {
    const t = Number(player.currentTime.toFixed(1));
    startRange.value = String(Math.min(Number(startRange.max), t));
    startNum.value = String(t);
  });

  $('videoLoopBtn').addEventListener('click', () => {
    playSegmentLoop('video', startNum.value, durNum.value);
  });

  $('videoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.videoFile) {
      showToast('Sube un video primero.', 'error');
      return;
    }

    const btn = $('videoGenerateBtn');
    btn.disabled = true;
    btn.textContent = 'Procesando video con FFmpeg...';

    try {
      const formData = new FormData();
      formData.append('video', state.videoFile);
      formData.append('startSec', startNum.value);
      formData.append('durationSec', durNum.value);
      formData.append('fitMode', fitSelect.value);
      formData.append('fps', $('videoFpsRange').value);
      formData.append('webpQuality', $('videoQualityRange').value);
      formData.append('audioBitrateKbps', $('videoAudioBitrate').value);
      formData.append('audioVolume', String(Number($('videoVolumeRange').value) / 100));
      formData.append('autoFitLimit', String($('videoAutoFit').checked));

      const res = await fetch('/api/preview/video', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo procesar el video.');

      renderGeneratedPreview(data);
      showToast('Vista previa generada.');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generar vista previa y calcular peso';
    }
  });
}

function setupImageAudioTab() {
  const imgEl = $('staticImagePreview');
  const imgPlaceholder = $('staticImagePlaceholder');
  const audioEl = $('audioPlayer');
  const fitSelect = $('staticFitMode');
  const startRange = $('audioStartRange');
  const startNum = $('audioStartNum');
  const durRange = $('audioDurationRange');
  const durNum = $('audioDurationNum');

  bindRangeAndNumber(startRange, startNum);
  bindRangeAndNumber(durRange, durNum);
  setupQuickPills('audioDuration', durRange, durNum);

  $('staticQualityRange').addEventListener('input', (e) => {
    $('staticQualityVal').textContent = `${e.target.value}%`;
  });
  $('staticVolumeRange').addEventListener('input', (e) => {
    $('staticVolumeVal').textContent = `${e.target.value}%`;
  });

  const syncFitClass = () => {
    imgEl.classList.toggle('contain-fit', fitSelect.value === 'contain');
    imgEl.classList.toggle('cover-fit', fitSelect.value === 'cover');
  };
  fitSelect.addEventListener('change', syncFitClass);

  setupDropzone($('imageDropzone'), $('imageFileInput'), (file) => {
    state.imageFile = file;
    $('imageFileName').textContent = `${file.name} (${formatKB(file.size)})`;
    if (state.imageObjectUrl) URL.revokeObjectURL(state.imageObjectUrl);
    state.imageObjectUrl = URL.createObjectURL(file);
    imgEl.src = state.imageObjectUrl;
    imgEl.classList.remove('hidden');
    imgPlaceholder.classList.add('hidden');
  });

  setupDropzone($('audioDropzone'), $('audioFileInput'), (file) => {
    stopSegmentLoop('audio');
    state.audioFile = file;
    $('audioFileName').textContent = `${file.name} (${formatKB(file.size)})`;
    if (state.audioObjectUrl) URL.revokeObjectURL(state.audioObjectUrl);
    state.audioObjectUrl = URL.createObjectURL(file);
    audioEl.src = state.audioObjectUrl;
  });

  audioEl.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
      const maxStart = Math.max(0, Number((audioEl.duration - 0.5).toFixed(1)));
      startRange.max = String(maxStart);
      startNum.max = String(audioEl.duration.toFixed(1));
      if (Number(startNum.value) > maxStart) {
        startRange.value = '0';
        startNum.value = '0';
      }
    }
  });

  $('audioUseCurrentBtn').addEventListener('click', () => {
    const t = Number(audioEl.currentTime.toFixed(1));
    startRange.value = String(Math.min(Number(startRange.max), t));
    startNum.value = String(t);
  });

  $('audioLoopBtn').addEventListener('click', () => {
    playSegmentLoop('audio', startNum.value, durNum.value);
  });

  $('imageAudioForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.imageFile || !state.audioFile) {
      showToast('Sube tanto la imagen como el archivo de audio o video.', 'error');
      return;
    }

    const btn = $('staticGenerateBtn');
    btn.disabled = true;
    btn.textContent = 'Procesando imagen y audio...';

    try {
      const formData = new FormData();
      formData.append('image', state.imageFile);
      formData.append('audio', state.audioFile);
      formData.append('fitMode', fitSelect.value);
      formData.append('webpQuality', $('staticQualityRange').value);
      formData.append('audioStartSec', startNum.value);
      formData.append('audioDurationSec', durNum.value);
      formData.append('audioBitrateKbps', $('staticAudioBitrate').value);
      formData.append('audioVolume', String(Number($('staticVolumeRange').value) / 100));
      formData.append('autoFitLimit', String($('staticAutoFit').checked));

      const res = await fetch('/api/preview/image-audio', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo procesar imagen y audio.');

      renderGeneratedPreview(data);
      showToast('Vista previa generada.');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generar vista previa y calcular peso';
    }
  });
}

function renderGeneratedPreview(data) {
  state.currentPreview = data;
  const cacheBust = `?t=${Date.now()}`;

  const genImg = $('generatedWebpImg');
  const genAudio = $('generatedAudioPlayer');
  const speakerBtn = $('playGeneratedAudioBtn');

  genAudio.pause();
  speakerBtn.classList.remove('playing');

  genImg.src = `${data.webpUrl}${cacheBust}`;
  genAudio.src = `${data.audioUrl}${cacheBust}`;

  $('outputEmptyState').classList.add('hidden');
  $('outputResultState').classList.remove('hidden');
  $('metricsBox').classList.remove('hidden');

  const webpBadge = $('webpSizeBadge');
  webpBadge.textContent = `${formatKB(data.webpSizeBytes)} / ${formatKB(data.limitBytes)}`;
  webpBadge.className = `size-badge ${data.withinLimit ? 'size-ok' : 'size-over'}`;

  $('audioSizeBadge').textContent = `${formatKB(data.audioSizeBytes)} · ${data.durationSec}s`;

  const appliedEl = $('appliedSettingsRow');
  const s = data.appliedSettings || {};
  const parts = [];
  if (s.fps) parts.push(`FPS: ${s.fps}`);
  if (s.webpQuality) parts.push(`Calidad WebP: ${s.webpQuality}%`);
  if (s.audioBitrateKbps) parts.push(`Audio: ${s.audioBitrateKbps} kbps`);
  if (parts.length > 0) {
    appliedEl.textContent = `Ajustes aplicados: ${parts.join(' · ')}`;
    appliedEl.classList.remove('hidden');
  }

  const dlWebp = $('downloadWebpLink');
  const dlOgg = $('downloadOggLink');
  dlWebp.href = `${data.webpUrl}?download=1`;
  dlOgg.href = `${data.audioUrl}?download=1`;
  dlWebp.classList.remove('disabled-link');
  dlOgg.classList.remove('disabled-link');

  updateSendButtonState();
}

function setupOutputControls() {
  const bubble = $('waStickerBubble');
  const genAudio = $('generatedAudioPlayer');
  const speakerBtn = $('playGeneratedAudioBtn');

  const togglePlay = () => {
    if (!genAudio.src) return;
    if (genAudio.paused) {
      genAudio.currentTime = 0;
      genAudio.play().catch(() => {});
    } else {
      genAudio.pause();
    }
  };

  bubble.addEventListener('click', togglePlay);
  speakerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlay();
  });

  genAudio.addEventListener('play', () => speakerBtn.classList.add('playing'));
  genAudio.addEventListener('pause', () => speakerBtn.classList.remove('playing'));
  genAudio.addEventListener('ended', () => speakerBtn.classList.remove('playing'));

  for (const radio of document.querySelectorAll('input[name="recipientMode"]')) {
    radio.addEventListener('change', () => {
      $('customRecipientWrap').classList.toggle('hidden', radio.value !== 'custom' || !radio.checked);
    });
  }

  $('sendWaBtn').addEventListener('click', async () => {
    if (!state.currentPreview) return;

    const mode = document.querySelector('input[name="recipientMode"]:checked')?.value || 'self';
    const recipient = mode === 'custom' ? $('customRecipientInput').value.trim() : '';

    if (mode === 'custom' && !recipient) {
      showToast('Ingresa un número destino con código de país.', 'error');
      return;
    }

    const btn = $('sendWaBtn');
    btn.disabled = true;
    btn.textContent = 'Enviando a WhatsApp...';

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previewId: state.currentPreview.id,
          recipient,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar el sticker.');

      showToast(`Sticker enviado (${data.messageId})`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      updateSendButtonState();
      btn.textContent = 'Enviar a WhatsApp';
    }
  });
}

function updateSendButtonState() {
  const ready = Boolean(state.currentPreview) && state.waStatus?.status === 'open';
  $('sendWaBtn').disabled = !ready;
}

async function pollWhatsAppStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    state.waStatus = data;

    const badge = $('waStatusBadge');
    const qrBtn = $('openQrBtn');
    const logoutBtn = $('logoutBtn');
    const qrModal = $('qrModal');

    if (data.status === 'open') {
      const who = data.user?.name ? ` (${data.user.name})` : '';
      badge.textContent = `🟢 Conectado${who}`;
      badge.className = 'status-pill status-open';
      qrBtn.classList.add('hidden');
      logoutBtn.classList.remove('hidden');
      qrModal.classList.add('hidden');
    } else if (data.status === 'qr' && data.qrDataUrl) {
      badge.textContent = '🟡 Escanea el QR';
      badge.className = 'status-pill status-qr';
      $('qrImage').src = data.qrDataUrl;
      qrBtn.classList.remove('hidden');
      logoutBtn.classList.add('hidden');
    } else if (data.status === 'connecting') {
      badge.textContent = '🟡 Conectando...';
      badge.className = 'status-pill status-connecting';
      qrBtn.classList.add('hidden');
      logoutBtn.classList.add('hidden');
    } else {
      badge.textContent = data.skipped ? '⚪ WhatsApp desactivado' : '🔴 Desconectado';
      badge.className = 'status-pill status-disconnected';
      qrBtn.classList.add('hidden');
      logoutBtn.classList.add('hidden');
    }

    updateSendButtonState();
  } catch {
    // Ignore transient network errors while polling.
  }
}

function setupModalControls() {
  $('openQrBtn').addEventListener('click', () => {
    $('qrModal').classList.remove('hidden');
  });
  $('closeQrBtn').addEventListener('click', () => {
    $('qrModal').classList.add('hidden');
  });
  $('qrModal').addEventListener('click', (e) => {
    if (e.target === $('qrModal')) $('qrModal').classList.add('hidden');
  });

  $('logoutBtn').addEventListener('click', async () => {
    try {
      await fetch('/api/whatsapp/logout', { method: 'POST' });
      showToast('Sesión desvinculada. Escanea el nuevo QR.');
      await pollWhatsAppStatus();
      if (state.waStatus?.qrDataUrl) {
        $('qrModal').classList.remove('hidden');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

setupTabs();
setupVideoTab();
setupImageAudioTab();
setupOutputControls();
setupModalControls();
pollWhatsAppStatus();
setInterval(pollWhatsAppStatus, 2500);
