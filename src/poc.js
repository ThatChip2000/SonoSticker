import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  prepareWAMessageMedia,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import {
  buildSoundStickerMessage,
  patchWAProtoForSoundStickers,
} from './sound-sticker-proto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.join(rootDir, 'test-assets');
const authDir = path.join(rootDir, 'auth_info');
const capturedPath = path.join(rootDir, 'captured-sticker.json');

const recentWireCaptures = [];

function recordWireCapture(capture) {
  recentWireCaptures.push({
    capturedAt: new Date().toISOString(),
    ...capture,
  });
  if (recentWireCaptures.length > 10) {
    recentWireCaptures.shift();
  }
}

patchWAProtoForSoundStickers({ onWireCapture: recordWireCapture });

/**
 * Recursively converts Uint8Array, Buffer, and Long-like objects into JSON-safe summaries.
 */
export function sanitizeForJson(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;

  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    const buf = Buffer.from(value);
    return {
      __type: 'Uint8Array',
      length: buf.length,
      base64Preview: buf.toString('base64').slice(0, 32),
    };
  }

  if (
    typeof value.low === 'number' &&
    typeof value.high === 'number' &&
    typeof value.toNumber === 'function'
  ) {
    return value.toString();
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJson(item, seen));
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) {
      out[k] = sanitizeForJson(v, seen);
    }
  }
  return out;
}

function getAssetPaths() {
  return {
    staticWebp: path.join(assetsDir, 'sticker-static.webp'),
    animWebp: path.join(assetsDir, 'sticker-anim.webp'),
    audioOgg: path.join(assetsDir, 'audio.ogg'),
  };
}

function assertAssetsExist() {
  const paths = getAssetPaths();
  const missing = Object.values(paths).filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    console.error('❌ Faltan archivos de prueba en test-assets/:');
    for (const p of missing) console.error(`   - ${p}`);
    console.error('Ejecuta primero: npm run generate-assets');
    process.exit(1);
  }
  return paths;
}

function extractText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    ''
  ).trim();
}

function shouldCaptureSticker(message) {
  if (!message || typeof message !== 'object') return false;
  const keys = Object.keys(message);
  if (keys.some((k) => /sticker/i.test(k))) return true;
  if (message.associatedChildMessage || message.lottieStickerMessage) return true;
  return recentWireCaptures.some(
    (c) =>
      c.hasUnknownTag &&
      Date.now() - Date.parse(c.capturedAt) < 3000
  );
}

async function sendTestSoundSticker(sock, jid, command, assetPaths, sentByBotIds) {
  const isAnimated = command === '!test-anim';
  const wrapped = command === '!test-wrapped';
  const webpPath = isAnimated ? assetPaths.animWebp : assetPaths.staticWebp;

  const webpBuffer = fs.readFileSync(webpPath);
  const audioBuffer = fs.readFileSync(assetPaths.audioOgg);

  console.log(`⏳ Subiendo sticker (${isAnimated ? 'animado' : 'estático'}) y audio Opus...`);

  const [stickerMedia, audioMedia] = await Promise.all([
    prepareWAMessageMedia(
      { sticker: webpBuffer, isAnimated },
      { upload: sock.waUploadToServer }
    ),
    prepareWAMessageMedia(
      {
        audio: audioBuffer,
        mimetype: 'audio/ogg; codecs=opus',
        seconds: 2,
        ptt: false,
      },
      { upload: sock.waUploadToServer }
    ),
  ]);

  const payload = buildSoundStickerMessage(
    stickerMedia.stickerMessage,
    audioMedia.audioMessage,
    { isAnimated, wrapped }
  );

  const relayOptions = wrapped
    ? { additionalAttributes: { mediatype: 'sticker' } }
    : {};

  const messageId = await sock.relayMessage(jid, payload, relayOptions);
  if (messageId) {
    sentByBotIds.add(messageId);
  }

  console.log(`✅ Enviado (${command}) con messageId=${messageId}`);
  console.log(JSON.stringify(sanitizeForJson(payload), null, 2));
}

async function startBot() {
  const assetPaths = assertAssetsExist();
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const sentByBotIds = new Set();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 Escanea este código QR desde WhatsApp -> Dispositivos vinculados:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('\n🟢 Conectado a WhatsApp!');
      console.log('1) Envía un Sound Sticker desde tu celular a tu propio chat ("Tú") para capturar su protobuf en captured-sticker.json.');
      console.log('2) O escribe en tu chat propio: !test-static | !test-anim | !test-wrapped | !help\n');
    }

    if (connection === 'close') {
      const statusCode =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output?.statusCode
          : undefined;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`🔴 Conexión cerrada (status=${statusCode}). Reconectar=${shouldReconnect}`);
      if (shouldReconnect) {
        startBot().catch((err) => console.error('Error reconectando:', err));
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message) continue;

      if (shouldCaptureSticker(msg.message)) {
        const keys = Object.keys(msg.message);
        const snapshot = {
          capturedAt: new Date().toISOString(),
          key: msg.key,
          message: sanitizeForJson(msg.message),
          rawWireCaptures: recentWireCaptures.splice(0),
        };
        fs.writeFileSync(capturedPath, JSON.stringify(snapshot, null, 2), 'utf8');
        console.log(`🔎 Sticker detectado (keys: ${keys.join(', ')}). Guardado en ${capturedPath}`);
      }

      if (!msg.key?.fromMe || sentByBotIds.has(msg.key.id)) {
        continue;
      }

      const cmd = extractText(msg.message).toLowerCase();
      if (!cmd) continue;

      if (cmd === '!help') {
        const res = await sock.sendMessage(msg.key.remoteJid, {
          text: 'Comandos PoC Sound Sticker:\n- !test-static (sticker estático + audio)\n- !test-anim (sticker animado + audio)\n- !test-wrapped (wrapper audioStickerMessage)\n- !help',
        });
        if (res?.key?.id) sentByBotIds.add(res.key.id);
        continue;
      }

      if (cmd === '!test-static' || cmd === '!test-anim' || cmd === '!test-wrapped') {
        try {
          await sendTestSoundSticker(sock, msg.key.remoteJid, cmd, assetPaths, sentByBotIds);
        } catch (err) {
          console.error(`❌ Error ejecutando ${cmd}:`, err);
        }
      }
    }
  });
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  startBot().catch((err) => {
    console.error('❌ Error fatal en el PoC:', err);
    process.exit(1);
  });
}
