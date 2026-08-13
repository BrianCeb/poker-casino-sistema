const cron = require('node-cron');
const runBackup = require('./backup');

// Corre todos los dias a las 5:00 AM (hora del servidor), cuando el
// casino ya cerro la operacion del dia. Ajustar el horario si hace falta.
function scheduleBackups() {
  cron.schedule('0 5 * * *', async () => {
    console.log('Iniciando backup automatico...');
    try {
      await runBackup();
    } catch (err) {
      console.error('Fallo el backup automatico:', err.message);
    }
  });
  console.log('Backup automatico programado: todos los dias a las 5:00 AM.');
}

module.exports = scheduleBackups;
