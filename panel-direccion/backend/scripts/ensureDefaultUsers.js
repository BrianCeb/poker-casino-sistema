const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function ensureDefaultUsers() {
  if (!process.env.JWT_SECRET) throw new Error('Falta JWT_SECRET en el archivo .env');

  const defaults = [
    { username: process.env.DIRECCION_USER, password: process.env.DIRECCION_PASSWORD, role: 'direccion' },
    { username: process.env.CAJA_USER, password: process.env.CAJA_PASSWORD, role: 'caja' },
    { username: process.env.GERENCIA_USER, password: process.env.GERENCIA_PASSWORD, role: 'gerencia' }
  ];

  for (const item of defaults) {
    if (!item.username || !item.password) continue;
    const username = item.username.trim().toLowerCase();
    const existing = await User.findOne({ username });
    if (existing) continue;
    const passwordHash = await bcrypt.hash(item.password, 12);
    try {
      await User.create({ username, passwordHash, role: item.role });
      console.log(`Usuario inicial creado: ${username} (${item.role})`);
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
}

module.exports = ensureDefaultUsers;