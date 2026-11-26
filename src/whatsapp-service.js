import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  prepareWAMessageMedia,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import {
  buildSoundStickerMessage,
  patchWAProtoForSoundStickers,
} from './sound-sticker-proto.js';

patchWAProtoForSoundStickers();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const authDir = path.join(rootDir, 'auth_info');

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.starting = false;
    this.manualLogout = false;
    this.reconnectTimer = null;
    this.state = {
      status: 'disconnected',
      qrDataUrl: null,
      user: null,
      lastError: null,
    };
  }

  getStatus() {
    return {
      status: this.state.status,
      qrDataUrl: this.state.qrDataUrl,
      user: this.state.user,
      lastError: this.state.lastError,
    };
  }

  async start() {
    if (this.starting || this.state.status === 'open') {
      return;
    }
    this.starting = true;
    this.manualLogout = false;
    this.state.status = 'connecting';
    this.state.lastError = null;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
      });

      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (this.sock !== sock) return;

        if (qr) {
          try {
            this.state.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
            this.state.status = 'qr';
            this.state.user = null;
          } catch (err) {
            this.state.lastError = `Error generando QR: ${err.message}`;
          }
        }

        if (connection === 'open') {
          const phoneJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
          const lidJid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : null;
          this.state.status = 'open';
          this.state.qrDataUrl = null;
          this.state.lastError = null;
          this.state.user = {
            name: sock.user?.name || 'Mi cuenta',
            phoneJid,
            lidJid,
            defaultSelfJid: lidJid || phoneJid,
          };
          console.log(`[WA] WhatsApp conectado como ${this.state.user.name} (${this.state.user.defaultSelfJid})`);
        }

        if (connection === 'close') {
          const statusCode =
            lastDisconnect?.error instanceof Boom
              ? lastDisconnect.error.output?.statusCode
              : undefined;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          this.sock = null;
          this.state.status = 'disconnected';
          this.state.qrDataUrl = null;

          if (isLoggedOut) {
            this.state.user = null;
            await fs.rm(authDir, { recursive: true, force: true }).catch(() => {});
            if (!this.manualLogout) {
              this.state.lastError = 'Sesión cerrada desde el teléfono. Generando nuevo QR...';
              clearTimeout(this.reconnectTimer);
              this.reconnectTimer = setTimeout(() => {
                this.start().catch((err) => {
                  this.state.lastError = err.message;
                });
              }, 1500);
            } else {
              this.state.lastError = 'Sesión cerrada.';
            }
            return;
          }

          if (!this.manualLogout) {
            this.state.lastError = `Conexión cerrada (${statusCode ?? 'desconocido'}). Reconectando...`;
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => {
              this.start().catch((err) => {
                this.state.lastError = err.message;
              });
            }, 2000);
          }
        }
      });
    } catch (err) {
      this.state.status = 'disconnected';
      this.state.lastError = err.message;
    } finally {
      this.starting = false;
    }
  }

  resolveTargetJid(recipient) {
    if (!recipient || typeof recipient !== 'string' || recipient.trim() === '') {
      const selfJid = this.state.user?.defaultSelfJid;
      if (!selfJid) {
        throw new Error('No se pudo determinar tu chat propio. Verifica la conexión de WhatsApp.');
      }
      return selfJid;
    }

    const trimmed = recipient.trim();
    if (trimmed.includes('@')) {
      return trimmed;
    }

    const digits = trimmed.replace(/\D/g, '');
    if (digits.length < 7) {
      throw new Error('Número de teléfono inválido. Incluye código de país (ej. 56912345678).');
    }
    return `${digits}@s.whatsapp.net`;
  }

  async sendSoundSticker({ recipient, webpPath, audioPath, isAnimated, seconds }) {
    if (!this.sock || this.state.status !== 'open') {
      throw new Error('WhatsApp no está conectado. Escanea el QR primero.');
    }

    const targetJid = this.resolveTargetJid(recipient);
    const webpBuffer = await fs.readFile(webpPath);

    if (!audioPath) {
      const stickerMedia = await prepareWAMessageMedia(
        { sticker: webpBuffer, isAnimated: Boolean(isAnimated) },
        { upload: this.sock.waUploadToServer }
      );
      const payload = {
        stickerMessage: {
          ...stickerMedia.stickerMessage,
          mimetype: stickerMedia.stickerMessage?.mimetype || 'image/webp',
          width: stickerMedia.stickerMessage?.width || 512,
          height: stickerMedia.stickerMessage?.height || 512,
          isAnimated: Boolean(isAnimated),
        },
      };
      const messageId = await this.sock.relayMessage(targetJid, payload, {});
      return { messageId, targetJid };
    }

    const audioBuffer = await fs.readFile(audioPath);
    const roundedSeconds = Math.max(1, Math.round(Number(seconds) || 2));

    const [stickerMedia, audioMedia] = await Promise.all([
      prepareWAMessageMedia(
        { sticker: webpBuffer, isAnimated: Boolean(isAnimated) },
        { upload: this.sock.waUploadToServer }
      ),
      prepareWAMessageMedia(
        {
          audio: audioBuffer,
          mimetype: 'audio/ogg; codecs=opus',
          seconds: roundedSeconds,
          ptt: false,
        },
        { upload: this.sock.waUploadToServer }
      ),
    ]);

    const payload = buildSoundStickerMessage(
      stickerMedia.stickerMessage,
      audioMedia.audioMessage,
      { isAnimated: Boolean(isAnimated), wrapped: false }
    );

    const messageId = await this.sock.relayMessage(targetJid, payload, {});
    return { messageId, targetJid };
  }

  async logout() {
    this.manualLogout = true;
    clearTimeout(this.reconnectTimer);

    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        // Ignore errors if socket is already closed.
      }
      try {
        this.sock.end(undefined);
      } catch {
        // Ignore cleanup errors.
      }
      this.sock = null;
    }

    await fs.rm(authDir, { recursive: true, force: true });
    this.state = {
      status: 'disconnected',
      qrDataUrl: null,
      user: null,
      lastError: null,
    };

    await this.start();
    return this.getStatus();
  }
}

export const whatsappService = new WhatsAppService();
