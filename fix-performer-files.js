// Performer file upload fix script
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Fixed server endpoint for performer registration
const fixPerformerEndpoint = `
// Fixed performer registration endpoint
app.post('/api/performers', upload.fields([
  { name: 'agreementFile', maxCount: 1 },
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'selfie', maxCount: 1 },
  { name: 'selfieWithId', maxCount: 1 }
]), (req, res) => {
  console.log('=== Performer Registration ===');
  console.log('Body:', req.body);
  console.log('Files:', req.files);
  
  const performer = {
    id: Date.now().toString(),
    lastName: req.body.lastName || '',
    firstName: req.body.firstName || '',
    lastNameRoman: req.body.lastNameRoman || '',
    firstNameRoman: req.body.firstNameRoman || '',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    documents: {}
  };
  
  // Process uploaded files
  if (req.files) {
    Object.keys(req.files).forEach(fieldName => {
      const file = req.files[fieldName][0];
      if (file) {
        performer.documents[fieldName] = {
          filename: file.filename,
          originalName: file.originalname,
          path: file.path,
          size: file.size,
          mimetype: file.mimetype,
          uploadedAt: new Date().toISOString(),
          verified: false
        };
      }
    });
  }
  
  // Save to performers array (in-memory for now)
  if (!global.performers) {
    global.performers = [];
  }
  global.performers.push(performer);
  
  console.log('Performer created:', performer);
  
  res.json({
    success: true,
    performer: performer
  });
});

// Documents metadata endpoint
app.get('/api/performers/:id/documents/metadata', (req, res) => {
  const performerId = req.params.id;
  console.log('Getting documents metadata for performer:', performerId);
  
  const performer = global.performers?.find(p => p.id === performerId);
  
  if (!performer) {
    return res.json([]);
  }
  
  const metadata = [];
  
  if (performer.documents) {
    Object.entries(performer.documents).forEach(([type, doc]) => {
      metadata.push({
        type: type,
        name: doc.originalName,
        status: doc.verified ? 'verified' : 'pending',
        last_updated: doc.uploadedAt,
        size: doc.size,
        mimetype: doc.mimetype
      });
    });
  }
  
  console.log('Returning metadata:', metadata);
  res.json(metadata);
});
`;

console.log('Performer file upload fix script');
console.log('================================');
console.log('Copy this code to the server to fix the file upload functionality:');
console.log(fixPerformerEndpoint);