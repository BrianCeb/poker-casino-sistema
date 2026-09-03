const express = require('express');
const Player = require('../models/Player');
const Transaction = require('../models/Transaction');
const { requireAuth, requireRole } = require('../middleware/auth');
const { diaOperativo } = require('../utils/diaOperativo');
const router = express.Router();

// GET /api/players -> listado (con busqueda opcional ?q=)
router.get('/', requireAuth, requireRole('caja'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = q ? { activo: { $ne: false }, $or: [
      { dni: { $regex: safeQ, $options: 'i' } },
      { nombre: { $regex: safeQ, $options: 'i' } },
      { apellido: { $regex: safeQ, $options: 'i' } }
    ] } : { activo: { $ne: false } };
    const players = await Player.find(filter)
      .collation({ locale: 'es', strength: 1 })
      .sort({ apellido: 1, nombre: 1, dni: 1 })
      .lean();
    res.json(players);
  } catch (err) { res.status(500).json({ error: 'Error al listar jugadores.' }); }
});

// POST /api/players -> alta de jugador desde Caja
router.post('/', requireAuth, requireRole('caja'), async (req, res) => {
  try {
    const { dni, nombre, apellido, telefono, email } = req.body || {};
    const cleanDni = String(dni || '').replace(/\D/g, '');
    if (!cleanDni || !nombre || !apellido) return res.status(400).json({ error: 'DNI, nombre y apellido son obligatorios.' });
    const player = await Player.create({
      dni: cleanDni, nombre: String(nombre).trim(), apellido: String(apellido).trim(),
      telefono: String(telefono || '').trim(), email: String(email || '').trim()
    });
    res.status(201).json(player);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Ese DNI ya está registrado.' });
    res.status(500).json({ error: 'Error al registrar el jugador.' });
  }
});

// PUT /api/players/:id -> editar (mismo criterio que Direccion, por _id)
router.put('/:id', requireAuth, requireRole('caja'), async (req, res) => {
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

// GET /api/players/:dni -> busqueda puntual para cobrar (con diaOperativo)
router.get('/:dni', requireAuth, requireRole('caja'), async (req,res)=>{
  try {
    const dni = req.params.dni.replace(/\D/g,''); const player = await Player.findOne({dni, activo: {$ne: false}});
    if(!player) return res.status(404).json({registrado:false});
    const today=diaOperativo(); const txHoy=await Transaction.find({dni,fecha:today}).sort({createdAt:1});
    const yaCompro=txHoy.some(t=>t.tipo==='buyin');
    res.json({registrado:true,player,yaCompro,recomprasCount:txHoy.filter(t=>t.tipo==='recompra').length,accionCorrespondiente:yaCompro?'recompra':'buyin'});
  } catch(err){res.status(500).json({error:'Error al buscar el jugador.'});}
});

module.exports=router;