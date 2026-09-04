const express = require('express');
const ExcelJS = require('exceljs');

const Transaction = require('../models/Transaction');
const Tournament = require('../models/Tournament');

const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();


// ======================================================
// FECHA ACTUAL
// ======================================================

function todayStr() {
  const d = new Date();

  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}


// ======================================================
// CONTROL DEL DÍA
// ======================================================

router.get(
  '/today',
  requireAuth,
  requireRole('direccion'),
  async (req, res) => {
    try {
      // Si viene ?fecha=YYYY-MM-DD (valida) se usa esa fecha para
      // consultar un dia/torneo anterior. Si no viene, se comporta
      // como siempre: el dia de hoy segun el calendario del servidor.
      const fechaQuery = req.query.fecha;
      const today = (fechaQuery && /^\d{4}-\d{2}-\d{2}$/.test(fechaQuery))
        ? fechaQuery
        : todayStr();

      const txs = await Transaction
        .find({ fecha: today })
        .sort({ createdAt: -1 });

      const activas = txs.filter(
        t => !t.anulado
      );

      const buyins = activas.filter(
        t => t.tipo === 'buyin'
      );

      const recompras = activas.filter(
        t => t.tipo === 'recompra'
      );

      const total = activas.reduce(
        (s, t) => s + Number(t.monto || 0),
        0
      );

      const jugadoresUnicos =
        new Set(activas.map(t => t.dni)).size;

      res.json({
        fecha: today,
        transacciones: txs,

        stats: {
          jugadores: jugadoresUnicos,
          buyins: buyins.length,
          recompras: recompras.length,
          total
        }
      });

    } catch (err) {
      console.error('Error obteniendo control:', err);

      res.status(500).json({
        error: 'Error al obtener el control del día.'
      });
    }
  }
);

router.patch(
  '/:id/anular',
  requireAuth,
  requireRole('direccion'),
  async (req, res) => {
    try {
      const tx = await Transaction.findOneAndUpdate(
        { _id: req.params.id, anulado: { $ne: true } },
        {
          anulado: true,
          anuladoPor: req.user.username || req.user.sub,
          anuladoEn: new Date()
        },
        { new: true }
      );

      if (!tx) return res.status(404).json({ error: 'Movimiento no encontrado o ya anulado.' });
      res.json(tx);
    } catch (err) {
      res.status(500).json({ error: 'Error al anular el movimiento.' });
    }
  }
);


// ======================================================
// FILTROS HISTÓRICOS
// ======================================================
// Se mantiene para futuras exportaciones históricas.
// IMPORTANTE:
// El Excel del día NO utiliza esta función.
// ======================================================

async function getFiltered(req) {
  const {
    desde,
    hasta,
    tipo,
    dni
  } = req.query || {};

  const filter = {};

  if (desde || hasta) {
    filter.fecha = {};

    if (desde) {
      filter.fecha.$gte = desde;
    }

    if (hasta) {
      filter.fecha.$lte = hasta;
    }
  }

  if (
    tipo &&
    ['buyin', 'recompra'].includes(tipo)
  ) {
    filter.tipo = tipo;
  }

  if (dni) {
    filter.dni = String(dni).replace(/\D/g, '');
  }

  return Transaction
    .find(filter)
    .sort({
      fecha: 1,
      hora: 1,
      createdAt: 1
    })
    .lean();
}


// ======================================================
// CSV
// ======================================================

