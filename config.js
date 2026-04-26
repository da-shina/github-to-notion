import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// ESモジュールで__dirnameを使用するための設定
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectNumber = parseInt(process.env.PROJECT_NUMBER, 10);
if (!Number.isInteger(projectNumber) || projectNumber <= 0) {
  throw new Error(`Invalid PROJECT_NUMBER: ${process.env.PROJECT_NUMBER}. Must be a positive integer.`);
}

const maxConcurrentRequests = parseInt(process.env.MAX_CONCURRENT_REQUESTS, 10);
if (!Number.isInteger(maxConcurrentRequests) || maxConcurrentRequests <= 0) {
  console.warn(`Invalid MAX_CONCURRENT_REQUESTS: ${process.env.MAX_CONCURRENT_REQUESTS}. Using default: 5`);
}

export const config = {
  github: {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    projectNumber,
    maxConcurrentRequests: Number.isInteger(maxConcurrentRequests) && maxConcurrentRequests > 0 ? maxConcurrentRequests : 5,
    allowedHosts: ['github.com', 'api.github.com', 'raw.githubusercontent.com', 'private-user-images.githubusercontent.com'],
    timeout: 10000
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