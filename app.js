// ============================================================
// 1. IMPORTS DO FIREBASE
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  getDoc,
  getDocs,
  Bytes,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";


// ============================================================
// 2. CONFIGURAÇÃO DO FIREBASE
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyBEiPrY_xJTgoUAmFVW88Zy7YCDF9zaUho",
  authDomain: "projetospotify-e06a3.firebaseapp.com",
  projectId: "projetospotify-e06a3",
  storageBucket: "projetospotify-e06a3.firebasestorage.app",
  messagingSenderId: "120996325072",
  appId: "1:120996325072:web:9f9d1ecaf67ec9686ae0d5",
  measurementId: "G-Q3PJEKW8B6",
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

setPersistence(auth, browserLocalPersistence).catch(console.warn);


// ============================================================
// 3. CONSTANTES DO APLICATIVO
// ============================================================

const CHUNK_SIZE = 480 * 1024;
const MAX_AUDIO_SIZE = 25 * 1024 * 1024;
const MAX_COVER_SIZE = 10 * 1024 * 1024;

const $ = (selector) => document.querySelector(selector);


// ============================================================
// 4. ELEMENTOS DA INTERFACE
// ============================================================

const audio = $("#audio");
const trackList = $("#trackList");
const libraryTrackList = $("#libraryTrackList");
const searchInput = $("#searchInput");
const audioFile = $("#audioFile");
const coverFile = $("#coverFile");

const uploadModal = $("#uploadModal");
const createPlaylistModal = $("#createPlaylistModal");
const trackActionsModal = $("#trackActionsModal");
const accountModal = $("#accountModal");

const uploadForm = $("#uploadForm");
const gateAuthForm = $("#gateAuthForm");

const playerTitle = $("#playerTitle");
const playerArtist = $("#playerArtist");
const playerCover = $("#playerCover");
const playerLike = $("#playerLike");
const playBtn = $("#playBtn");
const seekBar = $("#seekBar");
const volumeBar = $("#volumeBar");
const currentTime = $("#currentTime");
const duration = $("#duration");
const toast = $("#toast");

const dropzone = $("#dropzone");
const fileLabel = $("#fileLabel");
const coverPreview = $("#coverPreview");
const coverFileLabel = $("#coverFileLabel");


// ============================================================
// 5. ESTADO GLOBAL
// ============================================================

let tracks = [];
let visibleTracks = [];
let currentTrack = null;
let currentIndex = -1;

let playlists = [];
let savedTrackIds = new Set();
let activeView = "home";
let libraryMode = "overview";
let selectedPlaylist = null;

let currentLibraryTracks = [];
let selectedActionTrack = null;
let authMode = "login";
let repeat = false;
let shuffle = false;

let selectedDurationSeconds = 0;
let localCoverPreviewUrl = null;
let toastTimer = null;

let unsubscribeTracks = null;
let unsubscribeSaved = null;
let unsubscribePlaylists = null;

const coverUrlCache = new Map();
const audioUrlCache = new Map();
const assetLoading = new Map();
const migrationAttempted = new Set();

audio.volume = Number(volumeBar.value);


// ============================================================
// 6. UTILITÁRIOS GERAIS
// ============================================================

function safeText(value = "") {
  return String(value ?? "");
}

