/**
 * Example Vercel API endpoints for Garmin MFA authentication
 *
 * File structure for Vercel:
 *   api/garmin/login.js     - handles initial login
 *   api/garmin/verify-mfa.js - handles MFA verification
 *
 * Environment variables needed:
 *   MFA_SECRET_KEY - At least 32 characters for AES-256 encryption
 */

const { GarminConnect } = require('garmin-connect');

// ============================================
// api/garmin/login.js
// ============================================
async function loginHandler(req, res) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email, password } = req.body;

    if (!email || !password) {
        return res
            .status(400)
            .json({ error: 'Email and password are required' });
    }

    try {
        const GC = new GarminConnect({ username: email, password: password });
        const result = await GC.login();

        // Check if MFA is required
        if ('needsMFA' in result && result.needsMFA) {
            return res.json({
                needsMFA: true,
                mfaSession: result.mfaSession,
                message: 'Garmin has sent a verification code to your email'
            });
        }

        // Login successful - get user profile as confirmation
        const profile = await GC.getUserProfile();

        // Optionally export tokens for future use
        const tokens = GC.exportToken();

        return res.json({
            success: true,
            user: {
                displayName: profile.displayName,
                fullName: profile.fullName
            },
            // You might want to store these tokens securely
            tokens: {
                oauth1: tokens.oauth1,
                oauth2: {
                    access_token: tokens.oauth2.access_token,
                    expires_at: tokens.oauth2.expires_at
                }
            }
        });
    } catch (error) {
        console.error('Login error:', error.message);

        // Check for common error types
        if (
            error.message.includes('password') ||
            error.message.includes('credentials')
        ) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        if (error.message.includes('AccountLocked')) {
            return res
                .status(403)
                .json({
                    error: 'Account is locked. Please unlock via Garmin Connect website.'
                });
        }
        if (error.message.includes('MFA_SECRET_KEY')) {
            return res
                .status(500)
                .json({
                    error: 'Server configuration error: MFA_SECRET_KEY not set'
                });
        }

        return res.status(500).json({ error: error.message });
    }
}

// ============================================
// api/garmin/verify-mfa.js
// ============================================
async function verifyMfaHandler(req, res) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { mfaSession, mfaCode } = req.body;

    if (!mfaSession || !mfaCode) {
        return res
            .status(400)
            .json({ error: 'MFA session and code are required' });
    }

    try {
        // Create a new GarminConnect instance (credentials not needed for MFA verification)
        const GC = new GarminConnect({ username: '', password: '' });

        // Verify MFA
        await GC.verifyMFA(mfaSession, mfaCode);

        // MFA successful - get user profile
        const profile = await GC.getUserProfile();

        // Export tokens
        const tokens = GC.exportToken();

        return res.json({
            success: true,
            user: {
                displayName: profile.displayName,
                fullName: profile.fullName
            },
            tokens: {
                oauth1: tokens.oauth1,
                oauth2: {
                    access_token: tokens.oauth2.access_token,
                    expires_at: tokens.oauth2.expires_at
                }
            }
        });
    } catch (error) {
        console.error('MFA verification error:', error.message);

        if (error.message.includes('expired')) {
            return res
                .status(401)
                .json({ error: 'MFA session expired. Please login again.' });
        }
        if (
            error.message.includes('Invalid') ||
            error.message.includes('corrupted')
        ) {
            return res.status(400).json({ error: 'Invalid MFA session' });
        }
        if (error.message.includes('failed')) {
            return res
                .status(401)
                .json({
                    error: 'Invalid MFA code. Please check and try again.'
                });
        }

        return res.status(500).json({ error: error.message });
    }
}

// ============================================
// Combined handler (for single endpoint like your current setup)
// api/garmin/import.js
// ============================================
async function combinedHandler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email, password, mfaSession, mfaCode } = req.body;

    // If mfaSession and mfaCode provided, this is MFA verification
    if (mfaSession && mfaCode) {
        return verifyMfaHandler(req, res);
    }

    // Otherwise, this is initial login
    if (email && password) {
        return loginHandler(req, res);
    }

    return res.status(400).json({ error: 'Invalid request' });
}

// Export for Vercel
module.exports = combinedHandler;

// Also export individual handlers if needed
module.exports.login = loginHandler;
module.exports.verifyMfa = verifyMfaHandler;
