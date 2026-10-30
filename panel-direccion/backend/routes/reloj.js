const express = require('express');
const Tournament = require('../models/Tournament');
const Transaction = require('../models/Transaction');
const RelojTorneo = require('../models/RelojTorneo');
const RelojPrueba = require('../models/RelojPrueba');
const EstructuraCiegas = require('../models/EstructuraCiegas');
const PlantillaPremios = require('../models/PlantillaPremios');
const { PLANTILLAS_INICIALES } = require('../data/plantillasIniciales');
const { requireAuth, requireRole } = require('../middleware/auth');
const { diaOperativo } = require('../utils/diaOperativo');
const { TEMAS, esTemaValido, getTema, setTema } = require('../utils/relojTemas');
const {
  estadoEfectivo,
  entradaEn,
  segundosDe,
  armarVista,
  validarNiveles,
  validarPremios,
  tablaAutomatica,
  transaccionesDePrueba
} = require('../utils/relojCalculos');

const router = express.Router();
const soloDireccion = [requireAuth, requireRole('direccion')];


// ======================================================
// HELPERS
// ======================================================

// Carga las plantillas iniciales (Funny Sundays, etc.) si todavia no
// existen. Se ejecuta una sola vez por arranque del servidor; si
// Direccion ya edito o desactivo una plantilla, no se toca.
let plantillasAseguradas = false;
async function asegurarPlantillasIniciales() {
  if (plantillasAseguradas) return;
  for (const p of PLANTILLAS_INICIALES) {
    await EstructuraCiegas.updateOne(
      { nombre: p.nombre },
      { $setOnInsert: p },
      { upsert: true }
    );
  }
  plantillasAseguradas = true;
}

async function torneoActivo() {
  return Tournament.findOne({ activo: true }).sort({ createdAt: -1 }).lean();
}

// Devuelve el reloj del torneo. Si es la primera vez que se usa en ese
// torneo, lo crea copiando la CONFIGURACION del reloj del torneo
// anterior (stacks, estructura, premios), para no cargar todo de nuevo
// cada dia. El ESTADO (nivel, tiempo, eliminaciones) arranca de cero.
async function obtenerReloj(torneoId) {
  const existente = await RelojTorneo.findOne({ torneoId });
  if (existente) return existente;

  const anterior = await RelojTorneo.findOne({ torneoId: { $ne: torneoId } })
    .sort({ createdAt: -1 })
    .lean();

  const config = anterior ? {
    stackInicial: anterior.stackInicial,
    stackReentry: anterior.stackReentry,
    reentradasIlimitadas: anterior.reentradasIlimitadas,
    maxReentradas: anterior.maxReentradas,
    cierreRegistroNivel: anterior.cierreRegistroNivel,
    porcentajePagados: anterior.porcentajePagados,
    redondeoPremios: anterior.redondeoPremios,
    jugadoresMesaFinal: anterior.jugadoresMesaFinal,
    niveles: anterior.niveles,
    premios: anterior.premios,
    premiosPlantilla: anterior.premiosPlantilla || ''
  } : {};

  try {
    return await RelojTorneo.create({ torneoId, ...config });
  } catch (err) {
    // Si dos pantallas lo crearon al mismo tiempo, gana el primero.
    if (err.code === 11000) return RelojTorneo.findOne({ torneoId });
    throw err;
  }
}

// Campos de CONFIGURACION del reloj (lo que se copia a la prueba y lo
// que se aplica de vuelta al torneo real). El estado del reloj, las
// eliminaciones y las cantidades ficticias nunca se copian.
const CAMPOS_CONFIG = [
  'stackInicial', 'stackReentry', 'reentradasIlimitadas', 'maxReentradas',
  'cierreRegistroNivel', 'porcentajePagados', 'redondeoPremios', 'niveles', 'premios',
  'premiosPlantilla', 'jugadoresMesaFinal'
];

function copiarConfig(origen) {
  const config = {};
  for (const campo of CAMPOS_CONFIG) {
    if (origen[campo] !== undefined) config[campo] = JSON.parse(JSON.stringify(origen[campo]));
  }
  return config;
}

// Devuelve la copia de prueba del reloj del torneo. La primera vez la
// crea copiando la configuracion del reloj real, con el reloj detenido.
async function obtenerRelojPrueba(torneoId, real) {
  const existente = await RelojPrueba.findOne({ torneoId });
  if (existente) return existente;
  try {
    return await RelojPrueba.create({ torneoId, ...copiarConfig(real.toObject()) });
  } catch (err) {
    if (err.code === 11000) return RelojPrueba.findOne({ torneoId });
    throw err;
  }
}

