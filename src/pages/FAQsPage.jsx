import React from 'react';

const FAQsPage = () => {
  return (
    <div className="max-w-3xl mx-auto py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">よくある質問</h1>
      
      <div className="bg-white shadow rounded-lg divide-y divide-gray-200">
        <div className="p-6">
          <h3 className="text-lg font-medium text-gray-900">SafeVideoとは何ですか？</h3>
          <p className="mt-2 text-gray-600">
            SafeVideoは、コンテンツ制作者や配信者が出演者情報と身分証明書を安全に保管するためのサービスです。
            法的要件に準拠したコンテンツ管理を支援し、必要な記録を安全に維持します。
          </p>
        </div>
        
        <div className="p-6">
          <h3 className="text-lg font-medium text-gray-900">どのような種類のIDがサポートされていますか？</h3>
          <p className="mt-2 text-gray-600">
            運転免許証、パスポート、マイナンバーカード（個人番号部分を隠したもの）など、公的に発行された写真付き身分証明書をサポートしています。
          </p>
        </div>
        
        <div className="p-6">
          <h3 className="text-lg font-medium text-gray-900">アップロードした情報のセキュリティはどのように確保されていますか？</h3>
          <p className="mt-2 text-gray-600">
            すべてのデータは、AES-256暗号化を使用して保存されます。
            また、すべての通信はSSL/TLSで暗号化され、セキュリティ監査を定期的に実施しています。
            アクセス権限も厳しく管理され、必要最小限の権限を持つスタッフのみがデータにアクセスできます。
          </p>
        </div>
        
        <div className="p-6">
          <h3 className="text-lg font-medium text-gray-900">データの保存期間はどれくらいですか？</h3>
          <p className="mt-2 text-gray-600">
            法的要件に基づき、コンテンツが公開されている限り、関連する出演者情報と身分証明書を保管します。
            コンテンツが削除された場合でも、法的保護のために最低7年間はデータを保持します。
            特定のデータ削除リクエストについては、法的要件に従って対応します。
          </p>
        </div>
        
        <div className="p-6">
          <h3 className="text-lg font-medium text-gray-900">複数の出演者がいる場合はどうすればよいですか？</h3>
          <p className="mt-2 text-gray-600">
            1つの動画に対して複数の出演者を登録することができます。
            各出演者ごとに個別の情報と必要書類をアップロードしてください。
            出演者の数に制限はありません。
          </p>
        </div>
      </div>
    </div>
  );
};

export default FAQsPage;