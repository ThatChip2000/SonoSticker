import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist-release');

const PRODUCTION_ROOT_FILES = [
  'package-lock.json',
  'LICENSE',
  'README.md',
  '.gitignore',
];

const PRODUCTION_SRC_FILES = [
  'src/server.js',
  'src/media-processor.js',
  'src/whatsapp-service.js',
  'src/sound-sticker-proto.js',
];

const PORTABLE_LAUNCHER_BAT = [
  '@echo off',
  'chcp 65001 >nul',
  'title SonoSticker',
  'cd /d "%~dp0"',
  'echo Iniciando SonoSticker... ^(se abrira el navegador automaticamente^)',
  '"%~dp0runtime\\node.exe" "%~dp0src\\server.js"',
  'if errorlevel 1 (',
  '  echo.',
  '  echo [ERROR] SonoSticker se detuvo con un error.',
  '  pause',
  ')',
  '',
].join('\r\n');

function run(cmd, args, cwd = rootDir) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

async function copyAppFiles(targetDir, { portable }) {
  await fs.mkdir(path.join(targetDir, 'src'), { recursive: true });

  for (const file of PRODUCTION_ROOT_FILES) {
    await fs.copyFile(path.join(rootDir, file), path.join(targetDir, file));
  }
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
  const cleanPkg = {
    ...pkg,
    scripts: {
      start: pkg.scripts?.start || 'node src/server.js',
      dev: pkg.scripts?.dev || 'node --watch src/server.js',
    },
  };
  await fs.writeFile(path.join(targetDir, 'package.json'), `${JSON.stringify(cleanPkg, null, 2)}\n`, 'utf8');

  for (const srcFile of PRODUCTION_SRC_FILES) {
    await fs.copyFile(path.join(rootDir, srcFile), path.join(targetDir, srcFile));
  }
  await fs.cp(path.join(rootDir, 'public'), path.join(targetDir, 'public'), { recursive: true });

  if (portable) {
    await fs.writeFile(path.join(targetDir, 'Abrir SonoSticker.bat'), PORTABLE_LAUNCHER_BAT, 'utf8');
  } else {
    await fs.copyFile(
      path.join(rootDir, 'Abrir SonoSticker.bat'),
      path.join(targetDir, 'Abrir SonoSticker.bat')
    );
    await fs.copyFile(
      path.join(rootDir, 'abrir-sonosticker.sh'),
      path.join(targetDir, 'abrir-sonosticker.sh')
    );
  }
}

async function resolveLatestLtsNodeVersion() {
  const res = await fetch('https://nodejs.org/dist/index.json');
  if (!res.ok) {
    throw new Error(`No se pudo consultar nodejs.org/dist/index.json (${res.status})`);
  }
  const list = await res.json();
  const lts = list.find((item) => typeof item.lts === 'string');
  if (!lts?.version) {
    throw new Error('No se encontro una version LTS en nodejs.org/dist/index.json');
  }
  return lts.version;
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Error descargando ${url} (${res.status})`);
  }
  const arrBuf = await res.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(arrBuf));
}

function zipFolder(sourceFolder, zipPath) {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Compress-Archive -Path '${sourceFolder}' -DestinationPath '${zipPath}' -CompressionLevel Optimal -Force`,
    ],
    { stdio: 'inherit' }
  );
}

async function assertPortableLauncherClean(portableDir) {
  const batText = await fs.readFile(path.join(portableDir, 'Abrir SonoSticker.bat'), 'utf8');
  for (const forbidden of ['powershell', 'ExecutionPolicy', 'DownloadFile', 'msiexec', 'winget']) {
    assert.ok(
      !batText.toLowerCase().includes(forbidden.toLowerCase()),
      `Portable launcher contiene patron no permitido: ${forbidden}`
    );
  }
}

