#!/usr/bin/env node

/**
 * infinite-email CLI
 * Unified alias management CLI for infinite-email project
 * 
 * Commands:
 *   generate <service> [count]  Generate aliases via Worker bulk API
 *   list [service]              List aliases (optional service filter)
 *   revoke <alias>              Revoke/delete an alias
 *   lookup <address>            Parse alias to extract service/date
 *   fetch <service>             Fetch verification codes via codefetch
 * 
 * Configuration:
 *   .env.local must contain:
 *   - WORKER_URL (required for generate/list/revoke)
 *   - ADMIN_TOKEN (required for generate/list/revoke)
 *   - IMAP_* (required for fetch)
 */

import dotenv from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment from .env.local
dotenv.config({ path: '.env.local' });

// Configuration
const CONFIG = {
  workerUrl: process.env.WORKER_URL || 'http://localhost:8787',
  adminToken: process.env.ADMIN_TOKEN || '',
  imap: {
    host: process.env.IMAP_HOST,
    port: process.env.IMAP_PORT || '993',
    user: process.env.IMAP_USER,
    pass: process.env.IMAP_PASS,
    tls: process.env.IMAP_TLS !== 'false'
  }
};

/**
 * Make authenticated API request to Worker
 */
async function workerRequest(endpoint, options = {}) {
  const { method = 'GET', body = null } = options;
  
  if (!CONFIG.adminToken) {
    throw new Error('Missing ADMIN_TOKEN in .env.local');
  }
  
  const url = `${CONFIG.workerUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Admin-Token': CONFIG.adminToken
  };
  
  const fetchOptions = { method, headers };
  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, fetchOptions);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  
  return data;
}

/**
 * Format alias list as table
 */
function formatAliasTable(aliases) {
  if (!aliases || aliases.length === 0) {
    return 'No aliases found.';
  }
  
  const headers = ['Alias', 'Service', 'Status', 'Created', 'Note'];
  const rows = aliases.map(a => [
    a.alias || '',
    a.service || '-',
    a.status || 'active',
    a.created_at ? a.created_at.split(' ')[0] : '-',
    a.note || '-'
  ]);
  
  // Calculate column widths
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] || '').toString().length)));
  
  // Build table
  const separator = widths.map(w => '-'.repeat(w + 2)).join('+');
  const headerRow = headers.map((h, i) => ` ${h.padEnd(widths[i])} `).join('|');
  const dataRows = rows.map(row => 
    row.map((cell, i) => ` ${(cell || '').toString().padEnd(widths[i])} `).join('|')
  );
  
  return [separator, headerRow, separator, ...dataRows, separator].join('\n');
}

/**
 * Parse alias to extract service and date
 * Format: service-yyyymm-randomsuffix
 */
function parseAlias(address) {
  // Remove domain part if present
  const alias = address.split('@')[0];
  
  // Match pattern: service-yyyymm-random
  const match = alias.match(/^([a-zA-Z0-9]+)-(\d{6})-(.+)$/);
  
  if (match) {
    const [, service, yyyymm, suffix] = match;
    const year = yyyymm.slice(0, 4);
    const month = yyyymm.slice(4, 6);
    return {
      original: address,
      alias,
      service,
      date: `${year}-${month}`,
      year,
      month,
      suffix
    };
  }
  
  // Try simpler patterns
  const simpleMatch = alias.match(/^([a-zA-Z0-9]+)-(.+)$/);
  if (simpleMatch) {
    return {
      original: address,
      alias,
      service: simpleMatch[1],
      suffix: simpleMatch[2],
      note: 'Could not parse date from alias'
    };
  }
  
  return {
    original: address,
    alias,
    note: 'Alias format not recognized'
  };
}

/**
 * Command: generate <service> [count]
 */
async function generateCommand(service, count = 1, options = {}) {
  const data = await workerRequest('/api/aliases/bulk', {
    method: 'POST',
    body: { service, count }
  });
  
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`\n✓ Generated ${data.created}/${data.requested} aliases for "${service}":\n`);
    console.log(formatAliasTable(data.aliases));
    
    if (data.errors && data.errors.length > 0) {
      console.log('\n⚠ Errors:');
      data.errors.forEach(e => console.log(`  - ${e}`));
    }
  }
}

/**
 * Command: list [service]
 */
async function listCommand(service = null, options = {}) {
  const endpoint = service ? `/api/aliases?service=${encodeURIComponent(service)}` : '/api/aliases';
  const data = await workerRequest(endpoint);
  
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    const label = service ? `service "${service}"` : 'all';
    console.log(`\n📋 Aliases (${label}):\n`);
    console.log(formatAliasTable(data.aliases));
    console.log(`\nTotal: ${data.aliases?.length || 0} aliases`);
  }
}

/**
 * Command: revoke <alias>
 */
async function revokeCommand(alias, options = {}) {
  const data = await workerRequest(`/api/aliases/${encodeURIComponent(alias)}`, {
    method: 'DELETE'
  });
  
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`\n✓ Alias "${alias}" has been revoked.`);
    console.log(`  Status: ${data.status}`);
  }
}

/**
 * Command: lookup <address>
 */
function lookupCommand(address, options = {}) {
  const result = parseAlias(address);
  
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n🔍 Alias Analysis:\n`);
    console.log(`  Original: ${result.original}`);
    console.log(`  Alias:    ${result.alias}`);
    if (result.service) console.log(`  Service:  ${result.service}`);
    if (result.date) console.log(`  Date:     ${result.year}-${result.month} (${result.date})`);
    if (result.suffix) console.log(`  Suffix:   ${result.suffix}`);
    if (result.note) console.log(`  Note:     ${result.note}`);
  }
}

