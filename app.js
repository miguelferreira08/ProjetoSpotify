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
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

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
const storage = getStorage(firebaseApp);

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Não foi possível ativar a persistência local da sessão:", error);
});

// ---------- DOM ----------
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

const likedIds = new Set(JSON.parse(localStorage.getItem("redbeat-liked") || "[]"));
audio.volume = Number(volumeBar.value);

// ---------- helpers ----------
function safeText(value = "") {
  return String(value ?? "");
}

function initials(value = "R") {
  const clean = safeText(value).trim();
  return clean ? clean.charAt(0).toUpperCase() : "R";
}

function showToast(message, type = "success") {
  toast.textContent = message;
  toast.className = `toast show${type === "error" ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 3200);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
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

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "agora";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(timestamp.toDate());
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
    const matchesTerm = !term || [track.title, track.artist, track.album, track.genre]
      .some((field) => safeText(field).toLowerCase().includes(term));
    const matchesLiked = !likedOnly || likedIds.has(track.id);
    return matchesTerm && matchesLiked;
  });
}

function syncCurrentIndex() {
  currentIndex = filteredTracks.findIndex((track) => track.id === currentTrack?.id);
}

// ---------- rendering ----------
function renderTracks() {
  filteredTracks = getVisibleTracks();
  syncCurrentIndex();

  catalogTitle.textContent = likedOnly ? "Músicas curtidas" : (searchInput.value ? "Resultados" : "Seu catálogo");
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
        <p>${tracks.length ? "Tente outra busca ou filtro." : "Entre na conta e envie o primeiro MP3 para começar."}</p>
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
          <button class="row-play" data-action="play" aria-label="Tocar ${safeText(track.title)}">${active && !audio.paused ? "Ⅱ" : "▶"}</button>
        </div>
        <div class="title-cell">
          <div class="cover">${initials(track.title)}</div>
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
}

function escapeHtml(value) {
  return safeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updatePlayerUI() {
  if (!currentTrack) {
    playerTitle.textContent = "Nenhuma música";
    playerArtist.textContent = "Escolha uma faixa do catálogo";
    playerCover.textContent = "R";
    playerLike.textContent = "♡";
    playerLike.classList.remove("liked");
    playBtn.textContent = "▶";
    return;
  }

  playerTitle.textContent = currentTrack.title;
  playerArtist.textContent = currentTrack.artist;
  playerCover.textContent = initials(currentTrack.title);
  const liked = likedIds.has(currentTrack.id);
  playerLike.textContent = liked ? "♥" : "♡";
  playerLike.classList.toggle("liked", liked);
  playBtn.textContent = audio.paused ? "▶" : "Ⅱ";
}

function updateProgressBackground(input, percentage) {
  input.style.background = `linear-gradient(to right, #e50914 0%, #e50914 ${percentage}%, #393939 ${percentage}%, #393939 100%)`;
}

// ---------- catalog realtime ----------
const tracksQuery = query(collection(db, "tracks"), orderBy("createdAt", "desc"));

onSnapshot(
  tracksQuery,
  (snapshot) => {
    tracks = snapshot.docs.map((snap) => ({ id: snap.id, ...snap.data() }));
    if (currentTrack) {
      const refreshed = tracks.find((track) => track.id === currentTrack.id);
      if (refreshed) currentTrack = refreshed;
    }
    renderTracks();
    updatePlayerUI();
  },
  (error) => {
    console.error(error);
    showToast("Não foi possível ler o catálogo. Confira as regras do Firestore.", "error");
  }
);

// ---------- auth ----------
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
      warning.textContent = "Abra o projeto por http://localhost ou por uma hospedagem HTTPS. O login pode falhar quando o index.html é aberto diretamente como arquivo.";
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
    errorBox.textContent = "Abra o projeto usando http://localhost ou uma hospedagem HTTPS. Não use file:// para autenticação.";
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
    console.error("Firebase Auth:", error.code, error.message);
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
    "auth/network-request-failed": "Falha de rede. Verifique a conexão e confirme que o projeto está sendo aberto por http:// ou https://.",
    "auth/operation-not-allowed": "O cadastro por e-mail e senha não está disponível no momento.",
    "auth/configuration-not-found": "O sistema de cadastro e login ainda não está disponível.",
    "auth/unauthorized-domain": "Este endereço não está autorizado para realizar login.",
    "auth/app-not-authorized": "Este aplicativo não está autorizado a realizar login.",
    "auth/invalid-api-key": "O serviço de login está indisponível devido a uma configuração inválida."
  };
  return messages[code] || `Não foi possível autenticar (${code || "erro desconhecido"}). Abra o console do navegador para ver os detalhes.`;
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

["#openUpload"].forEach((selector) => {
  const element = $(selector);
  if (element) element.addEventListener("click", requireUserAndOpenUpload);
});

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
    else showToast("Somente quem enviou esta música pode excluí-la.");
  } else if (action === "play") {
    if (currentTrack?.id === track.id && !audio.paused) {
      audio.pause();
    } else if (currentTrack?.id === track.id) {
      audio.play().catch(handlePlayError);
    } else {
      playTrack(track);
    }
  } else if (!action) {
    playTrack(track);
  }
});

