const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const ensureDefaultUsers = require('./scripts/ensureDefaultUsers');
const authRouter = require('./routes/auth');

const playersRouter = require('./routes/players');
const tournamentRouter = require('./routes/tournament');
const transactionsRouter = require('./routes/transactions');

async function startServer(port) {
  await connectDB();
  await ensureDefaultUsers();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true, panel: 'caja' }));
  app.use('/api/auth', authRouter);
  app.use('/api/players', playersRouter);
  app.use('/api/tournament', tournamentRouter);
  app.use('/api/transactions', transactionsRouter);

  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`Backend embebido (Caja) escuchando en http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

module.exports = startServer;
