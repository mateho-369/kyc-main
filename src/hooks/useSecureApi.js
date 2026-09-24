import { useState, useCallback, useEffect } from 'react';
import secureApiClient from '../services/SecureApiClient';
import { useSecureFirebaseAuth } from '../contexts/SecureFirebaseAuthContext';

/**
 * セキュアなAPI通信用のカスタムフック
 * @param {string} url - APIエンドポイントのURL
 * @param {Object} options - オプション設定
 */
export const useSecureApi = (url, options = {}) => {
  const { isAuthenticated } = useSecureFirebaseAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // GETリクエスト
  const get = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);

    try {
      const response = await secureApiClient.get(url, { params });
      setData(response.data);
      return response.data;
    } catch (err) {
      const errorMessage = err.response?.data?.error?.message || 'データの取得に失敗しました';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [url]);

  // POSTリクエスト
  const post = useCallback(async (postData) => {
    setLoading(true);
    setError(null);

    try {
      const response = await secureApiClient.post(url, postData);
      setData(response.data);
      return response.data;
    } catch (err) {
      const errorMessage = err.response?.data?.error?.message || 'データの送信に失敗しました';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [url]);

  // PUTリクエスト
  const put = useCallback(async (putData) => {
    setLoading(true);
    setError(null);

    try {
      const response = await secureApiClient.put(url, putData);
      setData(response.data);
      return response.data;
    } catch (err) {
      const errorMessage = err.response?.data?.error?.message || 'データの更新に失敗しました';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [url]);

  // DELETEリクエスト
  const remove = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await secureApiClient.delete(url);
      setData(null);
      return response.data;
    } catch (err) {
      const errorMessage = err.response?.data?.error?.message || 'データの削除に失敗しました';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [url]);

  // 自動フェッチ
  useEffect(() => {
    if (options.autoFetch && isAuthenticated) {
      get();
    }
  }, [options.autoFetch, isAuthenticated, get]);

  // エラーのクリア
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    data,
    loading,
    error,
    get,
    post,
    put,
    remove,
    clearError
  };
};

/**
 * ページネーション対応のセキュアAPI フック
 */
export const useSecurePaginatedApi = (baseUrl, options = {}) => {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const itemsPerPage = options.itemsPerPage || 10;

  const fetchPage = useCallback(async (pageNumber = page) => {
    setLoading(true);
    setError(null);

    try {
      const response = await secureApiClient.get(baseUrl, {
        params: {
          page: pageNumber,
          limit: itemsPerPage,
          ...options.params
        }
      });

      const { data, pagination } = response.data;
      
      setItems(data);
      setPage(pageNumber);
      setTotalPages(pagination.totalPages);
      setTotalItems(pagination.totalItems);
      
      return response.data;
    } catch (err) {
      const errorMessage = err.response?.data?.error?.message || 'データの取得に失敗しました';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [baseUrl, page, itemsPerPage, options.params]);

  const nextPage = useCallback(() => {
    if (page < totalPages) {
      fetchPage(page + 1);
    }
  }, [page, totalPages, fetchPage]);

  const prevPage = useCallback(() => {
    if (page > 1) {
      fetchPage(page - 1);
    }
  }, [page, fetchPage]);

  const goToPage = useCallback((pageNumber) => {
    if (pageNumber >= 1 && pageNumber <= totalPages) {
      fetchPage(pageNumber);
    }
  }, [totalPages, fetchPage]);

  return {
    items,
    page,
    totalPages,
    totalItems,
    loading,
    error,
    fetchPage,
    nextPage,
    prevPage,
    goToPage,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1
  };
};

/**
 * ファイルアップロード用のセキュアAPI フック
 */
export const useSecureFileUpload = (uploadUrl) => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  const uploadFile = useCallback(async (file, additionalData = {}) => {
    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', file);
      
      // 追加データがある場合
      Object.entries(additionalData).forEach(([key, value]) => {
        formData.append(key, value);
      });

      const response = await secureApiClient.uploadFile(
        uploadUrl,
        file,
        (progressPercentage) => {
          setProgress(progressPercentage);
        }
      );

      return response.data;
    } catch (err) {
      const errorMessage = err.response?.data?.error?.message || 'ファイルのアップロードに失敗しました';
      setError(errorMessage);
      throw err;
    } finally {
      setUploading(false);
    }
  }, [uploadUrl]);

  const reset = useCallback(() => {
    setProgress(0);
    setError(null);
  }, []);

  return {
    uploadFile,
    uploading,
    progress,
    error,
    reset
  };
};

/**
 * リアルタイムデータ用のセキュアAPI フック（ポーリング）
 */
export const useSecureRealtimeApi = (url, options = {}) => {
  const { data, loading, error, get } = useSecureApi(url);
  const [isPolling, setIsPolling] = useState(false);

  const pollingInterval = options.pollingInterval || 5000; // デフォルト5秒

  useEffect(() => {
    let intervalId;

    if (isPolling) {
      intervalId = setInterval(() => {
        get().catch(console.error);
      }, pollingInterval);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isPolling, pollingInterval, get]);

  const startPolling = useCallback(() => {
    setIsPolling(true);
  }, []);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
  }, []);

  return {
    data,
    loading,
    error,
    get,
    isPolling,
    startPolling,
    stopPolling
  };
};