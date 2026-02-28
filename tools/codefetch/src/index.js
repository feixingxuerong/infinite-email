#!/usr/bin/env node

import dotenv from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import Imap from 'imap';
import { simpleParser } from 'mailparser';

dotenv.config({ path: '.env.local' });

// Configuration from environment
const IMAP_CONFIG = {
  user: process.env.IMAP_USER,
  password: process.env.IMAP_PASS,
  host: process.env.IMAP_HOST,
  port: parseInt(process.env.IMAP_PORT || '993'),
  tls: process.env.IMAP_TLS !== 'false',
  tlsOptions: { rejectUnauthorized: false }
};

// Regex patterns for verification codes
const CODE_PATTERNS = [
  /\b(\d{6})\b/g,                    // 6-digit code
  /\b(\d{8})\b/g,                    // 8-digit code
  /\b(?:code|verification|otp|密码|验证码)[:\s]*(\d{6,8})\b/gi,
  /\b(\d{4})\s+(\d{4})\b/g           // Spaced 8-digit (e.g., 1234 5678)
];

// Regex for verification links
const LINK_PATTERNS = [
  /https?:\/\/[^\s<>"']+\/verify[^\s<>"']*/gi,
  /https?:\/\/[^\s<>"']+\/confirm[^\s<>"']*/gi,
  /https?:\/\/[^\s<>"']+\/reset[^\s<>"']*/gi,
  /https?:\/\/[^\s<>"']+\/activate[^\s<>"']*/gi,
  /https?:\/\/[^\s<>"']+\/auth[^\s<>"']*/gi
];

/**
 * Parse email body to extract verification code
 */
function extractCode(body) {
  if (!body) return null;
  
  // Combine plain text and HTML (strip tags)
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  
  for (const pattern of CODE_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const code = match[1] || match[0].replace(/\D/g, '');
      // Filter out common non-code numbers (years, dates, etc.)
      if (code.length >= 6 && code.length <= 8 && !/^20\d{2}$/.test(code)) {
        return code;
      }
    }
  }
  return null;
}

/**
 * Extract verification links from email body
 */
function extractLinks(body) {
  if (!body) return [];
  
  const links = new Set();
  
  for (const pattern of LINK_PATTERNS) {
    const matches = body.match(pattern);
    if (matches) {
      matches.forEach(link => links.add(link));
    }
  }
  
  // Also extract generic URLs that might be verification links
  const genericUrlPattern = /https?:\/\/[^\s<>"']+/g;
  const genericMatches = body.match(genericUrlPattern) || [];
  genericMatches.forEach(url => {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('verify') || lowerUrl.includes('confirm') || 
        lowerUrl.includes('reset') || lowerUrl.includes('activate') ||
        lowerUrl.includes('auth') || lowerUrl.includes('token') ||
        lowerUrl.includes('email')) {
      links.add(url);
    }
  });
  
  return Array.from(links).slice(0, 5); // Limit to 5 links
}

/**
 * Connect to IMAP and fetch emails
 */
async function fetchEmails(service, limit = 50) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(IMAP_CONFIG);
    
    imap.once('ready', () => {
      // Open inbox
      imap.openBox('INBOX', false, async (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }
        
        // Search for emails matching service/alias
        const searchCriteria = service 
          ? ['ALL', ['SUBJECT', service]]
          : ['ALL'];
        
        // Fetch recent emails
        imap.search(searchCriteria, (err, results) => {
          if (err) {
            imap.end();
            return reject(err);
          }
          
          if (results.length === 0) {
            imap.end();
            return resolve([]);
          }
          
          // Get the most recent N emails
          const recentUids = results.slice(-limit);
          
          const fet = imap.fetch(recentUids, {
            bodies: '',
            struct: true
          });
          
          const emails = [];
          
          fet.on('message', (msg, seqno) => {
            let subject = '';
            let date = '';
            let from = '';
            let body = '';
            
            msg.on('body', (stream, info) => {
              let buffer = '';
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
              stream.on('end', async () => {
                try {
                  const parsed = await simpleParser(buffer);
                  subject = parsed.subject || '(No Subject)';
                  date = parsed.date ? parsed.date.toISOString().split('T')[0] : '';
                  from = parsed.from?.text || '';
                  body = parsed.text || parsed.html || '';
                  
                  const code = extractCode(body);
                  const links = extractLinks(body);
                  
                  if (code) {
                    emails.push({
                      code,
                      subject,
                      date,
                      from,
                      links: links.length > 0 ? links : undefined
                    });
                  }
                } catch (e) {
                  // Skip parsing errors
                }
              });
            });
          });
          
          fet.once('end', () => {
            imap.end();
            // Sort by date (most recent first)
            emails.sort((a, b) => b.date.localeCompare(a.date));
            resolve(emails);
          });
        });
      });
    });
    
    imap.once('error', (err) => {
      reject(err);
    });
    
    imap.connect();
  });
}

/**
 * Main CLI function
 */
async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('service', {
      alias: 's',
      description: 'Service/alias prefix to filter emails (e.g., google, amazon)',
      type: 'string'
    })
    .option('limit', {
      alias: 'l',
      description: 'Number of recent emails to search (default: 50)',
      type: 'number',
      default: 50
    })
    .option('links', {
      description: 'Include verification links in output',
      type: 'boolean',
      default: false
    })
    .option('quiet', {
      alias: 'q',
      description: 'Output only codes (one per line)',
      type: 'boolean',
      default: false
    })
    .help()
    .alias('help', 'h')
    .version('1.0.0')
    .example('codefetch --service google', 'Search for verification codes in Google-related emails')
    .example('codefetch -s amazon -l 20', 'Search last 20 Amazon emails')
    .example('codefetch --links', 'Include verification links in output')
    .epilogue('For more information, see docs/codefetch.md')
    .argv;
  
  const { service, limit, links, quiet } = argv;
  
  // Validate IMAP configuration
  if (!IMAP_CONFIG.user || !IMAP_CONFIG.password || !IMAP_CONFIG.host) {
    console.error('Error: Missing IMAP configuration in .env.local');
    console.error('Required: IMAP_USER, IMAP_PASS, IMAP_HOST, IMAP_PORT (optional)');
    process.exit(1);
  }
  
  try {
    const emails = await fetchEmails(service, limit);
    
    if (emails.length === 0) {
      if (!quiet) {
        console.log('No verification codes found.');
      }
      process.exit(0);
    }
    
    // Output results
    for (const email of emails) {
      if (quiet) {
        console.log(email.code);
      } else {
        console.log(`Code: ${email.code}`);
        console.log(`Subject: ${email.subject}`);
        console.log(`Date: ${email.date}`);
        if (links && email.links) {
          console.log(`Links: ${email.links.join(', ')}`);
        }
        console.log('---');
      }
    }
  } catch (err) {
    console.error('Error fetching emails:', err.message);
    process.exit(1);
  }
}

main().catch(console.error);
