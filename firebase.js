// ============================================================================
// FIREBASE.JS — INICIALIZAÇÃO ÚNICA DOS SERVIÇOS FIREBASE
// ============================================================================
//
// Este módulo é carregado por app.js e storage.js. Sua função é inicializar o
// SDK apenas uma vez e exportar objetos reutilizáveis.
//
// `firebaseApp` -> instância base do projeto.
// `auth`        -> Firebase Authentication (login, cadastro e sessão).
// `db`          -> Cloud Firestore (catálogo, chunks, biblioteca e sugestões).
//
// A configuração abaixo identifica o projeto Web no Firebase. Ela não substitui
// regras de segurança: aplicações Web precisam entregar essa configuração ao
// navegador para que o SDK saiba a qual projeto se conectar.
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
    getAuth,
    setPersistence,
    browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Configuração pública do aplicativo Web no Firebase.
// Ela identifica qual projeto Firebase o navegador deve usar.
const firebaseConfig = {
    apiKey: "AIzaSyBEiPrY_xJTgoUAmFVW88Zy7YCDF9zaUho",
    authDomain: "projetospotify-e06a3.firebaseapp.com",
    projectId: "projetospotify-e06a3",
    storageBucket: "projetospotify-e06a3.firebasestorage.app",
    messagingSenderId: "120996325072",
    appId: "1:120996325072:web:9f9d1ecaf67ec9686ae0d5",
    measurementId: "G-Q3PJEKW8B6",
};

// initializeApp() cria a instância central do SDK. Como todos os outros módulos
// importam esta mesma exportação, não existe uma inicialização duplicada.
export const firebaseApp = initializeApp(firebaseConfig);
// getAuth() cria/recupera o serviço de autenticação associado ao firebaseApp.
export const auth = getAuth(firebaseApp);
// getFirestore() cria/recupera o cliente que executará queries e gravações.
export const db = getFirestore(firebaseApp);

// browserLocalPersistence pede ao Firebase Auth para guardar a sessão no
// armazenamento local do navegador. Assim, ao reabrir o RedBeat, o SDK tenta
// restaurar a conta e onAuthStateChanged() recebe o usuário sem novo login.
// Se o ambiente bloquear a persistência, o erro é registrado no console e o
// restante do app continua podendo funcionar durante a sessão atual.
setPersistence(auth, browserLocalPersistence).catch(console.warn);
