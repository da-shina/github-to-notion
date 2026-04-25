import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// ESモジュールで__dirnameを使用するための設定
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  github: {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    projectNumber: parseInt(process.env.PROJECT_NUMBER, 10),
    maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS, 10) || 5
  },
  paths: {
    downloads: path.join(__dirname, 'downloads')
  },
  // コンテンツタイプと対応する拡張子のマッピング
  contentTypes: {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'video/quicktime': '.mov',
    'video/mp4': '.mp4'
  }
};