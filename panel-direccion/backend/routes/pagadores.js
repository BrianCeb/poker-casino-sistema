const express = require('express');
const Pagador = require('../models/Pagador');
const TurnoPagador = require('../models/TurnoPagador');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getCantidadMesas, setCantidadMesas } = require('../utils/mesasConfig');
const router = express.Router();

// Cierra el turno de trabajo/descanso que este abierto para ese pagador
// (le pone "fin" y calcula cuanto duro), antes de que pase a otro estado.
async function cerrarTurnoActual(pagador) {
    if (pagador.estado === 'en_mesa' || pagador.estado === 'en_descanso') {
        const turnoAbierto = await TurnoPagador.findOne({ pagadorId: pagador._id, fin: null }).sort({ inicio: -1 });
        if (turnoAbierto) {
            const fin = new Date();
            turnoAbierto.fin = fin;
            turnoAbierto.duracionMinutos = Math.round((fin - turnoAbierto.inicio) / 60000);
            await turnoAbierto.save();
        }
    }
}

// GET /api/pagadores -> listado simple (para el formulario de alta / listas)
router.get('/', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const pagadores = await Pagador.find({ activo: { $ne: false } })
            .collation({ locale: 'es', strength: 1 })
            .sort({ nombre: 1 })
            .lean();
        res.json(pagadores);
    } catch (err) { res.status(500).json({ error: 'Error al listar pagadores.' }); }
});

// GET /api/pagadores/cantidad-mesas -> cantidad actual de mesas configurada
router.get('/cantidad-mesas', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const cantidadMesas = await getCantidadMesas();
        res.json({ cantidadMesas });
    } catch (err) { res.status(500).json({ error: 'Error al obtener la cantidad de mesas.' }); }
});

// PUT /api/pagadores/cantidad-mesas -> body { cantidad } -> cambia la cantidad de mesas
router.put('/cantidad-mesas', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const nueva = Number((req.body || {}).cantidad);

        if (!Number.isInteger(nueva) || nueva < 1 || nueva > 60) {
            return res.status(400).json({ error: 'La cantidad de mesas debe ser un número entero entre 1 y 60.' });
        }

        // Si se achica la cantidad, no puede quedar nadie sentado en una
        // mesa que va a dejar de existir.
        const ocupandoFuera = await Pagador.findOne({
            estado: 'en_mesa',
            mesa: { $gt: nueva },
            activo: { $ne: false }
        });

        if (ocupandoFuera) {
            return res.status(409).json({
                error: `No se puede bajar a ${nueva} mesas: ${ocupandoFuera.nombre} está en la Mesa ${ocupandoFuera.mesa}. Movelo o mandalo a descanso primero.`
            });
        }

        await setCantidadMesas(nueva);
        res.json({ cantidadMesas: nueva });
    } catch (err) { res.status(500).json({ error: 'Error al actualizar la cantidad de mesas.' }); }
});

// GET /api/pagadores/tablero -> vista consolidada para la pantalla en vivo
router.get('/tablero', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const cantidadMesas = await getCantidadMesas();
        const pagadores = await Pagador.find({ activo: { $ne: false } }).lean();

        const enMesa = pagadores
            .filter(p => p.estado === 'en_mesa')
            .sort((a, b) => new Date(a.desde) - new Date(b.desde)); // mas antiguo primero

        const enDescanso = pagadores
            .filter(p => p.estado === 'en_descanso')
            .sort((a, b) => new Date(a.desde) - new Date(b.desde)); // mas antiguo primero

        const disponibles = pagadores
            .filter(p => p.estado === 'disponible')
            .sort((a, b) => a.nombre.localeCompare(b.nombre));

        const mesas = [];
        for (let i = 1; i <= cantidadMesas; i++) {
            mesas.push({ mesa: i, pagador: enMesa.find(p => p.mesa === i) || null });
        }

        // Sugerencia: el que mas tiempo lleva en mesa, relevado por el que
        // mas tiempo lleva descansando.
        const sugerido = (enMesa.length > 0 && enDescanso.length > 0)
            ? { relevado: enMesa[0], relevador: enDescanso[0] }
            : null;

        res.json({ mesas, enMesa, enDescanso, disponibles, sugerido, cantidadMesas });
    } catch (err) { res.status(500).json({ error: 'Error al obtener el tablero.' }); }
});

