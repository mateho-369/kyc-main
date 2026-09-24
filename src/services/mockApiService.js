// Mock API Service for staging environment
// This provides mock responses when the backend is unavailable

const mockPerformers = [
  {
    id: 1,
    lastName: '田中',
    firstName: '太郎',
    lastNameRoman: 'Tanaka',
    firstNameRoman: 'Taro',
    status: 'active',
    kycStatus: 'verified',
    createdAt: '2024-01-15T10:00:00Z'
  },
  {
    id: 2,
    lastName: '佐藤',
    firstName: '花子',
    lastNameRoman: 'Sato',
    firstNameRoman: 'Hanako',
    status: 'active',
    kycStatus: 'pending',
    createdAt: '2024-01-16T11:00:00Z'
  },
  {
    id: 3,
    lastName: '鈴木',
    firstName: '一郎',
    lastNameRoman: 'Suzuki',
    firstNameRoman: 'Ichiro',
    status: 'active',
    kycStatus: 'verified',
    createdAt: '2024-01-17T12:00:00Z'
  }
];

const mockDashboardStats = {
  totalPerformers: 3,
  activePerformers: 3,
  pendingKYC: 1,
  verifiedKYC: 2
};

const mockUser = {
  id: 1,
  email: 'test@example.com',
  name: 'Test User',
  role: 'admin' // Set as admin to access all features
};

// Mock users for login
const mockUsers = [
  {
    id: 1,
    email: 'test@example.com',
    password: 'password123',
    name: 'Test User',
    role: 'user'
  },
  {
    id: 2,
    email: 'admin@example.com',
    password: 'admin123',
    name: 'Admin User',
    role: 'admin'
  }
];

// Check if we're in staging/production without backend
const isBackendUnavailable = () => {
  // 環境変数でモックAPIを強制有効化
  if (process.env.REACT_APP_USE_MOCK_API === 'true') {
    console.log('🎭 Mock APIモードが環境変数で有効化されています');
    return true;
  }
  
  // localStorageで一時的にMock APIを有効化（デバッグ用）
  if (localStorage.getItem('USE_MOCK_API') === 'true') {
    console.log('🎭 Mock APIモードがlocalStorageで有効化されています');
    return true;
  }
  
  // サーバー復旧確認 - Real API準備
  return false; // Real API接続有効化（ステージング環境用）
  
  // Emergency mode logic
  // return true; // Mock API強制モード
  
  // Original logic
  // return process.env.NODE_ENV === 'production' || 
  //        process.env.NODE_ENV === 'staging' ||
  //        window.location.hostname === 'stg.id-manager.com';
};

