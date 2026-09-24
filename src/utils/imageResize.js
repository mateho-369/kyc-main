/**
 * 画像リサイズユーティリティ
 * 画像ファイルを指定サイズに圧縮・リサイズする
 */

/**
 * 画像をリサイズする
 * @param {File} file - リサイズする画像ファイル
 * @param {number} maxWidth - 最大幅（px）
 * @param {number} maxHeight - 最大高さ（px）
 * @param {number} quality - JPEG品質（0-1）
 * @returns {Promise<File>} リサイズされた画像ファイル
 */
export const resizeImage = (file, maxWidth = 1920, maxHeight = 1920, quality = 0.8) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // アスペクト比を保持しながらリサイズ
        if (width > height) {
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('画像の変換に失敗しました'));
              return;
            }
            
            const resizedFile = new File([blob], file.name, {
              type: blob.type,
              lastModified: Date.now()
            });
            
            resolve(resizedFile);
          },
          file.type,
          quality
        );
      };
      
      img.onerror = () => {
        reject(new Error('画像の読み込みに失敗しました'));
      };
      
      img.src = e.target.result;
    };
    
    reader.onerror = () => {
      reject(new Error('ファイルの読み込みに失敗しました'));
    };
    
    reader.readAsDataURL(file);
  });
};

/**
 * ファイルサイズをチェックし、必要に応じてリサイズする
 * @param {File} file - チェックする画像ファイル
 * @param {number} maxSize - 最大ファイルサイズ（バイト）
 * @returns {Promise<File>} リサイズ済み（または元の）ファイル
 */
export const resizeIfNeeded = async (file, maxSize = 5 * 1024 * 1024) => {
  // 画像ファイルでない場合はそのまま返す
  if (!file.type.startsWith('image/')) {
    return file;
  }
  
  // ファイルサイズが制限内の場合はそのまま返す
  if (file.size <= maxSize) {
    return file;
  }
  
  // 段階的に品質を下げながらリサイズ
  const qualities = [0.9, 0.8, 0.7, 0.6, 0.5];
  let resizedFile = file;
  
  for (const quality of qualities) {
    try {
      resizedFile = await resizeImage(file, 1920, 1920, quality);
      if (resizedFile.size <= maxSize) {
        console.log(`画像を品質${quality * 100}%でリサイズしました: ${(resizedFile.size / 1024 / 1024).toFixed(2)}MB`);
        break;
      }
    } catch (error) {
      console.error('画像のリサイズに失敗しました:', error);
      throw error;
    }
  }
  
  return resizedFile;
};