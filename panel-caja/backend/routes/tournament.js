const express = require('express');
const Tournament = require('../models/Tournament');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();
function todayStr(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
router.get('/', requireAuth, requireRole('caja'), async(req,res)=>{
  try{const activo=await Tournament.findOne({activo:true}).sort({createdAt:-1}); if(!activo)return res.json({nombre:'Sin configurar',buyIn:0,recompra:0,fecha:todayStr(),activo:false}); res.json(activo);}catch(err){res.status(500).json({error:'Error al obtener el torneo.'});}
});
module.exports=router;
