# SonoSticker

App web local para crear, recortar, comprimir y enviar **Stickers con Audio (Sound Stickers)** nativos de WhatsApp directamente desde tu PC.

---

## Descarga (Releases)

Puedes descargar cualquiera de las dos versiones en la sección de [Releases](https://github.com/ThatChip2000/SonoSticker/releases/latest):

| Versión | Qué incluye | Cómo se usa | Ideal si... |
| :--- | :--- | :--- | :--- |
| **Portable** (`SonoSticker-v1.0.1-Windows-Portable.zip`) | Código + `node.exe` portable + `node_modules` + `ffmpeg.exe` (~85 MB) | Descomprimir y hacer doble clic en `Abrir SonoSticker.bat` | No quieres instalar Node.js ni nada en Windows, ni usar permisos de Administrador |
| **Ligera / No portable** (`SonoSticker-v1.0.1-Windows-Ligero.zip` o clonar el repo) | Solo el código fuente (~60 KB) | Doble clic en `Abrir SonoSticker.bat` (pregunta si deseas instalar Node.js LTS si falta e instala dependencias la primera vez) | Ya tienes Node.js 20+ o prefieres la descarga mínima |

---

## Qué puedes hacer

- **Video a Sticker animado con sonido (hasta 5 s / `< 500 KB`):**
  - Sube cualquier video (`.mp4`, `.mov`, `.webm`, `.mkv`, `.avi`) y recorta el tramo exacto con reproductor y loop en vivo.
  - Ajusta encuadre `512x512` (*Cover* o *Contain* con transparencia), **FPS**, **calidad WebP**, **bitrate de audio Opus** y **volumen**, con auto-compresión opcional para no superar el límite de WhatsApp.
- **Imagen estática + Audio (hasta 10 s / `< 100 KB`):**
  - Combina una imagen (`.png` con transparencia, `.jpg`, `.webp`) con cualquier archivo de audio (`.mp3`, `.wav`, `.ogg`, `.m4a`) o incluso un video para extraerle solo el sonido.
  - Recorta el fragmento exacto, previsualiza el sticker real en una burbuja de WhatsApp y escucha el `.ogg` antes de enviarlo.
- **Envío directo al chat:**
  - Envíalo a tu propio chat (*"Tú"*) para guardarlo en favoritos o a otro número, y descarga el `.webp` y `.ogg` si los quieres conservar.

---

## Inicio rápido

### Windows (Versión Portable)
1. Descarga `SonoSticker-v1.0.1-Windows-Portable.zip` desde [Releases](https://github.com/ThatChip2000/SonoSticker/releases/latest) y descomprime la carpeta.
2. Haz doble clic en **`Abrir SonoSticker.bat`**.
3. Se abrirá `http://localhost:3000` automáticamente sin instalar nada en tu PC.

### Windows (Versión Ligera / No portable)
1. Descarga `SonoSticker-v1.0.1-Windows-Ligero.zip` (o clona este repositorio).
2. Haz doble clic en **`Abrir SonoSticker.bat`**.
3. Si no tienes Node.js 20+, te preguntará (`S/N`) si deseas instalar Node.js LTS automáticamente; la primera vez descargará las dependencias (`npm install`) y abrirá `http://localhost:3000`.

### macOS / Linux
Requiere **Node.js 20+** instalado ([nodejs.org](https://nodejs.org/)).
```bash
chmod +x abrir-sonosticker.sh
./abrir-sonosticker.sh
```

### Manual (cualquier sistema con Node.js 20+)
```bash
npm install
npm start
```

---

## Primera vinculación con WhatsApp

1. Al abrir SonoSticker, haz clic en el botón **Ver QR** en la barra superior (cuando el estado indique `Escanea el QR`).
2. En tu teléfono ve a **WhatsApp -> Dispositivos vinculados -> Vincular un dispositivo** y escanea el código.
3. Tu sesión se guarda localmente en la carpeta `auth_info/` para que no tengas que escanear el QR cada vez que abras la app.

---

## Privacidad y uso local

- Todo el procesamiento de video, imagen y audio ocurre **100% en tu propia PC** con FFmpeg (incluido mediante `ffmpeg-static`).
- Las credenciales de sesión (`auth_info/`) y los archivos temporales (`tmp-uploads/`, `tmp-previews/`) están excluidos en `.gitignore` y nunca se suben al repositorio ni se comparten en los Releases.

---

## Aviso

Este proyecto utiliza `@whiskeysockets/baileys` (implementación no oficial de WhatsApp Web) con un parche en tiempo de ejecución para el campo `StickerMessage.audioMessage`. Úsalo bajo tu propia responsabilidad y de forma moderada/personal para evitar restricciones en tu cuenta.
