import { app } from './firebase_config.js';
import { getAuth, setPersistence, browserSessionPersistence, signInWithCustomToken, signOut, onIdTokenChanged } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';

const auth = getAuth(app);
const ready = setPersistence(auth, browserSessionPersistence).then(() => auth.authStateReady());
let expirationTimer;
let uiMounted = false;

function validClaims(claims) {
    const now = Math.floor(Date.now() / 1000);
    return claims.sub === 'coffee-site-admin' && claims.coffeeAdmin === true &&
        Number.isInteger(claims.auth_time) && claims.auth_time <= now &&
        Number.isInteger(claims.coffeeSessionExpiresAt) && claims.coffeeSessionExpiresAt > now &&
        claims.coffeeSessionExpiresAt <= claims.auth_time + 3600 && now - claims.auth_time < 3600;
}

export async function getAdminToken() {
    await ready;
    if (!auth.currentUser) throw new Error('請先登入管理員');
    const result = await auth.currentUser.getIdTokenResult();
    if (!validClaims(result.claims)) {
        await signOut(auth);
        throw new Error('管理員登入已到期，請重新登入');
    }
    return result.token;
}

export async function login(customToken) {
    await ready;
    await signInWithCustomToken(auth, customToken);
    return getAdminToken();
}

export async function logout() {
    clearTimeout(expirationTimer);
    await signOut(auth);
    sessionStorage.removeItem('roast_db_auth');
    sessionStorage.removeItem('roast_db_token');
}

export async function mountAdminUI(onAuthenticated) {
    await ready;
    if (uiMounted) return;
    uiMounted = true;
    sessionStorage.removeItem('roast_db_auth');
    sessionStorage.removeItem('roast_db_token');
    const overlay = document.getElementById('password-overlay');
    const logoutButton = document.createElement('button');
    logoutButton.type = 'button';
    logoutButton.textContent = '登出管理員';
    logoutButton.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:100;background:#fff;color:#222;border:1px solid #777;border-radius:6px;padding:8px 12px;font-size:12px;';
    logoutButton.hidden = true;
    logoutButton.addEventListener('click', () => logout().catch(() => { if (overlay) overlay.style.display = 'flex'; }));
    document.body.appendChild(logoutButton);
    onIdTokenChanged(auth, async user => {
        clearTimeout(expirationTimer);
        let allowed = false;
        let claims;
        try { if (user) { claims = (await user.getIdTokenResult()).claims; allowed = validClaims(claims); } } catch { /* 閉鎖處理 */ }
        if (overlay) overlay.style.display = allowed ? 'none' : 'flex';
        logoutButton.hidden = !allowed;
        if (allowed) {
            expirationTimer = setTimeout(() => logout().catch(() => { if (overlay) overlay.style.display = 'flex'; }), Math.max(0, claims.coffeeSessionExpiresAt * 1000 - Date.now()));
            if (onAuthenticated) onAuthenticated();
        }
    });
}
