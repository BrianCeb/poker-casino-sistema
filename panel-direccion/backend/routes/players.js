const express = require('express');
const Player = require('../models/Player');
const Transaction = require('../models/Transaction');
const Pago = require('../models/Pago');
const requireAuth = require('../middleware/auth').requireAuth;
const requireRole = require('../middleware/auth').requireRole;
const router = express.Router();

router.get('/', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = q ? {
      activo: { $ne: false }, $or: [
        { dni: { $regex: safeQ, $options: 'i' } },
        { nombre: { $regex: safeQ, $options: 'i' } },
        { apellido: { $regex: safeQ, $options: 'i' } }
      ]
    } : { activo: { $ne: false } };
    // Orden apellido -> nombre -> dni, con comparacion locale-aware para
    // que tildes y enie ordenen correctamente en espanol (ej: "Nuñez"
    // despues de "Nunez", "Álvarez" junto a "Alvarez"). strength:1 ignora
    // mayusculas/minusculas y acentos para el orden.
    const players = await Player.find(filter)
      .collation({ locale: 'es', strength: 1 })
      .sort({ apellido: 1, nombre: 1, dni: 1 })
      .lean();
    res.json(players);
  } catch (err) { res.status(500).json({ error: 'Error al listar jugadores.' }); }
});


// NUEVO: estadisticas acumuladas por jugador (para la pestana de ranking)
// - totalGastado: suma de todas las compras (buy-in + re-entries) no anuladas
// - operaciones: cantidad total de compras
// - recurrencia: cantidad de fechas operativas DISTINTAS en las que jugo
// - ultimaFecha: la fecha operativa mas reciente en la que jugo
// Y lo que COBRO (pagos de Caja no anulados, por DNI):
// - premios / premiosMonto / mejorPuesto
// - bounties / bountiesMonto
// - hunters / hunterMonto
// - totalCobrado y balance (= totalCobrado - totalGastado)
router.get('/estadisticas', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const cobrosPromise = Pago.aggregate([
      { $match: { anulado: { $ne: true }, dni: { $nin: ['', null] } } },
      {
        $group: {
          _id: '$dni',
          premios: { $sum: { $cond: [{ $eq: ['$tipo', 'premio'] }, 1, 0] } },
          premiosMonto: { $sum: { $cond: [{ $eq: ['$tipo', 'premio'] }, '$monto', 0] } },
          mejorPuesto: { $min: { $cond: [{ $eq: ['$tipo', 'premio'] }, '$puesto', null] } },
          bounties: { $sum: { $cond: [{ $eq: ['$tipo', 'bounty'] }, 1, 0] } },
          bountiesMonto: { $sum: { $cond: [{ $eq: ['$tipo', 'bounty'] }, '$monto', 0] } },
          hunters: { $sum: { $cond: [{ $eq: ['$tipo', 'hunter'] }, 1, 0] } },
          hunterMonto: { $sum: { $cond: [{ $eq: ['$tipo', 'hunter'] }, '$monto', 0] } },
          totalCobrado: { $sum: '$monto' }
        }
      }
    ]);

    const stats = await Transaction.aggregate([
      { $match: { anulado: { $ne: true } } },
      {
        $group: {
          _id: '$dni',
          nombre: { $last: '$nombre' },
          apellido: { $last: '$apellido' },
          totalGastado: { $sum: '$monto' },
          operaciones: { $sum: 1 },
          fechasDistintas: { $addToSet: '$fecha' },
          ultimaFecha: { $max: '$fecha' }
        }
      },
      {
        $project: {
          _id: 0,
          dni: '$_id',
          nombre: 1,
          apellido: 1,
          totalGastado: 1,
          operaciones: 1,
          recurrencia: { $size: '$fechasDistintas' },
          ultimaFecha: 1
        }
      },
      { $sort: { apellido: 1 } }
    ]);

    // Se suma lo cobrado a cada jugador. La respuesta sigue siendo la
    // misma lista de antes, con campos nuevos.
    const cobros = new Map((await cobrosPromise).map(c => [c._id, c]));
    for (const p of stats) {
      const c = cobros.get(p.dni) || {};
      p.premios = c.premios || 0;
      p.premiosMonto = c.premiosMonto || 0;
      p.mejorPuesto = c.mejorPuesto || null;
      p.bounties = c.bounties || 0;
      p.bountiesMonto = c.bountiesMonto || 0;
      p.hunters = c.hunters || 0;
      p.hunterMonto = c.hunterMonto || 0;
      p.totalCobrado = c.totalCobrado || 0;
      p.balance = p.totalCobrado - Number(p.totalGastado || 0);
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener las estadísticas.' });
  }
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

// Elimina un jugador. Si NUNCA tuvo ninguna operacion registrada (ni
// siquiera anulada), se borra de verdad de MongoDB. Si tiene historial,
// no se borra (romperia la trazabilidad de esas operaciones): en su
// lugar se desactiva, igual que antes.
router.delete('/:id', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const player = await Player.findById(req.params.id);
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado.' });

    const tieneOperaciones = await Transaction.exists({ dni: player.dni });

    if (tieneOperaciones) {
      await Player.findByIdAndUpdate(req.params.id, { activo: false });
      return res.json({ ok: true, borradoReal: false });
    }

    await Player.deleteOne({ _id: req.params.id });
    res.json({ ok: true, borradoReal: true });

  } catch (err) { res.status(500).json({ error: 'Error al eliminar el jugador.' }); }
});

// NUEVO: historial completo del jugador (todas las fechas, mas reciente primero)
router.get('/:id/historial', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const player = await Player.findById(req.params.id);
    if (!player) return res.status(404).json({ error: 'Jugador no encontrado.' });
    const movimientos = await Transaction.find({ dni: player.dni })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ player, movimientos });
  } catch (err) { res.status(500).json({ error: 'Error al obtener el historial.' }); }
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
