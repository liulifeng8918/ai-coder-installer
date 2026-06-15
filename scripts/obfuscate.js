#!/usr/bin/env node

const key = process.argv[2]

if (!key) {
  console.error('Usage: node scripts/obfuscate.js sk-your-agnes-key')
  process.exit(1)
}

const XOR_KEY = 42
const encoded = Buffer.from(key, 'utf8')
  .map(byte => byte ^ XOR_KEY)
  .toString('base64')

console.log(encoded)
