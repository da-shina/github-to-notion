import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { config } from './config.js';
import { ensureDirectory, writeFileWithMetadata, cleanupTempFiles, getFileExtension } from './utils/file-utils.js';
import { getProjectId, getProjectItems, getIssueDetails, downloadFromGitHub } from './utils/github-api.js';
import { promptForContinuation } from './utils/interactive-utils.js';

// Set up downloads directory
ensureDirectory(config.paths.downloads);

// Delay function for rate limiting
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Process items in batches
async function processInBatches(items, processFunction, batchSize = config.github.maxConcurrentRequests) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processFunction));
    results.push(...batchResults.filter(Boolean));
    if (i + batchSize < items.length) {
      await delay(1000); // API rate limit consideration
    }
  }
  return results;
}

// Extract attachments with improved detection
function extractAttachments(text, html) {
  if (!text && !html) return [];
  
  const attachments = new Set();
  const processedUrls = new Set();
  
  function processUrl(url) {
    if (!processedUrls.has(url)) {
      if (url.includes('private-user-images.githubusercontent.com')) {
        const assetIdMatch = url.match(/\/([a-f0-9-]+)\.[^?]+/);
        if (assetIdMatch) {
          const assetId = assetIdMatch[1];
          const attachmentUrl = `https://github.com/user-attachments/assets/${assetId}`;
          if (!processedUrls.has(attachmentUrl)) {
            attachments.add(attachmentUrl);
            processedUrls.add(attachmentUrl);
          }
        }
      } else {
        attachments.add(url);
        processedUrls.add(url);
      }
    }
  }

  if (text) {
    const userAttachmentsRegex = /https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+/g;
    const privateImagesRegex = /https:\/\/private-user-images\.githubusercontent\.com[^"'\s)]+/g;
    
    let match;
    while ((match = userAttachmentsRegex.exec(text)) !== null) {
      processUrl(match[0]);
    }
    while ((match = privateImagesRegex.exec(text)) !== null) {
      processUrl(match[0]);
    }
  }

  if (html) {
    const mediaRegex = /<(?:video|img)[^>]*?(?:src|data-canonical-src)="([^"]+)"[^>]*?>/g;
    let match;
    while ((match = mediaRegex.exec(html)) !== null) {
      processUrl(match[1]);
    }

    // Extract video filename from details summary
    const summaryRegex = /<summary[^>]*?>[\s\S]*?<span[^>]*?class="m-1"[^>]*?>([^<]+)<\/span>/g;
    while ((match = summaryRegex.exec(html)) !== null) {
      const filename = match[1].trim();
      if (filename) {
        global.videoFilenames = global.videoFilenames || new Map();
        const videoId = html.match(/\/([a-f0-9-]+)\.mov/)?.[1];
        if (videoId) {
          global.videoFilenames.set(videoId, filename);
        }
      }
    }
  }
  
  return Array.from(attachments);
}

