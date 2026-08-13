import fs from 'fs/promises'
import path from 'path'
import { getFilesPath, getLibraryPath } from './library'
import { computeFileHash } from './ingest'
import { getEntry, updateEntry, getJournalsNeedingFile } from './db/queries/entries'

const JOURNAL_DIR_NAME = 'Journal Entries'

interface TiptapNode {
  type: string
  text?: string
  content?: TiptapNode[]
}

// Leaf block types that end a line. Wrapper/container types (doc, bulletList,
// orderedList, listItem) hold other blocks but aren't themselves lines, so
// they're walked without flushing — otherwise every list item would leave a
// spurious blank line behind from its container closing.
const LINE_BREAK_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock'])

// Plain-text rendering of a Tiptap/ProseMirror document: marks (bold, italic,
// etc.) carry no meaning in a flat .txt file, so only text content and leaf
// block boundaries are kept, each becoming a line. Written without a Tiptap
// dependency since the main process only needs this one narrow conversion.
function extractPlainText(doc: TiptapNode): string {
  const blocks: string[] = []
  let current = ''
  const walk = (node: TiptapNode) => {
    if (node.type === 'text') { current += node.text ?? ''; return }
    if (node.type === 'hardBreak') { current += '\n'; return }
    for (const child of node.content ?? []) walk(child)
    if (LINE_BREAK_TYPES.has(node.type)) { blocks.push(current); current = '' }
  }
  walk(doc)
  if (current) blocks.push(current)
  return blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200)
    .trim()
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

async function uniquePath(dir: string, stem: string, ext: string): Promise<string> {
  let n = 1
  let dest = path.join(dir, `${stem}${ext}`)
  while (await pathExists(dest)) {
    n += 1
    dest = path.join(dir, `${stem} (${n})${ext}`)
  }
  return dest
}

// Writes (or rewrites) a journal entry's on-disk plain-text mirror, so the
// library's files/ folder holds every entry, not just ones with a real
// backing file. The exported .txt is a one-way mirror of rich_text_json —
// editing it directly on disk does not flow back into the app.
//
// Once written, content_hash is set to match the file's own hash *before*
// anything else touches it. This matters: files/ is watched by chokidar
// (src/main/sync/index.ts), and a new file appearing there triggers the
// normal ingest pipeline, which dedupes by content_hash — without this, the
// watcher would import the export as a second, ghost entry.
export async function syncJournalFile(entryId: number): Promise<void> {
  const entry = getEntry(entryId)
  if (!entry || entry.type !== 'journal') return

  const text = entry.rich_text_json ? extractPlainText(JSON.parse(entry.rich_text_json)) : ''

  let destPath: string
  if (entry.file_path) {
    destPath = path.join(getLibraryPath(), entry.file_path)
  } else {
    const dir = path.join(getFilesPath(), JOURNAL_DIR_NAME)
    await fs.mkdir(dir, { recursive: true })
    const stem = sanitizeFileName(entry.title ?? '') || `Journal ${new Date(entry.timestamp).toISOString().slice(0, 10)}`
    destPath = await uniquePath(dir, stem, '.txt')
  }

  await fs.writeFile(destPath, text, 'utf8')
  const hash = await computeFileHash(destPath)
  const relPath = path.relative(getLibraryPath(), destPath).split(path.sep).join('/')

  updateEntry(entryId, {
    file_path: relPath,
    content_hash: hash,
    original_file_name: entry.original_file_name ?? path.basename(destPath),
  })
}

// Backfill pass for journal entries created before this feature existed.
// Companion to ingest's rescanLibrary, called alongside it from the same
// "Rescan library" action — kept separate to avoid a circular import (this
// module already depends on ingest for computeFileHash).
export async function backfillJournalFiles(): Promise<number> {
  const candidates = getJournalsNeedingFile()
  for (const entry of candidates) await syncJournalFile(entry.id)
  return candidates.length
}
