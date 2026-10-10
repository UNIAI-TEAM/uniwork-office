// Minimal Electron main for run.mjs: one window with the same caption overlay
// as the shell (titleBarStyle 'hidden' + titleBarOverlay), so the renderer sees
// the real titlebar-area-* env values.
const { app, BrowserWindow, nativeTheme } = require('electron')

app.whenReady().then(() => {
  const dark = process.env.FIT_DARK === '1'
  nativeTheme.themeSource = dark ? 'dark' : 'light'
  const win = new BrowserWindow({
    width: 1280,
    height: 240,
    useContentSize: true,
    show: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: dark
      ? { color: '#2a2a2a', symbolColor: '#e4e4e4', height: 40 }
      : { color: '#ebebeb', symbolColor: '#454746', height: 40 },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.loadURL('about:blank')
})
app.on('window-all-closed', () => app.quit())
