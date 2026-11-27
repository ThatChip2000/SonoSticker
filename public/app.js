const state = {
  waStatus: null,
  activeTab: 'video',
  videoFile: null,
  videoIsGif: false,
  videoCustomAudioFile: null,
  imageFile: null,
  audioFile: null,
  videoObjectUrl: null,
  videoCustomAudioObjectUrl: null,
  imageObjectUrl: null,
  audioObjectUrl: null,
  currentPreview: null,
  loopMonitor: {
    video: null,
    customAudio: null,
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

async function parseJsonResponse(res, fallbackMsg) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(res.ok ? 'Respuesta inválida del servidor.' : `${fallbackMsg} (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data?.error || fallbackMsg);
  }
  return data;
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
    inputEl.value = '';
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

function getLoopMediaEl(kind) {
  if (kind === 'video') return $('videoPlayer');
  if (kind === 'customAudio') return $('videoCustomAudioPlayer');
  return $('audioPlayer');
}

function getLoopButtonInfo(kind) {
  if (kind === 'video') {
    return { btnId: 'videoLoopBtn', label: 'Reproducir tramo en loop' };
  }
  if (kind === 'customAudio') {
    return { btnId: 'videoCustomAudioLoopBtn', label: 'Reproducir tramo de audio en loop' };
  }
  return { btnId: 'audioLoopBtn', label: 'Reproducir tramo en loop' };
}

function stopSegmentLoop(kind, { pauseMedia = false } = {}) {
  const mediaEl = getLoopMediaEl(kind);
  const monitor = state.loopMonitor[kind];
  if (monitor) {
    mediaEl.removeEventListener('timeupdate', monitor.onTimeUpdate);
    mediaEl.removeEventListener('ended', monitor.onEnded);
    mediaEl.removeEventListener('pause', monitor.onPause);
    state.loopMonitor[kind] = null;
  }
  const { btnId, label } = getLoopButtonInfo(kind);
  const btn = $(btnId);
  if (btn) btn.textContent = label;
  if (pauseMedia) {
    mediaEl.pause();
  }
}

function playSegmentLoop(kind, startSec, durationSec) {
  const mediaEl = getLoopMediaEl(kind);
  if (!mediaEl.src) {
    showToast('Primero carga un archivo para reproducir el tramo.', 'error');
    return;
  }

  if (state.loopMonitor[kind]) {
    stopSegmentLoop(kind, { pauseMedia: true });
    return;
  }

  const start = Math.max(0, Number(startSec) || 0);
  const dur = Math.max(0.5, Number(durationSec) || 1);
  let end = start + dur;
  if (Number.isFinite(mediaEl.duration) && mediaEl.duration > 0) {
    end = Math.min(end, Math.max(start + 0.1, mediaEl.duration - 0.05));
  }

  const onTimeUpdate = () => {
    if (mediaEl.currentTime >= end || mediaEl.currentTime < start - 0.2) {
      mediaEl.currentTime = start;
    }
  };
  const onEnded = () => {
    if (!state.loopMonitor[kind]) return;
    mediaEl.currentTime = start;
    mediaEl.play().catch(() => {});
  };
  const onPause = () => {
    if (!mediaEl.ended) {
      stopSegmentLoop(kind);
    }
  };

  state.loopMonitor[kind] = { onTimeUpdate, onEnded, onPause };
  mediaEl.addEventListener('timeupdate', onTimeUpdate);
  mediaEl.addEventListener('ended', onEnded);
  mediaEl.addEventListener('pause', onPause);

  const { btnId } = getLoopButtonInfo(kind);
  const btn = $(btnId);
  if (btn) btn.textContent = 'Detener loop';

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

      stopSegmentLoop('video');
      stopSegmentLoop('customAudio');
      stopSegmentLoop('audio');
      $('videoPlayer').pause();
      $('videoCustomAudioPlayer').pause();
      $('audioPlayer').pause();

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
  const gifPlayer = $('gifPlayer');
  const fitSelect = $('videoFitMode');
  const startRange = $('videoStartRange');
  const startNum = $('videoStartNum');
  const durRange = $('videoDurationRange');
  const durNum = $('videoDurationNum');

  const customAudioPlayer = $('videoCustomAudioPlayer');
  const customAudioStartRange = $('videoCustomAudioStartRange');
  const customAudioStartNum = $('videoCustomAudioStartNum');
  const customAudioDurRange = $('videoCustomAudioDurationRange');
  const customAudioDurNum = $('videoCustomAudioDurationNum');

  bindRangeAndNumber(startRange, startNum);
  bindRangeAndNumber(durRange, durNum);
  setupQuickPills('videoDuration', durRange, durNum);
  bindRangeAndNumber(customAudioStartRange, customAudioStartNum);
  bindRangeAndNumber(customAudioDurRange, customAudioDurNum);

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
    const cls = fitSelect.value === 'contain' ? 'contain-fit' : 'cover-fit';
    player.classList.toggle('contain-fit', cls === 'contain-fit');
    player.classList.toggle('cover-fit', cls === 'cover-fit');
    gifPlayer.classList.toggle('contain-fit', cls === 'contain-fit');
    gifPlayer.classList.toggle('cover-fit', cls === 'cover-fit');
  };
  syncFitClass();
  fitSelect.addEventListener('change', syncFitClass);

  const clearCustomAudio = () => {
    stopSegmentLoop('customAudio');
    state.videoCustomAudioFile = null;
    $('videoCustomAudioInput').value = '';
    if (state.videoCustomAudioObjectUrl) {
      URL.revokeObjectURL(state.videoCustomAudioObjectUrl);
      state.videoCustomAudioObjectUrl = null;
    }
    customAudioPlayer.pause();
    customAudioPlayer.removeAttribute('src');
    $('videoCustomAudioName').textContent = 'Haz clic o arrastra un audio distinto (opcional)';
    $('videoCustomAudioControls').classList.add('hidden');
    $('clearVideoCustomAudioBtn').classList.add('hidden');
    if (!state.videoIsGif) {
      $('videoMuteOriginalWrap').classList.remove('hidden');
    }
  };

  setupDropzone($('videoDropzone'), $('videoFileInput'), (file) => {
    stopSegmentLoop('video');
    state.videoFile = file;
    state.videoIsGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
    $('videoFileName').textContent = `${file.name} (${formatKB(file.size)})`;
    $('videoMuteOriginal').checked = false;
    if (!state.videoIsGif && state.videoCustomAudioFile) {
      clearCustomAudio();
    }
    if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
    state.videoObjectUrl = URL.createObjectURL(file);

    if (state.videoIsGif) {
      player.pause();
      player.removeAttribute('src');
      player.classList.add('hidden');
      gifPlayer.src = state.videoObjectUrl;
      gifPlayer.classList.remove('hidden');
      $('videoStartGroup').classList.add('hidden');
      $('videoUseCurrentBtn').classList.add('hidden');
      $('videoLoopBtn').classList.add('hidden');
      $('videoMuteOriginalWrap').classList.add('hidden');
      startRange.value = '0';
      startNum.value = '0';
    } else {
      gifPlayer.removeAttribute('src');
      gifPlayer.classList.add('hidden');
      player.src = state.videoObjectUrl;
      player.classList.remove('hidden');
      $('videoStartGroup').classList.remove('hidden');
      $('videoUseCurrentBtn').classList.remove('hidden');
      $('videoLoopBtn').classList.remove('hidden');
      $('videoMuteOriginalWrap').classList.toggle('hidden', Boolean(state.videoCustomAudioFile));
    }

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

  $('clearVideoCustomAudioBtn').addEventListener('click', clearCustomAudio);

  setupDropzone($('videoCustomAudioDropzone'), $('videoCustomAudioInput'), (file) => {
    stopSegmentLoop('customAudio');
    state.videoCustomAudioFile = file;
    $('videoCustomAudioName').textContent = `${file.name} (${formatKB(file.size)})`;
    if (state.videoCustomAudioObjectUrl) URL.revokeObjectURL(state.videoCustomAudioObjectUrl);
    state.videoCustomAudioObjectUrl = URL.createObjectURL(file);
    customAudioPlayer.src = state.videoCustomAudioObjectUrl;
    $('videoCustomAudioControls').classList.remove('hidden');
    $('clearVideoCustomAudioBtn').classList.remove('hidden');
    $('videoMuteOriginalWrap').classList.add('hidden');
  });

  customAudioPlayer.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(customAudioPlayer.duration) && customAudioPlayer.duration > 0) {
      const maxStart = Math.max(0, Number((customAudioPlayer.duration - 0.5).toFixed(1)));
      customAudioStartRange.max = String(maxStart);
      customAudioStartNum.max = String(customAudioPlayer.duration.toFixed(1));
      if (Number(customAudioStartNum.value) > maxStart) {
        customAudioStartRange.value = '0';
        customAudioStartNum.value = '0';
      }
    }
  });

  $('videoCustomAudioUseCurrentBtn').addEventListener('click', () => {
    const t = Number(customAudioPlayer.currentTime.toFixed(1));
    customAudioStartRange.value = String(Math.min(Number(customAudioStartRange.max), t));
    customAudioStartNum.value = String(t);
  });

  $('videoCustomAudioLoopBtn').addEventListener('click', () => {
    playSegmentLoop('customAudio', customAudioStartNum.value, customAudioDurNum.value);
  });

  $('videoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.videoFile) {
      showToast('Sube un video o GIF primero.', 'error');
      return;
    }

    const btn = $('videoGenerateBtn');
    btn.disabled = true;
    btn.textContent = 'Procesando con FFmpeg...';

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
      formData.append('muteVideoAudio', String($('videoMuteOriginal').checked));
      if (state.videoCustomAudioFile) {
        formData.append('audio', state.videoCustomAudioFile);
        formData.append('audioStartSec', customAudioStartNum.value);
        formData.append('audioDurationSec', customAudioDurNum.value);
      }

      const res = await fetch('/api/preview/video', { method: 'POST', body: formData });
      const data = await parseJsonResponse(res, 'No se pudo procesar el archivo.');

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
    $('clearStaticAudioBtn').classList.remove('hidden');
  });

  $('clearStaticAudioBtn').addEventListener('click', () => {
    stopSegmentLoop('audio');
    state.audioFile = null;
    $('audioFileInput').value = '';
    if (state.audioObjectUrl) {
      URL.revokeObjectURL(state.audioObjectUrl);
      state.audioObjectUrl = null;
    }
    audioEl.pause();
    audioEl.removeAttribute('src');
    $('audioFileName').textContent = 'Sin audio crea un sticker estático normal';
    $('clearStaticAudioBtn').classList.add('hidden');
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
    if (!state.imageFile) {
      showToast('Sube una imagen primero.', 'error');
      return;
    }

    const btn = $('staticGenerateBtn');
    btn.disabled = true;
    btn.textContent = state.audioFile ? 'Procesando imagen y audio...' : 'Procesando imagen...';

    try {
      const formData = new FormData();
      formData.append('image', state.imageFile);
      if (state.audioFile) {
        formData.append('audio', state.audioFile);
        formData.append('audioStartSec', startNum.value);
        formData.append('audioDurationSec', durNum.value);
        formData.append('audioBitrateKbps', $('staticAudioBitrate').value);
        formData.append('audioVolume', String(Number($('staticVolumeRange').value) / 100));
      }
      formData.append('fitMode', fitSelect.value);
      formData.append('webpQuality', $('staticQualityRange').value);
      formData.append('autoFitLimit', String($('staticAutoFit').checked));

      const res = await fetch('/api/preview/image-audio', { method: 'POST', body: formData });
      const data = await parseJsonResponse(res, 'No se pudo procesar la imagen.');

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
  const tapHint = document.querySelector('.tap-hint');

  genAudio.pause();
  speakerBtn.classList.remove('playing');

  genImg.src = `${data.webpUrl}${cacheBust}`;

  $('outputEmptyState').classList.add('hidden');
  $('outputResultState').classList.remove('hidden');
  $('metricsBox').classList.remove('hidden');

  const webpBadge = $('webpSizeBadge');
  webpBadge.textContent = `${formatKB(data.webpSizeBytes)} / ${formatKB(data.limitBytes)}`;
  webpBadge.className = `size-badge ${data.withinLimit ? 'size-ok' : 'size-over'}`;

  const dlWebp = $('downloadWebpLink');
  const dlOgg = $('downloadOggLink');
  dlWebp.href = `${data.webpUrl}?download=1`;
  dlWebp.classList.remove('disabled-link');

  if (data.hasAudio && data.audioUrl) {
    genAudio.src = `${data.audioUrl}${cacheBust}`;
    speakerBtn.classList.remove('hidden');
    $('audioSizeBadge').textContent = `${formatKB(data.audioSizeBytes)} · ${data.durationSec}s`;
    dlOgg.href = `${data.audioUrl}?download=1`;
    dlOgg.classList.remove('disabled-link');
    tapHint.textContent = 'Toca el sticker o el botón de audio para escuchar el sonido real (.ogg)';
  } else {
    genAudio.removeAttribute('src');
    speakerBtn.classList.add('hidden');
    $('audioSizeBadge').textContent = 'Sin audio (sticker normal)';
    dlOgg.href = '#';
    dlOgg.classList.add('disabled-link');
    tapHint.textContent = 'Sticker normal sin audio (agrega un audio si quieres hacerlo Sound Sticker)';
  }

  const appliedEl = $('appliedSettingsRow');
  const s = data.appliedSettings || {};
  const parts = [];
  if (s.fps) parts.push(`FPS: ${s.fps}`);
  if (s.webpQuality) parts.push(`Calidad WebP: ${s.webpQuality}%`);
  if (s.audioBitrateKbps) parts.push(`Audio: ${s.audioBitrateKbps} kbps`);
  const summary = parts.length > 0 ? `Ajustes aplicados: ${parts.join(' · ')}` : '';
  const limitHint = !data.withinLimit
    ? `Supera el límite de WhatsApp (${formatKB(data.limitBytes)}). Activa Auto-comprimir o baja la calidad/FPS.`
    : '';
  const combined = [summary, limitHint].filter(Boolean).join(' — ');
  if (combined) {
    appliedEl.textContent = combined;
    appliedEl.classList.remove('hidden');
  } else {
    appliedEl.classList.add('hidden');
  }

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
      const data = await parseJsonResponse(res, 'No se pudo enviar el sticker.');

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
    const data = await parseJsonResponse(res, 'Error consultando estado.');
    state.waStatus = data;

    const badge = $('waStatusBadge');
    const qrBtn = $('openQrBtn');
    const reconnectBtn = $('reconnectBtn');
    const logoutBtn = $('logoutBtn');
    const qrModal = $('qrModal');

    if (data.status === 'open') {
      const who = data.user?.name ? ` (${data.user.name})` : '';
      badge.textContent = `Conectado${who}`;
      badge.className = 'status-pill status-open';
      qrBtn.classList.add('hidden');
      reconnectBtn.classList.add('hidden');
      logoutBtn.classList.remove('hidden');
      qrModal.classList.add('hidden');
    } else if (data.status === 'qr' && data.qrDataUrl) {
      badge.textContent = 'Escanea el QR';
      badge.className = 'status-pill status-qr';
      $('qrImage').src = data.qrDataUrl;
      qrBtn.classList.remove('hidden');
      reconnectBtn.classList.add('hidden');
      logoutBtn.classList.add('hidden');
    } else if (data.status === 'connecting') {
      badge.textContent = 'Conectando...';
      badge.className = 'status-pill status-connecting';
      qrBtn.classList.add('hidden');
      reconnectBtn.classList.add('hidden');
      logoutBtn.classList.add('hidden');
    } else {
      badge.textContent = data.skipped ? 'WhatsApp desactivado' : 'Desconectado';
      badge.className = 'status-pill status-disconnected';
      qrBtn.classList.add('hidden');
      reconnectBtn.classList.toggle('hidden', Boolean(data.skipped));
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

  $('reconnectBtn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/whatsapp/reconnect', { method: 'POST' });
      await parseJsonResponse(res, 'No se pudo reconectar WhatsApp.');
      await pollWhatsAppStatus();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/whatsapp/logout', { method: 'POST' });
      await parseJsonResponse(res, 'No se pudo desvincular la sesión.');
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
