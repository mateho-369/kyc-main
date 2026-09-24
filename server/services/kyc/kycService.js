const { 
  KYCRequest, 
  KYCDocument, 
  KYCVerificationStep,
  Performer,
  SharegramIntegration 
} = require('../../models');
const { createSharegramClient } = require('../sharegram/sharegramClient');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

class KYCService {
  /**
   * KYCリクエストの作成
   */
  static async createKYCRequest(performerId, requestData = {}) {
    const performer = await Performer.findByPk(performerId);
    if (!performer) {
      throw new Error('Performer not found');
    }
    
    // 既存のアクティブなKYCリクエストがないか確認
    const existingRequest = await KYCRequest.getActiveRequestForPerformer(performerId);
    if (existingRequest && existingRequest.status !== 'rejected') {
      throw new Error('Active KYC request already exists for this performer');
    }
    
    // KYCリクエストの作成
    const kycRequest = await KYCRequest.create({
      performerId,
      requestType: requestData.requestType || 'initial',
      status: 'draft',
      sharegramIntegrationId: requestData.integrationId || null,
      documentData: requestData.documentData || {},
      metadata: requestData.metadata || {}
    });
    
    // ワークフローステップの作成
    await KYCVerificationStep.createWorkflow(kycRequest.id);
    
    // Performerの状態を更新
    await performer.update({ kycStatus: 'in_progress' });
    
    return kycRequest;
  }
  
  /**
   * KYCドキュメントのアップロード
   */
  static async uploadDocument(kycRequestId, documentType, fileData) {
    const kycRequest = await KYCRequest.findByPk(kycRequestId);
    if (!kycRequest) {
      throw new Error('KYC request not found');
    }
    
    if (kycRequest.status !== 'draft') {
      throw new Error('Documents can only be uploaded to draft requests');
    }
    
    // ファイルの保存
    const uploadDir = path.join(process.env.UPLOAD_DIR || './uploads', 'kyc', kycRequestId.toString());
    await fs.mkdir(uploadDir, { recursive: true });
    
    const fileName = `${documentType}_${Date.now()}${path.extname(fileData.originalname)}`;
    const filePath = path.join(uploadDir, fileName);
    
    await fs.writeFile(filePath, fileData.buffer);
    
    // ファイルハッシュの計算
    const fileHash = crypto
      .createHash('sha256')
      .update(fileData.buffer)
      .digest('hex');
    
    // KYCドキュメントレコードの作成
    const kycDocument = await KYCDocument.create({
      kycRequestId,
      documentType,
      filePath,
      fileName: fileData.originalname,
      fileSize: fileData.size,
      mimeType: fileData.mimetype,
      hash: fileHash,
      metadata: {
        uploadIp: fileData.uploadIp,
        userAgent: fileData.userAgent,
        uploadTimestamp: new Date()
      }
    });
    
    // documentDataの更新
    const documentData = { ...kycRequest.documentData };
    
    switch (documentType) {
      case 'id_front':
        documentData.idDocument.frontImage = filePath;
        break;
      case 'id_back':
        documentData.idDocument.backImage = filePath;
        break;
      case 'selfie':
        documentData.selfie.image = filePath;
        documentData.selfie.timestamp = new Date();
        break;
      case 'address_proof':
        documentData.addressProof.documentImage = filePath;
        break;
    }
    
    await kycRequest.update({ documentData });
    
    // ドキュメントアップロードステップの更新
    const uploadStep = await KYCVerificationStep.findOne({
      where: {
        kycRequestId,
        stepType: 'document_upload'
      }
    });
    
    if (uploadStep && uploadStep.status === 'pending') {
      await uploadStep.start(null, 'system');
      
      // 必要なドキュメントがすべてアップロードされたか確認
      const requiredDocs = await this.checkRequiredDocuments(kycRequest);
      if (requiredDocs.allUploaded) {
        await uploadStep.complete({
          uploadedDocuments: requiredDocs.documents,
          totalSize: requiredDocs.totalSize
        });
      }
    }
    
    return kycDocument;
  }
  
  /**
   * KYCリクエストの提出
   */
  static async submitKYCRequest(kycRequestId) {
    const kycRequest = await KYCRequest.findByPk(kycRequestId, {
      include: [
        { model: KYCDocument, as: 'documents' },
        { model: Performer, as: 'performer' }
      ]
    });
    
    if (!kycRequest) {
      throw new Error('KYC request not found');
    }
    
    // 必要なドキュメントの確認
    const requiredDocs = await this.checkRequiredDocuments(kycRequest);
    if (!requiredDocs.allUploaded) {
      throw new Error(`Missing required documents: ${requiredDocs.missing.join(', ')}`);
    }
    
    // リクエストの提出
    await kycRequest.submit();
    
    // 自動検証の開始
    await this.startAutomatedVerification(kycRequest);
    
    return kycRequest;
  }
  
