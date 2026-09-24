import React, { useState, useEffect } from 'react';
import { FiAlertCircle as AlertCircle, FiCheckCircle as CheckCircle, FiDownload as Download, FiEye as Eye, FiFileText as FileText, FiInfo as Info, FiTrash as Trash, FiX as X } from 'react-icons/fi';
import { useParams, useNavigate } from 'react-router-dom';
// import { getPerformerById, getPerformerDocuments, downloadDocument, deletePerformer, verifyDocument } from '../services/performerService';
import { getUserRole } from '../services/auth';
import secureApiClient from '../services/SecureApiClient';
import { getPerformerDocumentsMetadata } from '../services/documentMetadataService';

const PerformerDetailPage = () => {
 const { id } = useParams();
 const navigate = useNavigate();
 const [performer, setPerformer] = useState(null);
 const [documents, setDocuments] = useState([]);
 const [documentsMetadata, setDocumentsMetadata] = useState([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState('');
 const [deleteModalOpen, setDeleteModalOpen] = useState(false);
 const [userRole, setUserRole] = useState('user');
 const [verifyingDoc, setVerifyingDoc] = useState(null);
 // 追加: ポップアップ表示のための状態
 const [previewDoc, setPreviewDoc] = useState(null);
 const [imageUrl, setImageUrl] = useState(null);
 const [imageLoadError, setImageLoadError] = useState(false);
 const [metadataError, setMetadataError] = useState(null);

 // 画像URLを直接生成（修正版）
 const fetchImageAsBlob = async (documentType) => {
   try {
     console.log('🖼️ 画像URL生成開始:', documentType);
     setImageLoadError(false);
     
     // 直接画像URLを生成（静的ファイル配信を利用）
     const baseUrl = process.env.REACT_APP_API_URL || 'https://stg.id-manager.com/api';
     const imageUrl = `${baseUrl}/performers/${id}/documents/${documentType}`;
     
     // 画像の存在確認（HEADリクエスト）
     try {
       await secureApiClient.client.head(imageUrl);
       setImageUrl(imageUrl);
       console.log('✅ 画像URL生成成功:', imageUrl);
     } catch (headError) {
       // HEADリクエストが失敗した場合でも、URLを設定して試す
       console.warn('HEADリクエスト失敗、URLを直接設定:', headError);
       setImageUrl(imageUrl);
     }
     
   } catch (error) {
     console.error('❌ 画像URLの生成に失敗しました:', error);
     setImageUrl(null);
     setImageLoadError(true);
   }
 };

 useEffect(() => {
   const initializePageData = async () => {
     try {
       // ユーザーロールを取得（async版）
       console.log('🔍 ユーザーロール取得開始（localStorage非使用）');
       const role = await getUserRole();
       setUserRole(role);
       console.log('✅ ユーザーロール取得成功:', role);

       // 出演者詳細を取得
       const performerData = await getPerformerById(id);
       setPerformer(performerData);
       
       const documentsData = await getPerformerDocuments(id);
       setDocuments(documentsData);
       
       // 書類メタデータ取得（新API）
       try {
         console.log('📄 書類メタデータ取得開始');
         const metadata = await getPerformerDocumentsMetadata(id);
         setDocumentsMetadata(metadata);
         console.log('✅ メタデータ取得成功:', metadata);
       } catch (metaErr) {
         console.error('⚠️ メタデータ取得エラー（フォールバック動作）:', metaErr);
         setMetadataError('書類の詳細情報は取得できませんでした');
         // エラーでも基本機能は継続
       }
     } catch (err) {
       setError('出演者情報の取得に失敗しました');
       console.error(err);
     } finally {
       setLoading(false);
     }
   };

   initializePageData();
 }, [id]);

 const handleDownload = async (documentType) => {
  try {
    const blob = await downloadDocument(id, documentType);
    const url = window.URL.createObjectURL(blob);
    
    // 該当するドキュメントを探す
    const doc = documents.find(d => d.type === documentType);
    
    // MIMEタイプから適切な拡張子を取得
    let extension = 'pdf'; // デフォルト
    if (doc && doc.mimeType) {
      if (doc.mimeType.includes('png')) extension = 'png';
      else if (doc.mimeType.includes('jpeg') || doc.mimeType.includes('jpg')) extension = 'jpg';
      else if (doc.mimeType.includes('gif')) extension = 'gif';
      else if (doc.mimeType.includes('webp')) extension = 'webp';
    }
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${performer.name}_${documentType}.${extension}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (err) {
    console.error('Download error:', err);
    setError('ダウンロードに失敗しました');
  }
 };

 const handleDelete = async () => {
  try {
    await deletePerformer(id);
    navigate('/performers');
  } catch (err) {
    setError('削除に失敗しました');
  }
 };

 const handleVerify = async (documentType) => {
  setVerifyingDoc(documentType);
  try {
    await verifyDocument(id, documentType);
    // 書類データを再取得して更新
    const updatedDocs = await getPerformerDocuments(id);
    setDocuments(updatedDocs);
  } catch (err) {
    setError('承認処理に失敗しました');
  } finally {
    setVerifyingDoc(null);
  }
 };

 const handlePreview = async (doc) => {
  setPreviewDoc(doc);
  setImageUrl(null); // 前の画像をクリア
  setImageLoadError(false);
  
  // 画像を取得
  await fetchImageAsBlob(doc.type);
 };

 const closePreview = () => {
  setPreviewDoc(null);
  if (imageUrl && imageUrl.startsWith('blob:')) {
    URL.revokeObjectURL(imageUrl);
  }
  setImageUrl(null);
  setImageLoadError(false);
 };

 // メタデータとドキュメントを結合する関数
 const mergeDocumentsWithMetadata = () => {
   return documents.map(doc => {
     const metadata = documentsMetadata.find(meta => meta.type === doc.type);
     return {
       ...doc,
       metadata: metadata || null
     };
   });
 };

 if (loading) {
  return (
    <div className="flex justify-center items-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
    </div>
  );
 }

 if (error) {
  return (
    <div className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
      {error}
    </div>
  );
 }

 if (!performer) {
  return (
    <div className="text-center py-8">
      <p className="text-gray-500">出演者が見つかりません。</p>
    </div>
  );
 }

 const documentRequirements = [
  { type: 'id_front', label: '身分証明書（表）', required: true },
  { type: 'id_back', label: '身分証明書（裏）', required: true },
  { type: 'selfie', label: 'セルフィー', required: true },
  { type: 'age_verification', label: '年齢確認書', required: false },
  { type: 'residence_proof', label: '住所証明書', required: false }
 ];

 const mergedDocuments = mergeDocumentsWithMetadata();

 return (
  <div className="max-w-6xl mx-auto">
    <div className="bg-white shadow-sm rounded-lg p-6 mb-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{performer.name}</h1>
          <p className="text-sm text-gray-500 mt-1">ID: {performer.id}</p>
          {performer.external_id && (
            <p className="text-sm text-gray-500">External ID: {performer.external_id}</p>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            performer.status === 'approved' ? 'bg-green-100 text-green-800' :
            performer.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
            performer.status === 'rejected' ? 'bg-red-100 text-red-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {performer.status === 'approved' ? '承認済み' :
             performer.status === 'pending' ? '審査中' :
             performer.status === 'rejected' ? '却下' :
             performer.status}
          </span>
          {(userRole === 'admin' || userRole === 'superadmin') && (
            <button
              onClick={() => setDeleteModalOpen(true)}
              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-medium text-gray-500">メールアドレス</h3>
          <p className="mt-1 text-gray-900">{performer.email || 'N/A'}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-500">生年月日</h3>
          <p className="mt-1 text-gray-900">
            {performer.date_of_birth ? new Date(performer.date_of_birth).toLocaleDateString('ja-JP') : 'N/A'}
          </p>
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-500">国籍</h3>
          <p className="mt-1 text-gray-900">{performer.nationality || 'N/A'}</p>
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-500">登録日</h3>
          <p className="mt-1 text-gray-900">
            {new Date(performer.created_at).toLocaleDateString('ja-JP')}
          </p>
        </div>
      </div>
    </div>

    {/* メタデータエラー通知 */}
    {metadataError && (
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
        <div className="flex">
          <div className="flex-shrink-0">
            <Info className="h-5 w-5 text-yellow-400" />
          </div>
          <div className="ml-3">
            <p className="text-sm text-yellow-700">{metadataError}</p>
          </div>
        </div>
      </div>
    )}

    <div className="bg-white shadow-sm rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">提出書類</h2>
      
      <div className="space-y-4">
        {documentRequirements.map(req => {
          const doc = mergedDocuments.find(d => d.type === req.type);
          
          return (
            <div key={req.type} className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center space-x-3">
                <FileText className="h-5 w-5 text-gray-400" />
                <div>
                  <p className="font-medium text-gray-900">
                    {req.label}
                    {req.required && <span className="text-red-500 ml-1">*</span>}
                  </p>
                  {doc ? (
                    <div className="space-y-1">
                      <p className="text-sm text-gray-500">
                        アップロード日: {new Date(doc.uploaded_at).toLocaleDateString('ja-JP')}
                      </p>
                      {/* メタデータがある場合は表示 */}
                      {doc.metadata && (
                        <div className="text-xs text-gray-400 space-y-0.5">
                          <p>サイズ: {(doc.metadata.size / 1024).toFixed(2)} KB</p>
                          <p>形式: {doc.metadata.mimeType}</p>
                          {doc.metadata.dimensions && (
                            <p>サイズ: {doc.metadata.dimensions.width} × {doc.metadata.dimensions.height}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">未提出</p>
                  )}
                </div>
              </div>
              
              {doc && (
                <div className="flex items-center space-x-2">
                  {doc.status === 'verified' ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : doc.status === 'rejected' ? (
                    <AlertCircle className="h-5 w-5 text-red-500" />
                  ) : null}
                  
                  <button
                    onClick={() => handlePreview(doc)}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                    title="プレビュー"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  
                  <button
                    onClick={() => handleDownload(doc.type)}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                    title="ダウンロード"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  
                  {(userRole === 'admin' || userRole === 'superadmin') && doc.status !== 'verified' && (
                    <button
                      onClick={() => handleVerify(doc.type)}
                      disabled={verifyingDoc === doc.type}
                      className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      {verifyingDoc === doc.type ? '処理中...' : '承認'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>

    {/* Delete Modal */}
    {deleteModalOpen && (
      <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-md w-full p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">出演者の削除</h3>
          <p className="text-gray-500 mb-6">
            {performer.name}を削除してもよろしいですか？この操作は取り消せません。
          </p>
          <div className="flex justify-end space-x-3">
            <button
              onClick={() => setDeleteModalOpen(false)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              onClick={handleDelete}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              削除
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Preview Modal */}
    {previewDoc && (
      <div className="fixed inset-0 bg-gray-900 bg-opacity-90 flex items-center justify-center p-4 z-50">
        <div className="max-w-6xl max-h-[90vh] w-full relative bg-white rounded-lg overflow-hidden">
          <div className="absolute top-0 right-0 p-4">
            <button
              onClick={closePreview}
              className="p-2 bg-white rounded-full shadow-lg hover:bg-gray-100 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
          
          <div className="p-6">
            <h3 className="text-xl font-semibold mb-4">
              {documentRequirements.find(r => r.type === previewDoc.type)?.label || previewDoc.type}
            </h3>
            
            <div className="flex justify-center items-center">
              {imageLoadError ? (
                <div className="text-center p-8">
                  <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
                  <p className="text-gray-700">画像の読み込みに失敗しました。</p>
                  <p className="text-sm text-gray-500 mt-2">ネットワーク接続を確認してください。</p>
                </div>
              ) : imageUrl ? (
                <img
                  src={imageUrl}
                  alt={`${performer.name} - ${previewDoc.type}`}
                  className="max-w-full max-h-[70vh] object-contain"
                  onError={(e) => {
                    console.error('画像読み込みエラー:', e);
                    setImageLoadError(true);
                    // フォールバック: 別のパスを試す
                    if (!e.target.dataset.retried) {
                      e.target.dataset.retried = 'true';
                      // /uploads/直下のパスを試す
                      const filename = imageUrl.split('/').pop();
                      e.target.src = `https://stg.id-manager.com/uploads/${filename}`;
                    }
                  }}
                />
              ) : (
                <div className="flex justify-center items-center h-64">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
 );
};

export default PerformerDetailPage;