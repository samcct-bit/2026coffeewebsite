// Pure rendering helpers: never use escaped text as JavaScript or CSS.
(function (root) {
    'use strict';
    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[char]);
    }

    // A base permits local page links; omit it for external source URLs.
    // Reject control characters, credentials and every non-HTTP(S) scheme.
    function safeURL(value, base) {
        if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f]/.test(value)) return '';
        try {
            const url = base ? new URL(value, base) : new URL(value);
            if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
            return url.href;
        } catch {
            return '';
        }
    }
    root.SafeDOM = Object.freeze({ escapeHTML, safeURL });
})(globalThis);