// El reloj sobre el que trabaja Direccion: si el modo prueba esta
// activo, la copia de prueba; si no, el real. Todas las rutas que
// modifican algo usan esto, asi en modo prueba nunca tocan el real.
async function relojDeTrabajo(torneo) {
  const real = await obtenerReloj(torneo._id);
  if (real.prueba && real.prueba.activa) {
    return { reloj: await obtenerRelojPrueba(torneo._id, real), real, enPrueba: true };
  }
  return { reloj: real, real, enPrueba: false };
}

// Datos del torneo con los que se calcula la vista. En modo prueba, si
// la copia tiene un tipo de torneo simulado (torneoPrueba.usar), se usan
// esos montos en lugar de los del torneo real.
function torneoEfectivo(torneo, reloj, enPrueba) {
  const tp = reloj.torneoPrueba;
  if (!enPrueba || !tp || !tp.usar) return torneo;
  return {
    ...torneo,
    tipo: tp.tipo,
    buyIn: tp.buyIn,
    recompra: tp.recompra,
    rake: tp.tipo === 'mistery_bounty' ? tp.mbRake : tp.rake,
    mbRake: tp.mbRake,
    mbBounty: tp.mbBounty
  };
}

// Valida el tipo de torneo simulado (mismas reglas que al crear un
// torneo en Direccion). Devuelve { datos } o { error }.
function validarTorneoPrueba(t) {
  const tipo = t && t.tipo === 'mistery_bounty' ? 'mistery_bounty' : 'normal';
  const num = campo => Number((t || {})[campo] || 0);
  const datos = {
    usar: true,
    tipo,
    buyIn: num('buyIn'),
    recompra: num('recompra'),
    rake: num('rake'),
    mbRake: num('mbRake'),
    mbBounty: num('mbBounty')
  };
  const valores = [datos.buyIn, datos.recompra, datos.rake, datos.mbRake, datos.mbBounty];
  if (valores.some(v => !Number.isFinite(v) || v < 0)) return { error: 'Los montos deben ser números mayores o iguales a 0.' };
  if (datos.buyIn <= 0) return { error: 'El buy-in de prueba tiene que ser mayor a 0.' };
  if (tipo === 'mistery_bounty') {
    const fijo = datos.mbRake + datos.mbBounty;
    if (fijo > datos.buyIn) return { error: 'La suma de Rake y Bounty no puede superar el buy-in.' };
    if (datos.recompra > 0 && fijo > datos.recompra) return { error: 'La suma de Rake y Bounty no puede superar la re-entrada.' };
    datos.rake = datos.mbRake;
  } else {
    if (datos.rake > datos.buyIn) return { error: 'El rake no puede ser mayor que el buy-in.' };
    if (datos.recompra > 0 && datos.rake > datos.recompra) return { error: 'El rake no puede ser mayor que la re-entrada.' };
    datos.mbRake = 0;
    datos.mbBounty = 0;
  }
  return { datos };
}

// Con el reloj andando, los niveles ya jugados no se pueden cambiar.
// Devuelve un mensaje de error o null.
function errorCambioNiveles(reloj, niveles) {
  if (reloj.estado === 'detenido') return null;
  const jugados = Math.min(reloj.nivelActual, reloj.niveles.length);
  if (niveles.length < jugados) return 'No se pueden borrar niveles que ya se jugaron.';
  for (let i = 0; i < jugados; i++) {
    const a = reloj.niveles[i];
    const n = niveles[i];
    if (a.tipo !== n.tipo || a.sb !== n.sb || a.bb !== n.bb || a.ante !== n.ante || a.minutos !== n.minutos) {
      return `La fila ${i + 1} ya se jugó y no se puede modificar.`;
    }
  }
  return null;
}

// Mismo criterio que el control del dia y el Excel: las operaciones del
// dia operativo actual (corte 06:00), sin las anuladas.
async function transaccionesDelDia() {
  return Transaction.find({ fecha: diaOperativo(), anulado: { $ne: true } })
    .select('tipo monto desglose')
    .lean();
}

// "Probar anuncio" del panel: queda en memoria 30 segundos para que la
// TV lo tome en su próxima consulta. No se guarda en la base.
let anuncioPrueba = null;

