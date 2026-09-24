const User = require('./User');
const Performer = require('./Performer');
const AuditLog = require('./AuditLog');
const SharegramIntegration = require('./SharegramIntegration');
const FirebaseUser = require('./FirebaseUser');
const ApiLog = require('./ApiLog');
const Webhook = require('./Webhook');
const BatchJob = require('./BatchJob');
const Video = require('./Video');
const KYCRequest = require('./KYCRequest');
const KYCDocument = require('./KYCDocument');
const KYCVerificationStep = require('./KYCVerificationStep');

// Define all models
const models = {
  User,
  Performer,
  AuditLog,
  SharegramIntegration,
  FirebaseUser,
  ApiLog,
  Webhook,
  BatchJob,
  Video,
  KYCRequest,
  KYCDocument,
  KYCVerificationStep
};

// リレーションシップ設定はassociateメソッドで定義されるため、ここでは削除

// Call associate methods if they exist
Object.keys(models).forEach(modelName => {
  if (models[modelName].associate) {
    try {
      models[modelName].associate(models);
    } catch (error) {
      console.warn(`Association error for ${modelName}:`, error.message);
    }
  }
});

module.exports = models;