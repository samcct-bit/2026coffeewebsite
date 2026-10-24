import { db } from './firebase_config.js';
import { getAdminToken } from './admin_auth.js';
import { publicationStore } from './publication_store.js';
import * as api from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { createCuppingService } from './cupping_service.js';
export const cuppingStore = createCuppingService({ db, api, publicationStore,
    authenticate: async () => { await getAdminToken(); return 'coffee-site-admin'; } });