function escapeHtml(value) {
  return safeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(value = "R") {
  const text = safeText(value).trim();
  return text ? text[0].toUpperCase() : "R";
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function byteSizeLabel(bytes) {
  if (bytes < 1048576) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function showToast(message, type = "success") {
  toast.textContent = message;
  toast.className = `toast show${type === "error" ? " error" : ""}`;

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 3400);
}

function updateRange(input, percentage) {
  input.style.background = `linear-gradient(
    to right,
    #e50914 0%,
    #e50914 ${percentage}%,
    #393939 ${percentage}%,
    #393939 100%
  )`;
}

function isOwner(track) {
  return Boolean(auth.currentUser) && track.ownerId === auth.currentUser.uid;
}


// ============================================================
// 7. AUTENTICAÇÃO
// ============================================================

function friendlyAuthError(code = "") {
  const messages = {
    "auth/invalid-credential": "E-mail ou senha inválidos.",
    "auth/user-not-found": "Conta não encontrada.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/email-already-in-use": "Este e-mail já possui uma conta.",
    "auth/weak-password": "Use uma senha mais forte, com pelo menos 6 caracteres.",
    "auth/invalid-email": "Digite um e-mail válido.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde e tente novamente.",
    "auth/network-request-failed": "Falha de rede. Verifique sua conexão.",
    "auth/operation-not-allowed": "O login por e-mail/senha não está habilitado.",
  };

  return messages[code] || `Não foi possível autenticar (${code || "erro"}).`;
}

function setGateMode(mode) {
  authMode = mode;

  const login = mode === "login";

  $("#gateTitle").textContent = login
    ? "Entrar no RedBeat"
    : "Criar conta";

  $("#gateCopy").textContent = login
    ? "Entre com sua conta para acessar músicas, biblioteca e playlists."
    : "Crie sua conta para sincronizar sua biblioteca em todos os dispositivos.";

  $("#gateSubmit").textContent = login
    ? "Entrar"
    : "Criar conta";

  $("#gateToggle").textContent = login
    ? "Criar uma conta"
    : "Já tenho uma conta";

  $("#gatePassword").autocomplete = login
    ? "current-password"
    : "new-password";

  $("#gateError").classList.add("hidden");
}

async function ensureUserProfile(user) {
  await setDoc(
    doc(db, "users", user.uid),
    {
      email: user.email || "",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

function stopSubscriptions() {
  unsubscribeTracks?.();
  unsubscribeSaved?.();
  unsubscribePlaylists?.();

  unsubscribeTracks = null;
  unsubscribeSaved = null;
  unsubscribePlaylists = null;
}

function subscribeAccountData(user) {
  stopSubscriptions();

  const tracksQuery = query(
    collection(db, "tracks"),
    where("recordType", "==", "track"),
  );

  unsubscribeTracks = onSnapshot(
    tracksQuery,
    (snapshot) => {
      tracks = snapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .filter((track) => track.status !== "uploading")
        .sort(
          (a, b) =>
            (b.createdAt?.toMillis?.() || 0) -
            (a.createdAt?.toMillis?.() || 0),
        );

      renderHome();
      renderLibrary();
      refreshCurrentTrack();

      for (const track of tracks) {
        const hasLegacyChunks =
          Number(track.audioChunks || 0) > 0 ||
          Number(track.coverChunks || 0) > 0;

        if (
          isOwner(track) &&
          track.storageLayout !== "subcollections-v2" &&
          hasLegacyChunks
        ) {
          migrateLegacyTrack(track);
        }
      }
    },
    (error) => {
      console.error(error);
      showToast("Não foi possível carregar as músicas.", "error");
    },
  );

  unsubscribeSaved = onSnapshot(
    collection(db, "users", user.uid, "savedTracks"),
    (snapshot) => {
      savedTrackIds = new Set(snapshot.docs.map((document) => document.id));

      renderHome();
      renderLibrary();
      updatePlayerUI();
    },
  );

  unsubscribePlaylists = onSnapshot(
    collection(db, "users", user.uid, "playlists"),
    (snapshot) => {
      playlists = snapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .sort(
          (a, b) =>
            (b.createdAt?.toMillis?.() || 0) -
            (a.createdAt?.toMillis?.() || 0),
        );

      renderLibrary();
    },
  );
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      await ensureUserProfile(user);
    } catch (error) {
      console.warn(error);
    }

    $("#authGate").classList.add("hidden");
    $("#appRoot").classList.remove("hidden");

    const name = user.email?.split("@")[0] || "Usuário";

    $("#profileLabel").textContent = name;
    $("#avatar").textContent = initials(name);
    $("#accountEmail").textContent = user.email || "Usuário";

    subscribeAccountData(user);
    return;
  }

  stopSubscriptions();

  tracks = [];
  playlists = [];
  savedTrackIds.clear();

  audio.pause();
  audio.removeAttribute("src");
  currentTrack = null;

  $("#appRoot").classList.add("hidden");
  $("#authGate").classList.remove("hidden");

  setGateMode("login");
});

gateAuthForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("#gateEmail").value.trim();
  const password = $("#gatePassword").value;
  const errorBox = $("#gateError");
  const submit = $("#gateSubmit");

  errorBox.classList.add("hidden");
  submit.disabled = true;

  try {
    if (authMode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }

    gateAuthForm.reset();
  } catch (error) {
    console.error(error);

    errorBox.textContent = friendlyAuthError(error.code);
    errorBox.classList.remove("hidden");
  } finally {
    submit.disabled = false;
    submit.textContent = authMode === "login" ? "Entrar" : "Criar conta";
  }
});

$("#gateToggle").addEventListener("click", () => {
  setGateMode(authMode === "login" ? "register" : "login");
});

$("#logoutBtn").addEventListener("click", async () => {
  accountModal.close();
  await signOut(auth);
});

$("#profileBtn").addEventListener("click", () => {
  accountModal.showModal();
});


// ============================================================
// 8. PROCESSAMENTO DE ÁUDIO E CAPA
// ============================================================

function readAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const audioElement = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      audioElement.removeAttribute("src");
      audioElement.load();
    };

    audioElement.preload = "metadata";

    audioElement.addEventListener(
      "loadedmetadata",
      () => {
        const seconds = Math.round(audioElement.duration);
        cleanup();

        if (Number.isFinite(seconds) && seconds > 0) {
          resolve(seconds);
        } else {
          reject(new Error("duration"));
        }
      },
      { once: true },
    );

    audioElement.addEventListener(
      "error",
      () => {
        cleanup();
        reject(new Error("metadata"));
      },
      { once: true },
    );

    audioElement.src = objectUrl;
  });
}

async function gzipBlob(blob) {
  if ("CompressionStream" in globalThis) {
    const stream = blob
      .stream()
      .pipeThrough(new CompressionStream("gzip"));

    return new Uint8Array(
      await new Response(stream).arrayBuffer(),
    );
  }

  const { gzip } = await import(
    "https://cdn.jsdelivr.net/npm/pako@2.1.0/+esm"
  );

  return gzip(
    new Uint8Array(await blob.arrayBuffer()),
  );
}

async function gunzipBytes(bytes) {
  if ("DecompressionStream" in globalThis) {
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));

    return new Uint8Array(
      await new Response(stream).arrayBuffer(),
    );
  }

  const { ungzip } = await import(
    "https://cdn.jsdelivr.net/npm/pako@2.1.0/+esm"
  );

  return ungzip(bytes);
}

async function optimizeCover(file) {
  let source = null;
  let cleanup = () => {};

  if ("createImageBitmap" in globalThis) {
    const bitmap = await createImageBitmap(file);

    source = {
      width: bitmap.width,
      height: bitmap.height,
      draw: (context, width, height) => {
        context.drawImage(bitmap, 0, 0, width, height);
      },
    };

    cleanup = () => bitmap.close?.();
  } else {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.src = objectUrl;
    await image.decode();

    source = {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (context, width, height) => {
        context.drawImage(image, 0, 0, width, height);
      },
    };

    cleanup = () => URL.revokeObjectURL(objectUrl);
  }

  try {
    const maxSide = 720;
    const ratio = Math.min(
      1,
      maxSide / Math.max(source.width, source.height),
    );

    const width = Math.max(
      1,
      Math.round(source.width * ratio),
    );

    const height = Math.max(
      1,
      Math.round(source.height * ratio),
    );

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", {
      alpha: false,
    });

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    source.draw(context, width, height);

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("cover"));
          }
        },
        "image/webp",
        0.78,
      );
    });
  } finally {
    cleanup();
  }
}


