const express = require('express');
const Tournament = require('../models/Tournament');
const Transaction = require('../models/Transaction');
const Pago = require('../models/Pago');
const { requireAuth, requireRole } = require('../middleware/auth');
const { diaOperativo } = require('../utils/diaOperativo');
const { estadoHunter } = require('../utils/hunter');

// ======================================================
// PAGOS (premios, bounties y Hunter) - vista de Direccion
// ======================================================
// Los pagos los registra Caja (panel-caja/backend/routes/pagos.js).
// Direccion los consulta, habilita el Hunter a mano si hace falta y
// anula pagos mal hechos (sin borrado fisico, igual que las operaciones).
// ======================================================

const router = express.Router();

async function torneoActivo() {
  return Tournament.findOne({ activo: true }).sort({ createdAt: -1 }).lean();
}


// GET /api/pagos/resumen -> pagos del torneo activo (incluye anulados),
// ranking de bounties y estado del Hunter.
router.get('/resumen', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const torneo = await torneoActivo();
    if (!torneo) return res.json({ sinTorneo: true });

    const [transacciones, pagos] = await Promise.all([
      Transaction.find({ fecha: diaOperativo(), anulado: { $ne: true } }).select('tipo monto desglose').lean(),
      Pago.find({ torneoId: torneo._id }).sort({ createdAt: -1 }).lean()
    ]);

    const vigentes = pagos.filter(p => !p.anulado);
    const suma = tipo => vigentes.filter(p => p.tipo === tipo).reduce((s, p) => s + Number(p.monto || 0), 0);
    const cuenta = tipo => vigentes.filter(p => p.tipo === tipo).length;

    res.json({
      torneo: {
        id: torneo._id,
        nombre: torneo.nombre,
        fecha: torneo.fecha,
        tipo: torneo.tipo || 'normal',
        montoBounty: torneo.tipo === 'mistery_bounty' ? Number(torneo.mbBounty || 0) : 0,
        hunterAporte: Number(torneo.hunterAporte || 0),
        hunterHabilitadoPor: torneo.hunterHabilitadoPor || '',
        hunterHabilitadoEn: torneo.hunterHabilitadoEn || null
      },
      torneoDeOtroDia: torneo.fecha !== diaOperativo(),
      totales: {
        premios: { cantidad: cuenta('premio'), monto: suma('premio') },
        bounties: { cantidad: cuenta('bounty'), monto: suma('bounty') },
        hunter: { cantidad: cuenta('hunter'), monto: suma('hunter') }
      },
      hunter: estadoHunter({ torneo, transacciones, pagos }),
      pagos
    });
  } catch (err) {
    console.error('Error obteniendo pagos en Dirección:', err);
    res.status(500).json({ error: 'Error al obtener los pagos.' });
  }
});


// GET /api/pagos/estadisticas -> totales historicos de pagos (todos los
// torneos, sin anulados), para la pestaña Estadisticas.
router.get('/estadisticas', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const filas = await Pago.aggregate([
      { $match: { anulado: { $ne: true } } },
      { $group: { _id: '$tipo', cantidad: { $sum: 1 }, monto: { $sum: '$monto' }, torneos: { $addToSet: '$torneoId' } } }
    ]);
    const vacio = { cantidad: 0, monto: 0, torneos: 0 };
    const por = Object.fromEntries(filas.map(f => [f._id, { cantidad: f.cantidad, monto: f.monto, torneos: f.torneos.length }]));
    const premio = por.premio || vacio, bounty = por.bounty || vacio, hunter = por.hunter || vacio;
    res.json({
      premios: premio,
      bounties: bounty,
      hunter,
      total: premio.monto + bounty.monto + hunter.monto
    });
  } catch (err) {
    console.error('Error obteniendo estadísticas de pagos:', err);
    res.status(500).json({ error: 'Error al obtener las estadísticas de pagos.' });
  }
});


// PUT /api/pagos/hunter/habilitar  { habilitado: true|false }
// Habilita (o vuelve a bloquear) el pago del Hunter antes de que se
// paguen todos los bounties.
router.put('/hunter/habilitar', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const habilitado = !!(req.body || {}).habilitado;
    const torneo = await Tournament.findOne({ activo: true }).sort({ createdAt: -1 });
    if (!torneo) return res.status(409).json({ error: 'No hay un torneo activo.' });
    if (torneo.tipo !== 'mistery_bounty') return res.status(400).json({ error: 'El torneo activo no tiene bounty.' });

    if (!habilitado) {
      const yaPagado = await Pago.exists({ torneoId: torneo._id, tipo: 'hunter', anulado: { $ne: true } });
      if (yaPagado) {
        return res.status(409).json({ error: 'El Hunter ya se pagó. Para bloquearlo primero anulá ese pago.' });
      }
    }

    torneo.hunterHabilitado = habilitado;
    torneo.hunterHabilitadoPor = habilitado ? (req.user.username || req.user.sub) : '';
    torneo.hunterHabilitadoEn = habilitado ? new Date() : null;
    await torneo.save();
    res.json({ ok: true, habilitado });
  } catch (err) {
    console.error('Error habilitando el Hunter:', err);
    res.status(500).json({ error: 'Error al cambiar el estado del Hunter.' });
  }
});


// PATCH /api/pagos/:id/anular -> anula un pago (premio, bounty o Hunter).
// Un premio anulado libera el puesto para volver a pagarlo; un bounty
// anulado deja de contar para el Hunter.
router.patch('/:id/anular', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const pago = await Pago.findOneAndUpdate(
      { _id: req.params.id, anulado: { $ne: true } },
      { anulado: true, anuladoPor: req.user.username || req.user.sub, anuladoEn: new Date() },
      { new: true }
    );
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado o ya anulado.' });
    res.json(pago);
  } catch (err) {
    console.error('Error anulando pago:', err);
    res.status(500).json({ error: 'Error al anular el pago.' });
  }
});

module.exports = router;