async function downloadAttachments(attachments, issueNumber, type = 'issue', content = '', htmlContent = '') {
  if (attachments.length === 0) return [];
  
  const issueDir = path.join(config.paths.downloads, `${type}_${issueNumber}`);
  await ensureDirectory(issueDir);

  const downloadFile = async (url) => {
    try {
      const fullAssetId = url.split('/').pop().split('?')[0];
      const assetId = fullAssetId.includes('-') ? fullAssetId.split('-').pop() : fullAssetId;
      
      // Determine URL and filename
      let downloadUrl = url;
      if (url.includes('user-attachments')) {
        const videoMatch = htmlContent?.match(/private-user-images\.githubusercontent\.com\/\d+\/([^/"]+)/);
        if (videoMatch) {
          downloadUrl = `https://private-user-images.githubusercontent.com/139605659/${videoMatch[1]}`;
          console.log(`Constructed private URL: ${downloadUrl}`);
        }
      }

      // Download and process
      const response = await downloadFromGitHub(downloadUrl);
      const contentType = response.headers.get('content-type');
      const ext = getFileExtension(contentType);
      
      // Generate filename
      const originalFilename = global.videoFilenames?.get(assetId) || `attachment_${assetId}${ext}`;
      const finalFilePath = path.join(issueDir, originalFilename);

      // Check if file already exists
      if (fs.existsSync(finalFilePath) && fs.statSync(finalFilePath).size > 0) {
        console.log(`File already exists: ${originalFilename}`);
        return { url: downloadUrl, localPath: finalFilePath, originalFilename };
      }

      // Download and save
      const buffer = await response.buffer();
      console.log(`Downloaded buffer size: ${buffer.length} bytes`);

      await writeFileWithMetadata(finalFilePath, buffer, {
        [assetId]: {
          originalFilename,
          contentType,
          downloadedAt: new Date().toISOString(),
          url: downloadUrl,
          size: buffer.length
        }
      });

      // Cleanup temp files
      cleanupTempFiles(issueDir, 'temp_');

      return { url: downloadUrl, localPath: finalFilePath, originalFilename };
    } catch (error) {
      console.error(`Error processing ${url}:`, error);
      return null;
    }
  };

  return await processInBatches(attachments, downloadFile);
}

async function main() {
  try {
    console.log('Fetching project information...');
    const projectId = await getProjectId();
    console.log(`Found project ID: ${projectId}`);
    
    const items = await getProjectItems(projectId);
    console.log(`Found ${items.length} items in the project`);

    // Export items data to JSON file
    const exportData = items.map(item => {
      const content = item.content;
      const issueUrl = content.repository 
        ? `https://github.com/${config.github.owner}/${content.repository.name}/issues/${content.number}`
        : null;
      
      return {
        id: item.id,
        type: content.__typename,
        issue_number: content.number,
        title: content.title,
        body: content.body,
        state: content.state,
        repository: content.repository?.name,
        author: content.author?.login,
        created_at: content.createdAt,
        url: issueUrl,  // GitHub IssueのURLを追加
        comments: content.comments?.nodes?.map(comment => ({
          body: comment.body,
          author: comment.author?.login,
          created_at: comment.createdAt
        })),
        field_values: item.fieldValues?.nodes?.reduce((acc, field) => {
          if (field?.field) {
            acc[field.field.name] = field.text || field.date || field.name || field.number;
          }
          return acc;
        }, {})
      };
    });

    await fs.promises.writeFile(
      'project_items_data.json',
      JSON.stringify(exportData, null, 2)
    );
    console.log('Exported project items data to project_items_data.json');
    
    // Continue with existing attachment processing
    for (const [index, item] of items.entries()) {
      const content = item.content;
      if (!content) {
        console.log(`Skipping item ${item.id} - no content found`);
        continue;
      }
      console.log(`\nProcessing ${content.__typename} #${content.number} (${index + 1}/${items.length})`);
      
      // Add improved continuation prompt
      if (!await promptForContinuation(index, items.length)) {
        return;
      }
      
      // Extract field values
      const fieldValues = {};
      if (item.fieldValues?.nodes) {
        item.fieldValues.nodes.forEach(field => {
          if (field?.field) {
            fieldValues[field.field.name] = field.text || field.date || field.name || field.number;
          }
        });
      }

      // Get detailed information
      let details = null;
      if (content.repository) {
        console.log(`Fetching detailed information...`);
        details = await getIssueDetails(config.github.owner, content.repository.name, content.number);
      }

      // Process attachments from main content and comments
      const processContent = async (body, bodyHTML, bodyText, source = 'main content') => {
        const attachments = extractAttachments(body, bodyHTML);
        if (attachments.length > 0) {
          console.log(`Found ${attachments.length} attachments in ${source}`);
          try {
            await downloadAttachments(
              attachments,
              content.number,
              (content.__typename || 'unknown').toLowerCase(),
              bodyText,
              bodyHTML
            );
          } catch (error) {
            console.error(`Error downloading attachments from ${source}:`, error.message);
          }
        }
      };

      // Process main content
      if (details?.body || content.body) {
        await processContent(details?.body || content.body, details?.bodyHTML, details?.bodyText);
      }

      // Process comments
      const comments = details?.comments?.nodes || content.comments?.nodes || [];
      for (const comment of comments) {
        if (comment.body) {
          await processContent(
            comment.body,
            comment.bodyHTML,
            comment.bodyText,
            `comment by ${comment.author?.login}`
          );
        }
      }
    }
    
    console.log('\nProcessing complete!');
  } catch (error) {
    console.error('Error in main process:', error);
    process.exit(1);
  }
}

// Start the process
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