  /**
   * 自動検証プロセスの開始
   */
  static async startAutomatedVerification(kycRequest) {
    // ドキュメント検証ステップ
    const docVerificationStep = await KYCVerificationStep.findOne({
      where: {
        kycRequestId: kycRequest.id,
        stepType: 'document_verification'
      }
    });
    
    if (docVerificationStep) {
      await docVerificationStep.start(null, 'automated_system');
      
      try {
        // ドキュメントの検証
        const verificationResults = await this.verifyDocuments(kycRequest);
        
        if (verificationResults.success) {
          await docVerificationStep.complete(verificationResults);
          
          // 次のステップ（顔照合）を開始
          await this.startFaceMatching(kycRequest);
        } else {
          await docVerificationStep.fail('Document verification failed', verificationResults);
        }
      } catch (error) {
        await docVerificationStep.fail('Document verification error', { error: error.message });
      }
    }
  }
  
  /**
   * ドキュメントの検証
   */
  static async verifyDocuments(kycRequest) {
    const results = {
      success: true,
      documents: {},
      issues: []
    };
    
    const documents = await KYCDocument.getDocumentsForRequest(kycRequest.id);
    
    for (const doc of documents) {
      // ファイルの整合性チェック
      const fileBuffer = await fs.readFile(doc.filePath);
      const currentHash = crypto
        .createHash('sha256')
        .update(fileBuffer)
        .digest('hex');
      
      const integrityCheck = await KYCDocument.checkDocumentIntegrity(doc.id, currentHash);
      
      if (!integrityCheck) {
        results.success = false;
        results.issues.push(`Document ${doc.documentType} has been tampered with`);
        continue;
      }
      
      // SharegramAPIを使用した検証（統合が設定されている場合）
      if (kycRequest.sharegramIntegrationId) {
        try {
          const sharegramClient = await createSharegramClient(kycRequest.sharegramIntegrationId);
          
          // ドキュメントのアップロード
          const uploadResult = await sharegramClient.uploadDocument(
            {
              file: fileBuffer,
              metadata: {
                documentType: doc.documentType,
                performerId: kycRequest.performerId
              }
            },
            doc.documentType
          );
          
          results.documents[doc.documentType] = {
            verified: true,
            sharegramDocumentId: uploadResult.documentId,
            extractedData: uploadResult.extractedData
          };
          
          // 抽出されたデータの保存
          await doc.update({
            verificationStatus: 'verified',
            verificationDetails: {
              ...doc.verificationDetails,
              sharegramAnalysis: uploadResult
            },
            extractedData: uploadResult.extractedData
          });
          
        } catch (error) {
          results.success = false;
          results.issues.push(`Failed to verify ${doc.documentType}: ${error.message}`);
        }
      }
    }
    
    return results;
  }
  
  /**
   * 顔照合の開始
   */
  static async startFaceMatching(kycRequest) {
    const faceMatchStep = await KYCVerificationStep.findOne({
      where: {
        kycRequestId: kycRequest.id,
        stepType: 'face_matching'
      }
    });
    
    if (!faceMatchStep) return;
    
    await faceMatchStep.start(null, 'automated_system');
    
    try {
      const documents = await KYCDocument.getDocumentsForRequest(kycRequest.id);
      const selfieDoc = documents.find(d => d.documentType === 'selfie' || d.documentType === 'selfie_with_id');
      const idDoc = documents.find(d => ['id_front', 'passport', 'drivers_license'].includes(d.documentType));
      
      if (!selfieDoc || !idDoc) {
        await faceMatchStep.fail('Missing required documents for face matching');
        return;
      }
      
      // SharegramAPIを使用した顔照合
      if (kycRequest.sharegramIntegrationId) {
        const sharegramClient = await createSharegramClient(kycRequest.sharegramIntegrationId);
        
        const faceMatchResult = await sharegramClient.performFaceMatch(
          selfieDoc.filePath,
          idDoc.filePath
        );
        
        if (faceMatchResult.confidence >= 0.8) {
          await faceMatchStep.complete({
            confidence: faceMatchResult.confidence,
            matched: true,
            details: faceMatchResult
          });
          
          // 次のステップを開始
          await this.startAddressVerification(kycRequest);
        } else {
          await faceMatchStep.fail('Face match confidence too low', {
            confidence: faceMatchResult.confidence,
            threshold: 0.8
          });
        }
      }
    } catch (error) {
      await faceMatchStep.fail('Face matching error', { error: error.message });
    }
  }
  
  /**
   * 住所確認
   */
  static async startAddressVerification(kycRequest) {
    const addressStep = await KYCVerificationStep.findOne({
      where: {
        kycRequestId: kycRequest.id,
        stepType: 'address_verification'
      }
    });
    
    if (!addressStep) return;
    
    await addressStep.start(null, 'automated_system');
    
    // 住所確認ロジック
    // TODO: 実装
    
    await addressStep.complete({
      addressVerified: true
    });
    
    // Sharegram検証を開始
    await this.startSharegramVerification(kycRequest);
  }
  
