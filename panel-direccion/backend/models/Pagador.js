const mongoose = require('mongoose');

const pagadorSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  activo: { type: Boolean, default: true },
  // Estado actual: disponible (recien llegado o termino su jornada),
  // en_mesa (trabajando en una mesa puntual) o en_descanso (en pausa).
  estado: { type: String, enum: ['disponible', 'en_mesa', 'en_descanso'], default: 'disponible' },
  mesa: { type: Number, min: 1, max: 13, default: null },
  // Desde cuando esta en el estado actual - es lo que alimenta el
  // cronometro en vivo del frontend.
  desde: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Pagador', pagadorSchema);