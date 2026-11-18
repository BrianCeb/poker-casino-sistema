const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: true,
    trim: true
  },

  buyIn: {
    type: Number,
    required: true,
    min: 0
  },

  recompra: {
    type: Number,
    required: true,
    min: 0
  },

  rake: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },

  tipo: {
    type: String,
    enum: ['normal', 'mistery_bounty'],
    default: 'normal'
  },

  mbRake: {
    type: Number,
    min: 0,
    default: 0
  },

  mbBounty: {
    type: Number,
    min: 0,
    default: 0
  },

  // HUNTER (solo torneos con bounty): monto fijo por Buy-in y Re-Entry
  // que sale de la parte que iba al pozo y arma la bolsa del premio
  // Hunter (para el jugador que mas bounties cobra).
  hunterAporte: {
    type: Number,
    min: 0,
    default: 0
  },

  // Direccion puede habilitar el pago del Hunter a mano (por ejemplo,
  // si el bounty del ganador no se cobra como ticket). Si no, se habilita
  // solo cuando se pagaron todos los bounties.
  hunterHabilitado: {
    type: Boolean,
    default: false
  },

  hunterHabilitadoPor: {
    type: String,
    default: ''
  },

  hunterHabilitadoEn: {
    type: Date,
    default: null
  },

  fecha: {
    type: String,
    required: true,
    index: true
  },

  activo: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true
});

tournamentSchema.index({ fecha: 1, activo: 1 });

module.exports = mongoose.model('Tournament', tournamentSchema);