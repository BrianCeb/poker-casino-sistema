const mongoose = require('mongoose');
const playerSchema = new mongoose.Schema({
  dni: { type: String, required: true, unique: true, trim: true, index: true },
  nombre: { type: String, required: true, trim: true },
  apellido: { type: String, required: true, trim: true },
  telefono: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  fechaAlta: { type: Date, default: Date.now },
  // Un jugador "anulado" no se borra (conserva su historial de compras)
  // pero deja de aparecer en el listado activo ni se puede usar en Caja.
  activo: { type: Boolean, default: true, index: true }
}, { timestamps: true });
module.exports = mongoose.model('Player', playerSchema);