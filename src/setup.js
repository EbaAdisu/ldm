import { exec } from 'child_process'
import { promisify } from 'util'
import which from 'which'
import chalk from 'chalk'

const execAsync = promisify(exec)

export async function checkDependencies() {
  const results = { aria2: false, ytdlp: false }

  // Check aria2c
  try {
    await which('aria2c')
    results.aria2 = true
    console.log(chalk.green('  ✓ aria2c') + chalk.gray(' (multi-segment downloads)'))
  } catch {
    console.log(chalk.yellow('  ⚠ aria2c not found') + chalk.gray(' — install: sudo apt install aria2'))
    console.log(chalk.gray('    Downloads will use single-connection mode'))
  }

  // Check yt-dlp
  try {
    await which('yt-dlp')
    results.ytdlp = true
    console.log(chalk.green('  ✓ yt-dlp') + chalk.gray(' (YouTube, Vimeo, social media)'))
  } catch {
    console.log(chalk.yellow('  ⚠ yt-dlp not found') + chalk.gray(' — attempting auto-install...'))
    try {
      await execAsync('pip3 install -q yt-dlp')
      results.ytdlp = true
      console.log(chalk.green('  ✓ yt-dlp installed'))
    } catch {
      try {
        // Try pipx as fallback
        await execAsync('pipx install yt-dlp')
        results.ytdlp = true
        console.log(chalk.green('  ✓ yt-dlp installed via pipx'))
      } catch {
        console.log(chalk.gray('    Manual install: pip3 install yt-dlp'))
        console.log(chalk.gray('    Video site downloads unavailable'))
      }
    }
  }

  return results
}
