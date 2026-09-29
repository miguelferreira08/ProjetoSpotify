import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  getDoc,
  Bytes
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBEiPrY_xJTgoUAmFVW88Zy7YCDF9zaUho",
  authDomain: "projetospotify-e06a3.firebaseapp.com",
  projectId: "projetospotify-e06a3",
  storageBucket: "projetospotify-e06a3.firebasestorage.app",
  messagingSenderId: "120996325072",
  appId: "1:120996325072:web:9f9d1ecaf67ec9686ae0d5",
  measurementId: "G-Q3PJEKW8B6"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Não foi possível ativar a persistência local da sessão:", error);
});

// Cada documento do Firestore tem limite de 1 MiB.
// 512 KiB deixa margem para os demais campos e overhead do documento.
const CHUNK_SIZE = 512 * 1024;
const CHUNKS_PER_BATCH = 6;
const MAX_AUDIO_SIZE = 25 * 1024 * 1024;
const MAX_COVER_SIZE = 10 * 1024 * 1024;

const $ = (selector) => document.querySelector(selector);
const audio = $("#audio");
const trackList = $("#trackList");
const searchInput = $("#searchInput");
const uploadModal = $("#uploadModal");
const authModal = $("#authModal");
const accountModal = $("#accountModal");
const uploadForm = $("#uploadForm");
const authForm = $("#authForm");
const loginBtn = $("#loginBtn");
const profileBtn = $("#profileBtn");
const profileLabel = $("#profileLabel");
const avatar = $("#avatar");
const playerTitle = $("#playerTitle");
const playerArtist = $("#playerArtist");
const playerCover = $("#playerCover");
const playerLike = $("#playerLike");
const playBtn = $("#playBtn");
const seekBar = $("#seekBar");
const volumeBar = $("#volumeBar");
const currentTime = $("#currentTime");
const duration = $("#duration");
const catalogTitle = $("#catalogTitle");
const trackCount = $("#trackCount");
const toast = $("#toast");

const audioFile = $("#audioFile");
const coverFile = $("#coverFile");
const dropzone = $("#dropzone");
const fileLabel = $("#fileLabel");
const coverFileLabel = $("#coverFileLabel");
const coverPreview = $("#coverPreview");

let tracks = [];
let filteredTracks = [];
let currentTrack = null;
let currentIndex = -1;
let likedOnly = false;
let authMode = "login";
let repeat = false;
let shuffle = false;
let toastTimer = null;
let selectedDurationSeconds = 0;
let localCoverPreviewUrl = null;

const likedIds = new Set(JSON.parse(localStorage.getItem("redbeat-liked") || "[]"));
const coverUrlCache = new Map();
const audioUrlCache = new Map();
const coverLoading = new Map();
const audioLoading = new Map();

audio.volume = Number(volumeBar.value);

// ---------- helpers ----------
function safeText(value = "") {
  return String(value ?? "");
}

function initials(value = "R") {
  const clean = safeText(value).trim();
  return clean ? clean.charAt(0).toUpperCase() : "R";
}