// Vista de la pantalla + el tema (apariencia) elegido para la TV.
async function vistaActual() {
  const vista = await vistaDelTorneo();
  vista.tema = await getTema();
  if (anuncioPrueba && Date.now() - anuncioPrueba.id < 30000) vista.anuncioPrueba = anuncioPrueba;
  return vista;
}

async function vistaDelTorneo() {
  const torneo = await torneoActivo();
  if (!torneo) return { sinTorneo: true, serverNow: Date.now() };

  const trabajo = await relojDeTrabajo(torneo);
  const reloj = trabajo.reloj.toObject();
  const enPrueba = trabajo.enPrueba;

  // En modo prueba se muestra la copia de prueba con las cantidades
  // ficticias; las operaciones reales ni se consultan.
  const torneoVista = torneoEfectivo(torneo, reloj, enPrueba);
  const transaccionesActivas = enPrueba
    ? transaccionesDePrueba(torneoVista, reloj.prueba || {})
    : await transaccionesDelDia();

  const vista = armarVista({ torneo: torneoVista, reloj, transaccionesActivas });
  vista.modoPrueba = enPrueba;
  // Aviso si el torneo activo quedo configurado de otro dia (se olvidaron
  // de cargar el torneo de hoy). Los numeros igual son los de hoy.
  vista.torneoDeOtroDia = torneo.fecha !== diaOperativo();
  return vista;
}

// Lleva lo guardado al estado real de "ahora": si el reloj estaba
// corriendo y paso de nivel solo, deja guardado el nivel correcto y los
// segundos que van. Se llama antes de cada accion.
function normalizar(reloj, ahora) {
  if (reloj.estado !== 'corriendo') return;
  const ef = estadoEfectivo(reloj.toObject(), ahora);
  reloj.nivelActual = ef.indice;
  reloj.segundosConsumidos = ef.transcurridos;
  reloj.inicioNivel = ahora;
}


// ======================================================
// PANTALLA (TV) - solo lectura
// ======================================================
// Sin login a proposito: la TV no deberia pedir usuario y contraseña.
// Solo devuelve lo mismo que se ve en la pantalla del salon (sin
// nombres ni DNI), y el servidor escucha unicamente en 127.0.0.1.

router.get('/pantalla', async (req, res) => {
  try {
    res.json(await vistaActual());
  } catch (err) {
    console.error('Error obteniendo pantalla del reloj:', err);
    res.status(500).json({ error: 'Error al obtener el reloj.' });
  }
});


// ======================================================
// DIRECCION - estado + configuracion
// ======================================================

router.get('/', ...soloDireccion, async (req, res) => {
  try {
    const torneo = await torneoActivo();
    if (!torneo) return res.json({ sinTorneo: true, serverNow: Date.now(), tema: await getTema(), temas: TEMAS });

    const { reloj, enPrueba } = await relojDeTrabajo(torneo);
    const vista = await vistaActual();
    const r = reloj.toObject();
    const copia = enPrueba ? r : await RelojPrueba.findOne({ torneoId: torneo._id }).lean();

    res.json({
      ...vista,
      temas: TEMAS,
      config: {
        stackInicial: r.stackInicial,
        stackReentry: r.stackReentry,
        reentradasIlimitadas: r.reentradasIlimitadas,
        maxReentradas: r.maxReentradas,
        cierreRegistroNivel: r.cierreRegistroNivel,
        porcentajePagados: r.porcentajePagados,
        redondeoPremios: r.redondeoPremios,
        jugadoresMesaFinal: r.jugadoresMesaFinal === undefined ? 8 : r.jugadoresMesaFinal,
        niveles: r.niveles,
        premios: r.premios,
        premiosPlantilla: r.premiosPlantilla || ''
      },
      prueba: {
        activa: enPrueba,
        existeCopia: !!copia,
        // Tipo de torneo y montos de la prueba (los simulados, o los del
        // torneo real si no se cambiaron).
        torneo: (() => {
          const t = torneoEfectivo(torneo, copia || {}, true);
          return {
            simulado: !!(copia && copia.torneoPrueba && copia.torneoPrueba.usar),
            tipo: t.tipo || 'normal',
            buyIn: Number(t.buyIn || 0),
            recompra: Number(t.recompra || 0),
            rake: Number(t.rake || 0),
            mbRake: Number(t.mbRake || 0),
            mbBounty: Number(t.mbBounty || 0)
          };
        })(),
        buyins: (copia && copia.prueba && copia.prueba.buyins) || 0,
        reentradas: (copia && copia.prueba && copia.prueba.reentradas) || 0
      }
    });
  } catch (err) {
    console.error('Error obteniendo reloj:', err);
    res.status(500).json({ error: 'Error al obtener el reloj.' });
  }
});

