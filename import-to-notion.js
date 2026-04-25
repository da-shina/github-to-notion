import fs from 'fs';
import path from 'path';
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import mime from 'mime-types';
import { FormData } from 'formdata-node';
import { fileFromPath } from 'formdata-node/file-from-path';

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  const videoExts = ['.mp4', '.mov', '.webm', '.mkv'];

  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  return 'file';
}

async function uploadFile(filepath) {
  try {
    const filename = path.basename(filepath);
    const contentType = mime.lookup(filepath) || 'application/octet-stream';

    // Step 1: Create upload session
    const sessionResponse = await fetch('https://api.notion.com/v1/file_uploads', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': '2026-03-11',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filename: filename,
        content_type: contentType,
        mode: 'single_part'
      })
    });

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      throw new Error(`Failed to create upload session: ${sessionResponse.statusText} - ${errorText}`);
    }

    const { file_upload } = await sessionResponse.json();
    const { id: fileUploadId } = file_upload;

    // Step 2: Upload file via multipart/form-data
    const form = new FormData();
    form.set('file', await fileFromPath(filepath), filename);

    const uploadResponse = await fetch(`https://api.notion.com/v1/file_uploads/${fileUploadId}/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': '2026-03-11'
      },
      body: form
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Failed to upload file: ${uploadResponse.statusText} - ${errorText}`);
    }

    const { file_upload: completedUpload } = await uploadResponse.json();
    return completedUpload.url;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

async function createFileBlock(filepath, filename) {
  const fileType = getFileType(filename);

  try {
    // ファイルをアップロード
    const uploadedUrl = await uploadFile(filepath);

    switch (fileType) {
      case 'image':
        return {
          object: 'block',
          type: 'image',
          image: {
            type: 'file',
            file: {
              url: uploadedUrl,
              expiry_time: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
            }
          }
        };
      case 'video':
        return {
          object: 'block',
          type: 'video',
          video: {
            type: 'file',
            file: {
              url: uploadedUrl,
              expiry_time: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
            }
          }
        };
      default:
        return {
          object: 'block',
          type: 'file',
          file: {
            type: 'file',
            file: {
              url: uploadedUrl,
              expiry_time: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
            }
          }
        };
    }
  } catch (error) {
    console.error(`Error creating file block for ${filename}:`, error);
    // エラーが発生した場合は、外部URLとしてフォールバック
    return {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: `Failed to upload ${filename}. Error: ${error.message}`
            }
          }
        ]
      }
    };
  }
}

async function convertTextToBlocks(text) {
  const blocks = [];
  let lastIndex = 0;

  // Figma URLを検出する正規表現を修正（クエリパラメータを含める）
  const figmaPattern = /https:\/\/(?:www\.)?figma\.com\/(file|proto|design)\/([^?\s]+)(?:\?[^\s]+)?/g;

  // まずFigmaのURLを処理
  let match;
  while ((match = figmaPattern.exec(text)) !== null) {
    // URLの前のテキストを処理
    const beforeText = text.slice(lastIndex, match.index);
    if (beforeText.trim()) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: beforeText } }]
        }
      });
    }

    // FigmaのURLを埋め込みブロックとして追加（完全なURLを使用）
    blocks.push({
      object: 'block',
      type: 'embed',
      embed: {
        url: match[0]
      }
    });

    lastIndex = match.index + match[0].length;
  }

  // 残りのテキストを処理（通常のURLやMarkdownリンクを含む）
  const remainingText = text.slice(lastIndex);
  if (remainingText.trim()) {
    const richTextSegments = [];
    let currentIndex = 0;

    // Markdownリンクと通常のURLを検出する正規表現
    const patterns = [
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, // Markdownリンク
      /(https?:\/\/(?!(?:www\.)?figma\.com)[^\s<)]+)/g // Figma以外の通常のURL
    ];

    let textToProcess = remainingText;

    // まずMarkdownリンクを処理
    while ((match = patterns[0].exec(textToProcess)) !== null) {
      const beforeText = textToProcess.slice(currentIndex, match.index);
      if (beforeText) {
        richTextSegments.push({
          type: 'text',
          text: { content: beforeText }
        });
      }

      richTextSegments.push({
        type: 'text',
        text: {
          content: match[1],
          link: { url: match[2] }
        }
      });

      currentIndex = match.index + match[0].length;
    }

    // 次に残りのテキストから通常のURLを処理
    textToProcess = textToProcess.slice(currentIndex);
    currentIndex = 0;

    while ((match = patterns[1].exec(textToProcess)) !== null) {
      const beforeText = textToProcess.slice(currentIndex, match.index);
      if (beforeText) {
        richTextSegments.push({
          type: 'text',
          text: { content: beforeText }
        });
      }

      richTextSegments.push({
        type: 'text',
        text: {
          content: match[1],
          link: { url: match[1] }
        }
      });

      currentIndex = match.index + match[1].length;
    }

    // 最後の残りのテキストを追加
    const finalText = textToProcess.slice(currentIndex);
    if (finalText) {
      richTextSegments.push({
        type: 'text',
        text: { content: finalText }
      });
    }

    if (richTextSegments.length > 0) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: richTextSegments
        }
      });
    }
  }

  return blocks;
}