function csvEscape(v) {
  const s = String(v ?? '');

  return '"' +
    s.replace(/"/g, '""') +
    '"';
}


function rows(txs) {
  return txs.map(t => [
    t.fecha,
    t.hora,
    t.dni,
    `${t.nombre} ${t.apellido}`,
    `${t.anulado ? 'ANULADO - ' : ''}${t.tipo === 'buyin' ? 'Buy-in' : 'Recompra'}`,
    t.monto,
    t.torneo,
    t.cajero || ''
  ]);
}


// ======================================================
// EXPORTAR CSV
// ======================================================
// Por ahora mantiene el comportamiento histórico.
// El Excel es el que queda exclusivamente del día.
// ======================================================

router.get(
  '/export.csv',
  requireAuth,
  requireRole('direccion'),
  async (req, res) => {
    try {
      const txs = await getFiltered(req);

      const data = [
        [
          'Fecha',
          'Hora',
          'DNI',
          'Jugador',
          'Tipo',
          'Monto',
          'Torneo',
          'Cajero'
        ],
        ...rows(txs)
      ];

      const csv =
        '\ufeff' +
        data
          .map(r =>
            r.map(csvEscape).join(';')
          )
          .join('\r\n');

      res.setHeader(
        'Content-Type',
        'text/csv; charset=utf-8'
      );

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="operaciones.csv"'
      );

      res.send(csv);

    } catch (err) {
      console.error(
        'Error exportando CSV:',
        err
      );

      res.status(500).json({
        error: 'No se pudo exportar CSV.'
      });
    }
  }
);


// ======================================================
// EXPORTAR EXCEL DEL DÍA
// ======================================================