// POST /api/reloj/probar-anuncio -> body { tipo: 'burbuja' | 'festejo' }
// Muestra en la TV el anuncio grande, para verlo sin esperar una burbuja.
router.post('/probar-anuncio', ...soloDireccion, (req, res) => {
  const tipo = (req.body || {}).tipo === 'festejo' ? 'festejo' : 'burbuja';
  anuncioPrueba = { id: Date.now(), tipo };
  res.json({ ok: true, tipo });
});

// PUT /api/reloj/tema -> apariencia de la pantalla de la TV. Es un
// ajuste general (no depende del torneo ni del modo prueba).
router.put('/tema', ...soloDireccion, async (req, res) => {
  try {
    const tema = req.body && req.body.tema;
    if (!esTemaValido(tema)) return res.status(400).json({ error: 'Tema de pantalla no válido.' });
    await setTema(tema);
    res.json({ tema });
  } catch (err) {
    console.error('Error guardando tema del reloj:', err);
    res.status(500).json({ error: 'Error al guardar la apariencia de la pantalla.' });
  }
});

// PUT /api/reloj/config -> stacks, re-entradas, cierre de registro,
// premios. Solo actualiza los campos que vienen en el body.
router.put('/config', ...soloDireccion, async (req, res) => {
  try {
    const torneo = await torneoActivo();
    if (!torneo) return res.status(409).json({ error: 'No hay un torneo activo configurado.' });

    const b = req.body || {};
    const update = {};

    const enteroNoNegativo = (campo, etiqueta) => {
      if (b[campo] === undefined) return null;
      const v = Number(b[campo]);
      if (!Number.isInteger(v) || v < 0) return `${etiqueta} debe ser un número entero mayor o igual a 0.`;
      update[campo] = v;
      return null;
    };

    const errores = [
      enteroNoNegativo('stackInicial', 'El stack inicial'),
      enteroNoNegativo('stackReentry', 'El stack de re-entry'),
      enteroNoNegativo('maxReentradas', 'El máximo de re-entradas'),
      enteroNoNegativo('cierreRegistroNivel', 'El nivel de cierre de registro'),
      enteroNoNegativo('redondeoPremios', 'El redondeo de premios'),
      enteroNoNegativo('jugadoresMesaFinal', 'Los jugadores de la mesa final')
    ].filter(Boolean);
    if (errores.length) return res.status(400).json({ error: errores[0] });

    if (b.reentradasIlimitadas !== undefined) update.reentradasIlimitadas = Boolean(b.reentradasIlimitadas);

    if (b.porcentajePagados !== undefined) {
      const pct = Number(b.porcentajePagados);
      if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
        return res.status(400).json({ error: 'El porcentaje que cobra debe estar entre 1 y 100.' });
      }
      update.porcentajePagados = pct;
    }

    if (b.premios !== undefined) {
      const v = validarPremios(b.premios);
      if (v.error) return res.status(400).json({ error: v.error });
      update.premios = v.premios;
      // Tabla editada a mano: ya no es exactamente la plantilla aplicada.
      update.premiosPlantilla = '';
    }

    const { reloj } = await relojDeTrabajo(torneo);
    reloj.set(update);
    await reloj.save();

    res.json(await vistaActual());
  } catch (err) {
    console.error('Error guardando config del reloj:', err);
    res.status(500).json({ error: 'Error al guardar la configuración del reloj.' });
  }
});

// PUT /api/reloj/niveles -> body { niveles }
// Con el reloj andando, los niveles ya jugados no se pueden cambiar;
// el actual y los que siguen, si (por ej. alargar un nivel o agregar
// un descanso).
router.put('/niveles', ...soloDireccion, async (req, res) => {
  try {
    const torneo = await torneoActivo();
    if (!torneo) return res.status(409).json({ error: 'No hay un torneo activo configurado.' });

    const v = validarNiveles((req.body || {}).niveles);
    if (v.error) return res.status(400).json({ error: v.error });

    const { reloj } = await relojDeTrabajo(torneo);
    normalizar(reloj, new Date());

    const errorNiveles = errorCambioNiveles(reloj, v.niveles);
    if (errorNiveles) return res.status(409).json({ error: errorNiveles });

    reloj.niveles = v.niveles;
    await reloj.save();
    res.json(await vistaActual());
  } catch (err) {
    console.error('Error guardando niveles del reloj:', err);
    res.status(500).json({ error: 'Error al guardar la estructura.' });
  }
});

