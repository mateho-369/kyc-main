'use strict';
const router=require('express').Router();
const auth=require('../middleware/auth');
const reviewer=require('../middleware/requireReviewer');
// Intentionally disabled, not a partly working invite service. A claim contract,
// shared-project writer coordination and secure invitation delivery are blockers.
// Do not create a token/account, update a DB role, or mutate Firebase claims.
router.post('/',auth,reviewer,(req,res)=>res.status(503).json({code:'ADMIN_INVITATION_CONTRACT_REQUIRED'}));
module.exports=router;
