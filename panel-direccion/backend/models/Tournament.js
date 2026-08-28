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
