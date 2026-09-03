const express = require('express');
const Tournament = require('../models/Tournament');
const { requireAuth, requireRole } = require('../middleware/auth');
const { diaOperativo } = require('../utils/diaOperativo');

const router = express.Router();

router.get('/', requireAuth, requireRole('caja'), async (req, res) => {
  try {
    const activo = await Tournament
      .findOne({ activo: true })
      .sort({ createdAt: -1 });

    if (!activo) {
      return res.json({
        nombre: 'Sin configurar',
        buyIn: 0,
        recompra: 0,
        fecha: diaOperativo(),
        activo: false
      });
    }

    res.json(activo);

  } catch (err) {
    console.error('Error al obtener torneo en Caja:', err);

    res.status(500).json({
      error: 'Error al obtener el torneo.'
    });
  }
});

module.exports = router;