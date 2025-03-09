import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

// 指定されたディレクトリが存在しない場合は作成
export async function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }
}

// コンテンツタイプから適切なファイル拡張子を取得
export function getFileExtension(contentType) {
  if (!contentType) return '.bin';
  const mainType = contentType.split(';')[0].toLowerCase();
  return config.contentTypes[mainType] || `.${mainType.split('/')[1]}`;
}

// ファイルをメタデータと共に書き込む
export async function writeFileWithMetadata(filePath, buffer, metadata) {
  const dirPath = path.dirname(filePath);
  await ensureDirectory(dirPath);
  
  // バッファをファイルに書き込む
  await fs.promises.writeFile(filePath, buffer);
  
  // ファイルサイズを確認
  const stats = await fs.promises.stat(filePath);
  if (stats.size === 0) {
    throw new Error(`書き込まれたファイルが空です: ${filePath}`);
  }
  
  // メタデータがある場合は保存
  if (metadata) {
    const metadataPath = path.join(path.dirname(filePath), 'metadata.json');
    let existingMetadata = {};
    
    // 既存のメタデータがあれば読み込む
    if (fs.existsSync(metadataPath)) {
      existingMetadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
    }
    
    // 新しいメタデータと既存のメタデータをマージして保存
    await fs.promises.writeFile(
      metadataPath,
      JSON.stringify({ ...existingMetadata, ...metadata }, null, 2)
    );
  }
  
  return stats;
}

// 一時ファイルのクリーンアップ
export function cleanupTempFiles(directory, pattern) {
  const files = fs.readdirSync(directory);
  for (const file of files) {
    if (file.startsWith(pattern)) {
      const filePath = path.join(directory, file);
      fs.unlinkSync(filePath);
    }
  }
}