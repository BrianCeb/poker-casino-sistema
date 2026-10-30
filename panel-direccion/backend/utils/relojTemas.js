const Config = require('../models/Config');

// Temas (apariencias) de la pantalla del reloj. El diseño de cada uno
// está en renderer/reloj.html (clase "tema-<id>" en el body). Para
// agregar uno nuevo: sumarlo acá y agregar sus estilos en reloj.html.
//
// El tema elegido es un ajuste general de la pantalla (no del torneo),
// así que se guarda en la colección Config, igual que la cantidad de
// mesas de Rotación.
const TEMAS = [
  { id: 'clasico', nombre: 'Clásica · fondo oscuro, dorado, tipografía Anton', fondo: 'reloj-fondo.jpg' },
  { id: 'crema', nombre: 'Crema y dorado oscuro · tipografía Oswald', fondo: 'reloj-fondo-crema.jpg' },
  { id: 'funny', nombre: 'Funny Sundays · fondo oscuro, nombre en neón', fondo: 'reloj-fondo-funny.jpg' },
  { id: 'bounty', nombre: 'Bounty Hunter · fondo claro con logo, tipografía Black Ops One', fondo: 'reloj-fondo-bounty.jpg' }
];

const CLAVE = 'relojTema';
const TEMA_POR_DEFECTO = 'clasico';

const esTemaValido = id => TEMAS.some(t => t.id === id);

// Si no se puede leer (por ej. un corte con la base), la pantalla sigue
// andando con el tema por defecto en vez de fallar.
async function getTema() {
  try {
    const doc = await Config.findOne({ clave: CLAVE }).lean();
    return doc && esTemaValido(doc.valor) ? doc.valor : TEMA_POR_DEFECTO;
  } catch (err) {
    console.error('No se pudo leer el tema del reloj:', err.message);
    return TEMA_POR_DEFECTO;
  }
}

async function setTema(id) {
  await Config.findOneAndUpdate(
    { clave: CLAVE },
    { clave: CLAVE, valor: id },
    { upsert: true }
  );
}

module.exports = { TEMAS, TEMA_POR_DEFECTO, esTemaValido, getTema, setTema };
