import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import type { Profile, ProfileList } from '../shared/types'

// A "profile" is a self-contained Timeline library folder (timeline.db + files/
// + thumbnails/ + spotify/ + settings.json). The registry of known profiles and
// which one is active is the ONLY global, machine-level state — it lives in
// userData/profiles.json so multiple people sharing a computer can each keep
// their own Timeline and switch between them without copying terabytes of media.

interface ProfileStore {
  profiles: Profile[]
  activeId: string
}

const profilesFile = () => path.join(app.getPath('userData'), 'profiles.json')
const legacySettingsFile = () => path.join(app.getPath('userData'), 'settings.json')
const defaultLibraryDir = () => path.join(app.getPath('userData'), 'library')
// New profiles created in-app get a folder here, named by their id.
const librariesRoot = () => path.join(app.getPath('userData'), 'libraries')

let cached: ProfileStore | null = null

function persist(store: ProfileStore): void {
  fs.writeFileSync(profilesFile(), JSON.stringify(store, null, 2), 'utf-8')
}

// First run (or upgrade from a single-library install): seed one profile that
// points at wherever the library already was, so nothing moves and no data is lost.
function migrateFromLegacy(): ProfileStore {
  let libPath = defaultLibraryDir()
  try {
    const legacy = JSON.parse(fs.readFileSync(legacySettingsFile(), 'utf-8'))
    if (typeof legacy.libraryPath === 'string' && legacy.libraryPath) libPath = legacy.libraryPath
  } catch { /* no legacy settings — use default */ }
  const store: ProfileStore = {
    profiles: [{ id: randomUUID(), name: 'My Timeline', path: libPath }],
    activeId: '',
  }
  store.activeId = store.profiles[0].id
  return store
}

function load(): ProfileStore {
  if (cached) return cached
  try {
    const raw = JSON.parse(fs.readFileSync(profilesFile(), 'utf-8')) as ProfileStore
    if (Array.isArray(raw.profiles) && raw.profiles.length > 0) {
      if (!raw.profiles.some(p => p.id === raw.activeId)) raw.activeId = raw.profiles[0].id
      cached = raw
      return cached
    }
  } catch { /* missing or corrupt — fall through to migration */ }
  cached = migrateFromLegacy()
  persist(cached)
  return cached
}

export function listProfiles(): ProfileList {
  const s = load()
  return { profiles: s.profiles.map(p => ({ ...p })), activeId: s.activeId }
}

export function getActiveProfile(): Profile {
  const s = load()
  return s.profiles.find(p => p.id === s.activeId) ?? s.profiles[0]
}

/** The active library folder — the single source of truth every path helper uses. */
export function getActiveLibraryPath(): string {
  return getActiveProfile().path
}

/** Create a brand-new empty Timeline in a fresh folder under userData/libraries. */
export function createProfileNew(name: string): Profile {
  const s = load()
  const id = randomUUID()
  const dir = path.join(librariesRoot(), id)
  fs.mkdirSync(dir, { recursive: true })
  const profile: Profile = { id, name: name.trim() || 'New Timeline', path: dir }
  s.profiles.push(profile)
  persist(s)
  return { ...profile }
}

/** Register an existing folder (empty, or already a Timeline library) as a profile. */
export function addExistingProfile(name: string, dir: string): Profile {
  const s = load()
  const existing = s.profiles.find(p => path.resolve(p.path) === path.resolve(dir))
  if (existing) return { ...existing }
  const profile: Profile = {
    id: randomUUID(),
    name: name.trim() || path.basename(dir) || 'Timeline',
    path: dir,
  }
  s.profiles.push(profile)
  persist(s)
  return { ...profile }
}

export function switchProfile(id: string): Profile {
  const s = load()
  const target = s.profiles.find(p => p.id === id)
  if (!target) throw new Error('Profile not found.')
  s.activeId = id
  persist(s)
  return { ...target }
}

export function renameProfile(id: string, name: string): void {
  const s = load()
  const p = s.profiles.find(p => p.id === id)
  if (!p) throw new Error('Profile not found.')
  p.name = name.trim() || p.name
  persist(s)
}

/**
 * Remove a profile from the registry. This only forgets it — the library folder
 * on disk is left untouched, so it can be re-added later. The active profile and
 * the last remaining profile can't be removed.
 */
export function removeProfile(id: string): void {
  const s = load()
  if (id === s.activeId) throw new Error('Cannot remove the active Timeline. Switch to another first.')
  if (s.profiles.length <= 1) throw new Error('Cannot remove the only Timeline.')
  s.profiles = s.profiles.filter(p => p.id !== id)
  persist(s)
}

/** Repoint the active profile at a new folder (used by move/relocate library). */
export function setActiveProfilePath(newPath: string): void {
  const s = load()
  const p = s.profiles.find(p => p.id === s.activeId)
  if (p) { p.path = newPath; persist(s) }
}