// ============================================================
// 9. CHUNKS E ARQUIVOS NO FIRESTORE
// ============================================================

function splitBytes(bytes) {
  const chunks = [];

  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += CHUNK_SIZE
  ) {
    chunks.push(
      bytes.slice(
        offset,
        Math.min(offset + CHUNK_SIZE, bytes.byteLength),
      ),
    );
  }

  return chunks;
}

async function writeSubcollectionChunks(
  trackRef,
  name,
  bytes,
  onBytes,
) {
  const chunks = splitBytes(bytes);
  const chunksCollection = collection(trackRef, name);

  for (
    let start = 0;
    start < chunks.length;
    start += 6
  ) {
    const batch = writeBatch(db);
    let batchBytes = 0;

    for (
      let index = start;
      index < Math.min(start + 6, chunks.length);
      index++
    ) {
      const chunk = chunks[index];
      const chunkRef = doc(
        chunksCollection,
        String(index).padStart(6, "0"),
      );

      batch.set(chunkRef, {
        index,
        byteLength: chunk.byteLength,
        data: Bytes.fromUint8Array(chunk),
      });

      batchBytes += chunk.byteLength;
    }

    await batch.commit();
    onBytes?.(batchBytes);
  }

  return chunks.length;
}

async function readSubcollectionChunks(track, type) {
  const collectionName = type === "audio"
    ? "audioChunks"
    : "coverChunks";

  const chunksCollection = collection(
    db,
    "tracks",
    track.id,
    collectionName,
  );

  const snapshot = await getDocs(
    query(chunksCollection, orderBy("index", "asc")),
  );

  if (snapshot.empty) {
    throw new Error(`Sem blocos ${type}`);
  }

  const chunks = snapshot.docs.map((document) =>
    document.data().data.toUint8Array(),
  );

  const total = chunks.reduce(
    (sum, chunk) => sum + chunk.byteLength,
    0,
  );

  const result = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function legacyChunkRef(trackId, type, index) {
  const typeCode = type === "audio" ? "a" : "c";
  const chunkId = String(index).padStart(6, "0");

  return doc(
    db,
    "tracks",
    `${trackId}__${typeCode}__${chunkId}`,
  );
}

async function readLegacyChunks(track, type) {
  const count = Number(
    type === "audio"
      ? track.audioChunks
      : track.coverChunks,
  ) || 0;

  if (!count) {
    throw new Error("Sem blocos antigos");
  }

  const chunks = [];

  for (let index = 0; index < count; index++) {
    const snapshot = await getDoc(
      legacyChunkRef(track.id, type, index),
    );

    if (!snapshot.exists()) {
      throw new Error("Bloco antigo ausente");
    }

    chunks.push(
      snapshot.data().data.toUint8Array(),
    );
  }

  const total = chunks.reduce(
    (sum, chunk) => sum + chunk.byteLength,
    0,
  );

  const result = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

async function readStoredBytes(track, type) {
  if (track.storageLayout === "subcollections-v2") {
    return readSubcollectionChunks(track, type);
  }

  return readLegacyChunks(track, type);
}

async function buildAssetUrl(track, type) {
  const key = `${type}:${track.id}`;
  const cache = type === "audio"
    ? audioUrlCache
    : coverUrlCache;

  if (cache.has(track.id)) {
    return cache.get(track.id);
  }

  if (assetLoading.has(key)) {
    return assetLoading.get(key);
  }

  const promise = (async () => {
    const stored = await readStoredBytes(track, type);

    const compression = type === "audio"
      ? track.audioCompression
      : track.coverCompression;

    const raw = compression === "gzip"
      ? await gunzipBytes(stored)
      : stored;

    const mime = type === "audio"
      ? track.audioMime || "audio/mpeg"
      : track.coverMime || "image/webp";

    const url = URL.createObjectURL(
      new Blob([raw], { type: mime }),
    );

    cache.set(track.id, url);
    return url;
  })();

  assetLoading.set(key, promise);

  try {
    return await promise;
  } finally {
    assetLoading.delete(key);
  }
}

async function deleteSubcollection(trackRef, name) {
  const snapshot = await getDocs(
    collection(trackRef, name),
  );

  for (
    let start = 0;
    start < snapshot.docs.length;
    start += 300
  ) {
    const batch = writeBatch(db);

    for (const document of snapshot.docs.slice(start, start + 300)) {
      batch.delete(document.ref);
    }

    await batch.commit();
  }
}

async function migrateLegacyTrack(track) {
  if (
    migrationAttempted.has(track.id) ||
    track.storageLayout === "subcollections-v2"
  ) {
    return;
  }

  migrationAttempted.add(track.id);

  try {
    const legacy = await getDocs(
      query(
        collection(db, "tracks"),
        where("parentTrackId", "==", track.id),
      ),
    );

    if (legacy.empty) {
      return;
    }

    for (
      let start = 0;
      start < legacy.docs.length;
      start += 150
    ) {
      const batch = writeBatch(db);

      for (const document of legacy.docs.slice(start, start + 150)) {
        const chunk = document.data();
        const subcollection = chunk.chunkType === "cover"
          ? "coverChunks"
          : "audioChunks";

        const target = doc(
          db,
          "tracks",
          track.id,
          subcollection,
          String(Number(chunk.index) || 0).padStart(6, "0"),
        );

        batch.set(target, {
          index: Number(chunk.index) || 0,
          byteLength: Number(chunk.byteLength) || 0,
          data: chunk.data,
        });

        batch.delete(document.ref);
      }

      await batch.commit();
    }

    await updateDoc(
      doc(db, "tracks", track.id),
      {
        storageLayout: "subcollections-v2",
        migratedAt: serverTimestamp(),
      },
    );

    showToast(`Dados de “${track.title}” organizados.`);
  } catch (error) {
    console.warn("Migração antiga ignorada:", error);
  }
}


// ============================================================
// 10. CAPAS, LISTAS E RENDERIZAÇÃO
// ============================================================

async function hydrateCover(track, container) {
  if (!track) {
    return;
  }

  try {
    const url = await buildAssetUrl(track, "cover");
    const element = container.querySelector(
      `[data-cover-id="${CSS.escape(track.id)}"]`,
    );

    if (element) {
      element.textContent = "";
      element.style.backgroundImage = `url("${url}")`;
    }
  } catch (error) {
    console.warn(error);
  }
}

async function hydrateListCovers(list, container) {
  for (const track of list) {
    hydrateCover(track, container);
  }
}

function getHomeTracks() {
  const term = searchInput.value
    .trim()
    .toLowerCase();

  return tracks.filter((track) => {
    if (!term) {
      return true;
    }

    return [
      track.title,
      track.artist,
      track.album,
      track.genre,
    ].some((value) =>
      safeText(value)
        .toLowerCase()
        .includes(term),
    );
  });
}

function trackRows(list, context = "home") {
  if (!list.length) {
    const message = context === "home"
      ? "Adicione a primeira música do catálogo."
      : "Adicione músicas à sua biblioteca ou playlist.";

    return `
      <div class="empty-state">
        <div class="empty-icon">♫</div>
        <h2>Nenhuma música aqui</h2>
        <p>${message}</p>
      </div>
    `;
  }

  return list
    .map((track, index) => {
      const isCurrent = currentTrack?.id === track.id;
      const isSaved = savedTrackIds.has(track.id);
      const playIcon = isCurrent && !audio.paused
        ? "Ⅱ"
        : "▶";

      return `
        <article
          class="track-row ${isCurrent ? "active" : ""}"
          data-id="${track.id}"
          data-context="${context}"
        >
          <div class="track-index">
            <span class="row-index">${index + 1}</span>
            <button class="row-play" data-action="play">${playIcon}</button>
          </div>

          <div class="title-cell">
            <div class="cover" data-cover-id="${track.id}">
              ${initials(track.title)}
            </div>

            <div class="title-stack">
              <strong>${escapeHtml(track.title)}</strong>
              <span>${escapeHtml(track.artist)}</span>
            </div>
          </div>

          <span class="album-cell">${escapeHtml(track.album || "-")}</span>
          <span class="genre-cell">${escapeHtml(track.genre || "-")}</span>
          <span class="duration-cell">
            ${escapeHtml(
              track.durationFormatted ||
              formatTime(Number(track.duration) || 0),
            )}
          </span>

          <button
            class="row-like ${isSaved ? "liked" : ""}"
            data-action="save"
            aria-label="Salvar"
          >
            ${isSaved ? "♥" : "♡"}
          </button>

          <button class="row-menu" data-action="menu">⋯</button>
        </article>
      `;
    })
    .join("");
}

function renderHome() {
  visibleTracks = getHomeTracks();

  $("#trackCount").textContent = `${visibleTracks.length} ${
    visibleTracks.length === 1 ? "música" : "músicas"
  }`;

  trackList.innerHTML = trackRows(
    visibleTracks,
    "home",
  );

  hydrateListCovers(
    visibleTracks,
    trackList,
  );

  syncCurrentIndex();
}

function renderLibrary() {
  $("#savedCount").textContent = `${savedTrackIds.size} ${
    savedTrackIds.size === 1 ? "música" : "músicas"
  }`;

  $("#playlistGrid").innerHTML = playlists
    .map((playlist) => `
      <div
        class="playlist-card-wrap"
        data-playlist-id="${playlist.id}"
      >
        <button
          class="playlist-card"
          data-action="open-playlist"
        >
          <span class="playlist-cover">♫</span>
          <strong>${escapeHtml(playlist.name || "Playlist")}</strong>
          <small>Playlist</small>
        </button>

        <button
          class="playlist-delete"
          data-action="delete-playlist"
          title="Excluir playlist"
        >
          ×
        </button>
      </div>
    `)
    .join("");

  if (
    activeView === "library" &&
    libraryMode !== "overview"
  ) {
    renderLibraryDetail();
  }
}

function renderLibraryDetail() {
  let list = [];

  if (libraryMode === "saved") {
    $("#libraryDetailTitle").textContent = "Músicas salvas";

    list = tracks.filter((track) =>
      savedTrackIds.has(track.id),
    );
  } else if (
    libraryMode === "playlist" &&
    selectedPlaylist
  ) {
    $("#libraryDetailTitle").textContent =
      selectedPlaylist.name || "Playlist";

    list = currentLibraryTracks;
  }

  libraryTrackList.innerHTML = trackRows(
    list,
    libraryMode,
  );

  hydrateListCovers(
    list,
    libraryTrackList,
  );
}

function refreshCurrentTrack() {
  if (!currentTrack) {
    return;
  }

  const freshTrack = tracks.find(
    (track) => track.id === currentTrack.id,
  );

  if (freshTrack) {
    currentTrack = freshTrack;
  }

  updatePlayerUI();
}

function syncCurrentIndex() {
  let list;

  if (activeView === "home") {
    list = visibleTracks;
  } else if (libraryMode === "saved") {
    list = tracks.filter((track) =>
      savedTrackIds.has(track.id),
    );
  } else {
    list = currentLibraryTracks;
  }

  currentIndex = list.findIndex(
    (track) => track.id === currentTrack?.id,
  );
}


// ============================================================
// 11. BIBLIOTECA E PLAYLISTS
// ============================================================

async function toggleSaved(track) {
  const user = auth.currentUser;

  if (!user) {
    return;
  }

  const savedRef = doc(
    db,
    "users",
    user.uid,
    "savedTracks",
    track.id,
  );

  if (savedTrackIds.has(track.id)) {
    await deleteDoc(savedRef);
  } else {
    await setDoc(savedRef, {
      trackId: track.id,
      savedAt: serverTimestamp(),
    });
  }
}

async function createPlaylist(name) {
  const user = auth.currentUser;

  if (!user) {
    return;
  }

  const playlistRef = doc(
    collection(
      db,
      "users",
      user.uid,
      "playlists",
    ),
  );

  await setDoc(playlistRef, {
    name,
    ownerId: user.uid,
    createdAt: serverTimestamp(),
  });

  return playlistRef.id;
}

async function deletePlaylist(id) {
  const user = auth.currentUser;

  if (!user) {
    return;
  }

  const items = await getDocs(
    collection(
      db,
      "users",
      user.uid,
      "playlists",
      id,
      "items",
    ),
  );

  for (
    let start = 0;
    start < items.docs.length;
    start += 300
  ) {
    const batch = writeBatch(db);

    for (const document of items.docs.slice(start, start + 300)) {
      batch.delete(document.ref);
    }

    await batch.commit();
  }

  await deleteDoc(
    doc(
      db,
      "users",
      user.uid,
      "playlists",
      id,
    ),
  );

  if (selectedPlaylist?.id === id) {
    libraryMode = "overview";
    selectedPlaylist = null;
    showLibraryOverview();
  }
}

async function addToPlaylist(track, playlist) {
  const user = auth.currentUser;

  if (!user) {
    return;
  }

  await setDoc(
    doc(
      db,
      "users",
      user.uid,
      "playlists",
      playlist.id,
      "items",
      track.id,
    ),
    {
      trackId: track.id,
      addedAt: serverTimestamp(),
    },
  );

  showToast(`Adicionada a “${playlist.name}”.`);

  if (selectedPlaylist?.id === playlist.id) {
    await loadPlaylist(playlist);
  }
}

async function loadPlaylist(playlist) {
  const user = auth.currentUser;

  if (!user) {
    return;
  }

  selectedPlaylist = playlist;

  const snapshot = await getDocs(
    collection(
      db,
      "users",
      user.uid,
      "playlists",
      playlist.id,
      "items",
    ),
  );

  const ids = new Set(
    snapshot.docs.map((document) => document.id),
  );

  currentLibraryTracks = tracks.filter((track) =>
    ids.has(track.id),
  );

  libraryMode = "playlist";
  showLibraryDetail();
}


// ============================================================
// 12. NAVEGAÇÃO ENTRE TELAS
// ============================================================

function setView(view) {
  activeView = view;

  $("#homeView").classList.toggle(
    "hidden",
    view !== "home",
  );

  $("#libraryView").classList.toggle(
    "hidden",
    view !== "library",
  );

  $("#showHome").classList.toggle(
    "active",
    view === "home",
  );

  $("#showLibrary").classList.toggle(
    "active",
    view === "library",
  );

  $("#searchBox").classList.toggle(
    "hidden",
    view !== "home",
  );

  if (view === "home") {
    renderHome();
  } else {
    renderLibrary();
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

function showLibraryOverview() {
  $("#libraryOverview").classList.remove("hidden");
  $("#libraryDetail").classList.add("hidden");

  libraryMode = "overview";
  renderLibrary();
}

function showLibraryDetail() {
  $("#libraryOverview").classList.add("hidden");
  $("#libraryDetail").classList.remove("hidden");

  renderLibraryDetail();
}

$("#showHome").addEventListener("click", () => {
  setView("home");
});

$("#brandHome").addEventListener("click", (event) => {
  event.preventDefault();
  setView("home");
});

$("#showLibrary").addEventListener("click", () => {
  setView("library");
  showLibraryOverview();
});

$("#backLibrary").addEventListener(
  "click",
  showLibraryOverview,
);

$("#openSavedTracks").addEventListener("click", () => {
  libraryMode = "saved";
  showLibraryDetail();
});

searchInput.addEventListener("input", renderHome);


// ============================================================
// 13. EVENTOS DE PLAYLISTS
// ============================================================

$("#openCreatePlaylist").addEventListener("click", () => {
  createPlaylistModal.showModal();
});

$("#createPlaylistForm").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const name = $("#playlistName").value.trim();

    if (!name) {
      return;
    }

    try {
      await createPlaylist(name);

      event.currentTarget.reset();
      createPlaylistModal.close();

      showToast("Playlist criada.");
    } catch (error) {
      console.error(error);
      showToast("Não foi possível criar a playlist.", "error");
    }
  },
);

$("#playlistGrid").addEventListener("click", async (event) => {
  const wrapper = event.target.closest(
    "[data-playlist-id]",
  );

  if (!wrapper) {
    return;
  }

  const playlist = playlists.find(
    (item) => item.id === wrapper.dataset.playlistId,
  );

  if (!playlist) {
    return;
  }

  const action = event.target.closest(
    "[data-action]",
  )?.dataset.action;

  if (action === "delete-playlist") {
    if (confirm(`Excluir a playlist “${playlist.name}”?`)) {
      await deletePlaylist(playlist.id);
    }
  } else if (action === "open-playlist") {
    await loadPlaylist(playlist);
  }
});


// ============================================================
// 14. AÇÕES DAS MÚSICAS
// ============================================================

function openTrackActions(track) {
  selectedActionTrack = track;

  $("#actionTrackTitle").textContent = track.title;

  $("#actionSaveTrack").textContent = savedTrackIds.has(track.id)
    ? "Remover da biblioteca"
    : "Salvar na biblioteca";

  $("#actionDeleteTrack").classList.toggle(
    "hidden",
    !isOwner(track),
  );

  $("#actionPlaylistList").innerHTML = playlists.length
    ? playlists
        .map(
          (playlist) => `
            <button
              class="action-item"
              data-playlist-id="${playlist.id}"
            >
              ${escapeHtml(playlist.name)}
            </button>
          `,
        )
        .join("")
    : '<small style="color:#888">Crie uma playlist na Biblioteca.</small>';

  trackActionsModal.showModal();
}

$("#actionSaveTrack").addEventListener("click", async () => {
  if (!selectedActionTrack) {
    return;
  }

  await toggleSaved(selectedActionTrack);
  trackActionsModal.close();
});

$("#actionPlaylistList").addEventListener(
  "click",
  async (event) => {
    const button = event.target.closest(
      "[data-playlist-id]",
    );

    if (!button || !selectedActionTrack) {
      return;
    }

    const playlist = playlists.find(
      (item) => item.id === button.dataset.playlistId,
    );

    if (playlist) {
      await addToPlaylist(
        selectedActionTrack,
        playlist,
      );

      trackActionsModal.close();
    }
  },
);

$("#actionDeleteTrack").addEventListener("click", async () => {
  if (selectedActionTrack) {
    trackActionsModal.close();
    await deleteTrack(selectedActionTrack);
  }
});

function listClickHandler(event) {
  const row = event.target.closest(".track-row");

  if (!row) {
    return;
  }

  const track = tracks.find(
    (item) => item.id === row.dataset.id,
  );

  if (!track) {
    return;
  }

  const action = event.target.closest(
    "[data-action]",
  )?.dataset.action;

  if (action === "save") {
    toggleSaved(track).catch((error) => {
      console.error(error);
      showToast("Não foi possível salvar.", "error");
    });

    return;
  }

  if (action === "menu") {
    openTrackActions(track);
    return;
  }

  if (action === "play") {
    if (
      currentTrack?.id === track.id &&
      !audio.paused
    ) {
      audio.pause();
    } else {
      playTrack(track);
    }

    return;
  }

  if (!action) {
    playTrack(track);
  }
}

trackList.addEventListener(
  "click",
  listClickHandler,
);

libraryTrackList.addEventListener(
  "click",
  listClickHandler,
);


// ============================================================
// 15. UPLOAD DE MÚSICA
// ============================================================

$("#openUpload").addEventListener("click", () => {
  uploadModal.showModal();
});

audioFile.addEventListener("change", async () => {
  const file = audioFile.files?.[0];

  fileLabel.textContent = file
    ? file.name
    : "Clique ou arraste um arquivo de áudio";

  selectedDurationSeconds = 0;

  $("#trackDuration").value = file
    ? "Lendo duração…"
    : "Selecione um arquivo";

  if (file && !$("#trackTitle").value) {
    $("#trackTitle").value = file.name.replace(
      /\.[^/.]+$/,
      "",
    );
  }

  if (!file) {
    return;
  }

  try {
    selectedDurationSeconds = await readAudioDuration(file);
    $("#trackDuration").value = formatTime(selectedDurationSeconds);
  } catch (error) {
    console.error(error);
    $("#trackDuration").value = "Não identificada";
  }
});

coverFile.addEventListener("change", () => {
  const file = coverFile.files?.[0];

  if (localCoverPreviewUrl) {
    URL.revokeObjectURL(localCoverPreviewUrl);
  }

  if (!file) {
    coverPreview.style.backgroundImage = "";
    coverPreview.textContent = "▧";
    coverFileLabel.textContent = "Selecionar capa do álbum";
    return;
  }

  localCoverPreviewUrl = URL.createObjectURL(file);

  coverPreview.textContent = "";
  coverPreview.style.backgroundImage = `url("${localCoverPreviewUrl}")`;
  coverFileLabel.textContent = file.name;
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  });
});

dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files?.[0];

  if (!file) {
    return;
  }

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);

  audioFile.files = dataTransfer.files;
  audioFile.dispatchEvent(new Event("change"));
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const user = auth.currentUser;
  const music = audioFile.files?.[0];
  const image = coverFile.files?.[0];

  const title = $("#trackTitle").value.trim();
  const artist = $("#trackArtist").value.trim();
  const album = $("#trackAlbum").value.trim();
  const genre = $("#trackGenre").value.trim();

  if (
    !user ||
    !music ||
    !image ||
    !title ||
    !artist ||
    !album ||
    !genre
  ) {
    showToast(
      "Preencha todos os dados e selecione áudio e capa.",
      "error",
    );
    return;
  }

  if (
    music.size > MAX_AUDIO_SIZE ||
    image.size > MAX_COVER_SIZE
  ) {
    showToast(
      "Arquivo acima do limite permitido.",
      "error",
    );
    return;
  }

  if (!selectedDurationSeconds) {
    try {
      selectedDurationSeconds = await readAudioDuration(music);
    } catch {
      showToast(
        "Não foi possível ler a duração.",
        "error",
      );
      return;
    }
  }

  const submit = $("#uploadSubmit");
  const wrapper = $("#uploadProgressWrap");
  const bar = wrapper.querySelector(".upload-progress-bar");
  const progress = $("#uploadProgress");
  const progressText = $("#uploadProgressText");
  const trackRef = doc(collection(db, "tracks"));

  submit.disabled = true;
  submit.textContent = "Adicionando…";

  wrapper.classList.remove("hidden");
  bar.classList.add("pending");

  let created = false;

  try {
    progressText.textContent = "Otimizando capa…";
    const cover = await optimizeCover(image);

    progressText.textContent = "Comprimindo arquivos…";

    const [coverGzip, audioGzip] = await Promise.all([
      gzipBlob(cover),
      gzipBlob(music),
    ]);

    await setDoc(trackRef, {
      title,
      artist,
      album,
      genre,
      duration: selectedDurationSeconds,
      durationFormatted: formatTime(selectedDurationSeconds),
      ownerId: user.uid,
      ownerEmail: user.email || "",
      recordType: "track",
      status: "uploading",
      storageLayout: "subcollections-v2",
      audioMime: music.type || "audio/mpeg",
      audioCompression: "gzip",
      audioOriginalSize: music.size,
      audioCompressedSize: audioGzip.byteLength,
      coverMime: cover.type || "image/webp",
      coverCompression: "gzip",
      coverOriginalSize: image.size,
      coverOptimizedSize: cover.size,
      coverCompressedSize: coverGzip.byteLength,
      createdAt: serverTimestamp(),
    });

    created = true;

    const total = coverGzip.byteLength + audioGzip.byteLength;
    let done = 0;

    const report = (bytes) => {
      done += bytes;

      const percentage = Math.min(
        99,
        Math.round((done / total) * 100),
      );

      bar.classList.remove("pending");
      progress.style.width = `${percentage}%`;
      progressText.textContent =
        `Salvando… ${percentage}% • ${byteSizeLabel(done)} de ${byteSizeLabel(total)}`;
    };

    const coverCount = await writeSubcollectionChunks(
      trackRef,
      "coverChunks",
      coverGzip,
      report,
    );

    const audioCount = await writeSubcollectionChunks(
      trackRef,
      "audioChunks",
      audioGzip,
      report,
    );

    await updateDoc(trackRef, {
      coverChunkCount: coverCount,
      audioChunkCount: audioCount,
      status: "ready",
      updatedAt: serverTimestamp(),
    });

    progress.style.width = "100%";
    progressText.textContent = "Música adicionada.";

    showToast("Música adicionada.");

    uploadForm.reset();
    selectedDurationSeconds = 0;

    $("#trackDuration").value = "Selecione um arquivo";
    fileLabel.textContent = "Clique ou arraste um arquivo de áudio";
    coverFileLabel.textContent = "Selecionar capa do álbum";
    coverPreview.style.backgroundImage = "";
    coverPreview.textContent = "▧";

    if (localCoverPreviewUrl) {
      URL.revokeObjectURL(localCoverPreviewUrl);
      localCoverPreviewUrl = null;
    }

    setTimeout(() => {
      wrapper.classList.add("hidden");
      bar.classList.remove("pending");
      progress.style.width = "0%";
      uploadModal.close();
    }, 300);
  } catch (error) {
    console.error(error);

    if (created) {
      try {
        await deleteSubcollection(trackRef, "audioChunks");
        await deleteSubcollection(trackRef, "coverChunks");
        await deleteDoc(trackRef);
      } catch (cleanupError) {
        console.warn(cleanupError);
      }
    }

    bar.classList.remove("pending");
    progressText.textContent = `Falha (${error.code || "erro"}).`;

    showToast(
      `Não foi possível adicionar (${error.code || "erro"}).`,
      "error",
    );
  } finally {
    submit.disabled = false;
    submit.textContent = "Adicionar música";
  }
});

