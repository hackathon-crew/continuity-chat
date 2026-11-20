import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const sourceFile = /\.(?:[cm]?[jt]s|sql)$/
const sqlStatement =
  /^\s*(?:SELECT\s|INSERT\s+INTO\s|UPDATE\s+\S+\s+SET\s|DELETE\s+FROM\s|(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|INDEX|DATABASE|SCHEMA)\s|WITH\s+\S+\s+AS\s*\(|(?:BEGIN|COMMIT|ROLLBACK)\s*;?\s*$)/i

function sqlLines(file: string) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true)
  const lines: number[] = []

  function visit(node: ts.Node) {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) && sqlStatement.test(node.text)) {
      lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return lines
}

test('SQL stays in server/db', () => {
  const dbDirectory = path.join(root, 'server', 'db') + path.sep
  const violations = ['server', 'scripts'].flatMap((directory) => {
    const files = readdirSync(path.join(root, directory), { recursive: true, withFileTypes: true })
    return files.flatMap((file) => {
      const absolute = path.join(file.parentPath, file.name)
      if (!file.isFile() || !sourceFile.test(file.name) || absolute.startsWith(dbDirectory)) {
        return []
      }
      const relative = path.relative(root, absolute)
      if (file.name.endsWith('.sql')) {
        return [relative]
      }
      return sqlLines(absolute).map((line) => `${relative}:${line}`)
    })
  })

  assert.deepEqual(violations, [], 'Move SQL to a server/db function that accepts the caller’s db')
})
