'use strict';
const fs = require('fs');
const path = require('path');
const { object } = require('./performerReview');
const ROOT = path.resolve(__dirname, '../uploads/performers');
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf' };
function allowedFile(file) {
  return TYPES[path.extname(file.originalname).toLowerCase()] === file.mimetype;
}
function hasExpectedSignature(file) {
  const fd = fs.openSync(file.path, 'r'), bytes = Buffer.alloc(8);
  let n;
  try { n = fs.readSync(fd, bytes, 0, 8, 0); } finally { fs.closeSync(fd); }
  if (file.mimetype === 'image/jpeg') return n >= 3 && bytes.subarray(0,3).equals(Buffer.from([255,216,255]));
  if (file.mimetype === 'image/png') return n === 8 && bytes.equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return file.mimetype === 'application/pdf' && n >= 5 && bytes.toString('ascii',0,5) === '%PDF-';
}
function storagePath(stored) {
  if (typeof stored !== 'string') return null;
  try {
    const root = fs.realpathSync(ROOT);
    const candidate = fs.realpathSync(path.isAbsolute(stored) ? stored : path.resolve(__dirname, '..', stored));
    return candidate.startsWith(root + path.sep) && fs.statSync(candidate).isFile() ? candidate : null;
  } catch (_) { return null; }
}
function publicPerformer(row) {
  const value = { ...(row.toJSON ? row.toJSON() : row.get ? row.get({ plain: true }) : row) };
  if (value.documents) {
    value.documents = Object.fromEntries(Object.entries(object(value.documents)).map(([type, doc]) => [type,
      doc && Object.fromEntries(['originalName','mimeType','verified','verifiedAt','verifiedBy','uploadedAt','size','rejectedAt'].filter(k=>doc[k] !== undefined).map(k=>[k,doc[k]]))]));
  }
  return value;
}
module.exports = { ROOT, allowedFile, hasExpectedSignature, storagePath, publicPerformer };
