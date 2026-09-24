import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { createPerformer, getPerformerById, updatePerformer } from '../services/performerService';
import { trackPerformerRegistration, trackDocumentUpload, trackError } from '../services/firebaseAnalytics';
import { resizeIfNeeded } from '../utils/imageResize';

const AddPerformerPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id: editId } = useParams();
  const isEditMode = !!editId;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState({});
  const [registrationStartTime, setRegistrationStartTime] = useState(null);
  const [externalId, setExternalId] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [existingDocs, setExistingDocs] = useState({});
  const [formData, setFormData] = useState({
    lastName: '',
    firstName: '',
    lastNameRoman: '',
    firstNameRoman: '',
    agreementFile: null,
    idFront: null,
    idBack: null,
    selfie: null,
    selfieWithId: null
  });

  // ファイルを削除する関数
  const removeFile = (fieldName) => {
    setFormData({
      ...formData,
      [fieldName]: null
    });
    // ファイル入力要素をリセット
    const fileInput = document.getElementById(fieldName);
    if (fileInput) {
      fileInput.value = '';
    }
  };

  // 編集モード: 既存データを取得
  useEffect(() => {
    if (isEditMode) {
      const fetchPerformerData = async () => {
        setEditLoading(true);
        try {
          const performer = await getPerformerById(editId);
          setFormData(prev => ({
            ...prev,
            lastName: performer.lastName || '',
            firstName: performer.firstName || '',
            lastNameRoman: performer.lastNameRoman || '',
            firstNameRoman: performer.firstNameRoman || ''
          }));
          if (performer.documents) {
            setExistingDocs(performer.documents);
          }
          if (performer.external_id) {
            setExternalId(performer.external_id);
          }
        } catch (err) {
          console.error('出演者データ取得エラー:', err);
          setError('出演者情報の取得に失敗しました。');
        } finally {
          setEditLoading(false);
        }
      };
      fetchPerformerData();
    }
  }, [editId, isEditMode]);

  // Track page view and registration start
  useEffect(() => {
    console.log(isEditMode ? 'Edit Performer Page' : 'Add Performer Page');
    setRegistrationStartTime(Date.now());

    if (!isEditMode) {
      // Sharegram SSO連携: external_idを取得
      // 優先順位: 1. URLパラメータ, 2. sessionStorage
      const urlExternalId = searchParams.get('external_id');
      const storedExternalId = sessionStorage.getItem('sharegram_external_id');
      const finalExternalId = urlExternalId || storedExternalId;

      if (finalExternalId) {
        console.log('Sharegram external_id detected:', finalExternalId);
        setExternalId(finalExternalId);
        sessionStorage.setItem('sharegram_external_id', finalExternalId);
      }
    }
  }, [searchParams, isEditMode]);

  // 必須フィールドがすべて入力されているか確認
  const isFormValid = () => {
    const hasName = formData.lastName && formData.firstName && formData.lastNameRoman && formData.firstNameRoman;
    if (isEditMode) {
      // 編集モード: 名前があればOK（ファイルは既存を保持）
      return hasName;
    }
    return hasName && formData.agreementFile && formData.idFront && formData.selfie;
  };

  // Stepper: determine current step based on form completion
  const getCurrentStep = () => {
    const hasName = formData.lastName && formData.firstName && formData.lastNameRoman && formData.firstNameRoman;
    const hasDocs = formData.agreementFile && formData.idFront && formData.selfie;
    if (hasDocs) return 3;
    if (hasName) return 2;
    return 1;
  };

  const currentStep = getCurrentStep();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });

    // Track step completion for name fields
    if (value && (name === 'lastName' || name === 'firstName' || name === 'lastNameRoman' || name === 'firstNameRoman')) {
      trackPerformerRegistration('name_input', {
        field: name,
        stepNumber: 1
      });
    }
  };

  const handleFileChange = async (e) => {
    const { name, files } = e.target;

    // ファイルのバリデーション
    if (files.length > 0) {
      const file = files[0];

      // ファイルサイズチェック (5MB)
      const maxFileSize = 20 * 1024 * 1024; // 20MB
      if (file.size > maxFileSize) {
        const errorMsg = `${name}：ファイルサイズが大きすぎます（20MB以下にしてください）`;
        setError(errorMsg);
        trackDocumentUpload(name, file.size, false, { message: 'File too large', code: 'SIZE_LIMIT_EXCEEDED' });
        trackError('validation_error', errorMsg, null, { documentType: name, fileSize: file.size });
        return;
      }

      // 形式チェック
      const allowedTypes = name === 'agreementFile'
        ? ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
        : ['image/jpeg', 'image/jpg', 'image/png'];

      if (!allowedTypes.includes(file.type)) {
        const errorMsg = `${name}：サポートされていないファイル形式です（${name === 'agreementFile' ? 'PDF, ' : ''}JPG, PNGのみ使用可能）`;
        setError(errorMsg);
        trackDocumentUpload(name, file.size, false, { message: 'Invalid file type', code: 'INVALID_TYPE' });
        trackError('validation_error', errorMsg, null, { documentType: name, fileType: file.type });
        return;
      }

      // エラー表示をクリア
      if (error) {
        setError('');
      }

      // 画像ファイルの場合はリサイズ処理を実行
      let processedFile = file;
      if (file.type.startsWith('image/')) {
        try {
          processedFile = await resizeIfNeeded(file, 20 * 1024 * 1024); // 20MB
          console.log(`ファイルサイズ: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(processedFile.size / 1024 / 1024).toFixed(2)}MB`);
        } catch (resizeError) {
          console.error('画像のリサイズに失敗しました:', resizeError);
          // リサイズに失敗しても元のファイルを使用
        }
      }

      // Track successful document upload
      trackDocumentUpload(name, processedFile.size, true);
      trackPerformerRegistration('document_upload', {
        documentType: name,
        fileSize: processedFile.size,
        stepNumber: 2
      });

      setFormData({
        ...formData,
        [name]: processedFile
      });
    } else {
      setFormData({
        ...formData,
        [name]: files[0]
      });
    }

    console.log(`ファイル「${name}」が選択されました:`, files[0] ? files[0].name : 'なし');
  };

  // ドラッグ関連のハンドラー
  const handleDrag = (e, fieldName) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive({ ...dragActive, [fieldName]: true });
    } else if (e.type === "dragleave") {
      setDragActive({ ...dragActive, [fieldName]: false });
    }
  };

  const handleDrop = async (e, fieldName) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive({ ...dragActive, [fieldName]: false });

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];

      // ファイルサイズチェック (5MB)
      const maxFileSize = 20 * 1024 * 1024; // 20MB
      if (file.size > maxFileSize) {
        const errorMsg = `${fieldName}：ファイルサイズが大きすぎます（20MB以下にしてください）`;
        setError(errorMsg);
        trackDocumentUpload(fieldName, file.size, false, { message: 'File too large', code: 'SIZE_LIMIT_EXCEEDED' });
        trackError('validation_error', errorMsg, null, { documentType: fieldName, fileSize: file.size });
        return;
      }

      // 形式チェック
      const allowedTypes = fieldName === 'agreementFile'
        ? ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
        : ['image/jpeg', 'image/jpg', 'image/png'];

      if (!allowedTypes.includes(file.type)) {
        const errorMsg = `${fieldName}：サポートされていないファイル形式です（${fieldName === 'agreementFile' ? 'PDF, ' : ''}JPG, PNGのみ使用可能）`;
        setError(errorMsg);
        trackDocumentUpload(fieldName, file.size, false, { message: 'Invalid file type', code: 'INVALID_TYPE' });
        trackError('validation_error', errorMsg, null, { documentType: fieldName, fileType: file.type });
        return;
      }

      // エラー表示をクリア
      if (error) {
        setError('');
      }

      // 画像ファイルの場合はリサイズ処理を実行
      let processedFile = file;
      if (file.type.startsWith('image/')) {
        try {
          processedFile = await resizeIfNeeded(file, 20 * 1024 * 1024); // 20MB
          console.log(`ファイルサイズ: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(processedFile.size / 1024 / 1024).toFixed(2)}MB`);
        } catch (resizeError) {
          console.error('画像のリサイズに失敗しました:', resizeError);
          // リサイズに失敗しても元のファイルを使用
        }
      }

      // Track successful document upload via drag and drop
      trackDocumentUpload(fieldName, processedFile.size, true);
      trackPerformerRegistration('document_upload', {
        documentType: fieldName,
        fileSize: processedFile.size,
        uploadMethod: 'drag_drop',
        stepNumber: 2
      });

      setFormData({
        ...formData,
        [fieldName]: processedFile
      });

      console.log(`ファイル「${fieldName}」がドロップされました:`, file.name);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    // テキストフィールドのバリデーション
    if (!formData.lastName || !formData.firstName || !formData.lastNameRoman || !formData.firstNameRoman) {
      const errorMsg = 'すべての名前フィールドを入力してください。';
      setError(errorMsg);
      setSubmitting(false);
      trackError('validation_error', errorMsg, null, { step: 'name_validation' });
      return;
    }

    try {
      if (isEditMode) {
        // === 編集モード ===
        console.log('出演者情報更新開始:', editId);
        const updateData = new FormData();
        updateData.append('lastName', formData.lastName);
        updateData.append('firstName', formData.firstName);
        updateData.append('lastNameRoman', formData.lastNameRoman);
        updateData.append('firstNameRoman', formData.firstNameRoman);

        // 新しいファイルが選択された場合のみ追加
        const fileFields = ['agreementFile', 'idFront', 'idBack', 'selfie', 'selfieWithId'];
        for (const field of fileFields) {
          if (formData[field] instanceof File) {
            updateData.append(field, formData[field]);
          }
        }

        await updatePerformer(editId, updateData);
        console.log('出演者情報更新成功');
        navigate(`/performers/${editId}`);
      } else {
        // === 新規登録モード ===
        // ファイルが選択されているか確認
        if (!formData.agreementFile || !formData.idFront || !formData.selfie) {
          const errorMsg = '必須ファイル（出演同意書、身分証明書表面、本人写真）がアップロードされていません。';
          setError(errorMsg);
          setSubmitting(false);
          trackError('validation_error', errorMsg, null, { step: 'file_validation' });
          return;
        }

        console.log('出演者情報登録開始:', {
          name: `${formData.lastName} ${formData.firstName}`,
          files: {
            agreementFile: formData.agreementFile?.name,
            idFront: formData.idFront?.name,
            idBack: formData.idBack?.name,
            selfie: formData.selfie?.name,
            selfieWithId: formData.selfieWithId?.name
          }
        });

        // external_idを含めたデータを作成
        const performerDataWithExternalId = {
          ...formData,
          external_id: externalId
        };
        const newPerformer = await createPerformer(performerDataWithExternalId);
        console.log('出演者情報登録成功:', newPerformer);

        // 登録成功後、sessionStorageのexternal_idをクリア
        if (externalId) {
          sessionStorage.removeItem('sharegram_external_id');
        }

        // Track successful registration completion
        const registrationDuration = Date.now() - registrationStartTime;
        trackPerformerRegistration('registration_complete', {
          performerId: newPerformer.id,
          duration: registrationDuration,
          stepNumber: 3
        });

        // Sharegram come_back_url があればリダイレクト
        const comeBackUrl = sessionStorage.getItem('sharegram_come_back_url');
        if (comeBackUrl) {
          sessionStorage.removeItem('sharegram_come_back_url');
          const redirectUrl = new URL(decodeURIComponent(comeBackUrl));
          redirectUrl.searchParams.set('performer_id', newPerformer.id);
          redirectUrl.searchParams.set('status', 'created');
          console.log('Sharegramにリダイレクト:', redirectUrl.toString());
          window.location.href = redirectUrl.toString();
        } else {
          navigate(`/performers/${newPerformer.id}`);
        }
      }
    } catch (err) {
      console.error(isEditMode ? '出演者情報更新エラー:' : '出演者情報登録エラー:', err);
      const errorMsg = err.message || (isEditMode ? '出演者情報の更新に失敗しました。' : '出演者情報の登録に失敗しました。');
      setError(errorMsg);
      trackError('api_error', errorMsg, err.stack, {
        endpoint: isEditMode ? 'updatePerformer' : 'createPerformer',
        registrationDuration: Date.now() - registrationStartTime
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (editLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  // Stepper configuration
  const steps = [
    { number: 1, label: '基本情報' },
    { number: 2, label: '書類提出' },
    { number: 3, label: '確認・送信' }
  ];

  // Reusable file upload zone renderer
  const renderFileUploadZone = (fieldName, label, required, acceptTypes, formatHint) => (
    <div>
      <label className="form-label">
        {label} {required && <span className="text-danger-500">*必須</span>}
        {isEditMode && existingDocs[fieldName] && !formData[fieldName] && (
          <span className="ml-2 text-success-600 text-xs font-normal">(登録済み)</span>
        )}
      </label>
      <div
        className={`mt-1 flex justify-center px-6 pt-5 pb-6 border-2 ${dragActive[fieldName] ? 'border-gold-500 bg-gold-50' : 'border-navy-200'} border-dashed rounded-xl transition-all duration-200`}
        onDragEnter={(e) => handleDrag(e, fieldName)}
        onDragLeave={(e) => handleDrag(e, fieldName)}
        onDragOver={(e) => handleDrag(e, fieldName)}
        onDrop={(e) => handleDrop(e, fieldName)}
      >
        <div className="space-y-1 text-center">
          <svg
            className="mx-auto h-12 w-12 text-navy-300"
            stroke="currentColor"
            fill="none"
            viewBox="0 0 48 48"
            aria-hidden="true"
          >
            <path
              d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="flex text-sm text-navy-500">
            <label
              htmlFor={fieldName}
              className="relative cursor-pointer bg-white rounded-md font-medium text-gold-600 hover:text-gold-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-navy-500 inline-block"
            >
              <span>ファイルを選択</span>
              <input
                id={fieldName}
                name={fieldName}
                type="file"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: 'pointer'
                }}
                onChange={handleFileChange}
                accept={acceptTypes}
                required={required && !isEditMode}
              />
            </label>
            <p className="pl-1">またはドラッグ&ドロップ</p>
          </div>
          <p className="text-xs text-navy-400">{formatHint}</p>
          {formData[fieldName] && (
            <div className="mt-2 flex items-center space-x-2">
              {formData[fieldName].type !== 'application/pdf' && (
                <img
                  src={URL.createObjectURL(formData[fieldName])}
                  alt="プレビュー"
                  className="object-cover rounded-lg border border-navy-200"
                  style={{ width: '192px', height: '128px' }}
                  onLoad={(e) => URL.revokeObjectURL(e.target.src)}
                />
              )}
              <div className="flex-1">
                <p className="text-xs text-gold-600">
                  {formData[fieldName].name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(fieldName)}
                className="text-danger-500 hover:text-danger-700 p-1 transition-colors"
                title="削除"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="animate-fade-in">
      {/* Page Header */}
      <div className="md:flex md:items-center md:justify-between mb-8 animate-fade-in-up">
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold leading-7 text-navy-900 font-display sm:text-3xl sm:truncate">
            {isEditMode ? '出演者情報編集' : '出演者情報登録'}
          </h2>
        </div>
      </div>

      {/* Stepper */}
      <div className="mb-8 animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
        <nav aria-label="Progress">
          <ol className="flex items-center justify-center space-x-2 sm:space-x-8">
            {steps.map((step, index) => (
              <li key={step.number} className="flex items-center">
                <div className="flex items-center">
                  <span
                    className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-all duration-300 ${
                      currentStep > step.number
                        ? 'bg-gold-500 text-white shadow-md'
                        : currentStep === step.number
                        ? 'bg-navy-700 text-white shadow-md ring-2 ring-navy-300'
                        : 'bg-navy-100 text-navy-400'
                    }`}
                  >
                    {currentStep > step.number ? (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      step.number
                    )}
                  </span>
                  <span
                    className={`ml-2 text-sm font-medium hidden sm:inline ${
                      currentStep >= step.number ? 'text-navy-800' : 'text-navy-400'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`ml-2 sm:ml-8 w-8 sm:w-16 h-0.5 transition-all duration-300 ${
                      currentStep > step.number ? 'bg-gold-500' : 'bg-navy-200'
                    }`}
                  />
                )}
              </li>
            ))}
          </ol>
        </nav>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 bg-danger-50 border border-danger-200 text-danger-600 rounded-xl p-4 text-sm animate-fade-in">
          {error}
        </div>
      )}

      {/* Main Form Card */}
      <div className="card-premium animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
        <div className="px-6 py-5 sm:px-8">
          <h3 className="text-lg leading-6 font-semibold text-navy-900">{isEditMode ? '出演者情報編集' : '出演者情報入力'}</h3>
          <p className="mt-1 max-w-2xl text-sm text-navy-500">
            {isEditMode ? '変更したい項目を編集してください。書類は新しいファイルを選択した場合のみ更新されます。' : '必要な情報と書類をアップロードしてください'}
          </p>
        </div>

        <div className="border-t border-navy-100">
          <form onSubmit={handleSubmit} className="divide-y divide-navy-100">
            {/* 基本情報 */}
            <div className="px-6 py-6 space-y-6 sm:px-8 animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
              <div className="grid grid-cols-6 gap-6">
                <div className="col-span-6 sm:col-span-3">
                  <label htmlFor="lastName" className="form-label">
                    姓（漢字）<span className="text-danger-500 ml-1">*必須</span>
                  </label>
                  <input
                    type="text"
                    name="lastName"
                    id="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    className="input-premium"
                  />
                </div>

                <div className="col-span-6 sm:col-span-3">
                  <label htmlFor="firstName" className="form-label">
                    名（漢字）<span className="text-danger-500 ml-1">*必須</span>
                  </label>
                  <input
                    type="text"
                    name="firstName"
                    id="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    className="input-premium"
                  />
                </div>

                <div className="col-span-6 sm:col-span-3">
                  <label htmlFor="lastNameRoman" className="form-label">
                    姓（ローマ字）<span className="text-danger-500 ml-1">*必須</span>
                  </label>
                  <input
                    type="text"
                    name="lastNameRoman"
                    id="lastNameRoman"
                    value={formData.lastNameRoman}
                    onChange={handleChange}
                    className="input-premium"
                  />
                </div>

                <div className="col-span-6 sm:col-span-3">
                  <label htmlFor="firstNameRoman" className="form-label">
                    名（ローマ字）<span className="text-danger-500 ml-1">*必須</span>
                  </label>
                  <input
                    type="text"
                    name="firstNameRoman"
                    id="firstNameRoman"
                    value={formData.firstNameRoman}
                    onChange={handleChange}
                    className="input-premium"
                  />
                </div>
              </div>
            </div>

            {/* 書類アップロード */}
            <div className="px-6 py-6 space-y-6 sm:px-8 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
              {renderFileUploadZone(
                'agreementFile',
                '出演同意書',
                true,
                '.pdf,.jpg,.jpeg,.png',
                'PDF, PNG, JPG (最大5MB)'
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {renderFileUploadZone(
                  'idFront',
                  '身分証明書（表面）',
                  true,
                  '.jpg,.jpeg,.png',
                  'PNG, JPG (最大5MB)'
                )}
                {renderFileUploadZone(
                  'idBack',
                  '身分証明書（裏面）',
                  false,
                  '.jpg,.jpeg,.png',
                  'PNG, JPG (最大5MB)'
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {renderFileUploadZone(
                  'selfie',
                  '本人写真',
                  true,
                  '.jpg,.jpeg,.png',
                  'PNG, JPG (最大5MB)'
                )}
                {renderFileUploadZone(
                  'selfieWithId',
                  '本人と身分証明書の写真',
                  true,
                  '.jpg,.jpeg,.png',
                  'PNG, JPG (最大5MB)'
                )}
              </div>
            </div>

            {/* 送信ボタン */}
            <div className="px-6 py-4 bg-navy-50 text-right sm:px-8 rounded-b-2xl animate-fade-in-up" style={{ animationDelay: '0.25s' }}>
              <button
                type="button"
                onClick={() => {
                  // Track registration abandonment
                  const registrationDuration = Date.now() - registrationStartTime;
                  console.log(console.PERFORMER_REGISTRATION_ABANDONED, {
                    duration: registrationDuration,
                    completedFields: {
                      hasName: !!(formData.lastName && formData.firstName),
                      hasRomanName: !!(formData.lastNameRoman && formData.firstNameRoman),
                      hasAgreement: !!formData.agreementFile,
                      hasIdFront: !!formData.idFront,
                      hasIdBack: !!formData.idBack,
                      hasSelfie: !!formData.selfie,
                      hasSelfieWithId: !!formData.selfieWithId
                    }
                  });
                  navigate('/performers');
                }}
                className="btn-secondary mr-3"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={submitting || !isFormValid()}
                className="btn-gold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <span className="flex items-center">
                    <span className="loading-spinner mr-2" style={{ width: '16px', height: '16px' }}></span>
                    {isEditMode ? '更新中...' : '登録中...'}
                  </span>
                ) : (
                  isEditMode ? '更新' : '登録'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddPerformerPage;
