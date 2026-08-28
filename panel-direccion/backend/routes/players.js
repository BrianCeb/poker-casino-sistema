const express = require('express');
const Player = require('../models/Player');
const requireAuth = require('../middleware/auth').requireAuth;
const requireRole = require('../middleware/auth').requireRole;
const router = express.Router();

router.get('/', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = q ? { $or: [
      { dni: { $regex: safeQ, $options: 'i' } },
      { nombre: { $regex: safeQ, $options: 'i' } },
      { apellido: { $regex: safeQ, $options: 'i' } }
    ] } : {};
    const players = await Player.find(filter).sort({ apellido: 1, nombre: 1 }).lean();
    res.json(players);
  } catch (err) { res.status(500).json({ error: 'Error al listar jugadores.' }); }
});

router.post('/', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const { dni, nombre, apellido, telefono, email } = req.body || {};
    const cleanDni = String(dni || '').replace(/\D/g, '');
    if (!cleanDni || !nombre || !apellido) return res.status(400).json({ error: 'DNI, nombre y apellido son obligatorios.' });
    const player = await Player.create({ dni: cleanDni, nombre: String(nombre).trim(), apellido: String(apellido).trim(), telefono: String(telefono || '').trim(), email: String(email || '').trim() });
    res.status(201).json(player);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Ese DNI ya está registrado.' });
    res.status(500).json({ error: 'Error al registrar el jugador.' });
  }
});

router.put('/:id', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const { nombre, apellido, telefono, email } = req.body || {};
    if (!nombre || !apellido) return res.status(400).json({ error: 'Nombre y apellido son obligatorios.' });
    const player = await Player.findByIdAndUpdate(req.params.id, {
      nombre: String(nombre).trim(), apellido: String(apellido).trim(),
      telefono: String(telefono || '').trim(), email: String(email || '').trim()
    }, { new: true, runValidators: true });
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado.' });
    res.json(player);
  } catch (err) { res.status(500).json({ error: 'Error al editar el jugador.' }); }
});

router.get('/:dni', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const dni = req.params.dni.replace(/\D/g, '');
    const player = await Player.findOne({ dni });
    if (!player) return res.status(404).json({ registrado: false });
    res.json({ registrado: true, player });
  } catch (err) { res.status(500).json({ error: 'Error al buscar el jugador.' }); }
});

module.exports = router;
