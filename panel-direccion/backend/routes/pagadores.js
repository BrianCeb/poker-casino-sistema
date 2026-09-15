const express = require('express');
const Pagador = require('../models/Pagador');
const TurnoPagador = require('../models/TurnoPagador');
const { requireAuth, requireRole } = require('../middleware/auth');
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

// GET /api/pagadores/tablero -> vista consolidada para la pantalla en vivo
router.get('/tablero', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
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
        for (let i = 1; i <= 13; i++) {
            mesas.push({ mesa: i, pagador: enMesa.find(p => p.mesa === i) || null });
        }

        // Sugerencia: el que mas tiempo lleva en mesa, relevado por el que
        // mas tiempo lleva descansando.
        const sugerido = (enMesa.length > 0 && enDescanso.length > 0)
            ? { relevado: enMesa[0], relevador: enDescanso[0] }
            : null;

        res.json({ mesas, enMesa, enDescanso, disponibles, sugerido });
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

// POST /api/pagadores/:id/asignar-mesa -> body { mesa }
router.post('/:id/asignar-mesa', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const mesaNum = Number((req.body || {}).mesa);
        if (!Number.isInteger(mesaNum) || mesaNum < 1 || mesaNum > 13) {
            return res.status(400).json({ error: 'La mesa debe ser un número entre 1 y 13.' });
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

// POST /api/pagadores/:id/disponible -> termina su bloque actual (fin de jornada, o vuelve a la nada)
router.post('/:id/disponible', requireAuth, requireRole('direccion'), async (req, res) => {
    try {
        const pagador = await Pagador.findById(req.params.id);
        if (!pagador) return res.status(404).json({ error: 'Pagador no encontrado.' });

        await cerrarTurnoActual(pagador);

        pagador.estado = 'disponible';
        pagador.mesa = null;
        pagador.desde = null;
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