import { proto } from '@whiskeysockets/baileys';
import protobuf from 'protobufjs/minimal.js';

const { Reader } = protobuf;

const PATCH_FLAG = Symbol.for('wsp.soundStickerProtoPatched');
let activeWireCapture = null;

function isPrintableAscii(buf) {
  if (!buf || buf.length === 0) return false;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte < 0x20 || byte > 0x7e) return false;
  }
  return true;
}

/**
 * Decodes raw protobuf wire fields recursively up to `maxDepth` without requiring a schema.
 * Useful for inspecting unknown WhatsApp WAProto tags on incoming messages.
 */
export function scanWireFields(bytes, maxDepth = 2) {
  if (!bytes || bytes.length === 0) return [];
  const reader = Reader.create(bytes);
  const fields = [];

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const fieldNumber = tag >>> 3;
    const wireType = tag & 7;

    if (fieldNumber === 0) {
      throw new Error('Invalid protobuf field number 0');
    }

    if (wireType === 0) {
      const val = reader.uint64();
      fields.push({ fieldNumber, wireType, value: val.toString() });
    } else if (wireType === 1) {
      const val = reader.fixed64();
      fields.push({ fieldNumber, wireType, value: val.toString() });
    } else if (wireType === 2) {
      const sub = reader.bytes();
      const entry = {
        fieldNumber,
        wireType,
        length: sub.length,
        base64Preview: Buffer.from(sub).toString('base64').slice(0, 48),
      };

      if (isPrintableAscii(sub)) {
        entry.utf8Preview = Buffer.from(sub).toString('utf8').slice(0, 120);
      } else if (maxDepth > 0 && sub.length > 0) {
        try {
          const nested = scanWireFields(sub, maxDepth - 1);
          if (nested.length > 0) {
            entry.nested = nested;
          }
        } catch {
          // Raw binary payload (e.g., sha256 hash or mediaKey), not a nested proto message.
        }
      }

      fields.push(entry);
    } else if (wireType === 5) {
      const val = reader.fixed32();
      fields.push({ fieldNumber, wireType, value: val });
    } else {
      throw new Error(`Unsupported wire type ${wireType} at field ${fieldNumber}`);
    }
  }

  return fields;
}

function readRawWireSlice(bytes) {
  const r = Reader.create(bytes);
  const entries = [];
  while (r.pos < r.len) {
    const tag = r.uint32();
    const fieldNumber = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 2) {
      entries.push({ fieldNumber, wireType, bytes: r.bytes() });
    } else {
      r.skipType(wireType);
      entries.push({ fieldNumber, wireType });
    }
  }
  return entries;
}

/**
 * Patches Baileys' WAProto `Message` and `StickerMessage` encode/decode methods at runtime
 * to support `StickerMessage.audioMessage` (tag 26) and `Message.audioStickerMessage` (tag 134),
 * and captures raw wire tags for inspection. Idempotent.
 */