async function deleteTrack(track) {
  if (
    !isOwner(track) ||
    !confirm(`Excluir “${track.title}”?`)
  ) {
    return;
  }

  const trackRef = doc(
    db,
    "tracks",
    track.id,
  );

  try {
    if (track.storageLayout === "subcollections-v2") {
      await deleteSubcollection(
        trackRef,
        "audioChunks",
      );

      await deleteSubcollection(
        trackRef,
        "coverChunks",
      );
    } else {
      const legacy = await getDocs(
        query(
          collection(db, "tracks"),
          where("parentTrackId", "==", track.id),
        ),
      );

      for (
        let start = 0;
        start < legacy.docs.length;
        start += 300
      ) {
        const batch = writeBatch(db);

        for (const document of legacy.docs.slice(start, start + 300)) {
          batch.delete(document.ref);
        }

        await batch.commit();
      }
    }

    await deleteDoc(trackRef);

    audioUrlCache.delete(track.id);
    coverUrlCache.delete(track.id);

    showToast("Música excluída.");
  } catch (error) {
    console.error(error);
    showToast("Não foi possível excluir.", "error");
  }
}


// ============================================================
// 16. PLAYER DE ÁUDIO
// ============================================================

async function playTrack(track) {
  currentTrack = track;

  updatePlayerUI();
  renderHome();
  renderLibraryDetail();

  try {
    showToast("Preparando música…");

    const source =
      track.audioUrl && track.audioUrl !== "firestore-chunks"
        ? track.audioUrl
        : await buildAssetUrl(track, "audio");

    if (currentTrack?.id !== track.id) {
      return;
    }

    audio.src = source;
    audio.load();

    await audio.play();
    await updateMediaSession(track);
  } catch (error) {
    console.error(error);
    showToast("Não foi possível abrir esta música.", "error");
  }
}

