const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

function pad(value) {
  return String(value).padStart(2, '0')
}

function buildStamp(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '.' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('')
}

const buildVersion = `${pkg.version}-build.${buildStamp()}`
const artifactName = `AI-Coder-Installer-${buildVersion}-\${arch}.\${ext}`
const builderCli = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')

console.log(`Building AI Coder Installer ${buildVersion}`)
console.log(`Artifact pattern: ${artifactName}`)

const result = spawnSync(process.execPath, [
  builderCli,
  '--win',
  'portable',
  '--x64',
  `-c.extraMetadata.version=${buildVersion}`,
  `-c.portable.artifactName=${artifactName}`
], {
  cwd: root,
  stdio: 'inherit',
  shell: false
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

if (result.status !== 0) {
  process.exit(result.status || 1)
}
