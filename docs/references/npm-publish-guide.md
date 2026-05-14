# Publishing pi-wiggum to npm

## One-Time Setup

1. Create an npm account at https://www.npmjs.com/signup
2. Go to https://www.npmjs.com/settings/<username>/tokens
3. Generate a **Publish** token (Granular Access Token) — check "Bypass 2FA for automated publishing"
4. Give the token to your agent (or use it yourself)

## Publishing

```bash
# Log out of any existing session to avoid conflicts
npm logout

# Set the token (agent: ask Jason for a fresh token)
npm config set //registry.npmjs.org/:_authToken <token-here>

# Publish
cd /path/to/pi-wiggum
npm publish --access public

# Clean up — remove the token from config
npm config delete //registry.npmjs.org/:_authToken
```

## Version Bumping

Before publishing a new version:
```bash
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0
npm version major   # 0.1.0 → 1.0.0
```

Then publish as above.

## Notes

- npm's 2FA system uses passkeys only — there's no TOTP authenticator fallback. The web login flow (`npm login`) opens a browser URL that agents cannot see or handle. Always use tokens.
- Tokens are one-shot per publish session. Revoke old tokens after use at https://www.npmjs.com/settings/<username>/tokens
- The token bypasses 2FA, so treat it like a password — never commit it, never leave it in shell history
