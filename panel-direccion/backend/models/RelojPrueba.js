const mongoose = require('mongoose');
const RelojTorneo = require('./RelojTorneo');

// ======================================================
// RELOJ DE PRUEBA
// ======================================================
// Copia aislada del reloj de un torneo, para probar cambios (estructura,
// premios, configuracion, reloj, sonidos) con jugadores ficticios sin
// tocar el torneo real. Usa exactamente el mismo esquema que
// RelojTorneo, pero se guarda en otra coleccion ("relojpruebas"), asi
// nunca se mezcla con los relojes reales.
//
// Los cambios se pasan al torneo real solo cuando Direccion toca
// "Aplicar al torneo real".
// ======================================================

module.exports = mongoose.model('RelojPrueba', RelojTorneo.schema.clone());