import useDialogFocus from '../hooks/useDialogFocus';
import React, { useState, useEffect, useRef } from 'react';
import { FiDownload as Download, FiRotateCw as RotateCw, FiX as X, FiZoomIn as ZoomIn, FiZoomOut as ZoomOut } from 'react-icons/fi';
import DocumentThumbnail from './DocumentThumbnail';
import secureApiClient from '../services/SecureApiClient';

/**
 * 画像プレビューモーダルコンポーネント
 * @param {Object} props
 * @param {boolean} props.isOpen - モーダルが開いているかどうか
 * @param {Function} props.onClose - モーダルを閉じる際のハンドラ
 * @param {string} props.performerId - 出演者ID
 * @param {Object} props.performer - 出演者情報
 */
const ImagePreviewModal = ({ isOpen, onClose, performerId, performer, initialDocumentType = 'selfie' }) => {
  const [selectedDocument, setSelectedDocument] = useState('selfie');
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, isOpen, onClose);

  // ドキュメントタイプの定義
  const documentTypes = [
    { key: 'selfie', label: 'セルフィー' },
    { key: 'idFront', label: '身分証明書（表面）' },
    { key: 'idBack', label: '身分証明書（裏面）' },
    { key: 'agreementFile', label: '同意書' },
    { key: 'selfieWithId', label: 'ID付きセルフィー' }
  ];

  useEffect(() => {
    if (isOpen) {
      const aliases = { agreement_file: 'agreementFile', id_front: 'idFront', id_back: 'idBack', selfie_with_id: 'selfieWithId' };
      setSelectedDocument(aliases[initialDocumentType] || initialDocumentType || 'selfie');
    }
  }, [isOpen, initialDocumentType]);

  // モーダルが閉じられる際にリセット
  useEffect(() => {
    if (!isOpen) {
      setZoom(100);
      setRotation(0);
      setSelectedDocument('selfie');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 25, 200));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 25, 50));
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);

  const handleDownload = async () => {
    try {
      // 表示（DocumentThumbnail）と同じく、認証付きでアプリの API ベース URL（REACT_APP_API_URL）から取得する。
      // 以前は https://stg.id-manager.com を直書きしていたので、ローカルでもステージングに取りに行っていた。
      const response = await secureApiClient.get(
        `/performers/${performerId}/documents/${selectedDocument}`,
        { responseType: 'blob' }
      );

      const blob = response?.data;
      if (blob) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${performer?.lastName || 'performer'}_${selectedDocument}.jpg`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('ダウンロードエラー:', error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="document-preview-title" tabIndex={-1} ref={dialogRef}>
      {/* オーバーレイ */}
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
        ></div>

        {/* モーダルコンテンツ */}
        <div className="inline-block w-full max-w-4xl align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
          {/* ヘッダー */}
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4 border-b border-gray-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 id="document-preview-title" className="text-lg break-words leading-6 font-medium text-gray-900">
                  {performer?.lastName} {performer?.firstName} - 書類プレビュー
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  {performer?.lastNameRoman} {performer?.firstNameRoman}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="プレビューを閉じる"
                className="p-2 shrink-0 bg-white rounded-md text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-navy-500"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
          </div>

          {/* サムネイル選択エリア - UX最適化 */}
          <div className="bg-gray-50 px-2 py-3 sm:px-4 border-b border-gray-200">
            <div className="flex items-center space-x-2 sm:space-x-3 overflow-x-auto pb-1">
              {documentTypes.map((docType) => (
                <div key={docType.key} className="flex-shrink-0">
                  <button
                    onClick={() => setSelectedDocument(docType.key)}
                    className={`flex flex-col items-center space-y-1 p-1 sm:p-2 rounded-lg border-2 transition-all duration-200 hover:shadow-sm ${
                      selectedDocument === docType.key
                        ? 'border-gold-500 bg-gold-50 shadow-sm transform scale-105'
                        : 'border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <DocumentThumbnail
                      performerId={performerId}
                      documentType={docType.key}
                      mimeType="image/jpeg"
                      className="w-10 h-10 sm:w-12 sm:h-12"
                    />
                    <span className="text-xs text-gray-600 text-center max-w-[3rem] sm:max-w-[4rem] leading-tight">
                      {docType.label}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* コントロールエリア - モバイル最適化 */}
          <div className="bg-white px-2 py-3 sm:px-4 border-b border-gray-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-1 sm:space-x-2">
                <button
                  onClick={handleZoomOut}
                  className="p-3 text-navy-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
                  disabled={zoom <= 50}
                  title="縮小"
                >
                  <ZoomOut className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>
                <span className="text-xs sm:text-sm text-gray-600 min-w-[3rem] sm:min-w-[4rem] text-center font-medium">
                  {zoom}%
                </span>
                <button
                  onClick={handleZoomIn}
                  className="p-3 text-navy-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
                  disabled={zoom >= 200}
                  title="拡大"
                >
                  <ZoomIn className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>
              </div>

              <div className="flex items-center space-x-1 sm:space-x-2">
                <button
                  onClick={handleRotate}
                  className="p-3 text-navy-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
                  title="回転"
                >
                  <RotateCw className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center px-2 py-1 sm:px-3 sm:py-2 border border-gray-300 shadow-sm text-xs sm:text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-navy-500 transition-colors"
                >
                  <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">ダウンロード</span>
                  <span className="sm:hidden">DL</span>
                </button>
              </div>
            </div>
          </div>

          {/* 画像表示エリア - レスポンシブ最適化 */}
          <div className="bg-gray-100 px-2 py-4 sm:px-6 sm:py-6">
            <div className="flex justify-center items-center min-h-[16rem] sm:min-h-[24rem] max-h-80 sm:max-h-96 overflow-hidden">
              <div 
                className="relative bg-white rounded-lg shadow-lg overflow-hidden"
                style={{
                  transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                  transformOrigin: 'center',
                  transition: 'transform 0.2s ease-in-out'
                }}
              >
                <DocumentThumbnail
                  performerId={performerId}
                  documentType={selectedDocument}
                  mimeType="image/jpeg"
                  className="w-64 h-64 sm:w-80 sm:h-80 border-0 rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* フッター */}
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              onClick={onClose}
              className="w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-navy-500 sm:ml-3 sm:w-auto sm:text-sm"
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImagePreviewModal;