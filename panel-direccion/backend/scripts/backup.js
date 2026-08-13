// Respaldo manual: exporta jugadores, torneos y transacciones a archivos JSON.
// Sirve como red de seguridad ADEMAS de los backups de Atlas (no en
// reemplazo). Se puede correr a mano con "npm run backup" o se ejecuta
// solo todas las noches via scheduleBackups.js
//
// Los archivos generados en ./backups se deben sincronizar a otro lugar
// (Google Drive, Dropbox, un disco externo, otro servidor) para que sea
// un respaldo real y no una copia en el mismo lugar que el original.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const Player = require('../models/Player');
const Tournament = require('../models/Tournament');
const Transaction = require('../models/Transaction');

async function runBackup() {
  const dir = process.env.BACKUP_DIR || './backups';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folder = path.join(dir, timestamp);
  fs.mkdirSync(folder, { recursive: true });

  const [players, tournaments, transactions] = await Promise.all([
    Player.find().lean(),
    Tournament.find().lean(),
    Transaction.find().lean()
  ]);

  fs.writeFileSync(path.join(folder, 'players.json'), JSON.stringify(players, null, 2));
  fs.writeFileSync(path.join(folder, 'tournaments.json'), JSON.stringify(tournaments, null, 2));
  fs.writeFileSync(path.join(folder, 'transactions.json'), JSON.stringify(transactions, null, 2));

  console.log(`Backup guardado en ${folder}`);
  console.log(`  jugadores: ${players.length} | torneos: ${tournaments.length} | movimientos: ${transactions.length}`);
  return folder;
}

// Si se ejecuta directamente con "node scripts/backup.js" o "npm run backup"
if (require.main === module) {
  connectDB()
    .then(runBackup)
    .then(() => mongoose.disconnect())
    .catch(err => {
      console.error('Error al hacer el backup:', err.message);
      process.exit(1);
    });
}

module.exports = runBackup;
