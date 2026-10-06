import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
    getAuth,
    setPersistence,
    browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBEiPrY_xJTgoUAmFVW88Zy7YCDF9zaUho",
    authDomain: "projetospotify-e06a3.firebaseapp.com",
    projectId: "projetospotify-e06a3",
    storageBucket: "projetospotify-e06a3.firebasestorage.app",
    messagingSenderId: "120996325072",
    appId: "1:120996325072:web:9f9d1ecaf67ec9686ae0d5",
    measurementId: "G-Q3PJEKW8B6",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

setPersistence(auth, browserLocalPersistence).catch(console.warn);
