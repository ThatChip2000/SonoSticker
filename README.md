# SonoSticker 🔊

App web local para crear, recortar, comprimir y enviar **Stickers con Audio (Sound Stickers)** nativos de WhatsApp directamente desde tu PC.

## Qué puedes hacer

- **🎬 Video → Sticker animado con sonido (hasta 5 s / `< 500 KB`):**
  - Sube cualquier video (`.mp4`, `.mov`, `.webm`, `.mkv`, `.avi`) y recorta el tramo exacto con reproductor y loop en vivo.
  - Ajusta encuadre `512×512` (*Cover* o *Contain* con transparencia), **FPS**, **calidad WebP**, **bitrate de audio Opus** y **volumen**, con auto-compresión opcional para no pasar el límite de WhatsApp.
- **🖼️ Imagen estática + Audio (hasta 10 s / `< 100 KB`):**
  - Combina una imagen (`.png` con transparencia, `.jpg`, `.webp`) con cualquier archivo de audio (`.mp3`, `.wav`, `.ogg`, `.m4a`) o incluso un video para extraerle solo el sonido.
  - Recorta el fragmento exacto, previsualiza el sticker real en una burbuja de WhatsApp y escucha el `.ogg` antes de enviarlo.
- **📲 Envío directo al chat:**
  - Envíalo a tu propio chat (*"Tú"*) para guardarlo en favoritos o a otro número, y descarga el `.webp` y `.ogg` si los quieres conservar.

---

## Requisitos

1. **Node.js 20 o superior** ([nodejs.org](https://nodejs.org/)). *(En Windows, `Abrir SonoSticker.bat` lo detecta e **instala Node.js LTS automáticamente** si no lo tienes).*
2. **WhatsApp móvil actualizado** con soporte para *Sound Stickers*.
3. *(FFmpeg viene integrado automáticamente mediante `ffmpeg-static`, no necesitas instalarlo aparte).*

---

## Inicio rápido

### Windows (1 clic)
1. Descarga o clona este repositorio.
2. Haz doble clic en **`Abrir SonoSticker.bat`**.
3. Si falta Node.js, lo instalará automáticamente; la primera vez también instalará las dependencias y abrirá `http://localhost:3000` en tu navegador.

### macOS / Linux
```bash
chmod +x abrir-sonosticker.sh
./abrir-sonosticker.sh
```

### Manual (cualquier sistema)
```bash
npm install
npm start
```
Luego abre `http://localhost:3000` (se abre automáticamente si tu entorno lo permite).

---

## Primera vinculación con WhatsApp

1. Al abrir SonoSticker, haz clic en el botón **Ver QR** en la barra superior (cuando el estado indique `🟡 Escanea el QR`).
2. En tu teléfono ve a **WhatsApp → Dispositivos vinculados → Vincular un dispositivo** y escanea el código.
3. Tu sesión se guarda localmente en la carpeta `auth_info/` para que no tengas que escanear el QR cada vez que abras la app.

---

## Privacidad y uso local

- Todo el procesamiento de video, imagen y audio ocurre **100% en tu propia PC** con FFmpeg.
- Las credenciales de sesión (`auth_info/`) y los archivos temporales (`tmp-uploads/`, `tmp-previews/`) están excluidos en `.gitignore` y nunca se suben al repositorio.

---

## Aviso

Este proyecto utiliza `@whiskeysockets/baileys` (implementación no oficial de WhatsApp Web) con un parche en tiempo de ejecución para el campo `StickerMessage.audioMessage`. Úsalo bajo tu propia responsabilidad y de forma moderada/personal para evitar restricciones en tu cuenta.