// POST /api/pagadores -> alta de un pagador nuevo (arranca "disponible")
router.post('/', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const { nombre } = req.body || {};
        if (!nombre || !String(nombre).trim()) {
            return res.status(400).json({ error: 'El nombre es obligatorio.' });
        }
        const pagador = await Pagador.create({ nombre: String(nombre).trim() });
        res.status(201).json(pagador);
    } catch (err) { res.status(500).json({ error: 'Error al registrar el pagador.' }); }
});

// PUT /api/pagadores/:id -> editar nombre, o desactivar (activo:false)
router.put('/:id', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const { nombre, activo } = req.body || {};
        const update = {};
        if (nombre !== undefined) {
            if (!String(nombre).trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
            update.nombre = String(nombre).trim();
        }
        if (activo !== undefined) update.activo = Boolean(activo);

        const pagador = await Pagador.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!pagador) return res.status(404).json({ error: 'Pagador no encontrado.' });
        res.json(pagador);
    } catch (err) { res.status(500).json({ error: 'Error al editar el pagador.' }); }
});

// DELETE /api/pagadores/:id -> elimina un pagador.
// Si NUNCA tuvo turnos registrados (ni en mesa ni en descanso), se borra
// de verdad. Si ya tiene historial en TurnoPagador, se conserva ese
// historial y en su lugar se desactiva (activo:false).
router.delete('/:id', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const pagador = await Pagador.findById(req.params.id);
        if (!pagador) return res.status(404).json({ error: 'Pagador no encontrado.' });

        const tieneTurnos = await TurnoPagador.exists({ pagadorId: pagador._id });

        if (tieneTurnos) {
            await Pagador.findByIdAndUpdate(req.params.id, { activo: false });
            return res.json({ ok: true, borradoReal: false });
        }

        await Pagador.deleteOne({ _id: req.params.id });
        res.json({ ok: true, borradoReal: true });

    } catch (err) { res.status(500).json({ error: 'Error al eliminar el pagador.' }); }
});

// POST /api/pagadores/:id/asignar-mesa -> body { mesa }
router.post('/:id/asignar-mesa', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const cantidadMesas = await getCantidadMesas();
        const mesaNum = Number((req.body || {}).mesa);
        if (!Number.isInteger(mesaNum) || mesaNum < 1 || mesaNum > cantidadMesas) {
            return res.status(400).json({ error: `La mesa debe ser un número entre 1 y ${cantidadMesas}.` });
        }

        const pagador = await Pagador.findById(req.params.id);
        if (!pagador) return res.status(404).json({ error: 'Pagador no encontrado.' });

        const ocupada = await Pagador.findOne({ estado: 'en_mesa', mesa: mesaNum, _id: { $ne: pagador._id }, activo: { $ne: false } });
        if (ocupada) return res.status(409).json({ error: `La mesa ${mesaNum} ya está ocupada por ${ocupada.nombre}.` });

        await cerrarTurnoActual(pagador);

        const ahora = new Date();
        pagador.estado = 'en_mesa';
        pagador.mesa = mesaNum;
        pagador.desde = ahora;
        await pagador.save();

        await TurnoPagador.create({ pagadorId: pagador._id, nombre: pagador.nombre, estado: 'en_mesa', mesa: mesaNum, inicio: ahora });

        res.json(pagador);
    } catch (err) { res.status(500).json({ error: 'Error al asignar la mesa.' }); }
});