  /**
   * Sharegram統合検証
   */
  static async startSharegramVerification(kycRequest) {
    const sharegramStep = await KYCVerificationStep.findOne({
      where: {
        kycRequestId: kycRequest.id,
        stepType: 'sharegram_verification'
      }
    });
    
    if (!sharegramStep || !kycRequest.sharegramIntegrationId) {
      // Sharegram検証をスキップ
      if (sharegramStep) {
        await sharegramStep.skip('No Sharegram integration configured');
      }
      return;
    }
    
    await sharegramStep.start(null, 'sharegram_system');
    
    try {
      const sharegramClient = await createSharegramClient(kycRequest.sharegramIntegrationId);
      const performer = await Performer.findByPk(kycRequest.performerId);
      
      // KYC検証リクエストの送信
      const verificationResult = await sharegramClient.submitKYCVerification({
        performerId: kycRequest.performerId,
        firstName: performer.firstName,
        lastName: performer.lastName,
        birthDate: performer.birthDate,
        nationality: performer.nationality,
        address: performer.address,
        documents: {
          idFront: kycRequest.documentData.idDocument.frontImage,
          idBack: kycRequest.documentData.idDocument.backImage,
          selfie: kycRequest.documentData.selfie.image,
          addressProof: kycRequest.documentData.addressProof.documentImage
        },
        metadata: kycRequest.metadata
      });
      
      // 結果の保存
      await sharegramStep.update({
        sharegramData: {
          requestId: verificationResult.requestId,
          responseId: verificationResult.responseId,
          verificationCode: verificationResult.verificationCode,
          rawResponse: verificationResult
        }
      });
      
      // リスクスコアの取得
      const riskScore = await sharegramClient.getRiskScore(kycRequest.performerId);
      
      await performer.update({
        sharegramUserId: verificationResult.sharegramUserId,
        riskScore: riskScore.score
      });
      
      if (verificationResult.status === 'approved' && riskScore.score < 0.7) {
        await sharegramStep.complete({
          approved: true,
          riskScore: riskScore.score,
          verificationId: verificationResult.verificationId
        });
        
        // 手動レビューを開始
        await this.startManualReview(kycRequest);
      } else {
        await sharegramStep.fail('Sharegram verification failed or high risk', {
          status: verificationResult.status,
          riskScore: riskScore.score,
          reasons: verificationResult.reasons
        });
      }
      
    } catch (error) {
      await sharegramStep.fail('Sharegram verification error', { error: error.message });
    }
  }
  
  /**
   * 手動レビューの開始
   */
  static async startManualReview(kycRequest) {
    const manualReviewStep = await KYCVerificationStep.findOne({
      where: {
        kycRequestId: kycRequest.id,
        stepType: 'manual_review'
      }
    });
    
    if (manualReviewStep) {
      await manualReviewStep.start();
      
      // リクエストのステータスを更新
      await kycRequest.update({ status: 'in_review' });
    }
  }
  
  /**
   * 必要なドキュメントの確認
   */
  static async checkRequiredDocuments(kycRequest) {
    const documents = await KYCDocument.getDocumentsForRequest(kycRequest.id);
    const uploadedTypes = documents.map(d => d.documentType);
    
    const requiredTypes = ['id_front', 'selfie', 'address_proof'];
    const missing = requiredTypes.filter(type => !uploadedTypes.includes(type));
    
    const totalSize = documents.reduce((sum, doc) => sum + doc.fileSize, 0);
    
    return {
      allUploaded: missing.length === 0,
      missing,
      documents: uploadedTypes,
      totalSize
    };
  }
  
  /**
   * KYCリクエストの承認
   */
  static async approveKYCRequest(kycRequestId, reviewerId) {
    const kycRequest = await KYCRequest.findByPk(kycRequestId, {
      include: [{ model: Performer, as: 'performer' }]
    });
    
    if (!kycRequest) {
      throw new Error('KYC request not found');
    }
    
    // 最終承認ステップの完了
    const finalApprovalStep = await KYCVerificationStep.findOne({
      where: {
        kycRequestId,
        stepType: 'final_approval'
      }
    });
    
    if (finalApprovalStep) {
      await finalApprovalStep.start(reviewerId);
      await finalApprovalStep.complete({
        approvedBy: reviewerId,
        approvedAt: new Date()
      });
    }
    
    // リクエストの承認
    await kycRequest.approve(reviewerId);
    
    // Performerの状態を更新
    await kycRequest.performer.updateKYCStatus('verified', {
      riskScore: kycRequest.performer.riskScore,
      metadata: {
        kycRequestId: kycRequest.id,
        approvedBy: reviewerId
      }
    });
    
    return kycRequest;
  }
  
  /**
   * KYCリクエストの拒否
   */
  static async rejectKYCRequest(kycRequestId, reviewerId, reason) {
    const kycRequest = await KYCRequest.findByPk(kycRequestId, {
      include: [{ model: Performer, as: 'performer' }]
    });
    
    if (!kycRequest) {
      throw new Error('KYC request not found');
    }
    
    // リクエストの拒否
    await kycRequest.reject(reviewerId, reason);
    
    // Performerの状態を更新
    await kycRequest.performer.updateKYCStatus('rejected', {
      metadata: {
        kycRequestId: kycRequest.id,
        rejectedBy: reviewerId,
        reason
      }
    });
    
    return kycRequest;
  }
}

module.exports = KYCService;