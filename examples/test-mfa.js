/**
 * CLI test script for Garmin MFA authentication
 *
 * Usage:
 *   1. Set environment variable: export MFA_SECRET_KEY="your-32-char-secret-key-here"
 *   2. Run: node examples/test-mfa.js
 *
 * Or on Windows:
 *   1. set MFA_SECRET_KEY=your-32-char-secret-key-here
 *   2. node examples/test-mfa.js
 */

const readline = require('readline');
const { GarminConnect } = require('../dist/index.js');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function main() {
    console.log('=== Garmin MFA Login Test ===\n');

    // Check for MFA_SECRET_KEY
    if (!process.env.MFA_SECRET_KEY || process.env.MFA_SECRET_KEY.length < 32) {
        console.error(
            'ERROR: MFA_SECRET_KEY environment variable must be set (at least 32 characters)'
        );
        console.error('\nExample:');
        console.error(
            '  export MFA_SECRET_KEY="your-very-long-secret-key-here-32ch"'
        );
        process.exit(1);
    }

    try {
        // Get credentials
        const email = await question('Garmin Email: ');
        const password = await question('Garmin Password: ');

        console.log('\nLogging in...');

        const GC = new GarminConnect({ username: email, password: password });
        const result = await GC.login();

        // Check if MFA is required
        if ('needsMFA' in result && result.needsMFA) {
            console.log(
                '\n[MFA Required] Garmin has sent a verification code to your email.'
            );
            console.log(
                'MFA Session Token (for debugging):',
                result.mfaSession.substring(0, 50) + '...\n'
            );

            const mfaCode = await question('Enter MFA Code: ');

            console.log('\nVerifying MFA...');
            await GC.verifyMFA(result.mfaSession, mfaCode);

            console.log('\n[Success] MFA verification complete!');
        } else {
            console.log('\n[Success] Login complete (no MFA required)');
        }

        // Test API call
        console.log('\nFetching user profile...');
        const profile = await GC.getUserProfile();

        console.log('\n=== User Profile ===');
        console.log('Display Name:', profile.displayName);
        console.log('Full Name:', profile.fullName);
        console.log('Profile ID:', profile.profileId);

        // Export tokens
        const tokens = GC.exportToken();
        console.log('\n=== OAuth Tokens ===');
        console.log(
            'OAuth1 Token:',
            tokens.oauth1.oauth_token.substring(0, 20) + '...'
        );
        console.log(
            'OAuth2 Access Token:',
            tokens.oauth2.access_token.substring(0, 20) + '...'
        );
        console.log(
            'OAuth2 Expires At:',
            new Date(tokens.oauth2.expires_at * 1000).toLocaleString()
        );
    } catch (error) {
        console.error('\n[Error]', error.message);
    } finally {
        rl.close();
    }
}

main();
