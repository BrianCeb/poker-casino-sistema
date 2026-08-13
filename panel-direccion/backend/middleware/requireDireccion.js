// Proteccion basica por clave compartida para las rutas que solo debe usar
// la PC de Direccion del torneo (alta de jugadores, configuracion del torneo).
// La PC de Caja nunca necesita esta clave.
//
// Esto es un primer nivel de seguridad, no reemplaza un login real con
// usuarios. Si mas adelante quieren login por cajero, se puede agregar
// JWT sin tocar el resto de las rutas.

function requireDireccion(req, res, next) {
  const key = req.headers['x-direccion-key'];
  if (!key || key !== process.env.DIRECCION_API_KEY) {
    return res.status(401).json({ error: 'No autorizado. Falta o es incorrecta la clave de Direccion.' });
  }
  next();
}

module.exports = requireDireccion;
