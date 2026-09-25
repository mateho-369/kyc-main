import React, { useState, useEffect } from 'react';
// import { getPerformerById, getPerformerDocuments, downloadDocument, deletePerformer, verifyDocument } from '../services/api';
import { FiAlertCircle as AlertCircle, FiCheckCircle as CheckCircle, FiDownload as Download, FiEye as Eye, FiFileText as FileText, FiInfo as Info, FiTrash as Trash } from 'react-icons/fi';
import { useParams, useNavigate } from 'react-router-dom';
import { getPerformerById, getPerformerDocuments, downloadDocument, deletePerformer, verifyDocument } from '../services/performerService';
import { getUserRole } from '../services/auth';
import secureApiClient from '../services/SecureApiClient';
import { getPerformerDocumentsMetadata } from '../services/documentMetadataService';
import DocumentThumbnail from '../components/DocumentThumbnail';
import ImagePreviewModal from '../components/ImagePreviewModal';

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

 // 画像をBlobとして取得してBlob URLを生成
 const fetchImageAsBlob = async (documentType) => {
   try {
     console.log('🖼️ 画像取得開始:', documentType);
     setImageLoadError(false);

     // SecureApiClientを使用して認証付きで画像を取得
     // baseURL（REACT_APP_API_URL）が既に .../api で終わるので、ここに /api を付けると /api/api/... で 404
     const response = await secureApiClient.get(`/performers/${id}/documents/${documentType}`, {
       responseType: 'blob'
     });

     // レスポンスからBlobを取得
     const blob = response.data;
     console.log('✅ Blob取得成功:', {
       size: blob.size,
       type: blob.type
     });

     // 既存のBlob URLがあれば解放
     if (imageUrl && imageUrl.startsWith('blob:')) {
       URL.revokeObjectURL(imageUrl);
     }

     // Blob URLを生成
     const blobUrl = URL.createObjectURL(blob);
     setImageUrl(blobUrl);
     console.log('✅ Blob URL生成成功:', blobUrl);

   } catch (error) {
     console.error('❌ 画像の取得に失敗しました:', error);
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

       // documentsオブジェクトを配列形式に変換
       if (performerData.documents) {
         const documentArray = [];
         const documentTypeMapping = {
           agreementFile: 'agreement_file',
           idFront: 'id_front',
           idBack: 'id_back',
           selfie: 'selfie',
           selfieWithId: 'selfie_with_id'
         };

         for (const [key, value] of Object.entries(performerData.documents)) {
           if (value) {
             documentArray.push({
               type: documentTypeMapping[key] || key,
               url: value,
               status: 'pending',
               uploaded_at: performerData.createdAt,
               mimeType: (value.mimeType || (value.path && value.path.endsWith('.png') ? 'image/png' : 'image/jpeg'))
             });
           }
         }
         setDocuments(documentArray);
       } else {
         const documentsData = await getPerformerDocuments(id);
         setDocuments(documentsData);
       }

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

   // クリーンアップ関数：コンポーネントアンマウント時にBlob URLを解放
   return () => {
     if (imageUrl && imageUrl.startsWith('blob:')) {
       URL.revokeObjectURL(imageUrl);
     }
   };
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
    a.download = `${performer.lastName}_${performer.firstName}_${documentType}.${extension}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (err) {
    console.error('Download error:', err);
    setError(err.response?.data?.message || 'ダウンロードに失敗しました');
  }
 };

 const handleDelete = async () => {
  try {
    await deletePerformer(id);
    navigate('/performers');
  } catch (err) {
    setError(err.response?.data?.message || '削除に失敗しました');
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
    // 403 の理由（「書類の検証は管理者のみが実行できます。」）をそのまま出す。
    // 握り潰すと「ボタンが効かない」にしか見えないため。
    setError(err.response?.data?.message || err.response?.data?.error || '確認処理に失敗しました');
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
   if (!Array.isArray(documents)) {
     console.warn('documents is not an array:', documents);
     return [];
   }
   if (!Array.isArray(documentsMetadata)) {
     console.warn('documentsMetadata is not an array:', documentsMetadata);
   }
   return documents.map(doc => {
     const metadata = Array.isArray(documentsMetadata)
       ? documentsMetadata.find(meta => meta.type === doc.type)
       : null;
     return {
       ...doc,
       metadata: metadata || null
     };
   });
 };

 if (loading) {
  return (
    <div className="flex justify-center items-center h-64">
      <div className="loading-spinner"></div>
    </div>
  );
 }

 if (error) {
  return (
    <div className="card-premium p-6 animate-fade-in">
      <div className="flex items-center gap-3 text-danger-600">
        <AlertCircle className="h-5 w-5 flex-shrink-0" />
        <p className="text-sm font-medium">{error}</p>
      </div>
    </div>
  );
 }

 if (!performer) {
  return (
    <div className="text-center py-12 animate-fade-in">
      <div className="w-16 h-16 rounded-full bg-navy-100 flex items-center justify-center mx-auto mb-4">
        <Info className="h-7 w-7 text-navy-400" />
      </div>
      <p className="text-navy-500 font-medium">出演者が見つかりません。</p>
    </div>
  );
 }

 const documentRequirements = [
  { type: 'agreement_file', label: '同意書', required: true },
  { type: 'id_front', label: '身分証明書（表）', required: true },
  { type: 'id_back', label: '身分証明書（裏）', required: true },
  { type: 'selfie', label: 'セルフィー', required: true },
  { type: 'selfie_with_id', label: '身分証明書と一緒のセルフィー', required: true }
 ];

 const mergedDocuments = mergeDocumentsWithMetadata();

 // KYC progress calculation
 const totalRequired = documentRequirements.filter(r => r.required).length;
 const submittedCount = documentRequirements.filter(req =>
   mergedDocuments.some(d => d.type === req.type)
 ).length;
 const verifiedCount = documentRequirements.filter(req => {
   const doc = mergedDocuments.find(d => d.type === req.type);
   return doc && doc.status === 'verified';
 }).length;
 const progressPercent = totalRequired > 0 ? Math.round((submittedCount / totalRequired) * 100) : 0;

 const getStatusBadge = (doc) => {
   if (!doc) {
     return <span className="badge badge-danger">未提出</span>;
   }
   if (doc.status === 'verified') {
     return <span className="badge badge-success">確認済</span>;
   }
   if (doc.status === 'rejected') {
     return <span className="badge badge-danger">却下</span>;
   }
   return <span className="badge badge-warning">確認待ち</span>;
 };

 return (
  <div className="max-w-6xl mx-auto animate-fade-in">
    {/* KYC Progress Summary */}
    <div className="card-premium p-6 mb-6 animate-fade-in-up stagger-1" style={{ animationFillMode: 'both' }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-navy-500 uppercase tracking-wider">KYC 認証進捗</h2>
          <p className="text-2xl font-display font-bold text-navy-900 mt-1">
            {submittedCount} / {totalRequired}
            <span className="text-sm font-normal text-navy-400 ml-2">書類提出済み</span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-success-500"></div>
            <span className="text-xs text-navy-500">確認済 {verifiedCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-warning-500"></div>
            <span className="text-xs text-navy-500">確認待ち {submittedCount - verifiedCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-navy-200"></div>
            <span className="text-xs text-navy-500">未提出 {totalRequired - submittedCount}</span>
          </div>
        </div>
      </div>
      {/* Progress bar */}
      <div className="mt-4">
        <div className="w-full h-2.5 bg-navy-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${progressPercent}%`,
              background: progressPercent === 100
                ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                : 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)'
            }}
          ></div>
        </div>
        <p className="text-xs text-navy-400 mt-1.5 text-right">{progressPercent}% 完了</p>
      </div>
    </div>

    {/* Performer Info Card */}
    <div className="card-premium p-8 mb-6 animate-fade-in-up stagger-2" style={{ animationFillMode: 'both' }}>
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy-900">{performer.lastName} {performer.firstName}</h1>
          <p className="text-sm text-navy-400 mt-1.5">ID: {performer.id}</p>
          {performer.external_id && (
            <p className="text-sm text-navy-400">External ID: {performer.external_id}</p>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => navigate(`/performers/${id}/edit`)}
            className="btn-primary"
          >
            編集
          </button>
          {(userRole === 'admin' || userRole === 'superadmin') && (
            <button
              onClick={() => setDeleteModalOpen(true)}
              className="p-3 text-danger-600 hover:bg-danger-50 rounded-xl transition-all duration-200"
              title="削除"
            >
              <Trash className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-4 rounded-xl bg-navy-50/50">
          <h3 className="text-xs font-semibold text-navy-500 uppercase tracking-wider">名前</h3>
          <p className="mt-1.5 text-navy-900 font-medium">{performer.lastName} {performer.firstName}</p>
        </div>
        <div className="p-4 rounded-xl bg-navy-50/50">
          <h3 className="text-xs font-semibold text-navy-500 uppercase tracking-wider">英語読み仮名</h3>
          <p className="mt-1.5 text-navy-900 font-medium">{performer.lastNameRoman} {performer.firstNameRoman}</p>
        </div>
        <div className="p-4 rounded-xl bg-navy-50/50">
          <h3 className="text-xs font-semibold text-navy-500 uppercase tracking-wider">登録日</h3>
          <p className="mt-1.5 text-navy-900 font-medium">
            {new Date(performer.createdAt || performer.created_at).toLocaleDateString('ja-JP')}
          </p>
        </div>
      </div>
    </div>

    {/* Metadata error notification */}
    {metadataError && (
      <div className="card-premium p-4 mb-6 border-l-4 border-warning-500 animate-fade-in-up" style={{ animationFillMode: 'both' }}>
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-warning-50 flex items-center justify-center">
            <Info className="h-4 w-4 text-warning-600" />
          </div>
          <p className="text-sm text-navy-600">{metadataError}</p>
        </div>
      </div>
    )}

    {/* Documents Section */}
    <div className="card-premium p-8 animate-fade-in-up stagger-3" style={{ animationFillMode: 'both' }}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-display font-semibold text-navy-900">提出書類</h2>
        <span className="badge badge-navy">{submittedCount} / {totalRequired}</span>
      </div>

      <div className="space-y-4">
        {documentRequirements.map((req, index) => {
          const doc = mergedDocuments.find(d => d.type === req.type);

          return (
            <div
              key={req.type}
              className={`flex items-center justify-between p-4 sm:p-5 rounded-xl border transition-all duration-200 ${
                doc
                  ? 'border-navy-200 bg-white hover:border-navy-300 hover:shadow-soft'
                  : 'border-dashed border-navy-200 bg-navy-50/30'
              }`}
            >
              <div className="flex items-center space-x-3 sm:space-x-4">
                {/* Thumbnail */}
                {doc ? (
                  <DocumentThumbnail
                    performerId={id}
                    documentType={doc.type}
                    mimeType={doc.mimeType}
                    onClick={() => handlePreview(doc)}
                    className="flex-shrink-0"
                    exists={!!(doc.url && doc.url.path)}
                  />
                ) : (
                  <div className="w-16 h-16 sm:w-20 sm:h-20 border border-navy-200 rounded-xl bg-navy-50 flex items-center justify-center flex-shrink-0">
                    <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-navy-300" />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-navy-900">
                      {req.label}
                      {req.required && <span className="text-danger-500 ml-1">*</span>}
                    </p>
                    {getStatusBadge(doc)}
                  </div>
                  {doc ? (
                    <div className="space-y-1 mt-1">
                      <p className="text-sm text-navy-500">
                        アップロード日: {new Date(doc.uploaded_at).toLocaleDateString('ja-JP')}
                      </p>
                      {/* Metadata display */}
                      {doc.metadata && (
                        <div className="text-xs text-navy-400 space-y-0.5">
                          <p>サイズ: {(doc.metadata.size / 1024).toFixed(2)} KB</p>
                          <p>形式: {doc.metadata.mimeType}</p>
                          {doc.metadata.dimensions && (
                            <p>サイズ: {doc.metadata.dimensions.width} x {doc.metadata.dimensions.height}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-navy-400 mt-1">未提出</p>
                  )}
                </div>
              </div>

              {doc && (
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => handlePreview(doc)}
                    className="p-2.5 text-navy-500 hover:text-navy-800 hover:bg-navy-100 rounded-lg transition-all duration-200"
                    title="プレビュー"
                  >
                    <Eye className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => handleDownload(doc.type)}
                    className="p-2.5 text-navy-500 hover:text-navy-800 hover:bg-navy-100 rounded-lg transition-all duration-200"
                    title="ダウンロード"
                  >
                    <Download className="h-4 w-4" />
                  </button>

                  {/*
                    検証（承認）。handleVerify は実装済みなのにどのボタンからも呼ばれて
                    おらず、管理者でもこの画面から書類を確定できなかった。
                    API: PUT /api/performers/:id/documents/:type/verify（管理者限定）。
                  */}
                  {(userRole === 'admin' || userRole === 'superadmin') && (
                    <button
                      onClick={() => handleVerify(doc.type)}
                      disabled={verifyingDoc === doc.type}
                      title={doc.status === 'verified' ? '検証済み（再検証）' : 'この書類を検証する'}
                      className={`p-2.5 rounded-lg transition-all duration-200 ${
                        doc.status === 'verified'
                          ? 'text-success-600 hover:bg-success-50'
                          : 'text-navy-500 hover:text-navy-800 hover:bg-navy-100'
                      } ${verifyingDoc === doc.type ? 'opacity-50 cursor-wait' : ''}`}
                    >
                      <CheckCircle className="h-4 w-4" />
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
      <div className="fixed inset-0 bg-navy-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
        <div className="card-premium max-w-md w-full p-8 animate-scale-in">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-danger-50 flex items-center justify-center flex-shrink-0">
              <Trash className="h-5 w-5 text-danger-600" />
            </div>
            <h3 className="text-lg font-display font-semibold text-navy-900">出演者の削除</h3>
          </div>
          <p className="text-navy-500 mb-8 leading-relaxed">
            <span className="font-semibold text-navy-700">{performer.lastName} {performer.firstName}</span>
            を削除してもよろしいですか？この操作は取り消せません。
          </p>
          <div className="flex justify-end space-x-3">
            <button
              onClick={() => setDeleteModalOpen(false)}
              className="btn-secondary"
            >
              キャンセル
            </button>
            <button
              onClick={handleDelete}
              className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-white bg-danger-600 hover:bg-danger-500 rounded-xl shadow-soft transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-danger-500 focus:ring-offset-2"
            >
              削除する
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Image Preview Modal */}
    <ImagePreviewModal
      isOpen={!!previewDoc}
      onClose={closePreview}
      performerId={id}
      documentType={previewDoc?.type}
      documentLabel={documentRequirements.find(r => r.type === previewDoc?.type)?.label || previewDoc?.type}
      performerName={performer ? `${performer.lastName} ${performer.firstName}` : ''}
    />
  </div>
 );
};

export default PerformerDetailPage;
