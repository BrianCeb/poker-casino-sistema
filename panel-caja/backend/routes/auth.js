const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password, panel } = req.body || {};
    if (!username || !password || !panel) {
      return res.status(400).json({ error: 'Usuario, contraseña y panel son obligatorios.' });
    }
    const user = await User.findOne({ username: String(username).trim().toLowerCase(), activo: true });
    if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    if ((panel === 'direccion' && user.role !== 'direccion') || (panel === 'caja' && user.role !== 'caja')) {
      return res.status(403).json({ error: 'Este usuario no tiene acceso a este panel.' });
    }
    const token = jwt.sign({ sub: String(user._id), username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: { username: req.user.username, role: req.user.role } }));

module.exports = router;