async function updateMediaSession(track) {
  if (!("mediaSession" in navigator)) {
    return;
  }

  let artwork = [];

  try {
    const cover = await buildAssetUrl(track, "cover");

    artwork = [
      {
        src: cover,
        type: track.coverMime || "image/webp",
      },
    ];
  } catch {
    // A música continua funcionando mesmo sem a capa na Media Session.
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork,
  });
}

function currentPlaybackList() {
  if (activeView === "home") {
    return visibleTracks.length
      ? visibleTracks
      : tracks;
  }

  if (libraryMode === "saved") {
    return tracks.filter((track) =>
      savedTrackIds.has(track.id),
    );
  }

  if (libraryMode === "playlist") {
    return currentLibraryTracks;
  }

  return tracks;
}

function togglePlayback() {
  if (!currentTrack) {
    const first = currentPlaybackList()[0];

    if (first) {
      playTrack(first);
    }

    return;
  }

  if (audio.paused) {
    audio.play().catch(console.error);
  } else {
    audio.pause();
  }
}

function nextTrack() {
  const list = currentPlaybackList();

  if (!list.length) {
    return;
  }

  let index = list.findIndex(
    (track) => track.id === currentTrack?.id,
  );

  if (shuffle && list.length > 1) {
    let randomIndex;

    do {
      randomIndex = Math.floor(
        Math.random() * list.length,
      );
    } while (
      list[randomIndex].id === currentTrack?.id
    );

    playTrack(list[randomIndex]);
    return;
  }

  index = index < 0
    ? 0
    : (index + 1) % list.length;

  playTrack(list[index]);
}

