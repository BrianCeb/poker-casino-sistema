require('dotenv').config();
const { app, BrowserWindow } = require('electron');
const path = require('path');
const startServer = require('./backend/server');

const PORT = process.env.PORT || 4002;
let mainWindow;
let httpServer;

async function createWindow() {
  try {
    httpServer = await startServer(PORT);
  } catch (err) {
    console.error('No se pudo conectar a MongoDB Atlas:', err.message);
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 780,
    title: 'Panel Caja — Torneo de Poker',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (httpServer) httpServer.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
