import React from 'react';

const SSOCallbackPage = () => {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold">SSO処理中...</h1>
        <p className="mt-4">認証を処理しています。しばらくお待ちください。</p>
      </div>
    </div>
  );
};

export default SSOCallbackPage;