function prevTrack() {
  const list = currentPlaybackList();

  if (!list.length) {
    return;
  }

  let index = list.findIndex(
    (track) => track.id === currentTrack?.id,
  );

  index = index <= 0
    ? list.length - 1
    : index - 1;

  playTrack(list[index]);
}

function updatePlayerUI() {
  if (!currentTrack) {
    playerTitle.textContent = "Nenhuma música";
    playerArtist.textContent = "Escolha uma faixa";
    playerCover.style.backgroundImage = "";
    playerCover.textContent = "R";
    playerLike.textContent = "♡";
    playerLike.classList.remove("liked");
    playBtn.textContent = "▶";
    return;
  }

  playerTitle.textContent = currentTrack.title;
  playerArtist.textContent = currentTrack.artist;

  const isSaved = savedTrackIds.has(currentTrack.id);

  playerLike.textContent = isSaved ? "♥" : "♡";
  playerLike.classList.toggle("liked", isSaved);
  playBtn.textContent = audio.paused ? "▶" : "Ⅱ";

  const cachedCover = coverUrlCache.get(currentTrack.id);

  if (cachedCover) {
    playerCover.textContent = "";
    playerCover.style.backgroundImage = `url("${cachedCover}")`;
    return;
  }

  playerCover.style.backgroundImage = "";
  playerCover.textContent = initials(currentTrack.title);

  buildAssetUrl(currentTrack, "cover")
    .then((url) => {
      if (currentTrack) {
        playerCover.textContent = "";
        playerCover.style.backgroundImage = `url("${url}")`;
      }
    })
    .catch(console.warn);
}

