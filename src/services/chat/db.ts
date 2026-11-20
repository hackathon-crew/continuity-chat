import { openDB } from 'idb'
import type { Session } from './types'

type StoredFile = { id: string; blob: Blob }
type Stage = { sessions: Map<string, Session>; files: Map<string, Blob> }

let stage: Stage
let queued = Promise.resolve()

export function stageArchive(read: () => Promise<void>): Promise<Stage> {
  const work = queued.then(async () => {
    stage = { sessions: new Map(), files: new Map() }
    try {
      await read()
      return stage
    } finally {
      stage = { sessions: new Map(), files: new Map() }
    }
  })
  queued = work.then(
    () => {},
    () => {}
  )
  return work
}

export async function addStagingSession(session: Session) {
  stage.sessions.set(session.id, session)
}

export async function saveStagingFiles(files: StoredFile[]) {
  for (const file of files) {
    stage.files.set(file.id, file.blob)
  }
}

export async function updateStagingFileTypes(types: ReadonlyMap<string, string>) {
  for (const session of stage.sessions.values()) {
    for (const message of session.messages) {
      if (message.role === 'user') {
        for (const file of message.files) {
          file.mimeType = types.get(file.id) ?? ''
        }
      }
    }
  }
}

export async function loadFile(id: string) {
  return stage?.files.get(id)
}

export async function legacyDatabases() {
  const databases = await indexedDB.databases()
  return databases.flatMap(({ name }) => (name?.startsWith('continuity-chat:') ? [name] : []))
}

export async function readLegacyDatabase(name: string): Promise<Stage> {
  const db = await openDB(name)
  try {
    const [sessions, files] = await Promise.all([
      db.getAll('sessions') as Promise<Session[]>,
      db.getAll('files') as Promise<StoredFile[]>,
    ])
    return {
      sessions: new Map(
        sessions.map((session) => [session.id, { ...session, id: `${name}:${session.id}` }])
      ),
      files: new Map(files.map((file) => [file.id, file.blob])),
    }
  } finally {
    db.close()
  }
}
