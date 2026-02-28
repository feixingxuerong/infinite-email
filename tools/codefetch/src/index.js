import Imap from 'imap';
import { simpleParser } from 'mailparser';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load IMAP config from .env.local
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Load IMAP config from .env.local
const IMAP_CONFIG = {
  user: process.env.IMAP_USER,
  password: process.env.IMAP_PASS,
  host: process.env.IMAP_HOST || 'imap.gmail.com',
  port: parseInt(process.env.IMAP_PORT || '993'),
  tls: process.env.IMAP_TLS !== 'false',
  tlsOptions: { rejectUnauthorized: false }
};

if (!IMAP_CONFIG.user || !IMAP_CONFIG.password) {
  console.error('Error: IMAP_USER and IMAP_PASS must be set in .env.local');
  process.exit(1);
}

/**
 * Extract verification code from email body
 * Looks for 6-8 digit codes in common patterns
 */
function extractCode(text) {
  if (!text) return null;
  
  // Patterns for common verification codes
  const patterns = [
    /\b(\d{6})\b/g,           // 6 digits
    /\b(\d{8})\b/g,           // 8 digits
    /code[:\s]*(\d{6,8})/gi,  // "code: 123456"
    /verification[:\s]*(\d{6,8})/gi,
    /your code is (\d{6,8})/gi,
    /代币为 (\d{6})/g,        // Chinese "token is X"
  ];
  
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      // Extract the number from the match
      const match = matches[0];
      const numberMatch = match.match(/(\d{6,8})/);
      if (numberMatch) {
        return numberMatch[1];
      }
    }
  }
  
  return null;
}

/**
 * Extract verification links from email body
 */
function extractLinks(text) {
  if (!text) return [];
  
  const urlPattern = /https?:\/\/[^\s<>"'}\]]+/gi;
  const matches = text.match(urlPattern) || [];
  
  // Filter to likely verification links
  return matches.filter(url => 
    url.includes('verify') || 
    url.includes('confirm') || 
    url.includes('auth') ||
    url.includes('login') ||
    url.includes('signup')
  ).slice(0, 5);
}

/**
 * Connect to IMAP and fetch emails
 */
async function fetchEmails(service, limit = 50) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(IMAP_CONFIG);
    
    imap.once('ready', () => {
      imap.openBox('INBOX', false, async (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }
        
        imap.search(['ALL'], (err, results) => {
          if (err) {
            imap.end();
            return reject(err);
          }
          
          if (results.length === 0) {
            imap.end();
            return resolve([]);
          }
          
          const recentUids = results.slice(-limit);
          const fet = imap.fetch(recentUids, { bodies: 'TEXT' });
          
          const emailPromises = [];
          
          fet.on('message', (msg, seqno) => {
            const emailPromise = new Promise((resolveEmail) => {
              let buffer = '';
              
              msg.on('body', (stream) => {
                stream.on('data', (chunk) => {
                  buffer += chunk.toString('utf8');
                });
                stream.on('end', async () => {
                  try {
                    const parsed = await simpleParser(buffer);
                    const subject = parsed.subject || '(No Subject)';
                    const date = parsed.date?.toISOString() || '';
                    const from = parsed.from?.text || '';
                    const to = parsed.to?.text || '';
                    const body = parsed.text || parsed.html || '';
                    const rawLower = buffer.toLowerCase();
                    
                    const code = extractCode(body);
                    const fullText = (subject + ' ' + from + ' ' + body + ' ' + to).toLowerCase();
                    
                    // Check if service matches in any field
                    const serviceMatch = !service || 
                      fullText.includes(service.toLowerCase()) ||
                      rawLower.includes(service.toLowerCase());
                    
                    if (code && (!service || serviceMatch)) {
                      resolveEmail({
                        code,
                        subject,
                        date: date ? date.split('T')[0] : '',
                        from,
                        links: extractLinks(body).slice(0, 5)
                      });
                    } else {
                      resolveEmail(null);
                    }
                  } catch (e) {
                    resolveEmail(null);
                  }
                });
              });
            });
            
            emailPromises.push(emailPromise);
          });
          
          fet.once('end', async () => {
            const emails = (await Promise.all(emailPromises)).filter(e => e !== null);
            imap.end();
            emails.sort((a, b) => b.date.localeCompare(a.date));
            resolve(emails);
          });
        });
      });
    });
    
    imap.once('error', (err) => reject(err));
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
      description: 'Service/alias prefix to filter emails (e.g., google, amazon, chatgpt)',
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
      description: 'Only output the code',
      type: 'boolean',
      default: false
    })
    .help()
    .alias('help', 'h')
    .argv;
  
  const { service, limit, links, quiet } = argv;
  
  try {
    const emails = await fetchEmails(service, limit);
    
    if (emails.length === 0) {
      if (!quiet) {
        console.log('No verification codes found.');
      }
      process.exit(0);
    }
    
    if (quiet) {
      // Just output the first code
      console.log(emails[0].code);
    } else {
      // Output full details
      for (const email of emails) {
        console.log(`Code: ${email.code}`);
        if (email.subject) console.log(`Subject: ${email.subject}`);
        if (email.date) console.log(`Date: ${email.date}`);
        if (email.from) console.log(`From: ${email.from}`);
        if (links && email.links?.length) {
          console.log('Links:');
          email.links.forEach(link => console.log(`  ${link}`));
        }
        console.log('---');
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
