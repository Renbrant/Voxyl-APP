#!/usr/bin/env node

/**
 * Cloudflare D1 Usage Analyzer
 * Queries Cloudflare GraphQL Analytics API for D1 daily row metrics.
 *
 * Usage:
 *   node scripts/check-d1-usage.mjs [options]
 *
 * Options:
 *   --token <token>        Cloudflare API Token (or CLOUDFLARE_API_TOKEN env var)
 *   --account <accountId>  Cloudflare Account ID (or CLOUDFLARE_ACCOUNT_ID env var)
 *   --database <dbId>      D1 Database UUID (default: from wrangler.toml)
 *   --days <number>        Number of recent days to inspect (default: 3)
 *   --limit <number>       Daily row write quota (default: 100000)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

export const DEFAULT_DATABASE_ID = '7f54b56f-9df1-4c12-b685-9fc7af29f094';
export const DEFAULT_DAILY_WRITE_LIMIT = 100_000;
const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    token: process.env.CLOUDFLARE_API_TOKEN || null,
    account: process.env.CLOUDFLARE_ACCOUNT_ID || null,
    database: process.env.D1_DATABASE_ID || DEFAULT_DATABASE_ID,
    days: 3,
    limit: DEFAULT_DAILY_WRITE_LIMIT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--token' && next) {
      args.token = next;
      i += 1;
    } else if (arg === '--account' && next) {
      args.account = next;
      i += 1;
    } else if (arg === '--database' && next) {
      args.database = next;
      i += 1;
    } else if (arg === '--days' && next) {
      args.days = parseInt(next, 10) || 3;
      i += 1;
    } else if (arg === '--limit' && next) {
      args.limit = parseInt(next, 10) || DEFAULT_DAILY_WRITE_LIMIT;
      i += 1;
    }
  }

  return args;
}

export function buildD1AnalyticsQuery(days = 3) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - days);
  const dateGte = targetDate.toISOString().slice(0, 10);

  const query = `
    query GetD1Usage($accountTag: String!, $databaseId: String!, $dateGte: String!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          d1AnalyticsAdaptiveGroups(
            limit: 30,
            filter: {
              databaseId: $databaseId,
              date_geq: $dateGte
            }
          ) {
            dimensions {
              date
            }
            sum {
              rowsWritten
              rowsRead
              readQueries
              writeQueries
            }
          }
        }
      }
    }
  `.trim();

  return { query, dateGte };
}

export function formatUsageReport(groups = [], dailyLimit = DEFAULT_DAILY_WRITE_LIMIT) {
  if (!groups || groups.length === 0) {
    return 'Nenhum dado de métricas encontrado para o período informado.';
  }

  const lines = [];
  lines.push('─────────────────────────────────────────────────────────────────');
  lines.push('  Data        | Linhas Gravadas (Writes) | Linhas Lidas | Queries | Status');
  lines.push('─────────────────────────────────────────────────────────────────');

  for (const group of groups) {
    const date = group.dimensions?.date || 'N/A';
    const writes = group.sum?.rowsWritten || 0;
    const reads = group.sum?.rowsRead || 0;
    const queries = group.sum?.queryCount || 0;

    const pct = ((writes / dailyLimit) * 100).toFixed(1);

    let status = '[OK]';
    if (writes >= dailyLimit) {
      status = '[CRÍTICO - LIMITE EXCEDIDO]';
    } else if (writes >= dailyLimit * 0.8) {
      status = '[ALERTA - >80%]';
    } else if (writes >= dailyLimit * 0.5) {
      status = '[ATENÇÃO - >50%]';
    }

    lines.push(
      `  ${date.padEnd(11)} | ${String(writes).padStart(12)} (${pct.padStart(4)}%) | ${String(reads).padStart(12)} | ${String(queries).padStart(7)} | ${status}`,
    );
  }

  lines.push('─────────────────────────────────────────────────────────────────');
  return lines.join('\n');
}

export async function fetchD1Usage({ token, account, database, days, limit, fetchImpl = fetch }) {
  if (!token || !account) {
    throw new Error(
      'Cloudflare API Token e Account ID são necessários.\n' +
      'Defina as variáveis CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID ou passe via --token e --account.',
    );
  }

  const { query, dateGte } = buildD1AnalyticsQuery(days);

  const response = await fetchImpl(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: {
        accountTag: account,
        databaseId: database,
        dateGte,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloudflare API error (${response.status}): ${text}`);
  }

  const result = await response.json();

  if (result.errors && result.errors.length > 0) {
    const msg = result.errors.map((e) => e.message).join(', ');
    throw new Error(`GraphQL query error: ${msg}`);
  }

  const accounts = result.data?.viewer?.accounts || [];
  if (accounts.length === 0) {
    throw new Error(`Conta Cloudflare '${account}' não encontrada ou token sem permissão de Analytics.`);
  }

  const groups = accounts[0].d1AnalyticsAdaptiveGroups || [];
  return {
    account,
    database,
    groups,
    report: formatUsageReport(groups, limit),
  };
}

// Execução direta via CLI
if (process.argv[1] && process.argv[1].endsWith('check-d1-usage.mjs')) {
  const args = parseArgs();

  if (!args.token || !args.account) {
    console.log(`
🔍 Voxyl - Cloudflare D1 Daily Usage Analyzer

Uso:
  node scripts/check-d1-usage.mjs --token <CF_API_TOKEN> --account <CF_ACCOUNT_ID>

Ou configure variáveis de ambiente:
  export CLOUDFLARE_API_TOKEN="seu_token_api"
  export CLOUDFLARE_ACCOUNT_ID="seu_account_id"
  node scripts/check-d1-usage.mjs

Database padrão configurado: ${args.database} (voxyl-db)
Limite diário Free Tier: ${args.limit.toLocaleString()} rows written
    `);
    process.exit(1);
  }

  try {
    console.log(`\nConsultando métricas do Cloudflare D1 (${args.database}) nos últimos ${args.days} dias...\n`);
    const { report } = await fetchD1Usage(args);
    console.log(report);
  } catch (err) {
    console.error(`\n❌ Erro: ${err.message}\n`);
    process.exit(1);
  }
}