const audioFile = $("#audioFile");
const dropzone = $("#dropzone");
const fileLabel = $("#fileLabel");

audioFile.addEventListener("change", async () => {
  const file = audioFile.files?.[0];
  fileLabel.textContent = file ? file.name : "Clique ou arraste um MP3";
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

  const file = audioFile.files?.[0];
  const title = $("#trackTitle").value.trim();
  const artist = $("#trackArtist").value.trim();
  const album = $("#trackAlbum").value.trim();
  const genre = $("#trackGenre").value.trim();

  if (!file || !title || !artist || !album || !genre) {
    showToast("Selecione um arquivo e preencha título, artista, álbum e gênero.", "error");
    return;
  }

  if (file.size > 25 * 1024 * 1024) {
    showToast("O arquivo excede 25 MB.", "error");
    return;
  }

  const allowed = file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg)$/i.test(file.name);
  if (!allowed) {
    showToast("Selecione um arquivo de áudio válido.", "error");
    return;
  }

  if (!selectedDurationSeconds) {
    try {
      selectedDurationSeconds = await readAudioDuration(file);
      $("#trackDuration").value = formatTime(selectedDurationSeconds);
    } catch (error) {
      console.error(error);
      showToast("Não foi possível obter a duração da música. Tente outro arquivo.", "error");
      return;
    }
  }

  const submit = $("#uploadSubmit");
  const progressWrap = $("#uploadProgressWrap");
  const progress = $("#uploadProgress");
  const progressText = $("#uploadProgressText");

  submit.disabled = true;
  submit.textContent = "Adicionando…";
  progressWrap.classList.remove("hidden");

  const ext = file.name.split(".").pop()?.toLowerCase() || "mp3";
  const filename = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const storagePath = `tracks/${user.uid}/${filename}`;
  const storageRef = ref(storage, storagePath);

  let slowUploadTimer;

  try {
    progressText.textContent = "Preparando música…";

    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type || "audio/mpeg",
      customMetadata: {
        ownerId: user.uid,
        originalName: file.name,
        genre,
        duration: String(selectedDurationSeconds)
      }
    });

    slowUploadTimer = setTimeout(() => {
      if (task.snapshot.bytesTransferred === 0) {
        progressText.textContent = "A conexão está demorando para iniciar. Aguarde…";
      }
    }, 10000);

    const downloadURL = await new Promise((resolve, reject) => {
      task.on(
        "state_changed",
        (snapshot) => {
          if (snapshot.bytesTransferred > 0 && slowUploadTimer) {
            clearTimeout(slowUploadTimer);
            slowUploadTimer = null;
          }
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          progress.style.width = `${pct}%`;
          const sentMB = (snapshot.bytesTransferred / (1024 * 1024)).toFixed(1);
          const totalMB = (snapshot.totalBytes / (1024 * 1024)).toFixed(1);
          progressText.textContent = `Adicionando… ${pct}% • ${sentMB} de ${totalMB} MB`;
        },
        reject,
        async () => resolve(await getDownloadURL(task.snapshot.ref))
      );
    });

    await addDoc(collection(db, "tracks"), {
      title,
      artist,
      album,
      genre,
      duration: selectedDurationSeconds,
      durationFormatted: formatTime(selectedDurationSeconds),
      audioUrl: downloadURL,
      storagePath,
      ownerId: user.uid,
      ownerEmail: user.email || "",
      originalName: file.name,
      createdAt: serverTimestamp()
    });

    showToast("Música adicionada ao catálogo.");
    uploadForm.reset();
    selectedDurationSeconds = 0;
    $("#trackDuration").value = "Selecione um arquivo";
    fileLabel.textContent = "Clique ou arraste um MP3";
    progress.style.width = "0%";
    progressWrap.classList.add("hidden");
    uploadModal.close();
  } catch (error) {
    console.error(error);
    showToast("Não foi possível adicionar a música. Tente novamente.", "error");
  } finally {
    if (slowUploadTimer) clearTimeout(slowUploadTimer);
    submit.disabled = false;
    submit.textContent = "Adicionar música";
  }
});

async function deleteTrack(track) {
  if (!isOwner(track)) return;

  const confirmed = confirm(`Excluir "${track.title}" do catálogo?`);
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "tracks", track.id));
    if (track.storagePath) {
      try {
        await deleteObject(ref(storage, track.storagePath));
      } catch (storageError) {
        console.warn("Metadado excluído, mas o arquivo não pôde ser removido:", storageError);
      }
    }

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
  if (!track?.audioUrl) return;
  currentTrack = track;
  filteredTracks = getVisibleTracks();
  syncCurrentIndex();

  audio.src = track.audioUrl;
  audio.load();
  updatePlayerUI();
  renderTracks();

  try {
    await audio.play();
  } catch (error) {
    handlePlayError(error);
  }
}

function handlePlayError(error) {
  console.error(error);
  showToast("O navegador bloqueou a reprodução ou o arquivo não está acessível.", "error");
}

function togglePlayback() {
  if (!currentTrack) {
    const first = filteredTracks[0] || tracks[0];
    if (first) playTrack(first);
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

// ---------- search / filters ----------
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

setAuthMode("login");
renderTracks();
updatePlayerUI();
