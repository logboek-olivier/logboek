// Bouwt de vorige release voor de upgradetest (tests/e2e/upgrade.spec.ts) in .vorige/:
// - .vorige/src: git worktree van de vorige release (UPGRADE_FROM, anders de laatste commit op main vóór deze);
// - .vorige/src/dist: die release gebouwd;
// - .vorige/data.json: met de code van die release gemaakte, versleutelde nepgegevens (een voorbeeld per databestand).
// Gebruik: npm run upgrade:vorige. Werkt in PowerShell en in CI; raakt logboek-data nooit aan.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, '.vorige')
const tree = join(target, 'src')
// Zelfde nepwachtzin als tests/e2e/helpers/logbook.ts.
const PASSPHRASE = 'nep wachtzin voor e2e'

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options })
}

function previousRef() {
  if (process.env.UPGRADE_FROM) return process.env.UPGRADE_FROM
  try {
    git('fetch', '--quiet', '--depth=50', 'origin', 'main')
  } catch {
    // Geen verbinding: dan wat er lokaal van main bekend is.
  }
  const head = git('rev-parse', 'HEAD')
  const base = git('merge-base', 'HEAD', 'origin/main')
  // Op main zelf (na mergen) is de vorige release de commit ervoor.
  return base === head ? git('rev-parse', 'HEAD~1') : base
}

const ref = previousRef()
console.log(`Vorige release: ${ref}`)
if (existsSync(tree)) {
  try {
    git('worktree', 'remove', '--force', tree)
  } catch {
    // Geen geregistreerde worktree meer; de map hieronder weghalen.
  }
}
rmSync(target, { recursive: true, force: true })
git('worktree', 'prune')
mkdirSync(target, { recursive: true })
git('worktree', 'add', '--detach', tree, ref)

run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: tree })
mkdirSync(join(tree, 'tests', 'upgrade'), { recursive: true })
copyFileSync(join(root, 'tests', 'upgrade', 'upgrade-samples.ts'), join(tree, 'tests', 'upgrade', 'upgrade-samples.ts'))
copyFileSync(join(root, 'tests', 'upgrade', 'upgrade-generate.ts'), join(tree, 'tests', 'upgrade', 'upgrade-generate.test.ts'))
run('npx', ['vitest', 'run', 'tests/upgrade/upgrade-generate.test.ts'], {
  cwd: tree,
  env: { ...process.env, UPGRADE_OUT: join(target, 'data.json'), UPGRADE_PASSPHRASE: PASSPHRASE },
})
run('npx', ['vite', 'build'], { cwd: tree })
console.log('Vorige release klaar in .vorige/')
