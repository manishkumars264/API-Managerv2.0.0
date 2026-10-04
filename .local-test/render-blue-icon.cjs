const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    await window.loadURL('about:blank');
    const svg = fs.readFileSync('build/icon.svg').toString('base64');
    const encoded = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; canvas.getContext('2d').drawImage(image, 0, 0, 256, 256); resolve(canvas.toDataURL('image/png').split(',')[1]); }; image.onerror = reject; image.src = 'data:image/svg+xml;base64,${svg}';
    })`);
    const png = Buffer.from(encoded, 'base64');
    const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
    fs.writeFileSync('build/icon.png', png); fs.writeFileSync('build/icon.ico', Buffer.concat([header, png]));
    console.log('Blue app icon rendered from the unchanged vector design.');
    window.destroy(); app.quit();
  } catch (error) { console.error(error); window.destroy(); app.exit(1); }
});
