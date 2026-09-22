const mongoose = require('mongoose');

// Configuraciones generales del sistema, guardadas como clave/valor.
// Por ahora se usa solo para "cantidadMesas" (Rotación), pero sirve para
// cualquier otro ajuste que a futuro se quiera hacer editable sin tocar
// código.
const configSchema = new mongoose.Schema({
  clave: { type: String, required: true, unique: true },
  valor: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Config', configSchema);