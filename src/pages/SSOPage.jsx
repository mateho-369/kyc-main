import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { createFirebaseSession } from '../services/auth';
import { auth } from '../config/firebase';
import { clearAccessToken, setAccessToken } from '../utils/authToken';
import { extractSsoToken } from '../utils/ssoToken';
// come_back の解錠・安全性判定は utils/sharegramReturn.js（登録画面と共通）
import { decodeComeBackUrl, isSafeReturnUrl } from '../utils/sharegramReturn';

/**
 * Sharegram SSO認証ページ
 *
 * Sharegramからのリダイレクトを受け付け、Firebase ID Tokenを検証して
 * 自動ログイン後、指定されたアクションに応じた画面へ遷移します。
 *
 * URL例: /sso?token={Firebase_ID_Token}&action=create&performer_id=123&come_back_url=https://...
 *
 * パラメータ:
 * - token: Firebase ID Token（必須。id_token などの別名、URLハッシュも許容）
 * - action: 操作種別 - create（新規作成）または edit（編集）（必須）
 * - performer_id: 出演者ID（action=editの場合は必須）
 * - come_back_url: 操作完了後のSharegramへの戻り先URL（オプション）
 *
 * token が無い場合の挙動:
 *   1. 同じブラウザで Firebase にサインイン済みなら、その ID Token を使う
 *      （Sharegram 側で既にサインインしているケースの救済）
 *   2. それも無ければ「Sharegram から token が届いていない」と明示して止める
 *      （以前は原因が分からないまま認証エラー画面になっていた）
 */
const SSOPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, setUser, setIsAuthenticated } = useAuth();

  const [status, setStatus] = useState('processing'); // processing, success, error
  const [errorMessage, setErrorMessage] = useState('');
  const [debugInfo, setDebugInfo] = useState({});
  const processStarted = useRef(false);

  useEffect(() => {
    // 二重実行防止
    if (processStarted.current) return;
    processStarted.current = true;

    const processSSO = async () => {
      try {
        // --- URL パラメータ -------------------------------------------------
        const action = searchParams.get('action');
        const performerId = searchParams.get('performer_id');
        // Sharegram historically sent both spellings. Accept both so the SSO
        // flow does not silently lose its return destination.
        const comeBackUrl = decodeComeBackUrl(
          searchParams.get('come_back_url') || searchParams.get('come_back')
        );

        // token はクエリ・ハッシュ・別名のいずれでも受け取る（utils/ssoToken.js）
        const tokenLookup = extractSsoToken({
          search: typeof window !== 'undefined' ? window.location.search : '',
          hash: typeof window !== 'undefined' ? window.location.hash : ''
        });

        let token = tokenLookup.token;
        let tokenSource = token ? tokenLookup.source : null;

        // URL に token が無い場合は、このブラウザの Firebase セッションを使えるか試す
        if (!token && auth?.currentUser) {
          try {
            console.log('🔁 URLにtokenが無いためFirebaseの現在ユーザーからID Tokenを取得します');
            token = await auth.currentUser.getIdToken();
            tokenSource = 'firebase';
          } catch (firebaseError) {
            console.warn('Firebase ID Tokenの取得に失敗:', firebaseError.message);
          }
        }

        // デバッグ情報を保存（値そのものは出さない）
        setDebugInfo({
          hasToken: !!token,
          tokenLength: token?.length || 0,
          tokenSource,
          tokenParamName: tokenLookup.paramName,
          tokenProblem: tokenLookup.reason,
          receivedParamNames: tokenLookup.receivedParamNames,
          action,
          performerId,
          hasComeBackUrl: !!comeBackUrl
        });

        console.log('SSO認証開始:', {
          hasToken: !!token,
          tokenSource,
          action,
          performerId,
          hasComeBackUrl: !!comeBackUrl
        });

        // --- 後続画面のために引き継ぐ（検証より先に保存する） ------------------
        // 認証に失敗してこの画面に留まっても、「Sharegramに戻る」で戻れるよう、
        // エラー表示より前に保存しておく。
        if (comeBackUrl) {
          try {
            sessionStorage.setItem('sharegram_come_back_url', comeBackUrl);
            console.log('come_back_urlを保存:', comeBackUrl);
          } catch (e) {
            console.warn('セッションストレージへの保存に失敗:', e);
          }
        }

        if (action) {
          sessionStorage.setItem('sharegram_action', action);
        }
        if (performerId) {
          sessionStorage.setItem('sharegram_performer_id', performerId);
        }

        // --- 必須パラメータの検証 -------------------------------------------
        if (!token) {
          if (tokenLookup.reason === 'malformed') {
            throw new Error(
              'tokenパラメータの値がFirebase ID Tokenの形式ではありません（"undefined" や空文字が渡されていませんか）。'
              + ' Sharegram側でトークン取得後に改めて開き直してください。'
            );
          }
          throw new Error(
            'SharegramからFirebase ID Token（tokenパラメータ）が送られていません。'
            + ' Sharegram側の「本人確認を開始」から開き直すか、下の「ログイン画面へ」から直接ログインしてください。'
          );
        }

        if (!action || !['create', 'edit'].includes(action)) {
          throw new Error('actionパラメータが無効です。create または edit を指定してください。');
        }

        if (action === 'edit' && !performerId) {
          throw new Error('編集モードではperformer_idが必須です。');
        }

        // 前回のログインで残ったローカルJWTを破棄する。
        // 残したままだと axios のインターセプターが Authorization に付け、
        // Sharegramのトークンより優先されて「Invalid token」になる。
        // （URLのtokenを最優先で使うため、交換の直前にだけ消す）
        clearAccessToken();

        // --- Firebase ID Tokenの検証とセッション作成 ------------------------
        console.log('Firebase ID Token検証開始...');

        try {
          // バックエンドでFirebase ID Tokenを検証してセッションを作成
          const sessionResponse = await createFirebaseSession(token);
          console.log('Firebaseセッション作成成功:', sessionResponse);

          // AuthContextを更新（認証状態を反映）
          if (sessionResponse?.user) {
            // トークンをlocalStorageに保存（APIリクエストで使用）
            if (sessionResponse.token) {
              setAccessToken(sessionResponse.token);
              console.log('✅ Access tokenをlocalStorageに保存');
            }

            // setUser と setIsAuthenticated を直接呼び出す
            setUser(sessionResponse.user);
            setIsAuthenticated(true);
            console.log('AuthContext更新完了 - ユーザー:', sessionResponse.user.email);
          } else {
            console.warn('セッションレスポンスにユーザー情報がありません');
          }
        } catch (sessionError) {
          console.error('Firebaseセッション作成エラー:', sessionError);

          // エラーメッセージを詳細化
          const httpStatus = sessionError.response?.status;
          const code = sessionError.response?.data?.code
            || sessionError.response?.data?.error?.code;

          if (httpStatus === 401 && code === 'TOKEN_EXPIRED') {
            throw new Error('Firebase ID Tokenの有効期限が切れています。Sharegramから再度ログインしてください。');
          } else if (httpStatus === 401) {
            throw new Error('Firebase ID Tokenが無効または期限切れです。Sharegramから再度ログインしてください。');
          } else if (httpStatus === 400) {
            throw new Error('Firebase ID Tokenを解釈できませんでした。SharegramのFirebaseプロジェクトとサーバー設定（FIREBASE_PROJECT_ID）が一致しているか確認してください。');
          } else if (httpStatus === 503) {
            throw new Error('サーバーのFirebase設定が不完全です（FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY）。');
          } else if (httpStatus === 429) {
            throw new Error('ログイン試行が多すぎます。少し待ってから再試行してください。');
          } else {
            throw new Error(`認証処理中にエラーが発生しました: ${sessionError.message || '不明なエラー'}`);
          }
        }

        // --- 認証成功 -------------------------------------------------------
        setStatus('success');
        console.log('SSO認証成功、リダイレクト準備中...');

        // 少し待ってから遷移（認証状態の反映を待つ）
        await new Promise(resolve => setTimeout(resolve, 1000));

        // actionに応じたリダイレクト先を決定
        let redirectPath = '/';
        if (action === 'create') {
          redirectPath = '/performers/add';
          console.log('新規登録画面へリダイレクト:', redirectPath);
        } else if (action === 'edit') {
          redirectPath = `/performers/${performerId}`;
          console.log('編集画面へリダイレクト:', redirectPath);
        }

        // リダイレクト実行
        navigate(redirectPath, { replace: true });

      } catch (error) {
        console.error('SSO認証エラー:', error);
        setStatus('error');
        setErrorMessage(error.message || '認証処理中にエラーが発生しました。');
      }
    };

    processSSO();
  }, [searchParams, navigate, setUser, setIsAuthenticated]);

  // エラー時のSharegramへ戻るハンドラ
  /**
   * 「Sharegramに戻る」。come_back はクエリパラメータで外部から来る値なので、
   * そのまま location.href に渡すと ?come_back=javascript:... で自傷XSSになる。
   * http/https と確認できる物だけ使い、それ以外はダッシュボードへ落とす。
   */
  const handleReturnToSharegram = () => {
    const comeBackUrl = sessionStorage.getItem('sharegram_come_back_url');
    if (isSafeReturnUrl(decodeComeBackUrl(comeBackUrl))) {
      window.location.href = decodeComeBackUrl(comeBackUrl);
      return;
    }
    if (comeBackUrl) {
      console.warn('[come_back] 安全でない戻り先のため遷移しません:', comeBackUrl);
    }
    // 戻り先が無い／使えない場合：認証済みならダッシュボード、未認証ならログイン
    navigate(isAuthenticated ? '/' : '/login', { replace: true });
  };

  // 再試行ハンドラ
  const handleRetry = () => {
    processStarted.current = false;
    setStatus('processing');
    setErrorMessage('');
    window.location.reload();
  };

  const handleGoToLogin = () => {
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            Sharegram SSO認証
          </h1>

          {/* 処理中 */}
          {status === 'processing' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
              </div>
              <p className="text-gray-600">認証を処理しています...</p>
              <p className="text-sm text-gray-500">しばらくお待ちください</p>
            </div>
          )}

          {/* 成功 */}
          {status === 'success' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="rounded-full h-12 w-12 bg-green-100 flex items-center justify-center">
                  <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
              <p className="text-green-600 font-medium">認証成功</p>
              <p className="text-sm text-gray-500">リダイレクト中...</p>
            </div>
          )}

          {/* エラー */}
          {status === 'error' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="rounded-full h-12 w-12 bg-red-100 flex items-center justify-center">
                  <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
              </div>
              <p className="text-red-600 font-medium">認証エラー</p>
              <div className="bg-red-50 border border-red-200 rounded-md p-4 text-left">
                <p className="text-sm text-red-700">{errorMessage}</p>
              </div>

              <div className="flex flex-col space-y-2 mt-4">
                <button
                  onClick={handleRetry}
                  className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  再試行
                </button>
                <button
                  onClick={handleGoToLogin}
                  className="w-full py-2 px-4 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-700 bg-white hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  ログイン画面へ
                </button>
                <button
                  onClick={handleReturnToSharegram}
                  className="w-full py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Sharegramに戻る
                </button>
              </div>

              {/* デバッグ情報（開発環境のみ） */}
              {process.env.NODE_ENV === 'development' && (
                <div className="mt-4 p-3 bg-gray-100 rounded text-left text-xs text-gray-600">
                  <p className="font-medium mb-1">デバッグ情報:</p>
                  <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SSOPage;
