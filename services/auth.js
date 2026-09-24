import api from './api';

export const login = async (email, password) => {
  try {
    const response = await api.post('/auth/login', { email, password });
    const { token, user } = response.data;
    
    // トークンをローカルストレージに保存
    localStorage.setItem('token', token);
    
    return user;
  } catch (error) {
    throw error.response?.data || { message: 'ログインに失敗しました' };
  }
};

export const logout = async () => {
  localStorage.removeItem('token');
  return true;
};

export const checkAuth = async () => {
  try {
    const response = await api.get('/auth/me');
    return response.data;
  } catch (error) {
    localStorage.removeItem('token');
    throw error;
  }
};