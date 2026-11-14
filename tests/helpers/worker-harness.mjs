import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Shared harness for Worker tests: a real SQLite database built from every
// repository migration, plus locally signed Clerk-style JWTs.

export const issuer = 'https://clerk.voxyl.test';
export const origin = 'https://v.renbrant.com';
export const migrationsDir = path.resolve('workers/api/migrations');

export const baseEnv = {
  CLERK_AUTHORIZED_PARTIES: `${origin},http://localhost:5173`,
  CLERK_ISSUER: issuer,
  CLERK_SECRET_KEY: 'sk_test_unused',
  CLERK_JWT_KEY: '',
};

export function migrationFiles() {
  return fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
}

export function applyMigrations(db, files = migrationFiles()) {
  for (const file of files) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
}

export function createSqliteD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  applyMigrations(db);
  const clean = (params) => params.map((value) => (value === undefined ? null : value));

  return {
    raw: db,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            sql,
            params,
            async first() {
              return db.prepare(sql).get(...clean(params)) ?? null;
            },
            async all() {
              return { results: db.prepare(sql).all(...clean(params)) };
            },
            async run() {
              const result = db.prepare(sql).run(...clean(params));
              return { meta: { changes: Number(result.changes) } };
            },
          };
        },
      };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createJwt({ sub, email, name }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `kid-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    sub,
    sid: `session-${sub}`,
    email,
    name,
    azp: origin,
    iat: now - 10,
    nbf: now - 10,
    exp: now + 3600,
  };
  const signedData = `${base64urlJson({ alg: 'RS256', typ: 'JWT', kid })}.${base64urlJson(claims)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signedData), privateKey).toString('base64url');

  return {
    token: `${signedData}.${signature}`,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
  };
}
