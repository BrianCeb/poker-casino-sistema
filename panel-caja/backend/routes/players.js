const express = require('express');
const Player = require('../models/Player');
const Transaction = require('../models/Transaction');
const Tournament = require('../models/Tournament');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
router.get('/:dni', requireAuth, requireRole('caja'), async (req,res)=>{
  try {
    const dni = req.params.dni.replace(/\D/g,''); const player = await Player.findOne({dni});
    if(!player) return res.status(404).json({registrado:false});
    const today=todayStr(); const txHoy=await Transaction.find({dni,fecha:today}).sort({createdAt:1});
    const yaCompro=txHoy.some(t=>t.tipo==='buyin');
    res.json({registrado:true,player,yaCompro,recomprasCount:txHoy.filter(t=>t.tipo==='recompra').length,accionCorrespondiente:yaCompro?'recompra':'buyin'});
  } catch(err){res.status(500).json({error:'Error al buscar el jugador.'});}
});
module.exports=router;
