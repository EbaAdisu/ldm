#!/usr/bin/env node
import { startServer } from '../src/server.js'
import { checkDependencies } from '../src/setup.js'
import { cleanup } from '../src/downloader.js'
import open from 'open'
import chalk from 'chalk'

const PORT = parseInt(process.env.LDM_PORT || '6543')
const args = process.argv.slice(2)
const noBrowser = args.includes('--no-browser')

async function main() {
  console.log(chalk.cyan.bold('\n  LDM — Linux Download Manager\n'))

  await checkDependencies()
  console.log()

  await startServer(PORT)

  console.log(chalk.green('  Ready: ') + chalk.white.underline(`http://localhost:${PORT}`))
  console.log(chalk.gray('  Press Ctrl+C to stop\n'))

  if (!noBrowser) {
    await open(`http://localhost:${PORT}`)
  }

  process.on('SIGINT', () => {
    console.log(chalk.gray('\n  Shutting down...'))
    cleanup()
    process.exit(0)
  })
  process.on('SIGTERM', () => { cleanup(); process.exit(0) })
}

main().catch(err => {
  console.error(chalk.red('\n  Fatal: ') + err.message)
  process.exit(1)
})