// Mock API interceptor
export const mockApiInterceptor = {
  // Mock GET requests
  mockGet: async (url) => {
    console.log('🎭 Mock API intercepting GET:', url);
    
    // Add delay to simulate network request
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
    
    // 16エンドポイント統合API仕様書準拠のMockレスポンス
    
    // 1. Firebase認証検証 (GET形式への対応)
    if (url.includes('/auth/firebase-verify') || url.includes('/auth/firebase-sso')) {
      return {
        data: {
          success: true,
          data: {
            user: {
              id: 'mock_user_123',
              email: 'test@example.com',
              name: 'Test User',
              firebase_uid: 'firebase_mock_uid'
            },
            session_token: 'mock_session_token_' + Date.now(),
            redirect_url: 'https://sharegram.com/dashboard'
          },
          error: null
        }
      };
    }
    
    // 2. 出演者情報連携 - 出演者一覧取得
    if (url.includes('/performers') && !url.includes('/performers/')) {
      return {
        data: {
          success: true,
          data: {
            performers: mockPerformers,
            pagination: {
              page: 1,
              limit: 20,
              total: mockPerformers.length,
              totalPages: 1
            }
          },
          error: null
        }
      };
    }
    
    // 3. 出演者詳細取得
    if (url.match(/\/performers\/[^\/]+$/) && !url.includes('/documents')) {
      const performerId = url.split('/').pop();
      const performer = mockPerformers.find(p => p.id.toString() === performerId) || mockPerformers[0];
      return {
        data: {
          success: true,
          data: { performer },
          error: null
        }
      };
    }
    
    // 4. 身分証明書関連 - 書類一覧取得
    if (url.includes('/documents') && !url.includes('/download') && !url.includes('/metadata')) {
      return {
        data: {
          success: true,
          data: {
            documents: [
              {
                type: 'agreementFile',
                filename: 'agreement_mock.pdf',
                verified: true,
                uploadedAt: '2024-01-15T10:00:00Z'
              },
              {
                type: 'idFront',
                filename: 'id_front_mock.jpg',
                verified: false,
                uploadedAt: '2024-01-15T10:30:00Z'
              },
              {
                type: 'idBack',
                filename: 'id_back_mock.jpg',
                verified: false,
                uploadedAt: '2024-01-15T10:31:00Z'
              }
            ]
          },
          error: null
        }
      };
    }
    
    // 5. 書類メタデータ取得 (新規実装)
    if (url.includes('/documents/metadata')) {
      return {
        data: {
          success: true,
          data: {
            documents: [
              {
                type: 'agreementFile',
                filename: 'agreement_mock.pdf',
                size: 1024000,
                mimeType: 'application/pdf',
                verified: true,
                metadata: {
                  pages: 2,
                  created: '2024-01-15T10:00:00Z',
                  modified: '2024-01-15T10:00:00Z'
                }
              },
              {
                type: 'idFront',
                filename: 'id_front_mock.jpg',
                size: 512000,
                mimeType: 'image/jpeg',
                verified: false,
                metadata: {
                  dimensions: { width: 1200, height: 800 },
                  created: '2024-01-15T10:30:00Z'
                }
              }
            ]
          },
          error: null
        }
      };
    }
    
    // 6. 書類ダウンロード (ブロブレスポンス)
    if (url.includes('/download')) {
      // Mock binary data response
      const mockBlob = new Blob(['Mock PDF content'], { type: 'application/pdf' });
      return {
        data: mockBlob,
        headers: { 'content-type': 'application/pdf' }
      };
    }
    
    // 7. 連携状態管理
    if (url.includes('/integration/status')) {
      return {
        data: {
          success: true,
          data: {
            status: 'healthy',
            last_sync: new Date().toISOString(),
            features: {
              firebase_auth: true,
              document_upload: true,
              kyc_verification: true,
              webhook_notifications: true
            }
          },
          error: null
        }
      };
    }
    
    // 8. 連携ヘルスチェック
    if (url.includes('/integration/health')) {
      return {
        data: {
          success: true,
          data: {
            status: 'healthy',
            response_time: Math.floor(Math.random() * 500) + 100,
            service_checks: {
              database: 'healthy',
              firebase: 'healthy',
              file_storage: 'healthy',
              webhook_service: 'healthy'
            }
          },
          error: null
        }
      };
    }
    
    // Dashboard stats
    if (url.includes('/dashboard/stats')) {
      return {
        data: {
          success: true,
          data: mockDashboardStats,
          error: null
        }
      };
    }
    
    // Auth me
    if (url.includes('/auth/me') || url.includes('/users/me')) {
      return {
        data: {
          success: true,
          data: mockUser,
          error: null
        }
      };
    }
    
    // Session init
    if (url.includes('/auth/session/init')) {
      return {
        data: {
          success: true,
          data: { csrfToken: 'mock-csrf-token' },
          error: null
        }
      };
    }
    
    // Default mock response
    console.log('🎭 Mock API default response for:', url);
    return {
      data: {
        success: true,
        data: {},
        error: null
      }
    };
  },
  
  // Mock POST requests
  mockPost: async (url, data) => {
    console.log('🎭 Mock API intercepting POST:', url, data);
    
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
    
    // 16エンドポイント統合API仕様書準拠のMock POSTレスポンス
    
    // 1. Firebase認証検証
    if (url.includes('/auth/firebase-verify')) {
      return {
        data: {
          success: true,
          data: {
            user: {
              id: 'verified_user_' + Date.now(),
              email: 'test@firebase.com',
              name: 'Firebase User',
              firebase_uid: data.id_token ? 'firebase_' + data.id_token.slice(-6) : 'firebase_mock'
            },
            session_token: 'verified_session_' + Date.now()
          },
          error: null
        }
      };
    }
    
    // 2. 出演者情報同期
    if (url.includes('/performers/sync')) {
      const syncedPerformer = {
        id: 'synced_' + Date.now(),
        external_id: data.performer?.external_id || 'external_' + Date.now(),
        ...data.performer,
        status: 'synced',
        syncedAt: new Date().toISOString()
      };
      
      return {
        data: {
          success: true,
          data: { performer: syncedPerformer },
          error: null
        }
      };
    }
    
    // 3. 出演者登録完了通知
    if (url.includes('/performers/registration-complete')) {
      return {
        data: {
          success: true,
          data: {
            message: '出演者登録が正常に完了しました',
            redirect_url: 'https://sharegram.com/performers/' + (data.external_id || 'mock_id'),
            performer_status: 'registration_completed'
          },
          error: null
        }
      };
    }
    
    // 4. KYC承認処理
    if (url.includes('/approve')) {
      return {
        data: {
          success: true,
          data: {
            performer: {
              id: url.split('/')[2], // Extract ID from URL
              status: 'approved',
              approvedAt: new Date().toISOString(),
              approvedBy: data.admin_user_id || 'mock_admin'
            },
            sharegram_notification: {
              sent: true,
              notificationId: 'notif_' + Date.now(),
              message: 'KYC承認が完了しました'
            }
          },
          error: null
        }
      };
    }
    
    // 5. コンテンツ承認Webhook
    if (url.includes('/webhooks/content-approved')) {
      return {
        data: {
          success: true,
          data: {
            updated_performers: data.performer_ids?.map(id => ({
              performer_id: id,
              content_approved: true,
              updated_at: new Date().toISOString()
            })) || []
          },
          error: null
        }
      };
    }
    
    // 6. KYC承認通知
    if (url.includes('/performers/kyc-approved')) {
      return {
        data: {
          success: true,
          data: {
            message: 'KYC承認通知が正常に処理されました',
            performer_status: data.status || 'approved',
            notification_sent: true
          },
          error: null
        }
      };
    }
    
    // Legacy endpoints
    if (url.includes('/auth/login')) {
      // Validate login credentials
      const user = mockUsers.find(u => 
        u.email === data.email && u.password === data.password
      );
      
      if (user) {
        const { password, ...userWithoutPassword } = user;
        return {
          data: {
            success: true,
            data: {
              token: 'mock-jwt-token-' + user.id,
              user: userWithoutPassword,
              message: 'Login successful'
            },
            error: null
          }
        };
      } else {
        // Mock login failure
        const error = new Error('Invalid credentials');
        error.response = { 
          status: 401, 
          data: { 
            success: false,
            data: null,
            error: {
              message: 'メールアドレスまたはパスワードが正しくありません',
              code: 'INVALID_CREDENTIALS'
            }
          } 
        };
        throw error;
      }
    }
    
    if (url.includes('/auth/session/init')) {
      return {
        data: {
          success: true,
          data: { csrfToken: 'mock-csrf-token' },
          error: null
        }
      };
    }
    
    if (url.includes('/performers') && !url.includes('/sync') && !url.includes('/registration-complete')) {
      const newPerformer = {
        id: mockPerformers.length + 1,
        ...data,
        status: 'active',
        kycStatus: 'pending',
        createdAt: new Date().toISOString()
      };
      mockPerformers.push(newPerformer);
      return {
        data: {
          success: true,
          data: newPerformer,
          error: null
        }
      };
    }
    
    // Default mock response
    return {
      data: {
        success: true,
        data: {},
        error: null
      }
    };
  },
  
  // Mock PUT requests
  mockPut: async (url, data) => {
    console.log('🎭 Mock API intercepting PUT:', url, data);
    
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
    
    // 書類検証エンドポイント
    if (url.includes('/documents/') && url.includes('/verify')) {
      const documentType = url.split('/documents/')[1].split('/verify')[0];
      
      return {
        data: {
          success: true,
          data: {
            document: {
              type: documentType,
              verified: data.verified || true,
              verifiedBy: data.verified_by || 'mock_admin',
              verifiedAt: new Date().toISOString(),
              notes: data.notes || ''
            },
            all_verified: Math.random() > 0.5 // Random boolean for demo
          },
          error: null
        }
      };
    }
    
    return {
      data: {
        success: true,
        data: {},
        error: null
      }
    };
  },
  
  // Check if mock should be used
  shouldUseMock: () => isBackendUnavailable(),
  
  // Enable/disable mock API
  enableMock: () => {
    localStorage.setItem('USE_MOCK_API', 'true');
    console.log('🎭 Mock APIモードを有効化しました');
    window.location.reload();
  },
  
  disableMock: () => {
    localStorage.removeItem('USE_MOCK_API');
    console.log('🎭 Mock APIモードを無効化しました');
    window.location.reload();
  },
  
  // Check current mock status
  getMockStatus: () => {
    return {
      envVar: process.env.REACT_APP_USE_MOCK_API === 'true',
      localStorage: localStorage.getItem('USE_MOCK_API') === 'true',
      isActive: isBackendUnavailable()
    };
  }
};

export default mockApiInterceptor;