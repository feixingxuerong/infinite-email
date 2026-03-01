# Auto Register ChatGPT

Automated ChatGPT account registration tool using generated email aliases and IMAP verification code fetching.

## Overview

This tool automates the ChatGPT registration process by:
1. Generating a unique email alias via the Worker API
2. Opening ChatGPT signup page with Playwright
3. Filling email and password
4. Fetching the verification code from email via IMAP
5. Completing the registration automatically

## Prerequisites

- Node.js 18+
- npm or yarn

## Installation

1. Navigate to the tool directory:
```bash
cd tools/auto-register-chatgpt
```

2. Install dependencies:
```bash
npm install
```

3. Create your `.env.local` configuration file:
```bash
cp .env.local.example .env.local
```

## Configuration

Configuration is loaded from `.env.local` files with the following priority:
1. `tools/auto-register-chatgpt/.env.local` (highest priority)
2. Project root `.env.local`

### Required Variables

```env
# Worker API Configuration (for generating aliases)
WORKER_URL=http://localhost:8787
ADMIN_TOKEN=your-admin-token-here

# IMAP Configuration (for fetching verification codes)
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=your-email@gmail.com
IMAP_PASS=your-app-password
IMAP_TLS=true

# Domain for email aliases
DOMAIN=1secmail.com
```

### Getting IMAP App Password

If using Gmail:
1. Go to Google Account > Security
2. Enable 2-Step Verification
3. Go to App Passwords (search "app password" in settings)
4. Create a new app password for "Mail"
5. Use that 16-character password as IMAP_PASS

## Usage

### Run from tool directory:
```bash
npm run start
```

### Or from project root:
```bash
# Add to root package.json scripts first:
# "register:chatgpt": "cd tools/auto-register-chatgpt && npm run start"

npm run register:chatgpt
```

## How It Works

1. **Generate Alias**: Calls the Worker API to create a new email alias for ChatGPT
2. **Generate Password**: Creates a strong random 28-character password
3. **Browser Automation**: Opens ChatGPT signup page with Playwright
4. **Fill Form**: Enters email and password
5. **Fetch Code**: Polls IMAP for verification email (up to 90 seconds)
6. **Complete Registration**: Fills the verification code and submits

## Output

Account information is saved to `outputs/chatgpt-account.json`:

```json
{
  "service": "chatgpt",
  "created_at": "2026-03-01T00:24:00+08:00",
  "email": "chatgpt.x123@1secmail.com",
  "password": "^{T@lv[GP5g?SV2:H|NwQ]'yaA~c",
  "status": "registered",
  "notes": "Do not share this file publicly."
}
```

**Security Note**: Password is never printed to console in full. Only masked versions (e.g., `ch***om`) are displayed.

## Troubleshooting

### Verification code timeout
- Check that IMAP credentials are correct
- Verify the email account can receive emails
- The default timeout is 90 seconds (18 retries × 5 seconds)

### Playwright issues
- Make sure Playwright browsers are installed: `npx playwright install chromium`
- If running headless fails, the script runs in non-headless mode by default

### API errors
- Verify WORKER_URL is accessible
- Check ADMIN_TOKEN is valid

## License

MIT
