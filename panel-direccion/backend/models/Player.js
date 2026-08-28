const mongoose = require('mongoose');
const playerSchema = new mongoose.Schema({
  dni: { type: String, required: true, unique: true, trim: true, index: true },
  nombre: { type: String, required: true, trim: true },
  apellido: { type: String, required: true, trim: true },
  telefono: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  fechaAlta: { type: Date, default: Date.now }
}, { timestamps: true });
module.exports = mongoose.model('Player', playerSchema);
