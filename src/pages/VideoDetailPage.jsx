import React, { useState, useEffect } from 'react';
import { FiDownload as Download, FiEye as Eye, FiPlus as Plus, FiTrash as Trash, FiUser as User } from 'react-icons/fi';
import { useParams, useNavigate, Link } from 'react-router-dom';
// import { getVideoById, getVideoPerformers } from '../services/videoService';

const VideoDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [video, setVideo] = useState(null);
  const [performers, setPerformers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchVideoDetails = async () => {
      try {
        const videoData = await getVideoById(id);
        setVideo(videoData);
        
        const performersData = await getVideoPerformers(id);
        setPerformers(performersData);
      } catch (err) {
        setError('動画情報の取得に失敗しました');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchVideoDetails();
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-600 rounded-md p-4">
        <p>{error}</p>
        <button 
          onClick={() => navigate('/')}
          className="mt-2 text-sm font-medium text-red-600 hover:text-red-800"
        >
          ダッシュボードに戻る
        </button>
      </div>
    );
  }

  return (
    <div>
      {video && (
        <>
          <div className="md:flex md:items-center md:justify-between mb-6">
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
                {video.title}
              </h2>
              <div className="mt-1 flex items-center text-sm text-gray-500">
                <span>ID: {video.id}</span>
              </div>
            </div>
            <div className="mt-4 flex md:mt-0 md:ml-4">
              <Link
                to={`/videos/${id}/performers/add`}
                className="ml-3 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-500 hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                <Plus className="mr-2 -ml-1 h-5 w-5" />
                出演者を追加
              </Link>
            </div>
          </div>

          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
              <h3 className="text-lg leading-6 font-medium text-gray-900">出演者一覧</h3>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-sm font-medium bg-green-100 text-green-800">
                {performers.length}名
              </span>
            </div>
            
            {performers.length === 0 ? (
              <div className="text-center py-12">
                <User className="mx-auto h-12 w-12 text-gray-300" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">出演者なし</h3>
                <p className="mt-1 text-sm text-gray-500">出演者情報は登録されていません</p>
                <div className="mt-6">
                  <Link
                    to={`/videos/${id}/performers/add`}
                    className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-500 hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                  >
                    <Plus className="-ml-1 mr-2 h-5 w-5" />
                    出演者を追加
                  </Link>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {performers.map((performer) => (
                  <li key={performer.id} className="px-4 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <div className="flex-shrink-0">
                          <User className="h-8 w-8 rounded-full bg-gray-100 p-1 text-gray-500" />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {performer.lastName} {performer.firstName}
                          </div>
                          <div className="text-sm text-gray-500">
                            {performer.lastNameRoman} {performer.firstNameRoman}
                          </div>
                        </div>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          type="button"
                          className="inline-flex items-center p-1 border border-transparent rounded-full shadow-sm text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                        >
                          <Eye className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center p-1 border border-transparent rounded-full shadow-sm text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                        >
                          <Download className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center p-1 border border-transparent rounded-full shadow-sm text-red-400 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        >
                          <Trash className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default VideoDetailPage;