function escapeHtml(value) {
  return safeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, type = "success") {
  toast.textContent = message;
  toast.className = `toast show${type === "error" ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 3600);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "agora";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(timestamp.toDate());
}

function readAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const preview = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      preview.removeAttribute("src");
      preview.load();
    };

    preview.preload = "metadata";
    preview.addEventListener("loadedmetadata", () => {
      const seconds = Math.round(preview.duration);
      cleanup();
      if (Number.isFinite(seconds) && seconds > 0) resolve(seconds);
      else reject(new Error("Duração do áudio indisponível."));
    }, { once: true });

    preview.addEventListener("error", () => {
      cleanup();
      reject(new Error("Não foi possível ler os metadados do áudio."));
    }, { once: true });

    preview.src = objectUrl;
  });
}

function persistLikes() {
  localStorage.setItem("redbeat-liked", JSON.stringify([...likedIds]));
}

function isOwner(track) {
  return !!auth.currentUser && track.ownerId === auth.currentUser.uid;
}

function getVisibleTracks() {
  const term = searchInput.value.trim().toLowerCase();

  return tracks.filter((track) => {
    if (track.status === "uploading") return false;

    const matchesTerm = !term || [track.title, track.artist, track.album, track.genre]
      .some((field) => safeText(field).toLowerCase().includes(term));
    const matchesLiked = !likedOnly || likedIds.has(track.id);

    return matchesTerm && matchesLiked;
  });
}

function syncCurrentIndex() {
  currentIndex = filteredTracks.findIndex((track) => track.id === currentTrack?.id);
}

function updateProgressBackground(input, percentage) {
  input.style.background = `linear-gradient(to right, #e50914 0%, #e50914 ${percentage}%, #393939 ${percentage}%, #393939 100%)`;
}

function createTrackRef() {
  return doc(collection(db, "tracks"));
}

function byteSizeLabel(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- compressão ----------
async function gzipBlob(blob) {
  if ("CompressionStream" in globalThis) {
    const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const { gzip } = await import("https://cdn.jsdelivr.net/npm/pako@2.1.0/+esm");
  return gzip(new Uint8Array(await blob.arrayBuffer()));
}

async function gunzipBytes(bytes) {
  if ("DecompressionStream" in globalThis) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  const { ungzip } = await import("https://cdn.jsdelivr.net/npm/pako@2.1.0/+esm");
  return ungzip(bytes);
}

async function loadImageSource(file) {
  if ("createImageBitmap" in globalThis) {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw(ctx, width, height) {
        ctx.drawImage(bitmap, 0, 0, width, height);
      },
      close() {
        bitmap.close?.();
      }
    };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();

    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw(ctx, width, height) {
        ctx.drawImage(image, 0, 0, width, height);
      },
      close() {
        URL.revokeObjectURL(objectUrl);
      }
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function optimizeCover(file) {
  const source = await loadImageSource(file);

  try {
    const maxSide = 720;
    const ratio = Math.min(1, maxSide / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * ratio));
    const height = Math.max(1, Math.round(source.height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    source.draw(ctx, width, height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("Não foi possível otimizar a capa.")),
        "image/webp",
        0.78
      );
    });

    return blob;
  } finally {
    source.close();
  }
}

// ---------- Firestore binário em blocos ----------
// Os blocos também ficam na coleção `tracks`. Isso evita depender de
// permissões de subcoleções e mantém todos os dados no mesmo caminho.
function splitBytes(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_SIZE) {
    chunks.push(bytes.slice(offset, Math.min(offset + CHUNK_SIZE, bytes.byteLength)));
  }
  return chunks;
}

function chunkDocId(trackId, kind, index) {
  const prefix = kind === "audio" ? "a" : "c";
  return `${trackId}__${prefix}__${String(index).padStart(6, "0")}`;
}

function chunkDocRef(trackId, kind, index) {
  return doc(db, "tracks", chunkDocId(trackId, kind, index));
}

function chunkRuleCompatibilityFields(track) {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    genre: track.genre,
    duration: track.duration,
    durationFormatted: track.durationFormatted,
    audioUrl: "firestore-chunks",
    ownerId: track.ownerId,
    ownerEmail: track.ownerEmail || ""
  };
}

async function writeChunks(track, kind, bytes, onCommittedBytes, writtenRefs) {
  const chunks = splitBytes(bytes);
  const compatibility = chunkRuleCompatibilityFields(track);
  const BATCH_SIZE = 4;

  for (let start = 0; start < chunks.length; start += BATCH_SIZE) {
    const batch = writeBatch(db);
    const refsInBatch = [];
    let batchBytes = 0;
    const end = Math.min(start + BATCH_SIZE, chunks.length);

    for (let index = start; index < end; index++) {
      const chunk = chunks[index];
      const chunkRef = chunkDocRef(track.id, kind, index);

      batch.set(chunkRef, {
        ...compatibility,
        recordType: "chunk",
        parentTrackId: track.id,
        chunkType: kind,
        index,
        byteLength: chunk.byteLength,
        data: Bytes.fromUint8Array(chunk),
        createdAt: serverTimestamp()
      });

      refsInBatch.push(chunkRef);
      batchBytes += chunk.byteLength;
    }

    await batch.commit();
    writtenRefs.push(...refsInBatch);
    onCommittedBytes?.(batchBytes);
  }

  return chunks.length;
}

