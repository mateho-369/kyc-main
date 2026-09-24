import api from './api';

// 動画一覧の取得
export const getVideos = async () => {
  try {
    const response = await api.get('/videos');
    return response.data;
  } catch (error) {
    throw error;
  }
};

// 動画詳細の取得
export const getVideoById = async (id) => {
  try {
    const response = await api.get(`/videos/${id}`);
    return response.data;
  } catch (error) {
    throw error;
  }
};

// 新規動画の登録
export const createVideo = async (videoData) => {
  try {
    const response = await api.post('/videos', videoData);
    return response.data;
  } catch (error) {
    throw error;
  }
};

// 動画の出演者一覧の取得
export const getVideoPerformers = async (videoId) => {
  try {
    const response = await api.get(`/videos/${videoId}/performers`);
    return response.data;
  } catch (error) {
    throw error;
  }
};

// 出演者の追加
export const addPerformer = async (videoId, performerData) => {
  try {
    const formData = new FormData();
    
    // 基本情報をFormDataに追加
    formData.append('lastName', performerData.lastName);
    formData.append('firstName', performerData.firstName);
    formData.append('lastNameRoman', performerData.lastNameRoman);
    formData.append('firstNameRoman', performerData.firstNameRoman);
    
    // ファイルをFormDataに追加
    if (performerData.agreementFile) {
      formData.append('agreementFile', performerData.agreementFile);
    }
    if (performerData.idFront) {
      formData.append('idFront', performerData.idFront);
    }
    if (performerData.idBack) {
      formData.append('idBack', performerData.idBack);
    }
    if (performerData.selfie) {
      formData.append('selfie', performerData.selfie);
    }
    if (performerData.selfieWithId) {
      formData.append('selfieWithId', performerData.selfieWithId);
    }
    
    const response = await api.post(`/videos/${videoId}/performers`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    
    return response.data;
  } catch (error) {
    throw error;
  }
};