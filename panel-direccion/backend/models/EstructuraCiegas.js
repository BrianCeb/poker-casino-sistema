const mongoose = require('mongoose');

// ======================================================
// PLANTILLAS DE ESTRUCTURA DE CIEGAS
// ======================================================
// Estructuras reutilizables ("Funny Sundays", "Turbo", etc.). Cuando
// Direccion configura el reloj de un torneo, elige una plantilla y los
// niveles se COPIAN a RelojTorneo.niveles. Asi, editar el torneo en
// vivo no modifica la plantilla, y editar la plantilla no altera
// torneos ya configurados.
//
// Los campos de cada nivel son los mismos que en RelojTorneo, para que
// la copia sea directa.
// ======================================================

const nivelSchema = new mongoose.Schema({
  tipo: { type: String, enum: ['nivel', 'descanso'], default: 'nivel' },
  sb: { type: Number, min: 0, default: 0 },
  bb: { type: Number, min: 0, default: 0 },
  ante: { type: Number, min: 0, default: 0 },
  minutos: { type: Number, required: true, min: 1 }
}, { _id: false });

const estructuraCiegasSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true, unique: true },

  // Nivel (solo niveles de juego, empezando en 1) al final del cual
  // cierra el registro. Se copia al reloj junto con los niveles; en el
  // torneo se puede cambiar igual. 0 = sin definir.
  cierreRegistroNivel: { type: Number, min: 0, default: 0 },

  niveles: { type: [nivelSchema], default: [] },

  // Igual que jugadores y operaciones: no se borra fisicamente, se
  // desactiva y deja de aparecer para elegir.
  activo: { type: Boolean, default: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model('EstructuraCiegas', estructuraCiegasSchema);