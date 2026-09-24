import secureApiClient from './SecureApiClient';

// 動画一覧の取得
export const getVideos = async () => {
  try {
    const response = await secureApiClient.get('/videos');
    return response.data;
  } catch (error) {
    throw error;
  }
};

// 動画詳細の取得
export const getVideoById = async (id) => {
  try {
    const response = await secureApiClient.get(`/videos/${id}`);
    return response.data;
  } catch (error) {
    throw error;
  }
};

// 新規動画の登録
export const createVideo = async (videoData) => {
  try {
    const response = await secureApiClient.post('/videos', videoData);
    return response.data;
  } catch (error) {
    throw error;
  }
};

// 動画の出演者一覧の取得
export const getVideoPerformers = async (videoId) => {
  try {
    const response = await secureApiClient.get(`/videos/${videoId}/performers`);
    return response.data;
  } catch (error) {
    throw error;
  }
};

// 出演者の追加
export const addPerformer = async (videoId, performerData) => {
  try {
    // FormDataの場合はpostWithFileを使用、通常データの場合はpostを使用
    const response = performerData instanceof FormData 
      ? await secureApiClient.post(`/videos/${videoId}/performers`, performerData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
      : await secureApiClient.post(`/videos/${videoId}/performers`, performerData);
    
    return response.data;
  } catch (error) {
    throw error;
  }
};

// 出演者詳細の取得
export const getPerformerById = async (videoId, performerId) => {
  try {
    const response = await secureApiClient.get(`/videos/${videoId}/performers/${performerId}`);
    return response.data;
  } catch (error) {
    throw error;
  }
};