import readline from 'readline';

export async function promptForContinuation(currentItem, totalItems, batchSize = 5) {
  if (currentItem <= 0 || currentItem % batchSize !== 0) {
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log(`\n処理状況: ${currentItem}/${totalItems} 完了`);
    const answer = await new Promise(resolve => {
      rl.question('反復処理を続行しますか? (Y/n): ', resolve);
    });

    if (answer.toLowerCase() === 'n') {
      console.log('処理を中断します。');
      return false;
    }
    return true;
  } finally {
    rl.close();
  }
}