async function processAttachments(downloadPath) {
  const attachments = [];
  if (fs.existsSync(downloadPath)) {
    const files = await fs.promises.readdir(downloadPath);
    for (const file of files) {
      if (file !== 'metadata.json') {
        const filePath = path.join(downloadPath, file);
        const fileBlock = await createFileBlock(filePath, file);
        attachments.push(fileBlock);
      }
    }
  }
  return attachments;
}

async function createNotionPage(item, attachments) {
  const properties = {
    Title: {
      title: [{ text: { content: item.title || `#${item.issue_number}` } }]
    },
    Status: {
      status: {
        name: item.field_values?.Status || "未着手"
      }
    },
    Type: {
      select: { name: item.type || "Unknown" }
    },
    Number: {
      number: item.issue_number
    }
  };

  const children = [];

  // GitHub IssueのURLを追加
  if (item.url) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: 'GitHub Issue: ',
            }
          },
          {
            type: 'text',
            text: {
              content: item.url,
              link: { url: item.url }
            }
          }
        ]
      }
    });
  }

  // メインコンテンツを処理
  if (item.body) {
    const bodyBlocks = await convertTextToBlocks(item.body);
    children.push(...bodyBlocks);
  }

  // コメントを処理
  if (item.comments?.length > 0) {
    for (const comment of item.comments) {
      // コメントのヘッダー（作成者情報）を追加
      children.push({
        object: 'block',
        type: 'quote',
        quote: {
          rich_text: [
            {
              type: 'text',
              text: { content: `${comment.author || 'unknown'}:` }
            }
          ]
        }
      });

      // コメント本文を処理してURLをリンクブロックに変換
      const commentBlocks = await convertTextToBlocks(comment.body);
      children.push(...commentBlocks);
    }
  }

  // 追加の添付ファイルがあれば追加
  if (attachments.length > 0) {
    children.push({
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: 'Attachments' } }]
      }
    });
    children.push(...attachments);
  }

  try {
    const response = await notion.pages.create({
      parent: { database_id: DATABASE_ID },
      properties,
      children
    });
    return response;
  } catch (error) {
    console.error('Error creating Notion page:', error);
    throw error;
  }
}

async function getDatabaseProperties() {
  try {
    const response = await notion.databases.retrieve({
      database_id: DATABASE_ID
    });
    console.log('Database properties:', JSON.stringify(response.properties, null, 2));
    return response.properties;
  } catch (error) {
    console.error('Error retrieving database properties:', error);
    throw error;
  }
}

async function main() {
  try {
    // まずデータベースのプロパティを取得
    const properties = await getDatabaseProperties();
    console.log('Available status options:', properties.Status.status.options);

    const data = JSON.parse(await fs.promises.readFile('project_items_data.json', 'utf8'));

    for (const item of data) {
      console.log(`Processing item #${item.issue_number}...`);

      // Process attachments from downloads directory
      const itemType = item.type ? item.type.toLowerCase().replace(/ /g, '_') : 'unknown';
      const downloadPath = path.join('downloads', `${itemType}_${item.issue_number}`);
      console.log(`Checking for attachments in: ${downloadPath}`);
      const attachments = await processAttachments(downloadPath);

      // Create Notion page
      const page = await createNotionPage(item, attachments);
      console.log(`Created Notion page for item #${item.issue_number}: ${page.url}`);

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('Import completed successfully!');
  } catch (error) {
    console.error('Error in main process:', error);
    process.exit(1);
  }
}

main().catch(console.error);