// POST /api/reloj/aplicar-plantilla -> body { plantillaId }
// Copia la estructura (y el cierre de registro) de la plantilla al
// reloj del torneo. Solo con el reloj detenido, para no pisar un
// torneo en juego.
router.post('/aplicar-plantilla', ...soloDireccion, async (req, res) => {
  try {
    const torneo = await torneoActivo();
    if (!torneo) return res.status(409).json({ error: 'No hay un torneo activo configurado.' });

    const plantilla = await EstructuraCiegas.findOne({ _id: (req.body || {}).plantillaId, activo: true }).lean();
    if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada.' });

    const { reloj } = await relojDeTrabajo(torneo);
    if (reloj.estado !== 'detenido') {
      return res.status(409).json({ error: 'El reloj ya arrancó. Reinicialo antes de cambiar de estructura.' });
    }

    reloj.niveles = plantilla.niveles;
    if (plantilla.cierreRegistroNivel > 0) reloj.cierreRegistroNivel = plantilla.cierreRegistroNivel;
    reloj.nivelActual = 0;
    reloj.segundosConsumidos = 0;
    reloj.inicioNivel = null;
    await reloj.save();

    res.json(await vistaActual());
  } catch (err) {
    console.error('Error aplicando plantilla:', err);
    res.status(500).json({ error: 'Error al aplicar la plantilla.' });
  }
});


// GET /api/reloj/premios/automatica?porcentaje=12.5&hasta=200
// Tabla automatica en tramos, para el editor de premios (sirve de base
// para armar una tabla personalizada).
router.get('/premios/automatica', ...soloDireccion, (req, res) => {
  const pct = Number(req.query.porcentaje || 12.5);
  const hasta = Math.min(1000, Math.max(8, Number(req.query.hasta || 200)));
  if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
    return res.status(400).json({ error: 'Porcentaje inválido.' });
  }
  res.json(tablaAutomatica(pct, hasta));
});


// ======================================================
// PLANTILLAS DE PREMIOS
// ======================================================

router.get('/plantillas-premios', ...soloDireccion, async (req, res) => {
  try {
    const plantillas = await PlantillaPremios.find({ activo: true })
      .collation({ locale: 'es', strength: 1 })
      .sort({ nombre: 1 })
      .lean();
    res.json(plantillas);
  } catch (err) {
    console.error('Error listando plantillas de premios:', err);
    res.status(500).json({ error: 'Error al listar las tablas de premios.' });
  }
});

function leerPlantillaPremios(body) {
  const b = body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return { error: 'El nombre de la tabla es obligatorio.' };
  const v = validarPremios(b.premios);
  if (v.error) return v;
  if (!v.premios.length) return { error: 'La tabla tiene que tener al menos un rango.' };
  return { datos: { nombre, premios: v.premios } };
}

