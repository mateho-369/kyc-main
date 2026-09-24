import React, { useState, useEffect } from 'react';
import { FiAlertCircle as AlertCircle, FiFileText as FileText, FiImage as Image } from 'react-icons/fi';
import secureApiClient from '../services/SecureApiClient';

/**
 * 書類のサムネイル表示コンポーネント
 * @param {Object} props
 * @param {string} props.performerId - 出演者ID
 * @param {string} props.documentType - 書類タイプ
 * @param {string} props.mimeType - MIMEタイプ
 * @param {Function} props.onClick - クリック時のハンドラ
 * @param {string} props.className - 追加のCSSクラス
 */
const DocumentThumbnail = ({
  performerId,
  documentType,
  mimeType,
  onClick,
  className = "",
  exists = true
}) => {
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // snake_case を camelCase に変換（バックエンドAPIとの互換性のため）
  const snakeToCamel = (str) => {
    const mapping = {
      'agreement_file': 'agreementFile',
      'id_front': 'idFront',
      'id_back': 'idBack',
      'selfie': 'selfie',
      'selfie_with_id': 'selfieWithId'
    };
    return mapping[str] || str;
  };

  // 画像ファイルかどうかを判定
  const isImageFile = mimeType && mimeType.startsWith('image/');

  useEffect(() => {
    // 書類が存在しない場合はスキップ
    if (!exists) {
      console.log('📋 書類未登録のためスキップ:', documentType);
      return;
    }

    // サムネイル取得を有効化
    if (isImageFile && performerId && documentType) {
      fetchThumbnail();
    }

    // クリーンアップ関数
    return () => {
      if (thumbnailUrl && thumbnailUrl.startsWith('blob:')) {
        URL.revokeObjectURL(thumbnailUrl);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performerId, documentType, exists]);

  const fetchThumbnail = async () => {
    setLoading(true);
    setError(false);

    try {
      // snake_case を camelCase に変換してAPIリクエスト
      const apiDocType = snakeToCamel(documentType);
      console.log('📸 サムネイル取得開始:', { performerId, documentType, apiDocType });

      // SecureApiClientを使用して認証付きで画像を取得
      const response = await secureApiClient.get(
        `/performers/${performerId}/documents/${apiDocType}`,
        {
          responseType: 'blob'
        }
      );
      
      const blob = response.data;
      
      // 既存のBlob URLがあれば解放
      if (thumbnailUrl && thumbnailUrl.startsWith('blob:')) {
        URL.revokeObjectURL(thumbnailUrl);
      }
      
      // Blob URLを生成
      const blobUrl = URL.createObjectURL(blob);
      setThumbnailUrl(blobUrl);
      
      console.log('✅ サムネイル取得成功:', { 
        size: blob.size, 
        type: blob.type 
      });
      
    } catch (error) {
      console.error('❌ サムネイル取得エラー:', error);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = () => {
    if (onClick) {
      onClick();
    }
  };

  const handleImageError = () => {
    console.error('🖼️ サムネイル画像の読み込みエラー');
    setError(true);
  };

  return (
    <div 
      className={`w-16 h-16 sm:w-20 sm:h-20 border border-gray-200 rounded-lg overflow-hidden bg-gray-50 flex items-center justify-center cursor-pointer hover:border-gray-300 hover:shadow-sm transition-all duration-200 ${className}`}
      onClick={handleClick}
      title="クリックしてプレビュー"
    >
      {isImageFile ? (
        <>
          {loading && (
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400"></div>
            </div>
          )}
          
          {error && !loading && (
            <div className="flex flex-col items-center justify-center text-gray-400">
              <AlertCircle className="h-6 w-6 mb-1" />
              <span className="text-xs">エラー</span>
            </div>
          )}
          
          {thumbnailUrl && !error && !loading && (
            <img
              src={thumbnailUrl}
              alt={`${documentType} サムネイル`}
              className="w-full h-full object-cover"
              onError={handleImageError}
            />
          )}
          
          {!thumbnailUrl && !loading && !error && (
            <div className="flex flex-col items-center justify-center text-gray-400">
              <Image className="h-6 w-6 mb-1" />
              <span className="text-xs">画像</span>
            </div>
          )}
        </>
      ) : (
        // 画像ファイルでない場合はファイルアイコンを表示
        <div className="flex flex-col items-center justify-center text-gray-400">
          <FileText className="h-6 w-6 mb-1" />
          <span className="text-xs">書類</span>
        </div>
      )}
    </div>
  );
};

export default DocumentThumbnail;