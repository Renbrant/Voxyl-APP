import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseArgs,
  buildD1AnalyticsQuery,
  formatUsageReport,
  fetchD1Usage,
  DEFAULT_DATABASE_ID,
  DEFAULT_DAILY_WRITE_LIMIT,
} from '../scripts/check-d1-usage.mjs';

test('D1 usage script - parseArgs defaults and CLI flags', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.database, DEFAULT_DATABASE_ID);
  assert.equal(defaults.days, 3);
  assert.equal(defaults.limit, DEFAULT_DAILY_WRITE_LIMIT);

  const custom = parseArgs([
    '--token', 'test-token',
    '--account', 'test-account',
    '--database', 'custom-db-id',
    '--days', '7',
    '--limit', '50000',
  ]);
  assert.equal(custom.token, 'test-token');
  assert.equal(custom.account, 'test-account');
  assert.equal(custom.database, 'custom-db-id');
  assert.equal(custom.days, 7);
  assert.equal(custom.limit, 50000);
});

test('D1 usage script - buildD1AnalyticsQuery constructs valid GraphQL query', () => {
  const { query, dateGte } = buildD1AnalyticsQuery(5);
  assert.ok(query.includes('d1AnalyticsAdaptiveGroups'));
  assert.ok(query.includes('rowsWritten'));
  assert.ok(query.includes('rowsRead'));
  assert.match(dateGte, /^\d{4}-\d{2}-\d{2}$/);
});

test('D1 usage script - formatUsageReport renders table and calculates thresholds', () => {
  const sampleGroups = [
    {
      dimensions: { date: '2026-10-01' },
      sum: { rowsWritten: 5000, rowsRead: 20000, queryCount: 300 },
    },
    {
      dimensions: { date: '2026-10-02' },
      sum: { rowsWritten: 85000, rowsRead: 50000, queryCount: 1500 },
    },
    {
      dimensions: { date: '2026-10-03' },
      sum: { rowsWritten: 105000, rowsRead: 80000, queryCount: 2000 },
    },
  ];

  const report = formatUsageReport(sampleGroups, 100000);
  assert.ok(report.includes('2026-10-01'));
  assert.ok(report.includes('[OK]'));
  assert.ok(report.includes('2026-10-02'));
  assert.ok(report.includes('[ALERTA - >80%]'));
  assert.ok(report.includes('2026-10-03'));
  assert.ok(report.includes('[CRÍTICO - LIMITE EXCEDIDO]'));
});

test('D1 usage script - fetchD1Usage with mock response returns expected structure', async () => {
  const mockFetch = async (url, options) => {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/graphql');
    assert.equal(options.headers.Authorization, 'Bearer mock-token');

    return {
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            accounts: [
              {
                d1AnalyticsAdaptiveGroups: [
                  {
                    dimensions: { date: '2026-10-03' },
                    sum: { rowsWritten: 1200, rowsRead: 4500, queryCount: 120 },
                  },
                ],
              },
            ],
          },
        },
      }),
    };
  };

  const result = await fetchD1Usage({
    token: 'mock-token',
    account: 'mock-account',
    database: DEFAULT_DATABASE_ID,
    days: 1,
    limit: 100000,
    fetchImpl: mockFetch,
  });

  assert.equal(result.account, 'mock-account');
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].sum.rowsWritten, 1200);
  assert.ok(result.report.includes('1200'));
});
