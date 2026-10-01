// Keeps the generated catalog English in the fields the English UI renders.
//
// The catalog is generated from English markdown, but its Persian default leaked
// into the English product: 246 of 264 agents showed the starter prompt
// "برای شروع یک درخواست بنویس" under an English "Start here", and every one of
// them opened a chat with a greeting that began in Persian and finished in
// English. Nothing checked for that, because the i18n gate only compares the two
// string dictionaries — it never looked at agent content.
//
// Persian agent copy lives in `src/data/fa-agents.ts` and is chosen by language
// at render time (see `agentPrompts`/`agentWelcome` in src/lib/i18n.tsx), so the
// generated catalog should contain no Persian in any field the English UI shows.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(path.join(root, 'src/data/catalog.generated.ts'), 'utf8')

const PERSIAN = /[\u0600-\u06FF]/

/** The agents array only: `divisions` follows it and has Persian categories by design. */
const from = source.indexOf('export const catalog')
const to = source.indexOf('export const divisions')
const catalog = source.slice(from, to === -1 ? undefined : to)

const blocks = catalog.split(/\n\s*"slug": "/).slice(1)
if (blocks.length === 0) {
  console.error('No agents found in catalog.generated.ts — has the format changed?')
  process.exit(1)
}

/** Fields the English UI renders directly. `category` is excluded: it holds the
 *  Persian division label, and the English UI uses `divisionLabel` instead. */
const TEXT_FIELDS = ['name', 'divisionLabel', 'description', 'longDescription', 'welcome']
const LIST_FIELDS = ['features', 'prompts']

const problems = []

for (const block of blocks) {
  const slug = block.slice(0, block.indexOf('"'))
  for (const field of TEXT_FIELDS) {
    const match = block.match(new RegExp(`"${field}": "((?:[^"\\\\]|\\\\.)*)"`))
    const value = match?.[1] ?? ''
    if (!value) problems.push(`${slug}: "${field}" is missing or empty`)
    else if (PERSIAN.test(value)) problems.push(`${slug}: "${field}" contains Persian text`)
  }
  for (const field of LIST_FIELDS) {
    const match = block.match(new RegExp(`"${field}": \\[([\\s\\S]*?)\\]`))
    const items = match?.[1] ?? ''
    if (items.trim() === '') problems.push(`${slug}: "${field}" is empty`)
    else if (PERSIAN.test(items)) problems.push(`${slug}: "${field}" contains Persian text`)
  }
}

if (problems.length > 0) {
  console.error(`The English catalog contains ${problems.length} problem(s):`)
  for (const problem of problems.slice(0, 12)) console.error(`  ${problem}`)
  if (problems.length > 12) console.error(`  …and ${problems.length - 12} more`)
  console.error(
    '\nPersian agent copy belongs in src/data/fa-agents.ts, not in the generated catalog.',
  )
  process.exit(1)
}

console.log(`catalog OK — ${blocks.length} agents, English in every rendered field.`)
