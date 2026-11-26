import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import multer from 'multer';
import {
  processImageAudioToSoundSticker,
  processVideoToSoundSticker,
} from './media-processor.js';
import { whatsappService } from './whatsapp-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const tmpUploadsDir = path.join(rootDir, 'tmp-uploads');
const tmpPreviewsDir = path.join(rootDir, 'tmp-previews');

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore missing temporary file.
  }
}

function formatPreviewResponse(id, result) {
  return {
    id,
    webpUrl: `/api/previews/${id}/sticker.webp`,
    audioUrl: `/api/previews/${id}/audio.ogg`,
    webpSizeBytes: result.webpSizeBytes,
    audioSizeBytes: result.audioSizeBytes,
    durationSec: result.durationSec,
    isAnimated: result.isAnimated,
    limitBytes: result.limitBytes,
    withinLimit: result.withinLimit,
    appliedSettings: result.appliedSettings,
  };
}

export function createApp() {
  const app = express();
  const previews = new Map();

  const upload = multer({
    dest: tmpUploadsDir,
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  const cleanupTimer = setInterval(async () => {
    const now = Date.now();
    for (const [id, entry] of previews.entries()) {
      if (now - entry.createdAt > PREVIEW_TTL_MS) {
        previews.delete(id);
        await fs.rm(entry.dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }, 5 * 60 * 1000);
  cleanupTimer.unref();

  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/api/status', (_req, res) => {
    res.json({
      ...whatsappService.getStatus(),
      skipped: process.env.SKIP_WHATSAPP === '1',
    });
  });

  app.post('/api/whatsapp/logout', async (_req, res, next) => {
    try {
      if (process.env.SKIP_WHATSAPP === '1') {
        return res.json({ status: 'disconnected', skipped: true });
      }
      const status = await whatsappService.logout();
      return res.json(status);
    } catch (err) {
      return next(err);
    }
  });

  app.post('/api/preview/video', upload.single('video'), async (req, res, next) => {
    const videoFile = req.file;
    if (!videoFile) {
      return res.status(400).json({ error: 'Debes subir un archivo de video.' });
    }

    const id = crypto.randomUUID();
    const previewDir = path.join(tmpPreviewsDir, id);

    try {
      const result = await processVideoToSoundSticker(videoFile.path, previewDir, {
        startSec: req.body.startSec,
        durationSec: req.body.durationSec,
        fitMode: req.body.fitMode,
        fps: req.body.fps,
        webpQuality: req.body.webpQuality,
        audioBitrateKbps: req.body.audioBitrateKbps,
        audioVolume: req.body.audioVolume,
        autoFitLimit: req.body.autoFitLimit,
      });

      previews.set(id, {
        dir: previewDir,
        webpPath: result.webpPath,
        audioPath: result.audioPath,
        isAnimated: result.isAnimated,
        durationSec: result.durationSec,
        createdAt: Date.now(),
      });

      return res.json(formatPreviewResponse(id, result));
    } catch (err) {
      await fs.rm(previewDir, { recursive: true, force: true }).catch(() => {});
      return next(err);
    } finally {
      await safeUnlink(videoFile.path);
    }
  });

  app.post(
    '/api/preview/image-audio',
    upload.fields([
      { name: 'image', maxCount: 1 },
      { name: 'audio', maxCount: 1 },
    ]),
    async (req, res, next) => {
      const imageFile = req.files?.image?.[0];
      const audioFile = req.files?.audio?.[0];

      if (!imageFile || !audioFile) {
        await safeUnlink(imageFile?.path);
        await safeUnlink(audioFile?.path);
        return res.status(400).json({ error: 'Debes subir una imagen y un archivo de audio (o video).' });
      }

      const id = crypto.randomUUID();
      const previewDir = path.join(tmpPreviewsDir, id);

      try {
        const result = await processImageAudioToSoundSticker(
          imageFile.path,
          audioFile.path,
          previewDir,
          {
            fitMode: req.body.fitMode,
            webpQuality: req.body.webpQuality,
            audioStartSec: req.body.audioStartSec,
            audioDurationSec: req.body.audioDurationSec,
            audioBitrateKbps: req.body.audioBitrateKbps,
            audioVolume: req.body.audioVolume,
            autoFitLimit: req.body.autoFitLimit,
          }
        );

        previews.set(id, {
          dir: previewDir,
          webpPath: result.webpPath,
          audioPath: result.audioPath,
          isAnimated: result.isAnimated,
          durationSec: result.durationSec,
          createdAt: Date.now(),
        });

        return res.json(formatPreviewResponse(id, result));
      } catch (err) {
        await fs.rm(previewDir, { recursive: true, force: true }).catch(() => {});
        return next(err);
      } finally {
        await safeUnlink(imageFile.path);
        await safeUnlink(audioFile.path);
      }
    }
  );

  app.get('/api/previews/:id/sticker.webp', (req, res) => {
    const entry = previews.get(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Vista previa no encontrada o expirada.' });
    }
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'no-store');
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', 'attachment; filename="sound-sticker.webp"');
    }
    return res.sendFile(entry.webpPath);
  });

  app.get('/api/previews/:id/audio.ogg', (req, res) => {
    const entry = previews.get(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Audio no encontrado o expirado.' });
    }
    res.setHeader('Content-Type', 'audio/ogg');
    res.setHeader('Cache-Control', 'no-store');
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', 'attachment; filename="sound-sticker-audio.ogg"');
    }
    return res.sendFile(entry.audioPath);
  });

  app.post('/api/send', async (req, res, next) => {
    try {
      const { previewId, recipient } = req.body || {};
      const entry = previews.get(previewId);
      if (!entry) {
        return res.status(404).json({
          error: 'Primero genera una vista previa válida antes de enviar.',
        });
      }

      const result = await whatsappService.sendSoundSticker({
        recipient,
        webpPath: entry.webpPath,
        audioPath: entry.audioPath,
        isAnimated: entry.isAnimated,
        seconds: entry.durationSec,
      });

      return res.json({ ok: true, ...result });
    } catch (err) {
      return next(err);
    }
  });

  app.use((err, _req, res, _next) => {
    const status = err?.code === 'LIMIT_FILE_SIZE' ? 413 : err?.status || 400;
    const message =
      err?.code === 'LIMIT_FILE_SIZE'
        ? 'El archivo supera el límite máximo permitido (100 MB).'
        : err?.message || 'Error interno del servidor.';
    res.status(status).json({ error: message });
  });

  return app;
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Ignore browser launch errors; the user can open the URL manually.
  }
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  await fs.mkdir(tmpUploadsDir, { recursive: true });
  await fs.mkdir(tmpPreviewsDir, { recursive: true });

  const port = Number(process.env.PORT) || 3000;
  const url = `http://localhost:${port}`;
  const shouldOpen = process.env.NO_OPEN !== '1' && process.env.SKIP_WHATSAPP !== '1';
  const app = createApp();

  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`\n[OK] SonoSticker disponible en: ${url}`);
    if (shouldOpen) {
      openBrowser(url);
    }
    if (process.env.SKIP_WHATSAPP !== '1') {
      whatsappService.start().catch((err) => {
        console.error('Error iniciando WhatsApp:', err);
      });
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[INFO] SonoSticker ya está ejecutándose en: ${url}`);
      if (shouldOpen) {
        openBrowser(url);
      }
      process.exit(0);
    }
    console.error('[ERROR] Error iniciando el servidor:', err);
    process.exit(1);
  });
}
