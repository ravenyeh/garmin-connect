/**
 * Local test server for Garmin MFA authentication
 *
 * Usage:
 *   1. Set MFA_SECRET_KEY: export MFA_SECRET_KEY="your-32-char-secret-key-here"
 *   2. Run: node examples/test-server.js
 *   3. Open: http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { GarminConnect } = require('../dist/index.js');

const PORT = 3000;

// Check MFA_SECRET_KEY
if (!process.env.MFA_SECRET_KEY || process.env.MFA_SECRET_KEY.length < 32) {
    console.error('ERROR: MFA_SECRET_KEY must be set (at least 32 characters)');
    console.error('');
    console.error('Windows:');
    console.error('  set MFA_SECRET_KEY=your-very-long-secret-key-here-32ch');
    console.error('  node examples/test-server.js');
    console.error('');
    console.error('Mac/Linux:');
    console.error(
        '  export MFA_SECRET_KEY="your-very-long-secret-key-here-32ch"'
    );
    console.error('  node examples/test-server.js');
    process.exit(1);
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

async function handleLogin(req, res) {
    try {
        const { email, password } = await parseBody(req);

        if (!email || !password) {
            return sendJson(res, 400, {
                error: 'Email and password are required'
            });
        }

        console.log(`[Login] Attempting login for: ${email}`);

        const GC = new GarminConnect({ username: email, password: password });
        const result = await GC.login();

        if ('needsMFA' in result && result.needsMFA) {
            console.log('[Login] MFA required');
            return sendJson(res, 200, {
                needsMFA: true,
                mfaSession: result.mfaSession,
                message: 'Garmin has sent a verification code to your email'
            });
        }

        console.log('[Login] Success (no MFA)');
        const profile = await GC.getUserProfile();

        return sendJson(res, 200, {
            success: true,
            user: {
                displayName: profile.displayName,
                fullName: profile.fullName
            }
        });
    } catch (error) {
        console.error('[Login] Error:', error.message);
        return sendJson(res, 401, { error: error.message });
    }
}

async function handleVerifyMFA(req, res) {
    try {
        const { mfaSession, mfaCode } = await parseBody(req);

        if (!mfaSession || !mfaCode) {
            return sendJson(res, 400, {
                error: 'MFA session and code are required'
            });
        }

        console.log(`[MFA] Verifying code: ${mfaCode}`);

        const GC = new GarminConnect({ username: '', password: '' });
        await GC.verifyMFA(mfaSession, mfaCode);

        console.log('[MFA] Verification successful');
        const profile = await GC.getUserProfile();

        return sendJson(res, 200, {
            success: true,
            user: {
                displayName: profile.displayName,
                fullName: profile.fullName
            }
        });
    } catch (error) {
        console.error('[MFA] Error:', error.message);
        return sendJson(res, 401, { error: error.message });
    }
}

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    const url = req.url;

    // Serve HTML page
    if (url === '/' || url === '/index.html') {
        const htmlPath = path.join(__dirname, 'mfa-test.html');
        const html = fs
            .readFileSync(htmlPath, 'utf8')
            .replace(
                /const API_BASE = '\/api\/garmin';/,
                "const API_BASE = '';"
            );
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(html);
    }

    // API endpoints
    if (req.method === 'POST') {
        if (url === '/login') {
            return handleLogin(req, res);
        }
        if (url === '/verify-mfa') {
            return handleVerifyMFA(req, res);
        }
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log('=================================');
    console.log('Garmin MFA Test Server Running');
    console.log('=================================');
    console.log(`URL: http://localhost:${PORT}`);
    console.log('');
    console.log('Endpoints:');
    console.log('  GET  /           - Test HTML page');
    console.log('  POST /login      - Initial login');
    console.log('  POST /verify-mfa - MFA verification');
    console.log('');
    console.log('Press Ctrl+C to stop');
    console.log('=================================');
});
