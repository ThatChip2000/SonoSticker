import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);

export const ANIMATED_LIMIT_BYTES = 500 * 1024;
export const STATIC_LIMIT_BYTES = 100 * 1024;
export const AUDIO_SAFE_LIMIT_BYTES = 64 * 1024;

function clamp(val, min, max, fallback) {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function parseBool(val, fallback = false) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'off') return false;
  }
  return fallback;
}

async function runFfmpeg(args) {
  if (!ffmpegPath) {
    throw new Error('No se encontró el binario de ffmpeg-static.');
  }
  try {
    return await execFileAsync(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    const detail = err.stderr ? err.stderr.split('\n').slice(-6).join('\n') : err.message;
    throw new Error(`Error al procesar multimedia con FFmpeg: ${detail}`);
  }
}

function buildSquareScaleFilter(fitMode, fps = null) {
  const fpsPrefix = fps ? `fps=${fps},` : '';
  if (fitMode === 'contain') {
    return `${fpsPrefix}scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba`;
  }
  return `${fpsPrefix}scale=512:512:force_original_aspect_ratio=increase:flags=lanczos,crop=512:512,format=rgba`;
}

/**
 * Inspects a media file via FFmpeg stderr output to extract duration, start PTS, and streams.
 */
export async function probeMedia(filePath) {
  if (!ffmpegPath) {
    throw new Error('No se encontró el binario de ffmpeg-static.');
  }

  let output = '';
  try {
    const res = await execFileAsync(ffmpegPath, ['-i', filePath], { maxBuffer: 4 * 1024 * 1024 });
    output = `${res.stdout || ''}\n${res.stderr || ''}`;
  } catch (err) {
    // Running `ffmpeg -i <file>` without an output file intentionally exits with code 1.
    output = `${err.stdout || ''}\n${err.stderr || ''}`;
  }

  const durationMatch = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  let durationSec = null;
  if (durationMatch) {
    const hours = Number(durationMatch[1]);
    const mins = Number(durationMatch[2]);
    const secs = Number(durationMatch[3]);
    durationSec = Number((hours * 3600 + mins * 60 + secs).toFixed(2));
  }

  const startMatch = output.match(/start:\s*([-0-9.]+)/);
  const startSec = startMatch ? Number(startMatch[1]) : null;

  const hasVideo = /Stream #\d+:\d+.*Video:/i.test(output);
  const hasAudio = /Stream #\d+:\d+.*Audio:/i.test(output);

  return { durationSec, startSec, hasVideo, hasAudio };
}

/**
 * Extracts and normalizes audio to a clean WhatsApp-compatible Ogg/Opus mono stream
 * with zeroed PTS timestamps and stripped container metadata.
 */
async function encodeNormalizedOpusAudio(
  inputPath,
  audioPath,
  { startSec, durationSec, audioBitrateKbps, audioVolume, autoFitLimit }
) {
  let bitrate = audioBitrateKbps;

  const encode = async (targetBitrate) => {
    await runFfmpeg([
      '-y',
      '-ss',
      String(startSec),
      '-i',
      inputPath,
      '-t',
      String(durationSec),
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-af',
      `aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS,volume=${audioVolume}`,
      '-c:a',
      'libopus',
      '-application',
      'voip',
      '-vbr',
      'on',
      '-ar',
      '24000',
      '-ac',
      '1',
      '-b:a',
      `${targetBitrate}k`,
      '-f',
      'ogg',
      audioPath,
    ]);
    return fs.stat(audioPath);
  };

  let audioStat = await encode(bitrate);

  if (autoFitLimit && audioStat.size > AUDIO_SAFE_LIMIT_BYTES) {
    for (let attempt = 0; attempt < 3 && audioStat.size > AUDIO_SAFE_LIMIT_BYTES; attempt++) {
      bitrate = Math.max(12, bitrate - 12);
      audioStat = await encode(bitrate);
    }
  }

  if (audioStat.size < 256) {
    throw new Error('No se pudo extraer una pista de audio válida para el tramo seleccionado.');
  }

  const audioProbe = await probeMedia(audioPath);
  return {
    audioSizeBytes: audioStat.size,
    durationSec: audioProbe.durationSec ?? durationSec,
    startSec: audioProbe.startSec,
    appliedAudioBitrateKbps: bitrate,
  };
}

/**
 * Converts a trimmed video segment into a 512x512 animated WebP + Opus OGG audio pair.
 */
export async function processVideoToSoundSticker(inputPath, outputDir, options = {}) {
  const probe = await probeMedia(inputPath);
  if (!probe.hasVideo) {
    throw new Error('El archivo subido no contiene una pista de video válida.');
  }
  if (!probe.hasAudio) {
    throw new Error(
      'El video no tiene pista de audio. Usa el módulo de Imagen + Audio o sube un video con sonido.'
    );
  }

  await fs.mkdir(outputDir, { recursive: true });

  const startSec = clamp(options.startSec, 0, 36000, 0);
  if (probe.durationSec != null && startSec >= probe.durationSec - 0.1) {
    throw new Error(
      `El segundo de inicio (${startSec}s) supera la duración del video (${probe.durationSec}s).`
    );
  }
  let durationSec = clamp(options.durationSec, 0.5, 10, 5);
  if (probe.durationSec != null && probe.durationSec > startSec + 0.2) {
    const remaining = Number((probe.durationSec - startSec).toFixed(2));
    if (remaining >= 0.5) {
      durationSec = Math.min(durationSec, remaining);
    }
  }

  const fitMode = options.fitMode === 'contain' ? 'contain' : 'cover';
  let fps = Math.round(clamp(options.fps, 5, 24, 12));
  let webpQuality = Math.round(clamp(options.webpQuality, 10, 95, 55));
  const audioBitrateKbps = Math.round(clamp(options.audioBitrateKbps, 12, 96, 24));
  const audioVolume = clamp(options.audioVolume, 0.2, 2.0, 1.0);
  const autoFitLimit = parseBool(options.autoFitLimit, false);

  const webpPath = path.join(outputDir, 'sticker.webp');
  const audioPath = path.join(outputDir, 'audio.ogg');

  const encodeAnimatedWebp = async (targetFps, targetQuality) => {
    const vf = buildSquareScaleFilter(fitMode, targetFps);
    await runFfmpeg([
      '-y',
      '-ss',
      String(startSec),
      '-i',
      inputPath,
      '-t',
      String(durationSec),
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-fps_mode',
      'cfr',
      '-vf',
      vf,
      '-c:v',
      'libwebp',
      '-lossless',
      '0',
      '-compression_level',
      '4',
      '-q:v',
      String(targetQuality),
      '-loop',
      '0',
      '-preset',
      'default',
      webpPath,
    ]);
    const stat = await fs.stat(webpPath);
    return stat.size;
  };

  let webpSizeBytes = await encodeAnimatedWebp(fps, webpQuality);

  if (autoFitLimit && webpSizeBytes >= ANIMATED_LIMIT_BYTES) {
    for (let attempt = 0; attempt < 4 && webpSizeBytes >= ANIMATED_LIMIT_BYTES; attempt++) {
      webpQuality = Math.max(15, webpQuality - 15);
      fps = Math.max(6, fps - 2);
      webpSizeBytes = await encodeAnimatedWebp(fps, webpQuality);
    }
  }

  const audioResult = await encodeNormalizedOpusAudio(inputPath, audioPath, {
    startSec,
    durationSec,
    audioBitrateKbps,
    audioVolume,
    autoFitLimit,
  });

  return {
    webpPath,
    audioPath,
    webpSizeBytes,
    audioSizeBytes: audioResult.audioSizeBytes,
    durationSec: audioResult.durationSec,
    isAnimated: true,
    limitBytes: ANIMATED_LIMIT_BYTES,
    withinLimit: webpSizeBytes < ANIMATED_LIMIT_BYTES,
    appliedSettings: {
      fps,
      webpQuality,
      audioBitrateKbps: audioResult.appliedAudioBitrateKbps,
      fitMode,
    },
  };
}

/**
 * Combines a static image (512x512 WebP) and a trimmed audio track (Opus OGG) into a Sound Sticker.
 */
export async function processImageAudioToSoundSticker(imagePath, audioSourcePath, outputDir, options = {}) {
  const audioProbeInput = await probeMedia(audioSourcePath);
  if (!audioProbeInput.hasAudio) {
    throw new Error('El archivo seleccionado no contiene pista de audio.');
  }

  await fs.mkdir(outputDir, { recursive: true });

  const fitMode = options.fitMode === 'cover' ? 'cover' : 'contain';
  let webpQuality = Math.round(clamp(options.webpQuality, 10, 95, 75));
  const audioStartSec = clamp(options.audioStartSec, 0, 36000, 0);
  if (audioProbeInput.durationSec != null && audioStartSec >= audioProbeInput.durationSec - 0.1) {
    throw new Error(
      `El segundo de inicio (${audioStartSec}s) supera la duración del audio (${audioProbeInput.durationSec}s).`
    );
  }
  let audioDurationSec = clamp(options.audioDurationSec, 0.5, 10, 5);
  if (audioProbeInput.durationSec != null && audioProbeInput.durationSec > audioStartSec + 0.2) {
    const remaining = Number((audioProbeInput.durationSec - audioStartSec).toFixed(2));
    if (remaining >= 0.5) {
      audioDurationSec = Math.min(audioDurationSec, remaining);
    }
  }

  const audioBitrateKbps = Math.round(clamp(options.audioBitrateKbps, 12, 96, 24));
  const audioVolume = clamp(options.audioVolume, 0.2, 2.0, 1.0);
  const autoFitLimit = parseBool(options.autoFitLimit, false);

  const webpPath = path.join(outputDir, 'sticker.webp');
  const audioPath = path.join(outputDir, 'audio.ogg');

  const encodeStaticWebp = async (targetQuality) => {
    const vf = buildSquareScaleFilter(fitMode, null);
    await runFfmpeg([
      '-y',
      '-i',
      imagePath,
      '-map',
      '0:v:0',
      '-map_metadata',
      '-1',
      '-vframes',
      '1',
      '-vf',
      vf,
      '-c:v',
      'libwebp',
      '-lossless',
      '0',
      '-compression_level',
      '6',
      '-q:v',
      String(targetQuality),
      webpPath,
    ]);
    const stat = await fs.stat(webpPath);
    return stat.size;
  };

  let webpSizeBytes = await encodeStaticWebp(webpQuality);

  if (autoFitLimit && webpSizeBytes >= STATIC_LIMIT_BYTES) {
    for (let attempt = 0; attempt < 4 && webpSizeBytes >= STATIC_LIMIT_BYTES; attempt++) {
      webpQuality = Math.max(15, webpQuality - 15);
      webpSizeBytes = await encodeStaticWebp(webpQuality);
    }
  }

  const audioResult = await encodeNormalizedOpusAudio(audioSourcePath, audioPath, {
    startSec: audioStartSec,
    durationSec: audioDurationSec,
    audioBitrateKbps,
    audioVolume,
    autoFitLimit,
  });

  return {
    webpPath,
    audioPath,
    webpSizeBytes,
    audioSizeBytes: audioResult.audioSizeBytes,
    durationSec: audioResult.durationSec,
    isAnimated: false,
    limitBytes: STATIC_LIMIT_BYTES,
    withinLimit: webpSizeBytes < STATIC_LIMIT_BYTES,
    appliedSettings: {
      webpQuality,
      audioBitrateKbps: audioResult.appliedAudioBitrateKbps,
      fitMode,
    },
  };
}
