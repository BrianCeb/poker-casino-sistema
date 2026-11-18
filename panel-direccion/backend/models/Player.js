const mongoose = require('mongoose');
// Nombre y apellido se guardan SIEMPRE con la inicial de cada palabra en
// mayuscula y el resto en minuscula, sin espacios de mas, se escriban como
// se escriban (alta, edicion, desde Caja o desde Direccion).
// Ej: "juan  CARLOS" -> "Juan Carlos", "pérez-núñez" -> "Pérez-Núñez".
const formatoNombre = v => String(v == null ? '' : v)
  .replace(/\s+/g, ' ').trim()
  .toLocaleLowerCase('es-AR')
  .replace(/(^|[\s\-'])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase('es-AR'));

const playerSchema = new mongoose.Schema({
  dni: { type: String, required: true, unique: true, trim: true, index: true },
  nombre: { type: String, required: true, trim: true, set: formatoNombre },
  apellido: { type: String, required: true, trim: true, set: formatoNombre },
  telefono: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  fechaAlta: { type: Date, default: Date.now },
  // Un jugador "anulado" no se borra (conserva su historial de compras)
  // pero deja de aparecer en el listado activo ni se puede usar en Caja.
  activo: { type: Boolean, default: true, index: true }
}, { timestamps: true });
module.exports = mongoose.model('Player', playerSchema);