async function readChunks(track, kind) {
  const count = kind === "audio" ? Number(track.audioChunks || 0) : Number(track.coverChunks || 0);
  if (!count) throw new Error(`Arquivo sem blocos: ${kind}`);

  const chunks = new Array(count);
  const READ_GROUP = 8;

  for (let start = 0; start < count; start += READ_GROUP) {
    const end = Math.min(start + READ_GROUP, count);
    const indexes = Array.from({ length: end - start }, (_, offset) => start + offset);
    const docs = await Promise.all(
      indexes.map((index) => getDoc(chunkDocRef(track.id, kind, index)))
    );

    docs.forEach((snapshot, localIndex) => {
      const index = indexes[localIndex];
      if (!snapshot.exists()) throw new Error(`Bloco ausente: ${kind}/${index}`);
      const value = snapshot.data().data;
      if (!value?.toUint8Array) throw new Error(`Bloco inválido: ${kind}/${index}`);
      chunks[index] = value.toUint8Array();
    });
  }

  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(totalBytes);

  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

async function deleteRefs(refs) {
  for (let start = 0; start < refs.length; start += 300) {
    const batch = writeBatch(db);
    for (const itemRef of refs.slice(start, start + 300)) batch.delete(itemRef);
    await batch.commit();
  }
}

function refsForTrackChunks(track) {
  const refs = [];
  for (let index = 0; index < Number(track.audioChunks || 0); index++) {
    refs.push(chunkDocRef(track.id, "audio", index));
  }
  for (let index = 0; index < Number(track.coverChunks || 0); index++) {
    refs.push(chunkDocRef(track.id, "cover", index));
  }
  return refs;
}

async function cleanupPartialTrack(trackRef, writtenRefs) {
  try {
    await deleteRefs(writtenRefs);
  } catch (error) {
    console.warn("Falha ao limpar blocos parciais:", error);
  }

  try {
    await deleteDoc(trackRef);
  } catch (error) {
    console.warn("Falha ao limpar música parcial:", error);
  }
}

async function buildAssetUrl(track, type) {
  const isAudio = type === "audio";
  const cache = isAudio ? audioUrlCache : coverUrlCache;
  const loading = isAudio ? audioLoading : coverLoading;

  if (cache.has(track.id)) return cache.get(track.id);
  if (loading.has(track.id)) return loading.get(track.id);

  const promise = (async () => {
    const kind = isAudio ? "audio" : "cover";
    const mime = isAudio ? (track.audioMime || "audio/mpeg") : (track.coverMime || "image/webp");
    const compression = isAudio ? track.audioCompression : track.coverCompression;

    const storedBytes = await readChunks(track, kind);
    const rawBytes = compression === "gzip" ? await gunzipBytes(storedBytes) : storedBytes;

    const url = URL.createObjectURL(new Blob([rawBytes], { type: mime }));
    cache.set(track.id, url);
    return url;
  })();

  loading.set(track.id, promise);

  try {
    return await promise;
  } finally {
    loading.delete(track.id);
  }
}

function releaseCachedTrack(trackId) {
  const audioUrl = audioUrlCache.get(trackId);
  const coverUrl = coverUrlCache.get(trackId);

  if (audioUrl) URL.revokeObjectURL(audioUrl);
  if (coverUrl) URL.revokeObjectURL(coverUrl);

  audioUrlCache.delete(trackId);
  coverUrlCache.delete(trackId);
}

async function hydrateVisibleCovers() {
  const visible = getVisibleTracks();

  for (const track of visible) {
    const element = trackList.querySelector(`[data-cover-id="${CSS.escape(track.id)}"]`);
    if (!element || !track.coverChunks) continue;

    try {
      const url = await buildAssetUrl(track, "cover");
      const currentElement = trackList.querySelector(`[data-cover-id="${CSS.escape(track.id)}"]`);
      if (!currentElement) continue;

      currentElement.textContent = "";
      currentElement.style.backgroundImage = `url("${url}")`;
    } catch (error) {
      console.warn("Não foi possível abrir a capa:", error);
    }
  }
}

async function hydratePlayerCover(track) {
  if (!track?.coverChunks) return;

  try {
    const url = await buildAssetUrl(track, "cover");
    if (currentTrack?.id !== track.id) return;

    playerCover.textContent = "";
    playerCover.style.backgroundImage = `url("${url}")`;
  } catch (error) {
    console.warn("Não foi possível abrir a capa no player:", error);
  }
}

// ---------- rendering ----------
function renderTracks() {
  filteredTracks = getVisibleTracks();
  syncCurrentIndex();

  catalogTitle.textContent = likedOnly
    ? "Músicas curtidas"
    : (searchInput.value ? "Resultados" : "Seu catálogo");

  trackCount.textContent = `${filteredTracks.length} ${filteredTracks.length === 1 ? "música" : "músicas"}`;

  if (!filteredTracks.length) {
    const text = likedOnly
      ? "Você ainda não curtiu nenhuma música."
      : searchInput.value
        ? "Nenhuma música encontrada para essa busca."
        : "Seu catálogo está vazio.";

    trackList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">♫</div>
        <h3>${text}</h3>
        <p>${tracks.length ? "Tente outra busca ou filtro." : "Entre na conta e adicione a primeira música."}</p>
        ${tracks.length ? "" : '<button class="primary-btn" data-action="open-upload">Adicionar música</button>'}
      </div>
    `;
    return;
  }

  trackList.innerHTML = filteredTracks.map((track, index) => {
    const liked = likedIds.has(track.id);
    const active = currentTrack?.id === track.id;

    return `
      <article class="track-row ${active ? "active" : ""}" data-id="${track.id}">
        <div class="track-index">
          <span class="row-index">${index + 1}</span>
          <button class="row-play" data-action="play" aria-label="Tocar ${escapeHtml(track.title)}">${active && !audio.paused ? "Ⅱ" : "▶"}</button>
        </div>
        <div class="title-cell">
          <div class="cover" data-cover-id="${track.id}">${initials(track.title)}</div>
          <div class="title-stack">
            <strong>${escapeHtml(track.title)}</strong>
            <span>${escapeHtml(track.artist)}</span>
          </div>
        </div>
        <span class="album-cell">${escapeHtml(track.album || "Sem álbum")}</span>
        <span class="genre-cell">${escapeHtml(track.genre || "—")}</span>
        <span class="duration-cell">${escapeHtml(track.durationFormatted || formatTime(Number(track.duration) || 0))}</span>
        <button class="row-like ${liked ? "liked" : ""}" data-action="like" aria-label="Curtir">${liked ? "♥" : "♡"}</button>
        <button class="row-menu" data-action="menu" aria-label="${isOwner(track) ? "Excluir música" : "Opções"}">${isOwner(track) ? "×" : "⋯"}</button>
      </article>
    `;
  }).join("");

  hydrateVisibleCovers();
}

function updatePlayerUI() {
  if (!currentTrack) {
    playerTitle.textContent = "Nenhuma música";
    playerArtist.textContent = "Escolha uma faixa do catálogo";
    playerCover.style.backgroundImage = "";
    playerCover.textContent = "R";
    playerLike.textContent = "♡";
    playerLike.classList.remove("liked");
    playBtn.textContent = "▶";
    return;
  }

  playerTitle.textContent = currentTrack.title;
  playerArtist.textContent = currentTrack.artist;

  const cachedCover = coverUrlCache.get(currentTrack.id);
  if (cachedCover) {
    playerCover.textContent = "";
    playerCover.style.backgroundImage = `url("${cachedCover}")`;
  } else {
    playerCover.style.backgroundImage = "";
    playerCover.textContent = initials(currentTrack.title);
    hydratePlayerCover(currentTrack);
  }

  const liked = likedIds.has(currentTrack.id);
  playerLike.textContent = liked ? "♥" : "♡";
  playerLike.classList.toggle("liked", liked);
  playBtn.textContent = audio.paused ? "▶" : "Ⅱ";
}

// ---------- catálogo realtime ----------
const tracksQuery = query(collection(db, "tracks"), where("recordType", "==", "track"));

onSnapshot(
  tracksQuery,
  (snapshot) => {
    tracks = snapshot.docs
      .map((snap) => ({ id: snap.id, ...snap.data() }))
      .filter((track) => track.status !== "uploading")
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });

    if (currentTrack) {
      const refreshed = tracks.find((track) => track.id === currentTrack.id);
      if (refreshed) currentTrack = refreshed;
    }

    renderTracks();
    updatePlayerUI();
  },
  (error) => {
    console.error(error);
    showToast("Não foi possível carregar o catálogo. Confira as regras do banco.", "error");
  }
);

// ---------- autenticação ----------
onAuthStateChanged(auth, (user) => {
  if (user) {
    loginBtn.classList.add("hidden");
    profileBtn.classList.remove("hidden");
    const name = user.email?.split("@")[0] || "Usuário";
    profileLabel.textContent = name;
    avatar.textContent = initials(name);
    $("#accountEmail").textContent = user.email || "Usuário";
  } else {
    loginBtn.classList.remove("hidden");
    profileBtn.classList.add("hidden");
  }
  renderTracks();
});

function openAuth() {
  const warning = $("#authEnvironmentWarning");

  if (warning) {
    if (location.protocol === "file:") {
      warning.textContent = "Abra o projeto por http://localhost ou por uma hospedagem HTTPS.";
      warning.classList.remove("hidden");
    } else {
      warning.classList.add("hidden");
    }
  }

  authModal.showModal();
  requestAnimationFrame(() => $("#emailInput")?.focus());
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";

  $("#authTitle").textContent = isLogin ? "Entrar" : "Criar conta";
  $("#authCopy").textContent = isLogin
    ? "Entre para adicionar e gerenciar suas músicas."
    : "Crie sua conta para começar a montar o catálogo.";
  $("#authSubmit").textContent = isLogin ? "Entrar" : "Criar conta";
  $("#toggleAuthMode").textContent = isLogin ? "Criar uma conta" : "Já tenho uma conta";
  $("#passwordInput").autocomplete = isLogin ? "current-password" : "new-password";
  $("#authError").classList.add("hidden");
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("#emailInput").value.trim();
  const password = $("#passwordInput").value;
  const errorBox = $("#authError");
  const submitButton = $("#authSubmit");

  errorBox.classList.add("hidden");

  if (location.protocol === "file:") {
    errorBox.textContent = "Abra o projeto usando http://localhost ou uma hospedagem HTTPS.";
    errorBox.classList.remove("hidden");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = authMode === "login" ? "Entrando…" : "Criando…";

  try {
    if (authMode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("Login realizado.");
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
      showToast("Conta criada e sessão iniciada.");
    }

    authForm.reset();
    authModal.close();
  } catch (error) {
    console.error("Auth:", error.code, error.message);
    errorBox.textContent = friendlyAuthError(error.code);
    errorBox.classList.remove("hidden");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = authMode === "login" ? "Entrar" : "Criar conta";
  }
});

function friendlyAuthError(code = "") {
  const messages = {
    "auth/invalid-credential": "E-mail ou senha inválidos.",
    "auth/user-not-found": "Nenhuma conta foi encontrada para este e-mail.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/email-already-in-use": "Este e-mail já está cadastrado. Use Entrar.",
    "auth/weak-password": "A senha não atende aos requisitos mínimos.",
    "auth/password-does-not-meet-requirements": "A senha não atende à política de segurança configurada.",
    "auth/invalid-email": "Digite um e-mail válido.",
    "auth/missing-password": "Digite a senha.",
    "auth/user-disabled": "Esta conta foi desativada.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    "auth/network-request-failed": "Falha de rede. Verifique sua conexão.",
    "auth/operation-not-allowed": "O cadastro por e-mail e senha não está disponível no momento.",
    "auth/configuration-not-found": "O sistema de cadastro e login ainda não está disponível.",
    "auth/unauthorized-domain": "Este endereço não está autorizado para realizar login."
  };

  return messages[code] || `Não foi possível autenticar (${code || "erro desconhecido"}).`;
}

$("#toggleAuthMode").addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
});

loginBtn.addEventListener("click", openAuth);
profileBtn.addEventListener("click", () => accountModal.showModal());

$("#logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  accountModal.close();
  showToast("Você saiu da conta.");
});

// ---------- upload ----------
function requireUserAndOpenUpload() {
  if (!auth.currentUser) {
    showToast("Entre na sua conta para adicionar músicas.");
    openAuth();
    return;
  }

  uploadModal.showModal();
}

$("#openUpload")?.addEventListener("click", requireUserAndOpenUpload);

trackList.addEventListener("click", (event) => {
  if (event.target.matches('[data-action="open-upload"]')) {
    requireUserAndOpenUpload();
    return;
  }

  const row = event.target.closest(".track-row");
  if (!row) return;

  const track = tracks.find((item) => item.id === row.dataset.id);
  if (!track) return;

  const action = event.target.closest("[data-action]")?.dataset.action;

  if (action === "like") {
    toggleLike(track.id);
  } else if (action === "menu") {
    if (isOwner(track)) deleteTrack(track);
    else showToast("Somente quem adicionou esta música pode excluí-la.");
  } else if (action === "play") {
    if (currentTrack?.id === track.id && !audio.paused) {
      audio.pause();
    } else if (currentTrack?.id === track.id && audio.src) {
      audio.play().catch(handlePlayError);
    } else {
      playTrack(track);
    }
  } else if (!action) {
    playTrack(track);
  }
});

audioFile.addEventListener("change", async () => {
  const file = audioFile.files?.[0];

  fileLabel.textContent = file ? file.name : "Clique ou arraste um arquivo de áudio";
  selectedDurationSeconds = 0;
  $("#trackDuration").value = file ? "Lendo duração…" : "Selecione um arquivo";

  if (file && !$("#trackTitle").value) {
    $("#trackTitle").value = file.name.replace(/\.[^/.]+$/, "");
  }

  if (!file) return;

  try {
    selectedDurationSeconds = await readAudioDuration(file);
    $("#trackDuration").value = formatTime(selectedDurationSeconds);
  } catch (error) {
    console.error(error);
    $("#trackDuration").value = "Não identificada";
    showToast("Não foi possível identificar a duração deste áudio.", "error");
  }
});

coverFile.addEventListener("change", () => {
  const file = coverFile.files?.[0];

  if (localCoverPreviewUrl) {
    URL.revokeObjectURL(localCoverPreviewUrl);
    localCoverPreviewUrl = null;
  }

  if (!file) {
    coverFileLabel.textContent = "Selecionar capa do álbum";
    coverPreview.style.backgroundImage = "";
    coverPreview.textContent = "▧";
    return;
  }

  coverFileLabel.textContent = file.name;
  localCoverPreviewUrl = URL.createObjectURL(file);
  coverPreview.textContent = "";
  coverPreview.style.backgroundImage = `url("${localCoverPreviewUrl}")`;
});

["dragenter", "dragover"].forEach((type) => {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((type) => {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  });
});

dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files?.[0];
  if (!file) return;

  const transfer = new DataTransfer();
  transfer.items.add(file);
  audioFile.files = transfer.files;
  audioFile.dispatchEvent(new Event("change"));
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const user = auth.currentUser;
  if (!user) {
    uploadModal.close();
    openAuth();
    return;
  }

  const musicFile = audioFile.files?.[0];
  const imageFile = coverFile.files?.[0];
  const title = $("#trackTitle").value.trim();
  const artist = $("#trackArtist").value.trim();
  const album = $("#trackAlbum").value.trim();
  const genre = $("#trackGenre").value.trim();

  if (!musicFile || !imageFile || !title || !artist || !album || !genre) {
    showToast("Preencha os dados e selecione o áudio e a capa.", "error");
    return;
  }

  if (musicFile.size > MAX_AUDIO_SIZE) {
    showToast("O áudio excede 25 MB.", "error");
    return;
  }

  if (imageFile.size > MAX_COVER_SIZE) {
    showToast("A imagem da capa excede 10 MB.", "error");
    return;
  }

  const isAudio = musicFile.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg)$/i.test(musicFile.name);
  if (!isAudio) {
    showToast("Selecione um arquivo de áudio válido.", "error");
    return;
  }

  if (!imageFile.type.startsWith("image/")) {
    showToast("Selecione uma imagem válida para a capa.", "error");
    return;
  }

  if (!selectedDurationSeconds) {
    try {
      selectedDurationSeconds = await readAudioDuration(musicFile);
      $("#trackDuration").value = formatTime(selectedDurationSeconds);
    } catch (error) {
      console.error(error);
      showToast("Não foi possível obter a duração da música.", "error");
      return;
    }
  }

  const submit = $("#uploadSubmit");
  const progressWrap = $("#uploadProgressWrap");
  const progressBar = progressWrap.querySelector(".upload-progress-bar");
  const progress = $("#uploadProgress");
  const progressText = $("#uploadProgressText");
  const trackRef = createTrackRef();

  submit.disabled = true;
  submit.textContent = "Adicionando…";
  progressWrap.classList.remove("hidden");
  progressBar.classList.add("pending");
  progress.style.width = "0%";

  let parentCreated = false;
  const writtenRefs = [];

  try {
    progressText.textContent = "Otimizando capa…";
    const optimizedCover = await optimizeCover(imageFile);

    progressText.textContent = "Comprimindo capa…";
    const compressedCover = await gzipBlob(optimizedCover);

    progressText.textContent = "Comprimindo áudio…";
    const compressedAudio = await gzipBlob(musicFile);

    const baseTrack = {
      id: trackRef.id,
      title,
      artist,
      album,
      genre,
      duration: selectedDurationSeconds,
      durationFormatted: formatTime(selectedDurationSeconds),
      ownerId: user.uid,
      ownerEmail: user.email || ""
    };

    await setDoc(trackRef, {
      ...baseTrack,
      recordType: "track",
      audioUrl: "firestore-chunks",
      originalName: musicFile.name,

      audioMime: musicFile.type || "audio/mpeg",
      audioCompression: "gzip",
      audioOriginalSize: musicFile.size,
      audioCompressedSize: compressedAudio.byteLength,

      coverMime: optimizedCover.type || "image/webp",
      coverCompression: "gzip",
      coverOriginalSize: imageFile.size,
      coverOptimizedSize: optimizedCover.size,
      coverCompressedSize: compressedCover.byteLength,

      status: "uploading",
      createdAt: serverTimestamp()
    });

    parentCreated = true;

    const totalToStore = compressedAudio.byteLength + compressedCover.byteLength;
    let committed = 0;

    const updateProgress = (bytes) => {
      committed += bytes;
      const pct = totalToStore ? Math.min(99, Math.round((committed / totalToStore) * 100)) : 0;
      progressBar.classList.remove("pending");
      progress.style.width = `${pct}%`;
      progressText.textContent =
        `Salvando… ${pct}% • ${byteSizeLabel(committed)} de ${byteSizeLabel(totalToStore)}`;
    };

    const coverChunks = await writeChunks(
      baseTrack,
      "cover",
      compressedCover,
      updateProgress,
      writtenRefs
    );

    const audioChunks = await writeChunks(
      baseTrack,
      "audio",
      compressedAudio,
      updateProgress,
      writtenRefs
    );

    await updateDoc(trackRef, {
      audioChunks,
      coverChunks,
      status: "ready",
      updatedAt: serverTimestamp()
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
      progress.style.width = "0%";
      progressBar.classList.remove("pending");
      progressWrap.classList.add("hidden");
      uploadModal.close();
    }, 250);
  } catch (error) {
    console.error("Falha ao adicionar música:", error);

    if (parentCreated) {
      progressText.textContent = "Desfazendo envio incompleto…";
      await cleanupPartialTrack(trackRef, writtenRefs);
    }

    progressBar.classList.remove("pending");
    progress.style.width = "0%";

    const errorCode = error?.code || "erro-desconhecido";
    progressText.textContent = `Falha ao salvar (${errorCode}).`;
    if (errorCode === "permission-denied") {
      showToast("O banco recusou a gravação (permission-denied). Confira as regras da coleção tracks.", "error");
    } else if (errorCode === "resource-exhausted") {
      showToast("O limite do banco foi atingido (resource-exhausted).", "error");
    } else {
      showToast(`Não foi possível adicionar a música (${errorCode}).`, "error");
    }
  } finally {
    submit.disabled = false;
    submit.textContent = "Adicionar música";
  }
});

async function deleteTrack(track) {
  if (!isOwner(track)) return;

  const confirmed = confirm(`Excluir "${track.title}" do catálogo?`);
  if (!confirmed) return;

  const trackRef = doc(db, "tracks", track.id);

  try {
    await deleteRefs(refsForTrackChunks(track));
    await deleteDoc(trackRef);

    releaseCachedTrack(track.id);
    likedIds.delete(track.id);
    persistLikes();

    if (currentTrack?.id === track.id) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      currentTrack = null;
      currentIndex = -1;
      updatePlayerUI();
    }

    showToast("Música excluída.");
  } catch (error) {
    console.error(error);
    showToast("Não foi possível excluir a música.", "error");
  }
}

// ---------- player ----------
async function playTrack(track) {
  if (!track) return;

  currentTrack = track;
  filteredTracks = getVisibleTracks();
  syncCurrentIndex();

  playerTitle.textContent = track.title;
  playerArtist.textContent = track.artist;
  playBtn.textContent = "…";
  renderTracks();
  updatePlayerUI();

  try {
    let sourceUrl;

    // Compatibilidade com músicas antigas que ainda tenham URL externa.
    if (track.audioUrl && track.audioUrl !== "firestore-chunks") {
      sourceUrl = track.audioUrl;
    } else {
      showToast("Preparando música…");
      sourceUrl = await buildAssetUrl(track, "audio");
    }

    if (currentTrack?.id !== track.id) return;

    audio.src = sourceUrl;
    audio.load();
    await audio.play();
  } catch (error) {
    handlePlayError(error);
  }
}

function handlePlayError(error) {
  console.error(error);
  showToast("Não foi possível abrir esta música.", "error");
}

function togglePlayback() {
  if (!currentTrack) {
    const first = filteredTracks[0] || tracks[0];
    if (first) playTrack(first);
    return;
  }

  if (!audio.src) {
    playTrack(currentTrack);
    return;
  }

  if (audio.paused) audio.play().catch(handlePlayError);
  else audio.pause();
}

function nextTrack() {
  const list = filteredTracks.length ? filteredTracks : tracks;
  if (!list.length) return;

  if (shuffle && list.length > 1) {
    let next;
    do {
      next = Math.floor(Math.random() * list.length);
    } while (list[next].id === currentTrack?.id);

    playTrack(list[next]);
    return;
  }

  let index = list.findIndex((track) => track.id === currentTrack?.id);
  index = index < 0 ? 0 : (index + 1) % list.length;
  playTrack(list[index]);
}

function previousTrack() {
  const list = filteredTracks.length ? filteredTracks : tracks;
  if (!list.length) return;

  let index = list.findIndex((track) => track.id === currentTrack?.id);
  index = index <= 0 ? list.length - 1 : index - 1;
  playTrack(list[index]);
}

playBtn.addEventListener("click", togglePlayback);
$("#nextBtn").addEventListener("click", nextTrack);
$("#prevBtn").addEventListener("click", previousTrack);

$("#repeatBtn").addEventListener("click", (event) => {
  repeat = !repeat;
  event.currentTarget.classList.toggle("active", repeat);
});

$("#shuffleBtn").addEventListener("click", (event) => {
  shuffle = !shuffle;
  event.currentTarget.classList.toggle("active", shuffle);
});

audio.addEventListener("play", () => {
  updatePlayerUI();
  renderTracks();
});

audio.addEventListener("pause", () => {
  updatePlayerUI();
  renderTracks();
});

audio.addEventListener("loadedmetadata", () => {
  duration.textContent = formatTime(audio.duration);
});

audio.addEventListener("timeupdate", () => {
  currentTime.textContent = formatTime(audio.currentTime);
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  seekBar.value = pct;
  updateProgressBackground(seekBar, pct);
});

audio.addEventListener("ended", () => {
  if (repeat) {
    audio.currentTime = 0;
    audio.play().catch(handlePlayError);
  } else {
    nextTrack();
  }
});

seekBar.addEventListener("input", () => {
  if (!audio.duration) return;
  const pct = Number(seekBar.value);
  audio.currentTime = (pct / 100) * audio.duration;
  updateProgressBackground(seekBar, pct);
});

volumeBar.addEventListener("input", () => {
  audio.volume = Number(volumeBar.value);
  updateProgressBackground(volumeBar, Number(volumeBar.value) * 100);
});

updateProgressBackground(volumeBar, Number(volumeBar.value) * 100);

function toggleLike(trackId) {
  if (!trackId) return;

  if (likedIds.has(trackId)) likedIds.delete(trackId);
  else likedIds.add(trackId);

  persistLikes();
  renderTracks();
  updatePlayerUI();
}

playerLike.addEventListener("click", () => {
  if (currentTrack) toggleLike(currentTrack.id);
});

// ---------- busca / filtros ----------
searchInput.addEventListener("input", () => {
  likedOnly = false;
  setActiveNav("library");
  renderTracks();
});

function setActiveNav(view) {
  $("#showLibrary")?.classList.toggle("active", view === "library");
  $("#showLiked")?.classList.toggle("active", view === "liked");
}

function showLibrary() {
  likedOnly = false;
  searchInput.value = "";
  setActiveNav("library");
  renderTracks();
  $("#catalogSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showLiked() {
  likedOnly = true;
  searchInput.value = "";
  setActiveNav("liked");
  renderTracks();
  $("#catalogSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#showLibrary")?.addEventListener("click", showLibrary);
$("#showLiked")?.addEventListener("click", showLiked);

$("#playAllBtn")?.addEventListener("click", () => {
  const first = getVisibleTracks()[0] || tracks[0];

  if (first) playTrack(first);
  else showToast("Adicione uma música antes de tocar o catálogo.");
});

// ---------- dialogs ----------
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => {
    const modal = document.getElementById(button.dataset.close);
    if (modal?.open) modal.close();
  });
});

[uploadModal, authModal, accountModal].forEach((modal) => {
  modal.addEventListener("click", (event) => {
    const rect = modal.getBoundingClientRect();
    const clickedBackdrop =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;

    if (clickedBackdrop) modal.close();
  });
});

window.addEventListener("beforeunload", () => {
  for (const url of audioUrlCache.values()) URL.revokeObjectURL(url);
  for (const url of coverUrlCache.values()) URL.revokeObjectURL(url);
  if (localCoverPreviewUrl) URL.revokeObjectURL(localCoverPreviewUrl);
});

setAuthMode("login");
renderTracks();
updatePlayerUI();