/**
 * Command: fetch <service>
 * Calls codefetch tool
 */
async function fetchCommand(service, options = {}) {
  // Check IMAP configuration
  if (!CONFIG.imap.user || !CONFIG.imap.pass || !CONFIG.imap.host) {
    console.error('Error: Missing IMAP configuration in .env.local');
    console.error('Required: IMAP_HOST, IMAP_USER, IMAP_PASS');
    process.exit(1);
  }
  
  // Build codefetch arguments
  const codefetchPath = path.join(__dirname, '..', 'codefetch', 'src', 'index.js');
  const args = ['--service', service];
  
  if (options.limit) args.push('--limit', options.limit.toString());
  if (options.links) args.push('--links');
  if (options.quiet) args.push('--quiet');
  
  return new Promise((resolve, reject) => {
    const child = spawn('node', [codefetchPath, ...args], {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..', '..')
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`codefetch exited with code ${code}`));
      }
    });
    
    child.on('error', reject);
  });
}

/**
 * Main CLI entry
 */
async function main() {
  const argv = await yargs(hideBin(process.argv))
    .command(
      'generate <service> [count]',
      'Generate aliases via Worker bulk API',
      (yargs) => {
        yargs
          .positional('service', {
            describe: 'Service identifier (e.g., amazon, google)',
            type: 'string'
          })
          .positional('count', {
            describe: 'Number of aliases to generate (default: 1, max: 50)',
            type: 'number',
            default: 1
          })
          .option('json', {
            describe: 'Output raw JSON',
            type: 'boolean',
            default: false
          });
      },
      (argv) => generateCommand(argv.service, argv.count, argv)
    )
    .command(
      'list [service]',
      'List aliases (optional service filter)',
      (yargs) => {
        yargs
          .positional('service', {
            describe: 'Filter by service name',
            type: 'string'
          })
          .option('json', {
            describe: 'Output raw JSON',
            type: 'boolean',
            default: false
          });
      },
      (argv) => listCommand(argv.service, argv)
    )
    .command(
      'revoke <alias>',
      'Revoke/delete an alias',
      (yargs) => {
        yargs
          .positional('alias', {
            describe: 'Alias to revoke',
            type: 'string'
          })
          .option('json', {
            describe: 'Output raw JSON',
            type: 'boolean',
            default: false
          });
      },
      (argv) => revokeCommand(argv.alias, argv)
    )
    .command(
      'lookup <address>',
      'Parse alias to extract service/date info',
      (yargs) => {
        yargs
          .positional('address', {
            describe: 'Email address or alias to parse',
            type: 'string'
          })
          .option('json', {
            describe: 'Output raw JSON',
            type: 'boolean',
            default: false
          });
      },
      (argv) => lookupCommand(argv.address, argv)
    )
    .command(
      'fetch <service>',
      'Fetch verification codes from email (via codefetch)',
      (yargs) => {
        yargs
          .positional('service', {
            describe: 'Service/alias to search for',
            type: 'string'
          })
          .option('limit', {
            alias: 'l',
            describe: 'Number of emails to search',
            type: 'number',
            default: 50
          })
          .option('links', {
            describe: 'Include verification links',
            type: 'boolean',
            default: false
          })
          .option('quiet', {
            alias: 'q',
            describe: 'Output only codes (one per line)',
            type: 'boolean',
            default: false
          });
      },
      (argv) => fetchCommand(argv.service, argv)
    )
    .demandCommand(1, 'Please specify a command')
    .help()
    .alias('help', 'h')
    .version('1.0.0')
    .example('infinite-email generate amazon 10', 'Generate 10 amazon aliases')
    .example('infinite-email list', 'List all aliases')
    .example('infinite-email list amazon', 'List amazon aliases')
    .example('infinite-email revoke amazon-202602-a1b2c3', 'Revoke an alias')
    .example('infinite-email lookup amazon-202602-a1b2c3@domain.com', 'Parse alias info')
    .example('infinite-email fetch amazon', 'Fetch verification codes from amazon emails')
    .epilogue('For more information, see docs/setup.md')
    .argv;
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