router.get(
  '/export.xlsx',
  requireAuth,
  requireRole('direccion'),
  async (req, res) => {
    try {

      // ==================================================
      // SOLO EL DÍA ACTUAL
      // ==================================================

      const today = todayStr();

      const txs = await Transaction
        .find({
          fecha: today
        })
        .sort({
          hora: 1,
          createdAt: 1
        })
        .lean();


      // ==================================================
      // OBTENER TORNEO
      // ==================================================
      // Primero buscamos el torneo activo.
      // Si por algún motivo no existe, intentamos
      // encontrar uno correspondiente a la fecha.
      // ==================================================

      let torneo = await Tournament
        .findOne({
          activo: true
        })
        .sort({
          createdAt: -1
        })
        .lean();

      if (!torneo) {
        torneo = await Tournament
          .findOne({
            fecha: today
          })
          .sort({
            createdAt: -1
          })
          .lean();
      }


      // ==================================================
      // CONFIGURACIÓN DEL TORNEO
      // ==================================================

      const buyIn = Number(
        torneo?.buyIn || 0
      );

      const recompra = Number(
        torneo?.recompra || 0
      );

      const rake = Number(
        torneo?.rake || 0
      );


      // ==================================================
      // SEPARAR OPERACIONES
      // ==================================================

      const activas = txs.filter(
        t => !t.anulado
      );

      const buyins = activas.filter(
        t => t.tipo === 'buyin'
      );

      const recompras = activas.filter(
        t => t.tipo === 'recompra'
      );


      // ==================================================
      // TOTALES
      // ==================================================

      const totalRecaudado = activas.reduce(
        (s, t) =>
          s + Number(t.monto || 0),
        0
      );


      const cantidadOperaciones =
        activas.length;


      // ==================================================
      // RAKE
      // ==================================================
      //
      // Cada operación tiene el mismo rake:
      //
      // BUY-IN     -> rake
      // RECOMPRA   -> rake
      //
      // Ejemplo:
      //
      // Buy-in = $30.000
      // Rake   = $5.000
      // Pozo   = $25.000
      //
      // Si hay 10 operaciones:
      //
      // Rake acumulado = 10 x $5.000
      //
      // ==================================================

      const rakeAcumulado =
        cantidadOperaciones * rake;


      // ==================================================
      // POZO ACUMULADO
      // ==================================================

      const pozoAcumulado =
        Math.max(
          0,
          totalRecaudado - rakeAcumulado
        );


      // ==================================================
      // CREAR EXCEL
      // ==================================================

      const wb =
        new ExcelJS.Workbook();

      wb.creator =
        'Sistema de Torneos';

      wb.created =
        new Date();


      const ws =
        wb.addWorksheet('Operaciones');


      // ==================================================
      // ANCHOS
      // ==================================================

      ws.columns = [
        {
          width: 14
        },
        {
          width: 10
        },
        {
          width: 14
        },
        {
          width: 28
        },
        {
          width: 14
        },
        {
          width: 15
        },
        {
          width: 28
        },
        {
          width: 20
        }
      ];


      // ==================================================
      // TÍTULO
      // ==================================================

      ws.mergeCells('A1:H1');

      ws.getCell('A1').value =
        'OPERACIONES DEL DÍA';


      ws.getCell('A1').font = {
        bold: true,
        size: 16,
        color: {
          argb: 'FFFFFFFF'
        }
      };


      ws.getCell('A1').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: '0E1A15'
        }
      };


      ws.getCell('A1').alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };


      ws.getRow(1).height = 26;


      // ==================================================
      // INFORMACIÓN DEL TORNEO
      // ==================================================

      ws.mergeCells('A2:H2');

      ws.getCell('A2').value =
        `Fecha: ${today} · Torneo: ${
          torneo?.nombre ||
          txs[0]?.torneo ||
          'Sin configurar'
        }`;


      ws.getCell('A2').font = {
        bold: true,
        size: 12
      };


      // ==================================================
      // CONFIGURACIÓN
      // ==================================================

      ws.mergeCells('A3:H3');

      ws.getCell('A3').value =
        `Buy-in: $${buyIn.toLocaleString('es-AR')} · ` +
        `Recompra: $${recompra.toLocaleString('es-AR')} · ` +
        `Rake por operación: $${rake.toLocaleString('es-AR')}`;


      ws.getCell('A3').font = {
        italic: true,
        color: {
          argb: '666666'
        }
      };


      // ==================================================
      // ENCABEZADOS
      // ==================================================

      const headerRow =
        5;

      ws.getRow(headerRow).values = [
        'Fecha',
        'Hora',
        'DNI',
        'Jugador',
        'Tipo',
        'Monto',
        'Torneo',
        'Cajero'
      ];


      const header =
        ws.getRow(headerRow);


      header.font = {
        bold: true,
        color: {
          argb: 'FFFFFFFF'
        }
      };


      header.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: '1B2E27'
        }
      };


      header.alignment = {
        vertical: 'middle'
      };


      // ==================================================
      // OPERACIONES
      // ==================================================

      let rowNumber =
        headerRow + 1;


      for (const t of txs) {

        const row =
          ws.getRow(rowNumber);


        row.values = [
          t.fecha,
          t.hora,
          t.dni,
          `${t.nombre} ${t.apellido}`,
          `${t.anulado ? 'ANULADO - ' : ''}${t.tipo === 'buyin' ? 'Buy-in' : 'Recompra'}`,
          Number(t.monto || 0),
          t.torneo,
          t.cajero || ''
        ];


        rowNumber++;
      }


      // ==================================================
      // FORMATO MONETARIO OPERACIONES
      // ==================================================

      ws.getColumn(6).numFmt =
        '$#,##0';


      // ==================================================
      // FILTRO
      // ==================================================

      ws.autoFilter = {
        from: `A${headerRow}`,
        to: `H${Math.max(
          headerRow,
          rowNumber - 1
        )}`
      };


      // ==================================================
      // RESUMEN
      // ==================================================

      const summaryStart =
        rowNumber + 2;


      ws.mergeCells(
        `A${summaryStart}:H${summaryStart}`
      );


      ws.getCell(
        `A${summaryStart}`
      ).value =
        'RESUMEN DEL DÍA';


      ws.getCell(
        `A${summaryStart}`
      ).font = {
        bold: true,
        size: 14,
        color: {
          argb: 'FFFFFFFF'
        }
      };


      ws.getCell(
        `A${summaryStart}`
      ).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: '0E1A15'
        }
      };


      ws.getCell(
        `A${summaryStart}`
      ).alignment = {
        horizontal: 'left'
      };


      // ==================================================
      // DATOS DEL RESUMEN
      // ==================================================

      const summary = [
        [
          'Operaciones',
          cantidadOperaciones,
          false
        ],
        [
          'Buy-ins',
          buyins.length,
          false
        ],
        [
          'Recompras',
          recompras.length,
          false
        ],
        [
          'Recaudación total',
          totalRecaudado,
          true
        ],
        [
          'Rake acumulado',
          rakeAcumulado,
          true
        ],
        [
          'Pozo acumulado',
          pozoAcumulado,
          true
        ]
      ];


      let summaryRow =
        summaryStart + 1;


      for (
        const [label, value, isMoney]
        of summary
      ) {

        ws.getCell(
          `A${summaryRow}`
        ).value =
          label;


        ws.getCell(
          `B${summaryRow}`
        ).value =
          value;


        ws.getCell(
          `A${summaryRow}`
        ).font = {
          bold: true
        };


        if (isMoney) {
          ws.getCell(
            `B${summaryRow}`
          ).numFmt =
            '$#,##0';
        }


        summaryRow++;
      }


      // ==================================================
      // RESALTAR RECAUDACIÓN
      // ==================================================

      const recaudacionRow =
        summaryStart + 4;


      ws.getCell(
        `A${recaudacionRow}`
      ).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: 'E8F1EC'
        }
      };


      ws.getCell(
        `B${recaudacionRow}`
      ).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: 'E8F1EC'
        }
      };


      // ==================================================
      // RESALTAR RAKE
      // ==================================================

      const rakeRow =
        summaryStart + 5;


      ws.getCell(
        `A${rakeRow}`
      ).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: 'F8E4DF'
        }
      };


      ws.getCell(
        `B${rakeRow}`
      ).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: 'F8E4DF'
        }
      };


      ws.getCell(
        `A${rakeRow}`
      ).font = {
        bold: true,
        color: {
          argb: '9E3F2E'
        }
      };


      ws.getCell(
        `B${rakeRow}`
      ).font = {
        bold: true,
        color: {
          argb: '9E3F2E'
        }
      };


      // ==================================================
      // RESALTAR POZO
      // ==================================================

      const pozoRow =
        summaryStart + 6;


      ws.getCell(
        `A${pozoRow}`
      ).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: 'E4C55E'
        }
      };


      ws.getCell(
        `B${pozoRow}`
      ).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: 'E4C55E'
        }
      };


      ws.getCell(
        `A${pozoRow}`
      ).font = {
        bold: true
      };


      ws.getCell(
        `B${pozoRow}`
      ).font = {
        bold: true
      };


      // ==================================================
      // BORDES DEL RESUMEN
      // ==================================================

      for (
        let r = summaryStart + 1;
        r <= summaryStart + 6;
        r++
      ) {

        ws.getCell(`A${r}`).border = {
          bottom: {
            style: 'thin',
            color: {
              argb: 'CCCCCC'
            }
          }
        };

        ws.getCell(`B${r}`).border = {
          bottom: {
            style: 'thin',
            color: {
              argb: 'CCCCCC'
            }
          }
        };
      }


      // ==================================================
      // CONGELAR ENCABEZADO
      // ==================================================

      ws.views = [
        {
          state: 'frozen',
          ySplit: headerRow
        }
      ];


      // ==================================================
      // GENERAR ARCHIVO
      // ==================================================

      const buffer =
        await wb.xlsx.writeBuffer();


      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );


      res.setHeader(
        'Content-Disposition',
        'attachment; filename="operaciones-del-dia.xlsx"'
      );


      res.send(
        Buffer.from(buffer)
      );


    } catch (err) {

      console.error(
        'Error exportando Excel:',
        err
      );

      res.status(500).json({
        error: 'No se pudo exportar Excel.'
      });
    }
  }
);


module.exports = router;