export function patchWAProtoForSoundStickers({ onWireCapture } = {}) {
  if (onWireCapture !== undefined) {
    activeWireCapture = onWireCapture;
  }

  const Message = proto.Message;
  const StickerMessage = proto.Message.StickerMessage;

  if (Message[PATCH_FLAG]) {
    return;
  }

  const origStickerEncode = StickerMessage.encode;
  const origStickerDecode = StickerMessage.decode;
  const origMessageEncode = Message.encode;
  const origMessageDecode = Message.decode;

  StickerMessage.encode = function encodeWithAudio(m, w) {
    w = origStickerEncode(m, w);
    if (m?.audioMessage != null && Object.hasOwnProperty.call(m, 'audioMessage')) {
      // Field 26, wireType 2 => (26 << 3) | 2 = 210
      proto.Message.AudioMessage.encode(m.audioMessage, w.uint32(210).fork()).ldelim();
    }
    return w;
  };

  Message.encode = function encodeWithAudioSticker(m, w) {
    w = origMessageEncode(m, w);
    if (m?.audioStickerMessage != null && Object.hasOwnProperty.call(m, 'audioStickerMessage')) {
      // Field 134, wireType 2 => (134 << 3) | 2 = 1074
      proto.Message.FutureProofMessage.encode(m.audioStickerMessage, w.uint32(1074).fork()).ldelim();
    }
    return w;
  };

  StickerMessage.decode = function decodeWithAudio(r, l, e) {
    if (!(r instanceof Reader)) {
      r = Reader.create(r);
    }
    const startPos = r.pos;
    const endPos = l === undefined ? r.len : r.pos + l;
    const rawSlice = r.buf.subarray(startPos, endPos);

    const decoded = origStickerDecode(r, l, e);

    try {
      const entries = readRawWireSlice(rawSlice);
      let hasExtra = false;
      for (const entry of entries) {
        if (entry.fieldNumber === 26 && entry.wireType === 2 && entry.bytes) {
          decoded.audioMessage = proto.Message.AudioMessage.decode(entry.bytes);
          hasExtra = true;
        } else if (entry.fieldNumber > 23) {
          hasExtra = true;
        }
      }

      if (activeWireCapture) {
        activeWireCapture({
          scope: 'StickerMessage',
          hasExtra,
          fields: scanWireFields(rawSlice, 2),
        });
      }
    } catch {
      // Ignore diagnostic scan failures so normal message decoding never breaks.
    }

    return decoded;
  };

  Message.decode = function decodeWithAudioSticker(r, l, e) {
    if (!(r instanceof Reader)) {
      r = Reader.create(r);
    }
    const startPos = r.pos;
    const endPos = l === undefined ? r.len : r.pos + l;
    const rawSlice = r.buf.subarray(startPos, endPos);

    const decoded = origMessageDecode(r, l, e);

    try {
      const entries = readRawWireSlice(rawSlice);
      let hasSticker = false;
      let hasAudioSticker = false;
      let hasUnknownTag = false;

      for (const entry of entries) {
        if (entry.fieldNumber === 26) {
          hasSticker = true;
        } else if (entry.fieldNumber === 134 && entry.wireType === 2 && entry.bytes) {
          decoded.audioStickerMessage = proto.Message.FutureProofMessage.decode(entry.bytes);
          hasAudioSticker = true;
        } else if (entry.fieldNumber > 114) {
          hasUnknownTag = true;
        }
      }

      if ((hasSticker || hasAudioSticker || hasUnknownTag) && activeWireCapture) {
        activeWireCapture({
          scope: 'Message',
          hasSticker,
          hasAudioSticker,
          hasUnknownTag,
          fields: scanWireFields(rawSlice, 3),
        });
      }
    } catch {
      // Ignore diagnostic scan failures so normal message decoding never breaks.
    }

    return decoded;
  };

  Message[PATCH_FLAG] = true;
}

/**
 * Combines uploaded StickerMessage and AudioMessage metadata into a Sound Sticker proto payload.
 */
export function buildSoundStickerMessage(
  stickerMessageObj,
  audioMessageObj,
  { isAnimated = false, wrapped = false } = {}
) {
  if (!stickerMessageObj) {
    throw new Error('stickerMessageObj es requerido');
  }
  if (!audioMessageObj) {
    throw new Error('audioMessageObj es requerido');
  }

  const audioMessage = {
    ...audioMessageObj,
    mimetype: audioMessageObj.mimetype || 'audio/ogg; codecs=opus',
    seconds: audioMessageObj.seconds ?? 2,
  };

  const stickerMessage = {
    ...stickerMessageObj,
    mimetype: stickerMessageObj.mimetype || 'image/webp',
    width: stickerMessageObj.width || 512,
    height: stickerMessageObj.height || 512,
    isAnimated,
    audioMessage,
  };

  if (wrapped) {
    return {
      audioStickerMessage: {
        message: {
          stickerMessage,
        },
      },
    };
  }

  return { stickerMessage };
}
