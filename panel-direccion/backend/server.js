const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const scheduleBackups = require('./scripts/scheduleBackups');
const ensureDefaultUsers = require('./scripts/ensureDefaultUsers');
const authRouter = require('./routes/auth');

const playersRouter = require('./routes/players');
const tournamentRouter = require('./routes/tournament');
const transactionsRouter = require('./routes/transactions');

// Arranca el servidor solo en localhost (127.0.0.1), nunca accesible
// desde otra PC de la red. La app de Caja tiene su propio servidor local
// identico en su propia maquina; ambos comparten datos porque los dos
// se conectan al mismo cluster de MongoDB Atlas.
async function startServer(port) {
  await connectDB();
  await ensureDefaultUsers();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true, panel: 'direccion' }));
  app.use('/api/auth', authRouter);
  app.use('/api/players', playersRouter);
  app.use('/api/tournament', tournamentRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api/pagadores', require('./routes/pagadores'));
  app.use('/api/reloj', require('./routes/reloj'));

  // Panel Gerencia: se accede por su propia URL (no por Electron), ya
  // que es de uso exclusivo para el rol gerencia. Se sirve SOLO este
  // archivo (no toda la carpeta renderer) para no exponer el resto
  // del panel de Direccion por HTTP sin necesidad.
  app.get('/gerencia.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'renderer', 'gerencia.html'));
  });

  // Pantalla del reloj para la TV del salon. Mismo criterio que
  // Gerencia: se sirve solo este archivo. Es de solo lectura y no pide
  // login (los datos vienen de /api/reloj/pantalla).
  app.get('/reloj.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'renderer', 'reloj.html'));
  });

  // Tipografías del reloj (archivos .woff2 en renderer/fuentes). Solo se
  // sirven nombres simples terminados en .woff2.
  app.get('/fuentes/:archivo', (req, res) => {
    const archivo = req.params.archivo;
    if (!/^[a-z0-9-]+\.woff2$/i.test(archivo)) return res.status(404).end();
    res.sendFile(path.join(__dirname, '..', 'renderer', 'fuentes', archivo), err => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  // Imágenes de fondo del reloj (opcionales), una por tema:
  // reloj-fondo.jpg (clásico), reloj-fondo-crema.jpg (crema), etc.
  // Si el archivo no existe, la pantalla usa un fondo hecho con degradé.
  // Imágenes de la pantalla del reloj (fondos de cada tema y la firma de
  // Arena Poker). Lista explícita de nombres: funciona en cualquier
  // versión de Express. Si falta un archivo, la pantalla usa un fondo de
  // respaldo y en la consola queda el aviso con la ruta buscada.
  const IMAGENES_RELOJ = [
    'reloj-fondo.jpg',
    'reloj-fondo-crema.jpg',
    'reloj-fondo-funny.jpg',
    'reloj-fondo-bounty.jpg',
    'reloj-firma.png'
  ];
  app.get(IMAGENES_RELOJ.map(nombre => '/' + nombre), (req, res) => {
    const archivo = path.join(__dirname, '..', 'renderer', path.basename(req.path));
    res.sendFile(archivo, err => {
      if (err && !res.headersSent) {
        console.warn('Reloj: no se encontró la imagen', archivo);
        res.status(404).end();
      }
    });
  });

  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`Backend embebido (Direccion) escuchando en http://127.0.0.1:${port}`);
      console.log(`Panel Gerencia disponible en http://127.0.0.1:${port}/gerencia.html`);
      console.log(`Reloj del torneo disponible en http://127.0.0.1:${port}/reloj.html`);
      scheduleBackups();
      resolve(server);
    });
  });
}

module.exports = startServer;
