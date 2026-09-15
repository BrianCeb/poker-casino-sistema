const express = require('express');
const Tournament = require('../models/Tournament');
const { requireAuth, requireRole } = require('../middleware/auth');
const { diaOperativo } = require('../utils/diaOperativo');

const router = express.Router();


// ======================================================
// OBTENER TORNEO ACTIVO
// ======================================================

router.get('/', requireAuth, async (req, res) => {
  try {
    const activo = await Tournament
      .findOne({ activo: true })
      .sort({ createdAt: -1 });

    if (!activo) {
      return res.json({
        nombre: 'Sin configurar',
        buyIn: 0,
        recompra: 0,
        rake: 0,
        fecha: diaOperativo(),
        activo: false
      });
    }

    res.json(activo);

  } catch (err) {
    console.error('Error obteniendo torneo:', err);

    res.status(500).json({
      error: 'Error al obtener el torneo.'
    });
  }
});


// ======================================================
// HISTORIAL DE TORNEOS (para el selector de Direccion)
// ======================================================

router.get('/historial', requireAuth, requireRole('direccion'), async (req, res) => {
  try {
    const torneos = await Tournament
      .find({})
      .sort({ fecha: -1, createdAt: -1 })
      .select('nombre fecha buyIn recompra rake activo')
      .lean();

    res.json(torneos);

  } catch (err) {
    console.error('Error obteniendo historial de torneos:', err);

    res.status(500).json({
      error: 'Error al obtener el historial de torneos.'
    });
  }
});


// ======================================================
// CREAR / ACTIVAR TORNEO
// ======================================================

router.post('/', requireAuth, requireRole('direccion'), async (req, res) => {
  try {

    const {
      nombre,
      buyIn,
      recompra,
      rake,
      fecha
    } = req.body || {};

    // Si no mandan fecha, usamos el dia operativo (no medianoche calendario)
    // asi un torneo cargado a las 2 AM se atribuye al dia que realmente
    // corresponde en la operatoria del casino - y coincide con la fecha
    // que van a tener las transacciones que se carguen esa madrugada.
    const torneoFecha = fecha || diaOperativo();

    if (
      !nombre ||
      buyIn == null ||
      recompra == null ||
      rake == null
    ) {
      return res.status(400).json({
        error: 'Nombre, buy-in, recompra y rake son obligatorios.'
      });
    }

    const buyInNum = Number(buyIn);
    const recompraNum = Number(recompra);
    const rakeNum = Number(rake);

    if (
      !Number.isFinite(buyInNum) ||
      !Number.isFinite(recompraNum) ||
      !Number.isFinite(rakeNum)
    ) {
      return res.status(400).json({
        error: 'Los montos deben ser números válidos.'
      });
    }

    if (
      buyInNum < 0 ||
      recompraNum < 0 ||
      rakeNum < 0
    ) {
      return res.status(400).json({
        error: 'Los montos no pueden ser negativos.'
      });
    }

    if (rakeNum > buyInNum) {
      return res.status(400).json({
        error: 'El rake no puede ser mayor que el buy-in.'
      });
    }

    if (recompraNum > 0 && rakeNum > recompraNum) {
      return res.status(400).json({
        error: 'El rake no puede ser mayor que el monto de la recompra.'
      });
    }

    await Tournament.updateMany(
      { activo: true },
      { $set: { activo: false } }
    );

    const nuevo = await Tournament.create({
      nombre: String(nombre).trim(),
      buyIn: buyInNum,
      recompra: recompraNum,
      rake: rakeNum,
      fecha: torneoFecha,
      activo: true
    });

    res.status(201).json(nuevo);

  } catch (err) {

    console.error('Error guardando torneo:', err);

    res.status(500).json({
      error: 'Error al guardar el torneo.'
    });
  }
});


module.exports = router;