// POST /api/pagadores/:id/mover-mesa -> body { mesa }
// A diferencia de "asignar-mesa", esto es para un pagador que YA esta
// en una mesa y pasa a otra SIN resetear su tiempo (no toca "desde", no
// cierra/abre turno nuevo - solo actualiza en que mesa esta sentado,
// tanto en el pagador como en el turno abierto actual).
router.post('/:id/mover-mesa', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const cantidadMesas = await getCantidadMesas();
        const mesaNum = Number((req.body || {}).mesa);
        if (!Number.isInteger(mesaNum) || mesaNum < 1 || mesaNum > cantidadMesas) {
            return res.status(400).json({ error: `La mesa debe ser un número entre 1 y ${cantidadMesas}.` });
        }

        const pagador = await Pagador.findById(req.params.id);
        if (!pagador) return res.status(404).json({ error: 'Pagador no encontrado.' });

        if (pagador.estado !== 'en_mesa') {
            return res.status(409).json({ error: 'El pagador no está actualmente en una mesa.' });
        }

        if (pagador.mesa === mesaNum) {
            return res.json(pagador);
        }

        const ocupada = await Pagador.findOne({ estado: 'en_mesa', mesa: mesaNum, _id: { $ne: pagador._id }, activo: { $ne: false } });
        if (ocupada) return res.status(409).json({ error: `La mesa ${mesaNum} ya está ocupada por ${ocupada.nombre}.` });

        pagador.mesa = mesaNum;
        await pagador.save();

        // Actualizamos tambien la mesa del turno que sigue abierto, para
        // que el historial refleje en que mesa termino sentado - pero sin
        // tocar "inicio" (por eso no se usa cerrarTurnoActual aca).
        const turnoAbierto = await TurnoPagador.findOne({ pagadorId: pagador._id, fin: null }).sort({ inicio: -1 });
        if (turnoAbierto) {
            turnoAbierto.mesa = mesaNum;
            await turnoAbierto.save();
        }

        res.json(pagador);
    } catch (err) { res.status(500).json({ error: 'Error al mover al pagador de mesa.' }); }
});

// POST /api/pagadores/:id/descanso -> pasa a descanso
router.post('/:id/descanso', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const pagador = await Pagador.findById(req.params.id);
        if (!pagador) return res.status(404).json({ error: 'Pagador no encontrado.' });

        await cerrarTurnoActual(pagador);

        const ahora = new Date();
        pagador.estado = 'en_descanso';
        pagador.mesa = null;
        pagador.desde = ahora;
        await pagador.save();

        await TurnoPagador.create({ pagadorId: pagador._id, nombre: pagador.nombre, estado: 'en_descanso', mesa: null, inicio: ahora });

        res.json(pagador);
    } catch (err) { res.status(500).json({ error: 'Error al enviar a descanso.' }); }
});

// POST /api/pagadores/:id/disponible -> FINALIZA LA JORNADA.
// A pedido: al finalizar jornada el pagador deja de figurar en
// cualquier lista (ni disponible, ni descanso, ni mesas) - se marca
// directamente activo:false, igual que un borrado logico. Todas las
// consultas de este archivo ya filtran { activo: { $ne: false } }, asi
// que desaparece de todos lados sin tocar nada mas. Si se finaliza por
// error, se vuelve a dar de alta con POST /pagadores.
router.post('/:id/disponible', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const pagador = await Pagador.findById(req.params.id);
        if (!pagador) return res.status(404).json({ error: 'Pagador no encontrado.' });

        await cerrarTurnoActual(pagador);

        pagador.estado = 'disponible';
        pagador.mesa = null;
        pagador.desde = null;
        pagador.activo = false;
        await pagador.save();

        res.json(pagador);
    } catch (err) { res.status(500).json({ error: 'Error al actualizar el estado.' }); }
});

// POST /api/pagadores/relevo -> ejecuta el relevo sugerido de una sola vez:
// body { relevadoId, relevadorId } - manda a descanso al que estaba en
// mesa y pone en esa misma mesa al que estaba descansando.
router.post('/relevo', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const { relevadoId, relevadorId } = req.body || {};
        const relevado = await Pagador.findById(relevadoId);
        const relevador = await Pagador.findById(relevadorId);
        if (!relevado || !relevador) return res.status(404).json({ error: 'Pagador no encontrado.' });
        if (relevado.estado !== 'en_mesa') return res.status(409).json({ error: 'El pagador a relevar ya no está en una mesa.' });
        if (relevador.estado !== 'en_descanso') return res.status(409).json({ error: 'El pagador que releva ya no está en descanso.' });

        const mesaNum = relevado.mesa;
        const ahora = new Date();

        await cerrarTurnoActual(relevado);
        relevado.estado = 'en_descanso';
        relevado.mesa = null;
        relevado.desde = ahora;
        await relevado.save();
        await TurnoPagador.create({ pagadorId: relevado._id, nombre: relevado.nombre, estado: 'en_descanso', mesa: null, inicio: ahora });

        await cerrarTurnoActual(relevador);
        relevador.estado = 'en_mesa';
        relevador.mesa = mesaNum;
        relevador.desde = ahora;
        await relevador.save();
        await TurnoPagador.create({ pagadorId: relevador._id, nombre: relevador.nombre, estado: 'en_mesa', mesa: mesaNum, inicio: ahora });

        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Error al ejecutar el relevo.' }); }
});

module.exports = router;