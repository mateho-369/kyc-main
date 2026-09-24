// Complete multer fix for performer file uploads

const multerConfig = `
// At the top of the file, after other requires
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create upload directory if it doesn't exist
const uploadDir = path.join(__dirname, 'uploads', 'performers');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('Created upload directory:', uploadDir);
}

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and PDF files are allowed'));
    }
  }
});

console.log('Multer configured with upload directory:', uploadDir);
`;

const fixedEndpoint = `
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
  console.log('Files received:', req.files ? Object.keys(req.files) : 'No files');
  
  const formData = req.body;
  const files = req.files || {};
  
  const fileRefs = {};
  
  // Process each file type
  ['agreementFile', 'idFront', 'idBack', 'selfie', 'selfieWithId'].forEach(fieldName => {
    if (files[fieldName] && files[fieldName][0]) {
      const file = files[fieldName][0];
      console.log(\`Processing \${fieldName}:\`, file.originalname, file.size);
      fileRefs[fieldName] = {
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        path: file.path
      };
    }
  });
  
  const newPerformer = {
    id: Date.now(),
    lastName: formData.lastName || '',
    firstName: formData.firstName || '',
    lastNameRoman: formData.lastNameRoman || '',
    firstNameRoman: formData.firstNameRoman || '',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    documents: fileRefs
  };
  
  performers[newPerformer.id] = newPerformer;
  console.log('Saved performer with documents:', Object.keys(fileRefs));
  
  res.status(201).json({
    ...newPerformer,
    createdAt: newPerformer.createdAt.toISOString(),
    updatedAt: newPerformer.updatedAt.toISOString()
  });
});
`;

console.log('=== Multer Configuration ===');
console.log(multerConfig);
console.log('\n=== Fixed Endpoint ===');
console.log(fixedEndpoint);