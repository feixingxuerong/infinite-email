/**
 * Auto Register ChatGPT
 * 
 * Flow:
 * 1. Load config from .env.local (priority: tool dir > project root)
 * 2. Generate email alias via worker API
 * 3. Generate strong random password (28 chars)
 * 4. Use Playwright to navigate to ChatGPT signup
 * 5. Fill email, wait for verification code
 * 6. Fetch verification code from IMAP
 * 7. Fill verification code and complete registration
 * 8. Save account info to outputs/chatgpt-account.json
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import Imap from 'imap';
import { simpleParser } from 'mailparser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const OUTPUTS_DIR = path.resolve(PROJECT_ROOT, 'outputs');
const ACCOUNT_FILE = path.resolve(OUTPUTS_DIR, 'chatgpt-account.json');

// ============================================
// Config Loading (Priority: tool dir > project root)
// ============================================
function loadConfig() {
  const toolEnvPath = path.resolve(__dirname, '.env.local');
  const rootEnvPath = path.resolve(PROJECT_ROOT, '.env.local');
  
  // Try tool directory first
  if (fs.existsSync(toolEnvPath)) {
    dotenv.config({ path: toolEnvPath });
    console.log('Loaded config from tools/auto-register-chatgpt/.env.local');
  } else if (fs.existsSync(rootEnvPath)) {
    dotenv.config({ path: rootEnvPath });
    console.log('Loaded config from project root .env.local');
  } else {
    console.error('Error: No .env.local found!');
    process.exit(1);
  }
  
  const config = {
    workerUrl: process.env.WORKER_URL || 'http://localhost:8787',
    adminToken: process.env.ADMIN_TOKEN,
    imapHost: process.env.IMAP_HOST || 'imap.gmail.com',
    imapPort: parseInt(process.env.IMAP_PORT || '993'),
    imapUser: process.env.IMAP_USER,
    imapPass: process.env.IMAP_PASS,
    imapTls: process.env.IMAP_TLS !== 'false',
    domain: process.env.DOMAIN || '1secmail.com'
  };
  
  // Validate required config
  if (!config.adminToken) {
    console.error('Error: ADMIN_TOKEN is required');
    process.exit(1);
  }
  if (!config.imapUser || !config.imapPass) {
    console.error('Error: IMAP_USER and IMAP_PASS are required');
    process.exit(1);
  }
  
  return config;
}

// ============================================
// Generate Random Strong Password (28 chars)
// ============================================
function generatePassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  let password = '';
  const array = new Uint32Array(28);
  crypto.getRandomValues(array);
  for (let i = 0; i < 28; i++) {
    password += chars[array[i] % chars.length];
  }
  return password;
}

// Mask email for logging (show only first and last 2 chars)
function maskEmail(email) {
  if (!email || email.length < 5) return '***';
  return email.substring(0, 2) + '***' + email.substring(email.length - 2);
}

// ============================================
// Generate Alias via Worker API
// ============================================
async function generateAlias(config) {
  console.log('Generating ChatGPT alias...');
  
  const response = await fetch(`${config.workerUrl}/api/aliases/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.adminToken}`
    },
    body: JSON.stringify({ service: 'chatgpt', count: 1 })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to generate alias: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  
  if (!data.aliases || data.aliases.length === 0) {
    throw new Error('No aliases returned from API');
  }
  
  const alias = data.aliases[0];
  const fullEmail = `${alias.name}@${config.domain}`;
  
  console.log(`Generated alias: ${maskEmail(fullEmail)}`);
  
  return { alias, fullEmail };
}

// ============================================
// IMAP Verification Code Fetching
// ============================================
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
      const match = matches[0];
      const numberMatch = match.match(/(\d{6,8})/);
      if (numberMatch) {
        return numberMatch[1];
      }
    }
  }
  
  return null;
}

async function fetchVerificationCode(config, email, maxRetries = 18, intervalMs = 5000) {
  console.log(`Waiting for verification code (max ${maxRetries * intervalMs / 1000}s)...`);
  
  const imapConfig = {
    user: config.imapUser,
    password: config.imapPass,
    host: config.imapHost,
    port: config.imapPort,
    tls: config.imapTls,
    tlsOptions: { rejectUnauthorized: false }
  };
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`Attempt ${attempt}/${maxRetries}: Checking for verification code...`);
    
    try {
      const code = await new Promise((resolve, reject) => {
        const imap = new Imap(imapConfig);
        
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
                return resolve(null);
              }
              
              const recentUids = results.slice(-50);
              const fet = imap.fetch(recentUids, { bodies: 'TEXT' });
              
              let foundCode = null;
              let emailCount = 0;
              
              fet.on('message', (msg, seqno) => {
                emailCount++;
                let buffer = '';
                
                msg.on('body', (stream) => {
                  stream.on('data', (chunk) => {
                    buffer += chunk.toString('utf8');
                  });
                  stream.on('end', async () => {
                    try {
                      const parsed = await simpleParser(buffer);
                      const subject = parsed.subject || '';
                      const from = parsed.from?.text || '';
                      const body = parsed.text || parsed.html || '';
                      const fullText = (subject + ' ' + from + ' ' + body).toLowerCase();
                      
                      // Check for chatgpt-related email
                      if (fullText.includes('chatgpt') || fullText.includes('openai')) {
                        const code = extractCode(body);
                        if (code) {
                          foundCode = code;
                        }
                      }
                    } catch (e) {
                      // Ignore parsing errors
                    }
                  });
                });
              });
              
              fet.once('end', () => {
                imap.end();
                resolve(foundCode);
              });
            });
          });
        });
        
        imap.once('error', (err) => reject(err));
        imap.connect();
      });
      
      if (code) {
        console.log(`Found verification code: ${code.substring(0, 2)}****${code.substring(4)}`);
        return code;
      }
      
    } catch (err) {
      console.log(`IMAP error (attempt ${attempt}): ${err.message}`);
    }
    
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  
  throw new Error('Verification code not found within timeout');
}

// ============================================
// Playwright ChatGPT Registration
// ============================================
async function registerWithPlaywright(config, email, password) {
  console.log('Starting Playwright registration...');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Navigate to ChatGPT signup
    console.log('Navigating to https://chatgpt.com/');
    await page.goto('https://chatgpt.com/', { waitUntil: 'networkidle' });
    
    // Wait for page to load and look for signup button
    // Using robust selectors for UI changes
    await page.waitForTimeout(2000);
    
    // Look for "Sign up" button - try multiple selectors
    const signupButtonSelectors = [
      'button:has-text("Sign up")',
      'button:has-text("Sign Up")',
      'a:has-text',
      '[data("Sign up")-testid="signup-button"]',
      'button:has-text("Create account")',
      'a:has-text("Create account")'
    ];
    
    let signupClicked = false;
    for (const selector of signupButtonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          signupClicked = true;
          console.log('Clicked signup button');
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (!signupClicked) {
      // Try to find any prominent button/link
      console.log('Trying alternative signup method...');
      await page.goto('https://auth.openai.com/signup', { waitUntil: 'networkidle' });
    }
    
    await page.waitForTimeout(2000);
    
    // Fill email
    console.log(`Filling email: ${maskEmail(email)}`);
    const emailInputSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email"]',
      'input[id="email"]'
    ];
    
    for (const selector of emailInputSelectors) {
      const input = await page.$(selector);
      if (input) {
        await input.fill(email);
        console.log('Email filled');
        break;
      }
    }
    
    // Click continue/submit
    const continueButtonSelectors = [
      'button:has-text("Continue")',
      'button[type="submit"]',
      'button:has-text("Continue with email")'
    ];
    
    for (const selector of continueButtonSelectors) {
      const button = await page.$(selector);
      if (button) {
        await button.click();
        console.log('Clicked continue');
        break;
      }
    }
    
    await page.waitForTimeout(2000);
    
    // Fill password
    console.log('Filling password...');
    const passwordInputSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="password"]'
    ];
    
    for (const selector of passwordInputSelectors) {
      const input = await page.$(selector);
      if (input) {
        await input.fill(password);
        console.log('Password filled');
        break;
      }
    }
    
    // Click continue again
    for (const selector of continueButtonSelectors) {
      const button = await page.$(selector);
      if (button) {
        await button.click();
        console.log('Clicked continue after password');
        break;
      }
    }
    
    // Wait for verification code page
    console.log('Waiting for verification code page...');
    await page.waitForTimeout(3000);
    
    // Check if we're on the verification page
    const pageContent = await page.content();
    const needsVerification = pageContent.toLowerCase().includes('verification') || 
                              pageContent.toLowerCase().includes('check your email');
    
    if (needsVerification) {
      console.log('Verification page detected - fetching code via IMAP');
      
      // Fetch verification code
      const code = await fetchVerificationCode(config, email);
      
      // Fill verification code
      console.log('Filling verification code...');
      const codeInputSelectors = [
        'input[name="code"]',
        'input[placeholder*="code"]',
        'input[maxlength="6"]',
        'input[maxlength="8"]'
      ];
      
      for (const selector of codeInputSelectors) {
        const input = await page.$(selector);
        if (input) {
          await input.fill(code);
          console.log('Verification code filled');
          break;
        }
      }
      
      // Submit code
      const submitButtonSelectors = [
        'button:has-text("Continue")',
        'button[type="submit"]',
        'button:has-text("Verify")'
      ];
      
      for (const selector of submitButtonSelectors) {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          console.log('Submitted verification code');
          break;
        }
      }
      
      await page.waitForTimeout(3000);
    }
    
    // Check for success - main interface or welcome page
    console.log('Checking for registration success...');
    await page.waitForTimeout(3000);
    
    const finalContent = await page.content();
    const isSuccess = finalContent.includes('ChatGPT') || 
                      finalContent.includes('Welcome to ChatGPT') ||
                      page.url().includes('chatgpt.com/') ||
                      page.url().includes('chat.openai.com');
    
    if (isSuccess) {
      console.log('Registration successful!');
      return true;
    } else {
      console.log('Registration may not be complete - please check browser');
      // Keep browser open for manual verification
      await page.waitForTimeout(10000);
      return false;
    }
    
  } finally {
    // Note: Don't close browser immediately to allow manual verification
    // await browser.close();
    console.log('Browser left open for verification. Close manually when done.');
  }
}

// ============================================
// Save Account Info
// ============================================
function saveAccountInfo(email, password, status) {
  // Ensure outputs directory exists
  if (!fs.existsSync(OUTPUTS_DIR)) {
    fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
  }
  
  const accountInfo = {
    service: 'chatgpt',
    created_at: new Date().toISOString(),
    email: email,
    password: password,
    status: status,
    notes: 'Do not share this file publicly.'
  };
  
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(accountInfo, null, 2));
  console.log(`Account info saved to ${ACCOUNT_FILE}`);
}

// ============================================
// Main
// ============================================
async function main() {
  console.log('=== Auto Register ChatGPT ===\n');
  
  // Load configuration
  const config = loadConfig();
  
  // Check for existing password in outputs
  let password;
  if (fs.existsSync(ACCOUNT_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf-8'));
      if (existing.password) {
        password = existing.password;
        console.log('Reusing existing password from previous run');
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  // Generate new password if not exists
  if (!password) {
    password = generatePassword();
    console.log('Generated new strong password (28 chars)');
  }
  
  // Generate alias
  const { fullEmail } = await generateAlias(config);
  
  // Start registration with Playwright
  const success = await registerWithPlaywright(config, fullEmail, password);
  
  // Save account info
  const status = success ? 'registered' : 'pending_verification';
  saveAccountInfo(fullEmail, password, status);
  
  console.log('\n=== Done ===');
  console.log(`Email: ${maskEmail(fullEmail)}`);
  console.log(`Status: ${status}`);
  
  if (!success) {
    console.log('\nNote: Browser left open for manual verification if needed.');
    console.log('Once verified, you can update the status in outputs/chatgpt-account.json');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
