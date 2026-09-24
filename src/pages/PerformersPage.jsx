import React, { useEffect, useState } from 'react';
import { FiEye as Eye, FiPlus as Plus, FiUser as User, FiSearch as Search, FiFilter as Filter, FiChevronRight as ChevronRight, FiAlertCircle as AlertCircle } from 'react-icons/fi';
import { Link, useNavigate } from 'react-router-dom';
import { getPerformers } from '../services/performerService';
import { useAuth } from '../contexts/AuthContext';
import ImagePreviewModal from '../components/ImagePreviewModal';
import DocumentThumbnail from '../components/DocumentThumbnail';

const PerformersPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [performers, setPerformers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const [previewModal, setPreviewModal] = useState({
    isOpen: false,
    performerId: null,
    performer: null
  });

  useEffect(() => {
    const fetchPerformers = async () => {
      try {
        console.log('出演者情報を取得中...');
        const data = await getPerformers();

        let performersList = data;
        if (data && typeof data === 'object' && !Array.isArray(data) && data.data) {
          performersList = data.data;
        }

        if (Array.isArray(performersList)) {
          console.log(`出演者情報取得成功: ${performersList.length}人`);
          setPerformers(performersList);
          setError('');
        } else {
          console.error('予期しないデータ形式:', data);
          setPerformers([]);
          setError('データ形式が不正です');
        }
      } catch (err) {
        console.error('出演者情報取得エラー:', err);

        if (err.response?.status === 401) {
          setError('認証が必要です。ログインしてください。');
        } else if (err.response?.status === 403) {
          setError('アクセス権限がありません。');
        } else if (err.response?.status === 404) {
          setError('出演者情報エンドポイントが見つかりません。');
        } else if (err.response?.status >= 500) {
          setError('サーバーエラーが発生しました。');
        } else if (!navigator.onLine) {
          setError('インターネット接続を確認してください。');
        } else {
          setError('出演者情報の取得に失敗しました。');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchPerformers();
  }, [retryCount]);

  const openPreviewModal = (performer) => {
    setPreviewModal({
      isOpen: true,
      performerId: performer.id,
      performer: performer
    });
  };

  const closePreviewModal = () => {
    setPreviewModal({
      isOpen: false,
      performerId: null,
      performer: null
    });
  };

  const filteredPerformers = performers.filter(performer => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      performer.lastName?.toLowerCase().includes(query) ||
      performer.firstName?.toLowerCase().includes(query) ||
      performer.lastNameRoman?.toLowerCase().includes(query) ||
      performer.firstNameRoman?.toLowerCase().includes(query)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="loading-spinner mx-auto mb-4"></div>
          <p className="text-navy-500 text-sm">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto py-12">
        <div className="card-premium p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-danger-50 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-danger-500" />
          </div>
          <h3 className="text-lg font-semibold text-navy-900 mb-2">エラーが発生しました</h3>
          <p className="text-navy-500 mb-6">{error}</p>
          <div className="flex items-center justify-center space-x-4">
            <button
              onClick={() => {
                setError('');
                setLoading(true);
                setRetryCount(retryCount + 1);
              }}
              className="btn-primary"
            >
              再試行
            </button>
            <button
              onClick={() => navigate('/')}
              className="btn-secondary"
            >
              ダッシュボードに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-navy-900 font-display">
              {isAdmin ? '全出演者一覧' : 'マイ出演者一覧'}
            </h1>
            <p className="mt-1 text-navy-500">
              {isAdmin
                ? 'システムに登録されているすべての出演者'
                : 'あなたが登録した出演者の一覧'}
            </p>
          </div>
          <div className="mt-4 lg:mt-0">
            <Link to="/performers/add" className="btn-gold">
              <Plus className="w-4 h-4 mr-2" />
              出演者を追加
            </Link>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="card-premium p-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-navy-400" />
            <input
              type="text"
              placeholder="名前で検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-premium pl-12"
            />
          </div>
          <div className="flex items-center space-x-3">
            <button className="btn-secondary">
              <Filter className="w-4 h-4 mr-2" />
              フィルター
            </button>
            <div className="hidden sm:flex items-center px-4 py-2 bg-navy-50 rounded-xl">
              <span className="text-sm font-medium text-navy-700">
                {filteredPerformers.length}
              </span>
              <span className="text-sm text-navy-500 ml-1">件</span>
            </div>
          </div>
        </div>
      </div>

      {/* Performers List */}
      <div className="card-premium overflow-hidden">
        {filteredPerformers.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full bg-navy-50 flex items-center justify-center mx-auto mb-4">
              <User className="w-10 h-10 text-navy-300" />
            </div>
            <h3 className="text-lg font-medium text-navy-900 mb-2">出演者が登録されていません</h3>
            <p className="text-navy-500 mb-6">新しい出演者を登録してください</p>
            <Link to="/performers/add" className="btn-gold">
              <Plus className="w-4 h-4 mr-2" />
              出演者を追加
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-navy-100">
            {filteredPerformers.map((performer, index) => (
              <div
                key={performer.id}
                className="p-5 hover:bg-navy-50/50 transition-colors duration-200 animate-fade-in-up"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    {/* Avatar */}
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-navy-100 to-navy-200 flex items-center justify-center flex-shrink-0">
                      <User className="w-6 h-6 text-navy-500" />
                    </div>

                    {/* Document Thumbnails */}
                    <div className="flex space-x-2">
                      <DocumentThumbnail
                        performerId={performer.id}
                        documentType="selfie"
                        mimeType="image/jpeg"
                        className="w-12 h-12 rounded-lg border-2 border-gold-200 hover:border-gold-400 transition-all duration-200 cursor-pointer"
                        onClick={() => openPreviewModal(performer)}
                      />
                      <DocumentThumbnail
                        performerId={performer.id}
                        documentType="idFront"
                        mimeType="image/jpeg"
                        className="w-12 h-12 rounded-lg border-2 border-navy-200 hover:border-navy-400 transition-all duration-200 cursor-pointer"
                        onClick={() => openPreviewModal(performer)}
                      />
                    </div>

                    {/* Info */}
                    <div className="min-w-0">
                      <h3 className="text-base font-medium text-navy-900 truncate">
                        {performer.lastName} {performer.firstName}
                      </h3>
                      <p className="text-sm text-navy-500">
                        {performer.lastNameRoman} {performer.firstNameRoman}
                      </p>
                      <div className="flex items-center space-x-3 mt-1">
                        <span className="badge badge-success">確認済み</span>
                        <span className="text-xs text-navy-400">ID: {performer.id}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => openPreviewModal(performer)}
                      className="p-2 rounded-lg text-navy-400 hover:text-navy-600 hover:bg-navy-100 transition-colors duration-200"
                      title="画像プレビュー"
                    >
                      <Eye className="w-5 h-5" />
                    </button>
                    <Link
                      to={`/performers/${performer.id}`}
                      className="flex items-center space-x-2 px-4 py-2 rounded-lg text-navy-600 hover:text-navy-900 hover:bg-navy-100 transition-colors duration-200"
                    >
                      <span className="text-sm font-medium">詳細</span>
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Image Preview Modal */}
      <ImagePreviewModal
        isOpen={previewModal.isOpen}
        onClose={closePreviewModal}
        performerId={previewModal.performerId}
        performer={previewModal.performer}
      />
    </div>
  );
};

export default PerformersPage;