function assertZipClean(zipPath) {
  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('${zipPath}'); try { $z.Entries | ForEach-Object { $_.FullName } } finally { $z.Dispose() }`,
    ],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );

  const lines = out.split(/\r?\n/).filter(Boolean);
  const bad = lines.filter((line) =>
    /(^|\/)(auth_info|captured-sticker\.json|tmp-uploads|tmp-previews|test-assets|scripts|\.git)(\/|$)|(^|\/)src\/poc\.js$/i.test(
      line
    )
  );
  assert.equal(bad.length, 0, `Archivos no permitidos detectados en ${zipPath}: ${bad.join(', ')}`);
  console.log(`[OK] ZIP verificado (${lines.length} entradas): ${zipPath}`);
}

async function smokeTestPortable(portableDir) {
  const runtimeNode = path.join(portableDir, 'runtime', 'node.exe');
  const ffmpegExe = path.join(portableDir, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');

  await fs.access(runtimeNode);
  await fs.access(ffmpegExe);
  await assertPortableLauncherClean(portableDir);

  execFileSync(
    runtimeNode,
    [
      '--input-type=module',
      '-e',
      `
import assert from 'node:assert/strict';
import { createApp } from './src/server.js';
const app = createApp();
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
try {
  const base = 'http://127.0.0.1:' + server.address().port;
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<title>SonoSticker<\\/title>/);
  const st = await fetch(base + '/api/status');
  assert.equal(st.status, 200);
  console.log('[OK] Smoke test con runtime/node.exe portable exitoso');
} finally {
  server.close();
}
`,
    ],
    {
      cwd: portableDir,
      env: { ...process.env, SKIP_WHATSAPP: '1', NO_OPEN: '1' },
      stdio: 'inherit',
    }
  );
}

async function main() {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
  const version = pkg.version;

  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  const ligeroStaging = path.join(distDir, 'ligero', 'SonoSticker-Ligero');
  const portableStaging = path.join(distDir, 'portable', 'SonoSticker-Portable');

  console.log('[INFO] Copiando archivos limpios...');
  await copyAppFiles(ligeroStaging, { portable: false });
  await copyAppFiles(portableStaging, { portable: true });

  const ltsVersion = await resolveLatestLtsNodeVersion();
  const nodeZipName = `node-${ltsVersion}-win-x64.zip`;
  const nodeZipUrl = `https://nodejs.org/dist/${ltsVersion}/${nodeZipName}`;
  const nodeZipPath = path.join(distDir, '_node.zip');
  const nodeExtractDir = path.join(distDir, '_node_extract');

  console.log(`[INFO] Descargando Node.js portable ${ltsVersion}...`);
  await downloadFile(nodeZipUrl, nodeZipPath);

  run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Expand-Archive -Path '${nodeZipPath}' -DestinationPath '${nodeExtractDir}' -Force`,
  ]);

  const extractedNodeExe = path.join(nodeExtractDir, `node-${ltsVersion}-win-x64`, 'node.exe');
  const portableRuntimeDir = path.join(portableStaging, 'runtime');
  await fs.mkdir(portableRuntimeDir, { recursive: true });
  await fs.copyFile(extractedNodeExe, path.join(portableRuntimeDir, 'node.exe'));

  console.log('[INFO] Instalando dependencias limpias (npm ci --omit=dev) para version portable...');
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/c', 'npm', 'ci', '--omit=dev'], {
      cwd: portableStaging,
      stdio: 'inherit',
    });
  } else {
    execFileSync('npm', ['ci', '--omit=dev'], {
      cwd: portableStaging,
      stdio: 'inherit',
    });
  }

  await smokeTestPortable(portableStaging);

  const ligeroZip = path.join(distDir, `SonoSticker-v${version}-Windows-Ligero.zip`);
  const portableZip = path.join(distDir, `SonoSticker-v${version}-Windows-Portable.zip`);

  console.log('[INFO] Comprimiendo archivos ZIP...');
  zipFolder(ligeroStaging, ligeroZip);
  zipFolder(portableStaging, portableZip);

  assertZipClean(ligeroZip);
  assertZipClean(portableZip);

  const [ligeroStat, portableStat] = await Promise.all([
    fs.stat(ligeroZip),
    fs.stat(portableZip),
  ]);

  console.log(`[OK] Ligero:   ${ligeroZip} (${(ligeroStat.size / 1024).toFixed(1)} KB)`);
  console.log(`[OK] Portable: ${portableZip} (${(portableStat.size / (1024 * 1024)).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