playBtn.addEventListener(
  "click",
  togglePlayback,
);

$("#nextBtn").addEventListener(
  "click",
  nextTrack,
);

$("#prevBtn").addEventListener(
  "click",
  prevTrack,
);

$("#shuffleBtn").addEventListener("click", (event) => {
  shuffle = !shuffle;
  event.currentTarget.classList.toggle("active", shuffle);
});

$("#repeatBtn").addEventListener("click", (event) => {
  repeat = !repeat;
  event.currentTarget.classList.toggle("active", repeat);
});

playerLike.addEventListener("click", () => {
  if (currentTrack) {
    toggleSaved(currentTrack);
  }
});

audio.addEventListener("play", () => {
  updatePlayerUI();
  renderHome();
  renderLibraryDetail();

  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = "playing";
  }
});

audio.addEventListener("pause", () => {
  updatePlayerUI();
  renderHome();
  renderLibraryDetail();

  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = "paused";
  }
});

audio.addEventListener("loadedmetadata", () => {
  duration.textContent = formatTime(audio.duration);
});

audio.addEventListener("timeupdate", () => {
  currentTime.textContent = formatTime(audio.currentTime);

  const percentage = audio.duration
    ? (audio.currentTime / audio.duration) * 100
    : 0;

  seekBar.value = percentage;
  updateRange(seekBar, percentage);

  if (
    "mediaSession" in navigator &&
    Number.isFinite(audio.duration) &&
    audio.duration > 0
  ) {
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate,
        position: Math.min(
          audio.currentTime,
          audio.duration,
        ),
      });
    } catch {
      // Alguns navegadores não implementam setPositionState por completo.
    }
  }
});

audio.addEventListener("ended", () => {
  if (repeat) {
    audio.currentTime = 0;
    audio.play();
  } else {
    nextTrack();
  }
});

seekBar.addEventListener("input", () => {
  if (audio.duration) {
    audio.currentTime =
      (Number(seekBar.value) / 100) * audio.duration;
  }
});

volumeBar.addEventListener("input", () => {
  audio.volume = Number(volumeBar.value);
  updateRange(volumeBar, audio.volume * 100);
});

updateRange(
  volumeBar,
  audio.volume * 100,
);

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler(
    "play",
    () => audio.play(),
  );

  navigator.mediaSession.setActionHandler(
    "pause",
    () => audio.pause(),
  );

  navigator.mediaSession.setActionHandler(
    "previoustrack",
    prevTrack,
  );

  navigator.mediaSession.setActionHandler(
    "nexttrack",
    nextTrack,
  );
}

$("#playAllBtn").addEventListener("click", () => {
  const first = visibleTracks[0] || tracks[0];

  if (first) {
    playTrack(first);
  }
});


// ============================================================
// 17. MODAIS E LIMPEZA DE RECURSOS
// ============================================================

document
  .querySelectorAll("[data-close]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      document
        .getElementById(button.dataset.close)
        ?.close();
    });
  });

[
  uploadModal,
  createPlaylistModal,
  trackActionsModal,
  accountModal,
].forEach((modal) => {
  modal.addEventListener("click", (event) => {
    const rect = modal.getBoundingClientRect();

    const clickedOutside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;

    if (clickedOutside) {
      modal.close();
    }
  });
});

window.addEventListener("beforeunload", () => {
  for (const url of audioUrlCache.values()) {
    URL.revokeObjectURL(url);
  }

  for (const url of coverUrlCache.values()) {
    URL.revokeObjectURL(url);
  }

  if (localCoverPreviewUrl) {
    URL.revokeObjectURL(localCoverPreviewUrl);
  }
});


// ============================================================
// 18. INICIALIZAÇÃO
// ============================================================

setGateMode("login");
renderHome();
renderLibrary();
updatePlayerUI();