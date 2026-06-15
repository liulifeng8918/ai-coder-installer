const { contextBridge, ipcRenderer } = require('electron')

const allowedEvents = new Set([
  'step-start',
  'step-done',
  'step-warn',
  'step-error',
  'log-line',
  'install-done',
  'tool-not-found',
  'save-key-result',
  'support-link-result'
])

contextBridge.exposeInMainWorld('installer', {
  startInstall: target => ipcRenderer.send('start-install', { target }),
  openLog: () => ipcRenderer.send('open-log'),
  openTool: tool => ipcRenderer.send('open-tool', { tool }),
  openStore: () => ipcRenderer.send('open-store'),
  openAgnesRegister: () => ipcRenderer.send('open-agnes-register'),
  openSupportLink: id => ipcRenderer.send('open-support-link', { id }),
  saveKey: payload => ipcRenderer.send('save-key', payload),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getSupportInfo: () => ipcRenderer.invoke('get-support-info'),
  on: (event, callback) => {
    if (!allowedEvents.has(event)) return
    ipcRenderer.on(event, (_event, data) => callback(data))
  }
})
