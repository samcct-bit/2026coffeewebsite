import { db } from './firebase_config.js';
import { getAdminToken } from './admin_auth.js';
import * as api from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { createPublicationService } from './publication_service.js';
export const publicationStore = createPublicationService({
    db, api,
    authenticate: async () => { await getAdminToken(); return 'coffee-site-admin'; }
});
