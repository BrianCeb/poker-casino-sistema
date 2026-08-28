const express = require('express');
const Tournament = require('../models/Tournament');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function todayStr() {
  const d = new Date();

  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}


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
        fecha: todayStr(),
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

    const torneoFecha = fecha || todayStr();

    // ----------------------------------------------
    // Validaciones
    // ----------------------------------------------

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

    // El rake no puede ser mayor que el buy-in
    if (rakeNum > buyInNum) {
      return res.status(400).json({
        error: 'El rake no puede ser mayor que el buy-in.'
      });
    }

    // Como el rake es el mismo para las recompras,
    // tampoco puede ser mayor que el monto de la recompra.
    if (recompraNum > 0 && rakeNum > recompraNum) {
      return res.status(400).json({
        error: 'El rake no puede ser mayor que el monto de la recompra.'
      });
    }


    // ----------------------------------------------
    // Desactivar torneo anterior
    // ----------------------------------------------

    await Tournament.updateMany(
      { activo: true },
      { $set: { activo: false } }
    );


    // ----------------------------------------------
    // Crear nuevo torneo
    // ----------------------------------------------

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