router.post('/plantillas-premios', ...soloDireccion, async (req, res) => {
  try {
    const p = leerPlantillaPremios(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    res.status(201).json(await PlantillaPremios.create(p.datos));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Ya existe una tabla con ese nombre (puede estar borrada).' });
    console.error('Error creando plantilla de premios:', err);
    res.status(500).json({ error: 'Error al guardar la tabla de premios.' });
  }
});

router.put('/plantillas-premios/:id', ...soloDireccion, async (req, res) => {
  try {
    const p = leerPlantillaPremios(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    const plantilla = await PlantillaPremios.findOneAndUpdate(
      { _id: req.params.id, activo: true },
      p.datos,
      { new: true, runValidators: true }
    );
    if (!plantilla) return res.status(404).json({ error: 'Tabla no encontrada.' });
    res.json(plantilla);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Ya existe una tabla con ese nombre (puede estar borrada).' });
    console.error('Error editando plantilla de premios:', err);
    res.status(500).json({ error: 'Error al guardar la tabla de premios.' });
  }
});

// No se borra: se desactiva. Los torneos que ya la usan conservan su copia.
router.delete('/plantillas-premios/:id', ...soloDireccion, async (req, res) => {
  try {
    const plantilla = await PlantillaPremios.findOneAndUpdate(
      { _id: req.params.id, activo: true },
      { activo: false },
      { new: true }
    );
    if (!plantilla) return res.status(404).json({ error: 'Tabla no encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error desactivando plantilla de premios:', err);
    res.status(500).json({ error: 'Error al borrar la tabla de premios.' });
  }
});

// POST /api/reloj/aplicar-plantilla-premios -> body { plantillaId }
// plantillaId = 'automatica' vuelve a la formula. Se aplica al reloj de
// trabajo (la copia, si el modo prueba esta activo).
router.post('/aplicar-plantilla-premios', ...soloDireccion, async (req, res) => {
  try {
    const torneo = await torneoActivo();
    if (!torneo) return res.status(409).json({ error: 'No hay un torneo activo configurado.' });

    const id = (req.body || {}).plantillaId;
    const { reloj } = await relojDeTrabajo(torneo);

    if (id === 'automatica') {
      reloj.premios = [];
      reloj.premiosPlantilla = '';
    } else {
      const plantilla = await PlantillaPremios.findOne({ _id: id, activo: true }).lean();
      if (!plantilla) return res.status(404).json({ error: 'Tabla no encontrada.' });
      reloj.premios = plantilla.premios;
      reloj.premiosPlantilla = plantilla.nombre;
    }

    await reloj.save();
    res.json(await vistaActual());
  } catch (err) {
    console.error('Error aplicando plantilla de premios:', err);
    res.status(500).json({ error: 'Error al aplicar la tabla de premios.' });
  }
});


// ======================================================
// MODO PRUEBA (copia aislada)
// ======================================================
// PUT /api/reloj/prueba -> body { activa?, buyins?, reentradas?, reiniciar?, recopiar?, torneo? }
//   torneo     : { tipo, buyIn, recompra, rake, mbRake, mbBounty } para simular
//                otro tipo de torneo, o 'real' para volver a los datos del
//                torneo activo. Nunca modifica el torneo real.
//   activa     : prende / apaga el modo prueba (Direccion y la TV pasan a
//                trabajar con la copia de prueba).
//   buyins / reentradas : cantidades ficticias de la copia.
//   reiniciar  : pone jugadores, re-entradas y eliminados de prueba en 0.
//   recopiar   : descarta los cambios de la copia y la vuelve a copiar
//                del torneo real (con el reloj de prueba detenido).
// No crea operaciones ni modifica el reloj real (salvo el aviso "activa").

router.put('/prueba', ...soloDireccion, async (req, res) => {
  try {
    const torneo = await torneoActivo();
    if (!torneo) return res.status(409).json({ error: 'No hay un torneo activo configurado.' });

    const b = req.body || {};

    const cantidades = {};
    for (const campo of ['buyins', 'reentradas']) {
      if (b[campo] === undefined) continue;
      const v = Number(b[campo]);
      if (!Number.isInteger(v) || v < 0 || v > 2000) {
        return res.status(400).json({ error: 'Las cantidades de prueba deben ser enteros entre 0 y 2000.' });
      }
      cantidades[campo] = v;
    }

    // Se valida antes de guardar nada.
    let torneoSimulado = null;
    if (b.torneo !== undefined && b.torneo !== 'real') {
      const vt = validarTorneoPrueba(b.torneo);
      if (vt.error) return res.status(400).json({ error: vt.error });
      torneoSimulado = vt.datos;
    }

    const real = await obtenerReloj(torneo._id);
    if (b.activa !== undefined) {
      real.set('prueba.activa', Boolean(b.activa));
      await real.save();
    }

    const copia = await obtenerRelojPrueba(torneo._id, real);

    if (b.torneo !== undefined) {
      if (torneoSimulado) copia.set('torneoPrueba', torneoSimulado);
      else copia.set('torneoPrueba.usar', false);
    }

    if (b.recopiar) {
      copia.set('torneoPrueba.usar', false);
      copia.set(copiarConfig(real.toObject()));
      copia.estado = 'detenido';
      copia.nivelActual = 0;
      copia.segundosConsumidos = 0;
      copia.inicioNivel = null;
      copia.eliminaciones = 0;
      copia.renuncias = [];
    }
    if (b.reiniciar) {
      cantidades.buyins = 0;
      cantidades.reentradas = 0;
      copia.eliminaciones = 0;
      copia.renuncias = [];
    }
    for (const [campo, v] of Object.entries(cantidades)) copia.set('prueba.' + campo, v);

    // Nunca mas eliminados que jugadores - 1.
    const buyins = (copia.prueba && copia.prueba.buyins) || 0;
    copia.eliminaciones = Math.max(0, Math.min(copia.eliminaciones || 0, buyins - 1));

    await copia.save();
    res.json(await vistaActual());
  } catch (err) {
    console.error('Error en modo prueba:', err);
    res.status(500).json({ error: 'Error al actualizar el modo prueba.' });
  }
});

// POST /api/reloj/prueba/aplicar
// Pasa la CONFIGURACION de la copia de prueba (estructura, premios,
// stacks, cierre de registro, % y redondeo) al torneo real. El estado del
// reloj real (nivel, tiempo) y sus eliminados no se tocan.
router.post('/prueba/aplicar', ...soloDireccion, async (req, res) => {
  try {
    const torneo = await torneoActivo();
    if (!torneo) return res.status(409).json({ error: 'No hay un torneo activo configurado.' });

    const copia = await RelojPrueba.findOne({ torneoId: torneo._id });
    if (!copia) return res.status(404).json({ error: 'No hay una prueba para aplicar.' });

    const real = await obtenerReloj(torneo._id);
    normalizar(real, new Date());

    const config = copiarConfig(copia.toObject());
    const errorNiveles = errorCambioNiveles(real, config.niveles || []);
    if (errorNiveles) {
      return res.status(409).json({
        error: `No se puede aplicar: el torneo real ya está en juego. ${errorNiveles}`
      });
    }

    real.set(config);
    await real.save();
    res.json(await vistaActual());
  } catch (err) {
    console.error('Error aplicando la prueba:', err);
    res.status(500).json({ error: 'Error al aplicar los cambios de la prueba.' });
  }
});


// ======================================================
// CONTROLES DEL RELOJ
// ======================================================
// POST /api/reloj/accion -> body { accion, segundos? }
//   iniciar | pausar | reanudar | siguiente | anterior |
//   ajustar (segundos: + agrega tiempo, - quita) | reiniciar |
//   finalizar | eliminar (+1 eliminacion) | deshacerEliminacion

router.post('/accion', ...soloDireccion, async (req, res) => {
  try {
    const torneo = await torneoActivo();
    if (!torneo) return res.status(409).json({ error: 'No hay un torneo activo configurado.' });

    const { accion, segundos } = req.body || {};
    const { reloj, enPrueba } = await relojDeTrabajo(torneo);
    const ahora = new Date();
    normalizar(reloj, ahora);

    const corriendo = reloj.estado === 'corriendo';
    const irANivel = indice => {
      reloj.nivelActual = Math.max(0, indice);
      reloj.segundosConsumidos = 0;
      reloj.inicioNivel = corriendo ? ahora : null;
    };

    switch (accion) {
      case 'iniciar':
        if (reloj.estado !== 'detenido') return res.status(409).json({ error: 'El reloj ya está iniciado.' });
        if (!reloj.niveles.length) return res.status(409).json({ error: 'Cargá la estructura de ciegas antes de iniciar.' });
        reloj.estado = 'corriendo';
        reloj.inicioNivel = ahora;
        break;

      case 'pausar':
        if (!corriendo) return res.status(409).json({ error: 'El reloj no está corriendo.' });
        reloj.estado = 'pausado';
        reloj.inicioNivel = null;
        break;

      case 'reanudar':
        if (reloj.estado !== 'pausado') return res.status(409).json({ error: 'El reloj no está pausado.' });
        reloj.estado = 'corriendo';
        reloj.inicioNivel = ahora;
        break;

      case 'siguiente':
        irANivel(reloj.nivelActual + 1);
        break;

      case 'anterior':
        irANivel(reloj.nivelActual - 1);
        break;

      case 'ajustar': {
        const s = Number(segundos);
        if (!Number.isFinite(s) || s === 0 || Math.abs(s) > 3600) {
          return res.status(400).json({ error: 'El ajuste debe ser un número de segundos distinto de 0 (máximo 1 hora).' });
        }
        const entrada = entradaEn(reloj.toObject().niveles, reloj.nivelActual);
        if (!entrada) return res.status(409).json({ error: 'No hay estructura cargada.' });
        // Agregar tiempo = descontar segundos consumidos. No puede quedar
        // mas tiempo que la duracion del nivel ni menos que 0.
        const nuevo = reloj.segundosConsumidos - s;
        reloj.segundosConsumidos = Math.min(segundosDe(entrada), Math.max(0, nuevo));
        break;
      }

      case 'reiniciar':
        reloj.estado = 'detenido';
        reloj.nivelActual = 0;
        reloj.segundosConsumidos = 0;
        reloj.inicioNivel = null;
        break;

      case 'finalizar':
        reloj.estado = 'finalizado';
        reloj.inicioNivel = null;
        break;

      case 'eliminar': {
        // En modo prueba, los jugadores son los ficticios de la copia.
        const buyins = enPrueba
          ? ((reloj.prueba && reloj.prueba.buyins) || 0)
          : await Transaction.countDocuments({ fecha: diaOperativo(), tipo: 'buyin', anulado: { $ne: true } });
        if (reloj.eliminaciones >= buyins - 1) {
          return res.status(409).json({ error: 'No se puede eliminar: quedaría el torneo sin jugadores.' });
        }
        reloj.eliminaciones += 1;
        break;
      }

      case 'deshacerEliminacion':
        if (reloj.eliminaciones <= 0) return res.status(409).json({ error: 'No hay eliminaciones para deshacer.' });
        reloj.eliminaciones -= 1;
        break;

      // Fichas renunciadas (surrender): body { accion, cantidad }
      case 'renunciar': {
        const cantidad = Number((req.body || {}).cantidad);
        if (!Number.isInteger(cantidad) || cantidad <= 0) {
          return res.status(400).json({ error: 'Las fichas renunciadas deben ser un número entero mayor a 0.' });
        }
        if (cantidad > 1e9) return res.status(400).json({ error: 'La cantidad de fichas no es válida.' });
        reloj.renuncias.push({ cantidad, en: new Date() });
        break;
      }

      case 'deshacerRenuncia':
        if (!reloj.renuncias || !reloj.renuncias.length) {
          return res.status(409).json({ error: 'No hay fichas renunciadas para deshacer.' });
        }
        reloj.renuncias.pop();
        break;

      default:
        return res.status(400).json({ error: 'Acción no válida.' });
    }

    await reloj.save();
    res.json(await vistaActual());
  } catch (err) {
    console.error('Error en accion del reloj:', err);
    res.status(500).json({ error: 'Error al ejecutar la acción del reloj.' });
  }
});


// ======================================================
// PLANTILLAS DE ESTRUCTURA
// ======================================================

router.get('/plantillas', ...soloDireccion, async (req, res) => {
  try {
    await asegurarPlantillasIniciales();
    const plantillas = await EstructuraCiegas.find({ activo: true })
      .collation({ locale: 'es', strength: 1 })
      .sort({ nombre: 1 })
      .lean();
    res.json(plantillas);
  } catch (err) {
    console.error('Error listando plantillas:', err);
    res.status(500).json({ error: 'Error al listar las plantillas.' });
  }
});

function leerPlantilla(body) {
  const b = body || {};
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return { error: 'El nombre de la plantilla es obligatorio.' };
  const v = validarNiveles(b.niveles);
  if (v.error) return v;
  if (!v.niveles.length) return { error: 'La plantilla tiene que tener al menos un nivel.' };
  const cierre = b.cierreRegistroNivel === undefined ? 0 : Number(b.cierreRegistroNivel);
  if (!Number.isInteger(cierre) || cierre < 0) return { error: 'El nivel de cierre de registro debe ser un entero mayor o igual a 0.' };
  return { datos: { nombre, niveles: v.niveles, cierreRegistroNivel: cierre } };
}

router.post('/plantillas', ...soloDireccion, async (req, res) => {
  try {
    const p = leerPlantilla(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    const plantilla = await EstructuraCiegas.create(p.datos);
    res.status(201).json(plantilla);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Ya existe una plantilla con ese nombre (puede estar desactivada).' });
    console.error('Error creando plantilla:', err);
    res.status(500).json({ error: 'Error al crear la plantilla.' });
  }
});

router.put('/plantillas/:id', ...soloDireccion, async (req, res) => {
  try {
    const p = leerPlantilla(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    const plantilla = await EstructuraCiegas.findOneAndUpdate(
      { _id: req.params.id, activo: true },
      p.datos,
      { new: true, runValidators: true }
    );
    if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada.' });
    res.json(plantilla);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Ya existe una plantilla con ese nombre (puede estar desactivada).' });
    console.error('Error editando plantilla:', err);
    res.status(500).json({ error: 'Error al editar la plantilla.' });
  }
});

// No se borra: se desactiva (mismo criterio que jugadores y operaciones).
router.delete('/plantillas/:id', ...soloDireccion, async (req, res) => {
  try {
    const plantilla = await EstructuraCiegas.findOneAndUpdate(
      { _id: req.params.id, activo: true },
      { activo: false },
      { new: true }
    );
    if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error desactivando plantilla:', err);
    res.status(500).json({ error: 'Error al desactivar la plantilla.' });
  }
});

module.exports = router;