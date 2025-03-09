import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export async function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }
}

export function getFileExtension(contentType) {
  if (!contentType) return '.bin';
  const mainType = contentType.split(';')[0].toLowerCase();
  return config.contentTypes[mainType] || `.${mainType.split('/')[1]}`;
}

export async function writeFileWithMetadata(filePath, buffer, metadata) {
  const dirPath = path.dirname(filePath);
  await ensureDirectory(dirPath);
  
  await fs.promises.writeFile(filePath, buffer);
  
  const stats = await fs.promises.stat(filePath);
  if (stats.size === 0) {
    throw new Error(`Written file is empty: ${filePath}`);
  }
  
  if (metadata) {
    const metadataPath = path.join(path.dirname(filePath), 'metadata.json');
    let existingMetadata = {};
    
    if (fs.existsSync(metadataPath)) {
      existingMetadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
    }
    
    await fs.promises.writeFile(
      metadataPath,
      JSON.stringify({ ...existingMetadata, ...metadata }, null, 2)
    );
  }
  
  return stats;
}

export function cleanupTempFiles(directory, pattern) {
  const files = fs.readdirSync(directory);
  for (const file of files) {
    if (file.startsWith(pattern)) {
      const filePath = path.join(directory, file);
      fs.unlinkSync(filePath);
    }
  }
}