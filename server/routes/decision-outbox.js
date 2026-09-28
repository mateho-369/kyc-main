'use strict';
const router=require('../utils/wrapRouter')(require('express').Router());
const auth=require('../middleware/auth');
const reviewer=require('../middleware/requireReviewer');
const operations=require('../services/sharegram/outboxOperations');
const models=require('../models');
router.use(auth,reviewer);
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/',async(req,res)=>{
  try {
    const result=await operations.list({models,actor:req.user,status:req.query.status,
      limit:req.query.limit == null ? 25 : Number(req.query.limit),offset:req.query.offset == null ? 0 : Number(req.query.offset),ip:req.ip});
    res.json({success:true,...result});
  } catch(error) {res.status(error.status || 500).json({code:error.code || 'OUTBOX_LIST_FAILED'});}
});
router.post('/:id/retry',async(req,res)=>{
  try {
    const data=await operations.retry({models,actor:req.user,eventId:req.params.id,expectedAttempts:req.body?.expectedAttempts,confirmation:req.body?.confirmation,ip:req.ip});
    res.json({success:true,data});
  } catch(error) {res.status(error.status || 500).json({code:error.code || 'OUTBOX_RETRY_FAILED'});}
});
module.exports=router;
