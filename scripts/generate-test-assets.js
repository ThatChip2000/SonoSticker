import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.join(rootDir, 'test-assets');

const STATIC_LIMIT_BYTES = 100 * 1024;
const ANIM_LIMIT_BYTES = 500 * 1024;

function runFfmpeg(args) {
  execFileSync(ffmpegPath, args, { stdio: 'pipe' });
}

function assertSize(filePath, maxBytes, label) {
  const { size } = fs.statSync(filePath);
  if (size <= 0) {
    throw new Error(`${label} quedó vacío: ${filePath}`);
  }
  if (maxBytes != null && size >= maxBytes) {
    throw new Error(
      `${label} excede el límite (${(size / 1024).toFixed(2)} KB >= ${(maxBytes / 1024).toFixed(0)} KB): ${filePath}`
    );
  }
  console.log(`[OK] ${label}: ${filePath} (${(size / 1024).toFixed(2)} KB)`);
}

function main() {
  if (!ffmpegPath) {
    throw new Error('No se encontró el binario de ffmpeg-static.');
  }

  fs.mkdirSync(assetsDir, { recursive: true });

  const staticWebp = path.join(assetsDir, 'sticker-static.webp');
  const animWebp = path.join(assetsDir, 'sticker-anim.webp');
  const audioOgg = path.join(assetsDir, 'audio.ogg');

  runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc2=s=512x512:d=1',
    '-vframes', '1',
    '-c:v', 'libwebp',
    '-quality', '75',
    staticWebp,
  ]);

  runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc2=s=512x512:d=3:r=12',
    '-c:v', 'libwebp',
    '-loop', '0',
    '-preset', 'default',
    '-quality', '55',
    animWebp,
  ]);

  runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', 'sine=frequency=523.25:duration=2',
    '-c:a', 'libopus',
    '-ar', '48000',
    '-ac', '1',
    '-b:a', '32k',
    audioOgg,
  ]);

  assertSize(staticWebp, STATIC_LIMIT_BYTES, 'Sticker estático (.webp)');
  assertSize(animWebp, ANIM_LIMIT_BYTES, 'Sticker animado (.webp)');
  assertSize(audioOgg, null, 'Audio Opus (.ogg)');
}

main();
