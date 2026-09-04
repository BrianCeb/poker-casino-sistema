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

  // Panel Gerencia: se accede por su propia URL (no por Electron), ya
  // que es de uso exclusivo para el rol gerencia. Se sirve SOLO este
  // archivo (no toda la carpeta renderer) para no exponer el resto
  // del panel de Direccion por HTTP sin necesidad.
  app.get('/gerencia.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'renderer', 'gerencia.html'));
  });

  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`Backend embebido (Direccion) escuchando en http://127.0.0.1:${port}`);
      console.log(`Panel Gerencia disponible en http://127.0.0.1:${port}/gerencia.html`);
      scheduleBackups();
      resolve(server);
    });
  });
}

module.exports = startServer;