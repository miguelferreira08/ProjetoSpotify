import {
    collection,
    deleteDoc,
    doc,
    query,
    where,
    serverTimestamp,
    setDoc,
    updateDoc,
    writeBatch,
    getDocs,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";
import {
    ADMIN_EMAIL,
    MAX_AUDIO_SIZE,
    MAX_COVER_SIZE,
    MUSIC_GENRES,
} from "./config.js";
import {
    byteSizeLabel,
    escapeHtml,
    formatTime,
    initials,
    normalizeSearchValue,
    wait,
} from "./utils.js";
import { gzipBlob, optimizeCover, readAudioDuration } from "./media.js";
import {
    buildAssetUrl,
    clearCachedTrackAssets,
    deleteSubcollection,
    getCachedAssetUrl,
    migrateLegacyTrack,
    revokeAllAssetUrls,
    revokeCachedAssetUrl,
    verifyStoredTrackBytes,
    writeSubcollectionChunks,
} from "./storage.js";
import { initAuth } from "./auth.js";
import { initScrollbar } from "./scrollbar.js";
import { initPWA } from "./pwa.js";
const $ = (selector) => document.querySelector(selector);
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
const appBackButton = $("#appBackButton");
const homeHero = $("#homeHero");
const recentSection = $("#recentSection");
const recentGrid = $("#recentGrid");
const genreGrid = $("#genreGrid");
const genreSection = $("#genreSection");
const clearGenreFilter = $("#clearGenreFilter");
const genreSelect = $("#genreSelect");
const genreSelectButton = $("#genreSelectButton");
const genreSelectMenu = $("#genreSelectMenu");
const genreSelectValue = $("#genreSelectValue");
const trackGenreSelect = $("#trackGenre");
const catalogBlock = $("#catalogBlock");
const clearSearch = $("#clearSearch");
const nowPlayingTrigger = $("#nowPlayingTrigger");
const nowPlayingScreen = $("#nowPlayingScreen");
const fullscreenBackdrop = $("#fullscreenBackdrop");
const fullscreenTrackStage = $("#fullscreenTrackStage");
const fullscreenCover = $("#fullscreenCover");
const fullscreenTitle = $("#fullscreenTitle");
const fullscreenArtist = $("#fullscreenArtist");
const fullscreenMeta = $("#fullscreenMeta");
const fullscreenLikeBtn = $("#fullscreenLikeBtn");
const fullscreenPlayBtn = $("#fullscreenPlayBtn");
const fullscreenSeekBar = $("#fullscreenSeekBar");
const fullscreenCurrentTime = $("#fullscreenCurrentTime");
const fullscreenDuration = $("#fullscreenDuration");
const dropzone = $("#dropzone");
const fileLabel = $("#fileLabel");
const coverPreview = $("#coverPreview");
const coverFileLabel = $("#coverFileLabel");
const suggestionForm = $("#suggestionForm");
const suggestionUserEmail = $("#suggestionUserEmail");
const suggestionSongName = $("#suggestionSongName");
const suggestionArtist = $("#suggestionArtist");
const suggestionSubmit = $("#suggestionSubmit");
const suggestionList = $("#suggestionList");
const suggestionTotal = $("#suggestionTotal");
const suggestionBadge = $("#suggestionBadge");
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
let isAdminUser = false;
let activeGenre = "";
let repeat = false;
let shuffle = false;
let selectedDurationSeconds = 0;
let localCoverPreviewUrl = null;
let toastTimer = null;
let playbackRequestId = 0;
let fullscreenCloseTimer = null;
audio.volume = Number(volumeBar.value);
// ==================== UTILITÁRIOS ====================

function showToast(message, type = "success") {
    toast.textContent = message;
    toast.className = `toast show${type === "error" ? " error" : ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.className = "toast";
    }, 3400);
}

function updateRange(input, percentage) {
    input.style.background = `linear-gradient( to right, #e50914 0%, #e50914 ${percentage}%, #393939 ${percentage}%, #393939 100%
  )`;
}

function isAdminAccount(user = auth.currentUser) {
    return Boolean(user?.email) && user.email.toLowerCase() === ADMIN_EMAIL;
}

function canManageCatalog() {
    return isAdminUser && isAdminAccount();
}

function isOwner() {
    return canManageCatalog();
}

function updateAdminUI(user) {
    isAdminUser = isAdminAccount(user);

    document.querySelectorAll(".admin-only").forEach((element) => {
        element.classList.toggle("hidden", !isAdminUser);
    });

    const role = $("#accountRole");
    const copy = $("#accountCopy");

    if (role) {
        role.textContent = isAdminUser ? "Administrador" : "Ouvinte";
        role.classList.toggle("is-admin", isAdminUser);
    }

    if (copy) {
        copy.textContent = isAdminUser
            ? "Você administra o catálogo global. Somente esta conta pode adicionar ou excluir músicas."
            : "Sua biblioteca e suas playlists ficam vinculadas à sua conta. O catálogo é administrado pelo RedBeat.";
    }
}
// ==================== RENDERIZAÇÃO ====================

async function hydrateCover(track, container) {
    if (!track) {
        return;
    }
    try {
        const url = await buildAssetUrl(track, "cover");
        const element = container.querySelector(`[data-cover-id="${CSS.escape(track.id)}"]`);
        if (element) {
            element.textContent = "";
            element.style.backgroundImage = `url("${url}")`;
        }
    }
    catch (error) {
        console.warn(error);
    }
}

async function hydrateListCovers(list, container) {
    for (const track of list) {
        hydrateCover(track, container);
    }
}

function genreMatches(track, genre) {
    return normalizeSearchValue(track.genre) === normalizeSearchValue(genre);
}

function getHomeTracks() {
    const term = normalizeSearchValue(searchInput.value);
    let list = tracks;

    if (activeGenre) {
        list = list.filter((track) => genreMatches(track, activeGenre));
    }

    if (!term) {
        return list;
    }

    return list.filter((track) => {
        const searchableFields = [
            track.title,
            track.artist,
            track.album,
            track.genre,
        ];

        return searchableFields.some((value) =>
            normalizeSearchValue(value).includes(term)
        );
    });
}

function closeGenreSelect() {
    genreSelectMenu?.classList.add("hidden");
    genreSelectButton?.setAttribute("aria-expanded", "false");
    genreSelect?.classList.remove("open");
}

function openGenreSelect() {
    genreSelectMenu?.classList.remove("hidden");
    genreSelectButton?.setAttribute("aria-expanded", "true");
    genreSelect?.classList.add("open");
}

function setGenreSelectValue(value = "") {
    const safeValue = MUSIC_GENRES.includes(value) ? value : "";
    trackGenreSelect.value = safeValue;
    genreSelectValue.textContent = safeValue || "Selecione o gênero";
    genreSelectButton.classList.toggle("has-value", Boolean(safeValue));

    genreSelectMenu?.querySelectorAll("[data-genre-option]").forEach((option) => {
        const selected = option.dataset.genreOption === safeValue;
        option.classList.toggle("selected", selected);
        option.setAttribute("aria-selected", String(selected));
    });
}

genreSelectButton?.addEventListener("click", () => {
    if (genreSelectMenu.classList.contains("hidden")) {
        openGenreSelect();
    } else {
        closeGenreSelect();
    }
});

genreSelectMenu?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-genre-option]");
    if (!option) {
        return;
    }
    setGenreSelectValue(option.dataset.genreOption || "");
    closeGenreSelect();
    genreSelectButton.focus();
});

document.addEventListener("click", (event) => {
    if (!genreSelect?.contains(event.target)) {
        closeGenreSelect();
    }
});

genreSelectButton?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeGenreSelect();
        return;
    }
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openGenreSelect();
        const selected = genreSelectMenu.querySelector(".custom-option.selected")
            || genreSelectMenu.querySelector(".custom-option:not(.placeholder)");
        selected?.focus();
    }
});

genreSelectMenu?.addEventListener("keydown", (event) => {
    const options = [...genreSelectMenu.querySelectorAll(".custom-option")];
    const current = options.indexOf(document.activeElement);
    if (event.key === "Escape") {
        closeGenreSelect();
        genreSelectButton.focus();
        return;
    }
    if (event.key === "ArrowDown") {
        event.preventDefault();
        options[(current + 1 + options.length) % options.length]?.focus();
    }
    if (event.key === "ArrowUp") {
        event.preventDefault();
        options[(current - 1 + options.length) % options.length]?.focus();
    }
});

function renderGenreCards() {
    for (const genre of MUSIC_GENRES) {
        const count = tracks.filter((track) => genreMatches(track, genre)).length;
        const counter = document.querySelector(`[data-genre-count="${CSS.escape(genre)}"]`);
        const card = genreGrid?.querySelector(`[data-genre="${CSS.escape(genre)}"]`);

        if (counter) {
            counter.textContent = `${count} ${count === 1 ? "música" : "músicas"}`;
        }

        card?.classList.toggle("active", activeGenre === genre);
    }

    clearGenreFilter?.classList.toggle("hidden", !activeGenre);
}

function setGenreFilter(genre = "") {
    activeGenre = MUSIC_GENRES.includes(genre) ? genre : "";
    searchInput.value = "";
    renderHome();
    updateAppBackButton();

    requestAnimationFrame(() => {
        catalogBlock.scrollIntoView({
            behavior: "smooth",
            block: "start",
        });
    });
}

function trackRows(list, context = "home") {
    if (!list.length) {
        const message = context === "home"
            ? "Adicione a primeira música do catálogo." : "Adicione músicas à sua biblioteca ou playlist.";
        return `
      <div class="empty-state">
        <div class="empty-icon">♫</div> <h2>Nenhuma música aqui</h2> <p>${message}</p>
      </div>
    `;
    }
    return list
        .map((track, index) => {
        const isCurrent = currentTrack?.id === track.id;
        const isSaved = savedTrackIds.has(track.id);
        const playIcon = playStateMarkup(isCurrent && !audio.paused);
        return ` <article
          class="track-row ${isCurrent ? "active" : ""}" data-id="${track.id}" data-context="${context}"
        >
          <div class="track-index">
            <span class="row-index">${index + 1}</span> <button class="row-play" data-action="play">${playIcon}</button>
          </div>
          <div class="title-cell">
            <div class="cover" data-cover-id="${track.id}">
              ${initials(track.title)}
            </div>
            <div class="title-stack">
              <strong>${escapeHtml(track.title)}</strong> <span>${escapeHtml(track.artist)}</span>
            </div>
          </div>
          <span class="album-cell">${escapeHtml(track.album || "-")}</span> <span class="genre-cell">${escapeHtml(track.genre || "-")}</span> <span class="duration-cell">
            ${escapeHtml(track.durationFormatted || formatTime(Number(track.duration) || 0))}
          </span>
          <button
            class="row-like ${isSaved ? "liked" : ""}" data-action="save" aria-label="Salvar"
          >
            ${isSaved ? "♥" : "♡"}
          </button>
          <button class="row-menu" data-action="menu">⋯</button>
        </article>
      `;
    })
        .join("");
}

function renderRecentTracks() {
    const recentTracks = tracks.slice(0, 5);
    if (!recentTracks.length) {
        recentGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">♫</div> <h2>Seu catálogo está vazio</h2> <p>Adicione a primeira música para começar.</p>
      </div>
    `;
        return;
    }
    recentGrid.innerHTML = recentTracks
        .map((track) => `
      <button class="recent-card" type="button" data-track-id="${track.id}">
        <span class="recent-cover" data-cover-id="${track.id}">${initials(track.title)}</span> <strong>${escapeHtml(track.title)}</strong> <span>${escapeHtml(track.artist)}</span>
      </button>
    `)
        .join("");
    hydrateListCovers(recentTracks, recentGrid);
}

function updateHomeDashboard() {
    const user = auth.currentUser;
    const accountName = user?.email?.split("@")[0] || "ouvinte";
    const displayName = accountName
        .replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    $("#homeGreeting").textContent = `Olá, ${displayName}.`;
    $("#homeTrackTotal").textContent = String(tracks.length);
    $("#homeSavedTotal").textContent = String(savedTrackIds.size);
    $("#homePlaylistTotal").textContent = String(playlists.length);
}

function renderHome() {
    visibleTracks = getHomeTracks();
    const term = searchInput.value.trim();
    const isSearching = Boolean(term);
    const isGenreFiltered = Boolean(activeGenre);

    homeHero.classList.toggle("searching", isSearching);
    recentSection.classList.toggle("searching", isSearching || isGenreFiltered);
    clearSearch.classList.toggle("hidden", !isSearching);

    $("#catalogEyebrow").textContent = isSearching
        ? "PESQUISA"
        : isGenreFiltered
            ? "GÊNERO"
            : "CATÁLOGO";

    $("#catalogTitle").textContent = isSearching
        ? `Resultados para “${term}”`
        : isGenreFiltered
            ? activeGenre
            : "Todas as músicas";

    const searchStatus = $("#searchStatus");
    const hasStatus = isSearching || isGenreFiltered;
    searchStatus.classList.toggle("hidden", !hasStatus);
    searchStatus.textContent = isSearching
        ? `${visibleTracks.length} ${visibleTracks.length === 1 ? "resultado encontrado" : "resultados encontrados"} no catálogo salvo.`
        : isGenreFiltered
            ? `${visibleTracks.length} ${visibleTracks.length === 1 ? "música" : "músicas"} em ${activeGenre}.`
            : "";
    $("#trackCount").textContent = `${visibleTracks.length} ${visibleTracks.length === 1 ? "música" : "músicas"}`;
    trackList.innerHTML = trackRows(visibleTracks, "home");
    hydrateListCovers(visibleTracks, trackList);
    if (!isSearching && !isGenreFiltered) {
        renderRecentTracks();
    }

    renderGenreCards();
    updateHomeDashboard();
    syncCurrentIndex();
}

function renderLibrary() {
    $("#savedCount").textContent = `${savedTrackIds.size} ${savedTrackIds.size === 1 ? "música" : "músicas"}`;
    updateHomeDashboard();
    $("#playlistGrid").innerHTML = playlists
        .map((playlist) => `
      <div
        class="playlist-card-wrap" data-playlist-id="${playlist.id}"
      >
        <button
          class="playlist-card" data-action="open-playlist"
        >
          <span class="playlist-cover">♫</span> <strong>${escapeHtml(playlist.name || "Playlist")}</strong> <small>Playlist</small>
        </button>
        <button
          class="playlist-delete" data-action="delete-playlist" title="Excluir playlist"
        >
          ×
        </button>
      </div>
    `)
        .join("");
    if (activeView === "library" &&
        libraryMode !== "overview") {
        renderLibraryDetail();
    }
}

function renderLibraryDetail() {
    let list = [];
    if (libraryMode === "saved") {
        $("#libraryDetailTitle").textContent = "Músicas salvas";
        list = tracks.filter((track) => savedTrackIds.has(track.id));
    }
    else if (libraryMode === "playlist" &&
        selectedPlaylist) {
        $("#libraryDetailTitle").textContent =
            selectedPlaylist.name || "Playlist";
        list = currentLibraryTracks;
    }
    libraryTrackList.innerHTML = trackRows(list, libraryMode);
    hydrateListCovers(list, libraryTrackList);
}

function refreshCurrentTrack() {
    if (!currentTrack) {
        return;
    }
    const freshTrack = tracks.find((track) => track.id === currentTrack.id);
    if (freshTrack) {
        currentTrack = freshTrack;
    }
    updatePlayerUI();
}

function syncCurrentIndex() {
    let list;
    if (activeView === "home") {
        list = visibleTracks;
    }
    else if (libraryMode === "saved") {
        list = tracks.filter((track) => savedTrackIds.has(track.id));
    }
    else {
        list = currentLibraryTracks;
    }
    currentIndex = list.findIndex((track) => track.id === currentTrack?.id);
}
// ==================== BIBLIOTECA E PLAYLISTS ====================

async function toggleSaved(track) {
    const user = auth.currentUser;
    if (!user) {
        return;
    }
    const savedRef = doc(db, "users", user.uid, "savedTracks", track.id);
    if (savedTrackIds.has(track.id)) {
        await deleteDoc(savedRef);
    }
    else {
        await setDoc(savedRef, {
            trackId: track.id, savedAt: serverTimestamp(),
        });
    }
}

async function createPlaylist(name) {
    const user = auth.currentUser;
    if (!user) {
        return;
    }
    const playlistRef = doc(collection(db, "users", user.uid, "playlists"));
    await setDoc(playlistRef, {
        name, ownerId: user.uid, createdAt: serverTimestamp(),
    });
    return playlistRef.id;
}

async function deletePlaylist(id) {
    const user = auth.currentUser;
    if (!user) {
        return;
    }
    const items = await getDocs(collection(db, "users", user.uid, "playlists", id, "items"));
    for (let start = 0; start < items.docs.length; start += 300) {
        const batch = writeBatch(db);
        for (const document of items.docs.slice(start, start + 300)) {
            batch.delete(document.ref);
        }
        await batch.commit();
    }
    await deleteDoc(doc(db, "users", user.uid, "playlists", id));
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
    await setDoc(doc(db, "users", user.uid, "playlists", playlist.id, "items", track.id), {
        trackId: track.id, addedAt: serverTimestamp(),
    });
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
    const snapshot = await getDocs(collection(db, "users", user.uid, "playlists", playlist.id, "items"));
    const ids = new Set(snapshot.docs.map((document) => document.id));
    currentLibraryTracks = tracks.filter((track) => ids.has(track.id));
    libraryMode = "playlist";
    showLibraryDetail();
}
function renderSuggestions() {
    // Renderização administrada em auth.js
}

// ==================== NAVEGAÇÃO ====================

function canGoBackInsideApp() {
    if (activeView === "library") {
        return true;
    }
    if (activeView === "home" && (searchInput.value.trim() || activeGenre)) {
        return true;
    }
    return false;
}

function updateAppBackButton() {
    const canGoBack = canGoBackInsideApp();
    appBackButton.disabled = !canGoBack;
    appBackButton.setAttribute("aria-disabled", String(!canGoBack));
    if (activeView === "library" && libraryMode !== "overview") {
        appBackButton.title = "Voltar para a biblioteca";
        appBackButton.setAttribute("aria-label", "Voltar para a biblioteca");
        return;
    }
    if (activeView === "library" || activeView === "suggestions") {
        appBackButton.title = "Voltar para o início";
        appBackButton.setAttribute("aria-label", "Voltar para o início");
        return;
    }
    if (searchInput.value.trim() || activeGenre) {
        appBackButton.title = "Voltar para todas as músicas";
        appBackButton.setAttribute("aria-label", "Voltar para todas as músicas");
        return;
    }
    appBackButton.title = "Voltar";
    appBackButton.setAttribute("aria-label", "Voltar dentro do aplicativo");
}

function goBackInsideApp() {
    if (activeView === "library" && libraryMode !== "overview") {
        showLibraryOverview();
        return;
    }
    if (activeView === "library" || activeView === "suggestions") {
        setView("home");
        return;
    }
    if (activeView === "home" && (searchInput.value.trim() || activeGenre)) {
        searchInput.value = "";
        activeGenre = "";
        renderHome();
        updateAppBackButton();
    }
}

function setView(view) {
    activeView = view;
    $("#homeView").classList.toggle("hidden", view !== "home");
    $("#libraryView").classList.toggle("hidden", view !== "library");
    $("#suggestionView").classList.toggle("hidden", view !== "suggestions");
    $("#showHome").classList.toggle("active", view === "home");
    $("#showLibrary").classList.toggle("active", view === "library");
    $("#showSuggestions").classList.toggle("active", view === "suggestions");

    if (view === "home") {
        renderHome();
    }
    else if (view === "library") {
        renderLibrary();
    }
    else {
        renderSuggestions();
    }
    updateAppBackButton();
    $("#pageScrollContainer")?.scrollTo({
        top: 0, behavior: "smooth",
    });
}

function showLibraryOverview() {
    $("#libraryOverview").classList.remove("hidden");
    $("#libraryDetail").classList.add("hidden");
    libraryMode = "overview";
    renderLibrary();
    updateAppBackButton();
}

function showLibraryDetail() {
    $("#libraryOverview").classList.add("hidden");
    $("#libraryDetail").classList.remove("hidden");
    renderLibraryDetail();
    updateAppBackButton();
}
$("#showHome").addEventListener("click", () => {
    activeGenre = "";
    searchInput.value = "";
    setView("home");
});
$("#brandHome").addEventListener("click", (event) => {
    event.preventDefault();
    activeGenre = "";
    searchInput.value = "";
    setView("home");
});
$("#showLibrary").addEventListener("click", () => {
    setView("library");
    showLibraryOverview();
});

$("#showSuggestions").addEventListener("click", () => {
    setView("suggestions");
});
$("#backLibrary").addEventListener("click", goBackInsideApp);
appBackButton.addEventListener("click", goBackInsideApp);
$("#openSavedTracks").addEventListener("click", () => {
    libraryMode = "saved";
    showLibraryDetail();
});
searchInput.addEventListener("input", () => {
    activeGenre = "";
    if (activeView !== "home") {
        setView("home");
    }
    renderHome();
    updateAppBackButton();
});
searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && searchInput.value.trim()) {
        event.preventDefault();
        catalogBlock.scrollIntoView({
            behavior: "smooth", block: "start",
        });
    }
});
clearSearch.addEventListener("click", () => {
    searchInput.value = "";
    activeGenre = "";
    searchInput.focus();
    renderHome();
    updateAppBackButton();
});
genreGrid?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-genre]");
    if (!card) {
        return;
    }

    setGenreFilter(card.dataset.genre || "");
});

clearGenreFilter?.addEventListener("click", () => {
    setGenreFilter("");
});

recentGrid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-track-id]");
    if (!card) {
        return;
    }
    const track = tracks.find((item) => item.id === card.dataset.trackId);
    if (track) {
        playTrack(track);
    }
});
$("#heroPlayBtn").addEventListener("click", () => {
    const firstTrack = getHomeTracks()[0] || tracks[0];
    if (firstTrack) {
        playTrack(firstTrack);
    }
    else {
        showToast("Adicione uma música ao catálogo primeiro.");
    }
});
$("#heroLibraryBtn").addEventListener("click", () => {
    setView("library");
    showLibraryOverview();
});
$("#heroUploadBtn").addEventListener("click", () => {
    if (!canManageCatalog()) {
        showToast("Somente o administrador pode adicionar músicas.", "error");
        return;
    }

    uploadModal.showModal();
});
$("#catalogStat").addEventListener("click", () => {
    catalogBlock.scrollIntoView({
        behavior: "smooth", block: "start",
    });
});
$("#savedStat").addEventListener("click", () => {
    setView("library");
    libraryMode = "saved";
    showLibraryDetail();
});
$("#playlistStat").addEventListener("click", () => {
    setView("library");
    showLibraryOverview();
});
$("#openCreatePlaylist").addEventListener("click", () => {
    createPlaylistModal.showModal();
});
$("#createPlaylistForm").addEventListener("submit", async (event) => {
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
    }
    catch (error) {
        console.error(error);
        showToast("Não foi possível criar a playlist.", "error");
    }
});
$("#playlistGrid").addEventListener("click", async (event) => {
    const wrapper = event.target.closest("[data-playlist-id]");
    if (!wrapper) {
        return;
    }
    const playlist = playlists.find((item) => item.id === wrapper.dataset.playlistId);
    if (!playlist) {
        return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "delete-playlist") {
        if (confirm(`Excluir a playlist “${playlist.name}”?`)) {
            await deletePlaylist(playlist.id);
        }
    }
    else if (action === "open-playlist") {
        await loadPlaylist(playlist);
    }
});
// ==================== AÇÕES DAS MÚSICAS ====================

function openTrackActions(track) {
    selectedActionTrack = track;
    $("#actionTrackTitle").textContent = track.title;
    $("#actionSaveTrack").textContent = savedTrackIds.has(track.id)
        ? "Remover da biblioteca" : "Salvar na biblioteca";
    $("#actionDeleteTrack").classList.toggle("hidden", !canManageCatalog());
    $("#actionPlaylistList").innerHTML = playlists.length
        ? playlists
            .map((playlist) => ` <button
              class="action-item" data-playlist-id="${playlist.id}"
            >
              ${escapeHtml(playlist.name)}
            </button>
          `)
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
$("#actionPlaylistList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-playlist-id]");
    if (!button || !selectedActionTrack) {
        return;
    }
    const playlist = playlists.find((item) => item.id === button.dataset.playlistId);
    if (playlist) {
        await addToPlaylist(selectedActionTrack, playlist);
        trackActionsModal.close();
    }
});
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
    const track = tracks.find((item) => item.id === row.dataset.id);
    if (!track) {
        return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
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
        if (currentTrack?.id === track.id &&
            !audio.paused) {
            audio.pause();
        }
        else {
            playTrack(track);
        }
        return;
    }
    if (!action) {
        playTrack(track);
    }
}
trackList.addEventListener("click", listClickHandler);
libraryTrackList.addEventListener("click", listClickHandler);
$("#openUpload").addEventListener("click", () => {
    if (!canManageCatalog()) {
        showToast("Somente o administrador pode adicionar músicas.", "error");
        return;
    }

    uploadModal.showModal();
});
audioFile.addEventListener("change", async () => {
    const file = audioFile.files?.[0];
    fileLabel.textContent = file
        ? file.name : "Clique ou arraste um arquivo de áudio";
    selectedDurationSeconds = 0;
    $("#trackDuration").value = file
        ? "Lendo duração…" : "Selecione um arquivo";
    if (file && !$("#trackTitle").value) {
        $("#trackTitle").value = file.name.replace(/\.[^/.]+$/, "");
    }
    if (!file) {
        return;
    }
    try {
        selectedDurationSeconds = await readAudioDuration(file);
        $("#trackDuration").value = formatTime(selectedDurationSeconds);
    }
    catch (error) {
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

    if (!user || !canManageCatalog()) {
        showToast("Somente o administrador pode adicionar músicas.", "error");
        uploadModal.close();
        return;
    }

    const music = audioFile.files?.[0];
    const image = coverFile.files?.[0];
    const title = $("#trackTitle").value.trim();
    const artist = $("#trackArtist").value.trim();
    const album = $("#trackAlbum").value.trim();
    const genre = $("#trackGenre").value.trim();

    if (!MUSIC_GENRES.includes(genre)) {
        showToast("Selecione um gênero válido.", "error");
        return;
    }

    if (!music || !image || !title || !artist || !album || !genre) {
        showToast("Preencha todos os dados e selecione áudio e capa.", "error");
        return;
    }
    if (music.size > MAX_AUDIO_SIZE ||
        image.size > MAX_COVER_SIZE) {
        showToast("Arquivo acima do limite permitido.", "error");
        return;
    }
    if (!selectedDurationSeconds) {
        try {
            selectedDurationSeconds = await readAudioDuration(music);
        }
        catch {
            showToast("Não foi possível ler a duração.", "error");
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
            gzipBlob(cover), gzipBlob(music),
        ]);
        await setDoc(trackRef, {
            title, artist, album, genre, duration: selectedDurationSeconds,
                durationFormatted: formatTime(selectedDurationSeconds), ownerId: user.uid,
                ownerEmail: user.email || "", recordType: "track", status: "uploading",
                storageLayout: "subcollections-v2",
            audioMime: music.type || "audio/mpeg", audioCompression: "gzip", audioOriginalSize: music.size,
                audioCompressedSize: audioGzip.byteLength, coverMime: cover.type || "image/webp",
                coverCompression: "gzip", coverOriginalSize: image.size, coverOptimizedSize: cover.size,
            coverCompressedSize: coverGzip.byteLength, createdAt: serverTimestamp(),
        });
        created = true;
        const total = coverGzip.byteLength + audioGzip.byteLength;
        let done = 0;
        const report = (bytes) => {
            done += bytes;
            const percentage = Math.min(99, Math.round((done / total) * 100));
            bar.classList.remove("pending");
            progress.style.width = `${percentage}%`;
            progressText.textContent =
                `Salvando… ${percentage}% • ${byteSizeLabel(done)} de ${byteSizeLabel(total)}`;
        };
        const coverCount = await writeSubcollectionChunks(trackRef, "coverChunks", coverGzip, report);
        const audioCount = await writeSubcollectionChunks(trackRef, "audioChunks", audioGzip, report);
        progressText.textContent = "Verificando integridade do upload…";
        await verifyStoredTrackBytes(trackRef.id, coverGzip, audioGzip);
        await updateDoc(trackRef, {
            coverChunkCount: coverCount, audioChunkCount: audioCount, status: "ready",
                updatedAt: serverTimestamp(),
        });
        progress.style.width = "100%";
        progressText.textContent = "Música adicionada.";
        showToast("Música adicionada.");
        uploadForm.reset();
        setGenreSelectValue("");
        closeGenreSelect();
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
    }
    catch (error) {
        console.error(error);
        if (created) {
            try {
                await deleteSubcollection(trackRef, "audioChunks");
                await deleteSubcollection(trackRef, "coverChunks");
                await deleteDoc(trackRef);
            }
            catch (cleanupError) {
                console.warn(cleanupError);
            }
        }
        bar.classList.remove("pending");
        progressText.textContent = `Falha (${error.code || "erro"}).`;
        showToast(`Não foi possível adicionar (${error.code || "erro"}).`, "error");
    }
    finally {
        submit.disabled = false;
        submit.textContent = "Adicionar música";
    }
});

async function deleteTrack(track) {
    if (!canManageCatalog()) {
        showToast("Somente o administrador pode excluir músicas.", "error");
        return;
    }

    if (!confirm(`Excluir “${track.title}”?`)) {
        return;
    }
    const trackRef = doc(db, "tracks", track.id);
    try {
        if (track.storageLayout === "subcollections-v2") {
            await deleteSubcollection(trackRef, "audioChunks");
            await deleteSubcollection(trackRef, "coverChunks");
        }
        else {
            const legacy = await getDocs(query(collection(db, "tracks"), where("parentTrackId", "==",
                track.id)));
            for (let start = 0; start < legacy.docs.length; start += 300) {
                const batch = writeBatch(db);
                for (const document of legacy.docs.slice(start, start + 300)) {
                    batch.delete(document.ref);
                }
                await batch.commit();
            }
        }
        await deleteDoc(trackRef);
        clearCachedTrackAssets(track.id);
        showToast("Música excluída.");
    }
    catch (error) {
        console.error(error);
        showToast("Não foi possível excluir.", "error");
    }
}


suggestionForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const user = auth.currentUser;
    const songName = suggestionSongName.value.trim();
    const artist = suggestionArtist.value.trim();

    if (!user) {
        showToast("Entre na sua conta para enviar uma sugestão.", "error");
        return;
    }

    if (!songName || !artist) {
        showToast("Informe o nome da música e o artista.", "error");
        return;
    }

    suggestionSubmit.disabled = true;
    suggestionSubmit.textContent = "Enviando…";

    try {
        const suggestionRef = doc(collection(db, "suggestions"));

        await setDoc(suggestionRef, {
            senderUid: user.uid,
            senderEmail: user.email || "",
            recipientEmail: ADMIN_EMAIL,
            recipientLabel: "Administrador",
            songName,
            artist,
            status: "new",
            createdAt: serverTimestamp(),
        });

        suggestionSongName.value = "";
        suggestionArtist.value = "";
        showToast("Sugestão enviada ao administrador.");
    }
    catch (error) {
        console.error("Enviar sugestão:", error);
        showToast("Não foi possível enviar a sugestão.", "error");
    }
    finally {
        suggestionSubmit.disabled = false;
        suggestionSubmit.textContent = "Enviar sugestão";
    }
});

suggestionList.addEventListener("click", async (event) => {
    const button = event.target.closest('[data-action="remove-suggestion"]');

    if (!button || !canManageCatalog()) {
        return;
    }

    const card = button.closest("[data-suggestion-id]");
    const suggestionId = card?.dataset.suggestionId;

    if (!suggestionId) {
        return;
    }

    try {
        button.disabled = true;
        await deleteDoc(doc(db, "suggestions", suggestionId));
        showToast("Sugestão removida.");
    }
    catch (error) {
        console.error("Excluir sugestão:", error);
        button.disabled = false;
        showToast("Não foi possível excluir a sugestão.", "error");
    }
});

// ==================== PLAYER E TELA CHEIA ====================

let playbackHealthTimer = null;
const playbackRecoveryAttempts = new Map();

function clearPlaybackHealthTimer() {
    clearTimeout(playbackHealthTimer);
    playbackHealthTimer = null;
}

function resetPlaybackRecovery(trackId = currentTrack?.id) {
    if (trackId) {
        playbackRecoveryAttempts.delete(trackId);
    }

    clearPlaybackHealthTimer();
}

function schedulePlaybackHealthCheck(delay = 1600) {
    clearPlaybackHealthTimer();

    if (!currentTrack || audio.paused) {
        return;
    }

    const snapshotTime = audio.currentTime;
    playbackHealthTimer = setTimeout(() => {
        if (!currentTrack || audio.paused) {
            return;
        }

        const remaining = Number.isFinite(audio.duration)
            ? Math.max(0, audio.duration - audio.currentTime)
            : Infinity;
        const stalled = Math.abs(audio.currentTime - snapshotTime) < 0.02
            && audio.currentTime > 0
            && remaining > 0.8;

        if (stalled) {
            recoverCurrentTrackPlayback("stalled").catch(console.error);
        }
    }, delay);
}

async function recoverCurrentTrackPlayback(reason = "error") {
    if (!currentTrack) {
        return;
    }

    const trackId = currentTrack.id;
    const attempts = playbackRecoveryAttempts.get(trackId) || 0;

    if (attempts >= 2) {
        showToast(
            "Não foi possível recuperar esta faixa. Se persistir, exclua e envie a música novamente.",
            "error",
        );
        return;
    }

    playbackRecoveryAttempts.set(trackId, attempts + 1);

    const resumeTime = Math.max(0, audio.currentTime || 0);
    const shouldResume = !audio.paused;

    try {
        showToast("Recuperando reprodução…");
        revokeCachedAssetUrl(trackId, "audio");

        const source = currentTrack.audioUrl && currentTrack.audioUrl !== "firestore-chunks"
            ? currentTrack.audioUrl
            : await buildAssetUrl(currentTrack, "audio");

        await new Promise((resolve, reject) => {
            const onLoaded = () => {
                audio.removeEventListener("error", onError);
                resolve();
            };

            const onError = () => {
                audio.removeEventListener("loadedmetadata", onLoaded);
                reject(new Error(reason));
            };

            audio.addEventListener("loadedmetadata", onLoaded, { once: true });
            audio.addEventListener("error", onError, { once: true });
            audio.src = source;
            audio.load();
        });

        if (resumeTime > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
            audio.currentTime = Math.min(resumeTime, Math.max(0, audio.duration - 0.35));
        }

        if (shouldResume) {
            await audio.play();
        }
    }
    catch (error) {
        console.error("Playback recovery:", error);
        showToast("A reprodução falhou. Tente tocar novamente.", "error");
    }
}

function isNowPlayingScreenOpen() {
    return nowPlayingScreen.classList.contains("is-open");
}

async function selectCurrentTrack(track) {
    const changingTrack = Boolean(currentTrack &&
        currentTrack.id !== track.id);
    if (changingTrack && isNowPlayingScreenOpen()) {
        nowPlayingScreen.classList.add("is-switching");
        fullscreenTrackStage.classList.remove("track-enter");
        fullscreenTrackStage.classList.add("track-exit");
        await wait(220);
    }
    resetPlaybackRecovery(track?.id);
    currentTrack = track;
    updatePlayerUI();
    renderHome();
    renderLibraryDetail();
    if (changingTrack && isNowPlayingScreenOpen()) {
        fullscreenTrackStage.classList.remove("track-exit");
        void fullscreenTrackStage.offsetWidth;
        fullscreenTrackStage.classList.add("track-enter");
        requestAnimationFrame(() => {
            nowPlayingScreen.classList.remove("is-switching");
        });
        setTimeout(() => {
            fullscreenTrackStage.classList.remove("track-enter");
        }, 440);
    }
}

async function playTrack(track) {
    const requestId = ++playbackRequestId;
    await selectCurrentTrack(track);
    try {
        showToast("Preparando música…");
        const source = track.audioUrl && track.audioUrl !== "firestore-chunks"
            ? track.audioUrl : await buildAssetUrl(track, "audio");
        if (requestId !== playbackRequestId ||
            currentTrack?.id !== track.id) {
            return;
        }
        audio.src = source;
        audio.load();
        await audio.play();
        resetPlaybackRecovery(track.id);
        await updateMediaSession(track);
    }
    catch (error) {
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
                src: cover, type: track.coverMime || "image/webp",
            },
        ];
    }
    catch { }
    navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title, artist: track.artist, album: track.album, artwork,
    });
}

function currentPlaybackList() {
    if (activeView === "home") {
        if (searchInput.value.trim()) {
            return tracks;
        }
        return visibleTracks.length
            ? visibleTracks : tracks;
    }
    if (libraryMode === "saved") {
        return tracks.filter((track) => savedTrackIds.has(track.id));
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
    }
    else {
        audio.pause();
    }
}

function nextTrack() {
    const list = currentPlaybackList();
    if (!list.length) {
        return;
    }
    let index = list.findIndex((track) => track.id === currentTrack?.id);
    if (shuffle && list.length > 1) {
        let randomIndex;
        do {
            randomIndex = Math.floor(Math.random() * list.length);
        } while (list[randomIndex].id === currentTrack?.id);
        playTrack(list[randomIndex]);
        return;
    }
    index = index < 0
        ? 0 : (index + 1) % list.length;
    playTrack(list[index]);
}

function prevTrack() {
    const list = currentPlaybackList();
    if (!list.length) {
        return;
    }
    let index = list.findIndex((track) => track.id === currentTrack?.id);
    index = index <= 0
        ? list.length - 1 : index - 1;
    playTrack(list[index]);
}

function logoPlaceholderMarkup() {
    return '<img alt="" src="./favicon.svg?v=16">';
}

function setLogoPlaceholder(element) {
    element.style.backgroundImage = "";
    element.innerHTML = logoPlaceholderMarkup();
}

function playStateMarkup(isPlaying) {
    return `<span class="${isPlaying ? "pause-symbol" : "play-symbol"}" aria-hidden="true"></span>`;
}

function setPlayState(button, isPlaying) {
    button.innerHTML = playStateMarkup(isPlaying);
    button.setAttribute("aria-label", isPlaying ? "Pausar" : "Reproduzir");
}

function setFullscreenCover(track) {
    if (!track) {
        fullscreenBackdrop.style.backgroundImage = "";
        setLogoPlaceholder(fullscreenCover);
        return;
    }
    const cached = getCachedAssetUrl(track.id, "cover");
    if (cached) {
        fullscreenCover.innerHTML = "";
        fullscreenCover.style.backgroundImage = `url("${cached}")`;
        fullscreenBackdrop.style.backgroundImage = `url("${cached}")`;
        return;
    }
    fullscreenCover.innerHTML = initials(track.title);
    fullscreenCover.style.backgroundImage = "";
    fullscreenBackdrop.style.backgroundImage = "";
    buildAssetUrl(track, "cover")
        .then((url) => {
        if (currentTrack?.id !== track.id) {
            return;
        }
        fullscreenCover.innerHTML = "";
        fullscreenCover.style.backgroundImage = `url("${url}")`;
        fullscreenBackdrop.style.backgroundImage = `url("${url}")`;
    })
        .catch(console.warn);
}

function updateFullscreenUI() {
    if (!currentTrack) {
        fullscreenTitle.textContent = "Nenhuma música";
        fullscreenArtist.textContent = "Escolha uma faixa";
        fullscreenMeta.textContent = "—";
        fullscreenLikeBtn.textContent = "♡";
        fullscreenLikeBtn.classList.remove("liked");
        setPlayState(fullscreenPlayBtn, false);
        setFullscreenCover(null);
        return;
    }
    fullscreenTitle.textContent = currentTrack.title;
    fullscreenArtist.textContent = currentTrack.artist;
    fullscreenMeta.textContent = [
        currentTrack.album || "Sem álbum", currentTrack.genre || "Sem gênero",
            currentTrack.durationFormatted || formatTime(Number(currentTrack.duration) || 0),
    ].join(" • ");
    const isSaved = savedTrackIds.has(currentTrack.id);
    fullscreenLikeBtn.textContent = isSaved ? "♥" : "♡";
    fullscreenLikeBtn.classList.toggle("liked", isSaved);
    setPlayState(fullscreenPlayBtn, !audio.paused);
    setFullscreenCover(currentTrack);
}

function openNowPlayingScreen() {
    if (!currentTrack || audio.paused) {
        return;
    }
    clearTimeout(fullscreenCloseTimer);
    updateFullscreenUI();
    nowPlayingScreen.classList.remove("hidden");
    nowPlayingScreen.setAttribute("aria-hidden", "false");
    document.body.classList.add("now-playing-open");
    requestAnimationFrame(() => {
        nowPlayingScreen.classList.add("is-open");
    });
}

function closeNowPlayingScreen() {
    if (nowPlayingScreen.classList.contains("hidden")) {
        return;
    }
    nowPlayingScreen.classList.remove("is-open");
    nowPlayingScreen.setAttribute("aria-hidden", "true");
    document.body.classList.remove("now-playing-open");
    clearTimeout(fullscreenCloseTimer);
    fullscreenCloseTimer = setTimeout(() => {
        nowPlayingScreen.classList.add("hidden");
    }, 350);
}

function updatePlayerUI() {
    const canOpenFullscreen = Boolean(currentTrack &&
        !audio.paused);
    nowPlayingTrigger.classList.toggle("is-clickable", canOpenFullscreen);
    nowPlayingTrigger.setAttribute("aria-disabled", String(!canOpenFullscreen));
    if (!currentTrack) {
        playerTitle.textContent = "Nenhuma música";
        playerArtist.textContent = "Escolha uma faixa";
        setLogoPlaceholder(playerCover);
        playerLike.textContent = "♡";
        playerLike.classList.remove("liked");
        setPlayState(playBtn, false);
        updateFullscreenUI();
        return;
    }
    playerTitle.textContent = currentTrack.title;
    playerArtist.textContent = currentTrack.artist;
    const isSaved = savedTrackIds.has(currentTrack.id);
    playerLike.textContent = isSaved ? "♥" : "♡";
    playerLike.classList.toggle("liked", isSaved);
    setPlayState(playBtn, !audio.paused);
    updateFullscreenUI();
    const cachedCover = getCachedAssetUrl(currentTrack.id, "cover");
    if (cachedCover) {
        playerCover.innerHTML = "";
        playerCover.style.backgroundImage = `url("${cachedCover}")`;
        return;
    }
    playerCover.innerHTML = initials(currentTrack.title);
    playerCover.style.backgroundImage = "";
    const trackId = currentTrack.id;
    buildAssetUrl(currentTrack, "cover")
        .then((url) => {
        if (currentTrack?.id === trackId) {
            playerCover.innerHTML = "";
            playerCover.style.backgroundImage = `url("${url}")`;
            updateFullscreenUI();
        }
    })
        .catch(console.warn);
}
playBtn.addEventListener("click", togglePlayback);
$("#nextBtn").addEventListener("click", nextTrack);
$("#prevBtn").addEventListener("click", prevTrack);
$("#shuffleBtn").addEventListener("click", (event) => {
    shuffle = !shuffle;
    event.currentTarget.classList.toggle("active", shuffle);
});
$("#repeatBtn").addEventListener("click", (event) => {
    repeat = !repeat;
    event.currentTarget.classList.toggle("active", repeat);
});
playerLike.addEventListener("click", (event) => {
    event.stopPropagation();
    if (currentTrack) {
        toggleSaved(currentTrack);
    }
});
nowPlayingTrigger.addEventListener("click", (event) => {
    if (event.target.closest("button")) {
        return;
    }
    openNowPlayingScreen();
});
nowPlayingTrigger.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openNowPlayingScreen();
    }
});
$("#closeNowPlaying").addEventListener("click", closeNowPlayingScreen);
$("#fullscreenPrevBtn").addEventListener("click", prevTrack);
$("#fullscreenNextBtn").addEventListener("click", nextTrack);
fullscreenPlayBtn.addEventListener("click", togglePlayback);
fullscreenLikeBtn.addEventListener("click", () => {
    if (currentTrack) {
        toggleSaved(currentTrack);
    }
});
fullscreenSeekBar.addEventListener("input", () => {
    if (!audio.duration) {
        return;
    }
    audio.currentTime =
        (Number(fullscreenSeekBar.value) / 100) * audio.duration;
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isNowPlayingScreenOpen()) {
        closeNowPlayingScreen();
    }
});
audio.addEventListener("play", () => {
    document.body.classList.add("is-playing");
    updatePlayerUI();
    renderHome();
    renderLibraryDetail();
    if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
    }
});
audio.addEventListener("pause", () => {
    clearPlaybackHealthTimer();
    document.body.classList.remove("is-playing");
    updatePlayerUI();
    renderHome();
    renderLibraryDetail();
    if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "paused";
    }
});
audio.addEventListener("loadedmetadata", () => {
    const formattedDuration = formatTime(audio.duration);
    duration.textContent = formattedDuration;
    fullscreenDuration.textContent = formattedDuration;
});
audio.addEventListener("timeupdate", () => {
    schedulePlaybackHealthCheck();
    currentTime.textContent = formatTime(audio.currentTime);
    const percentage = audio.duration
        ? (audio.currentTime / audio.duration) * 100 : 0;
    seekBar.value = percentage;
    fullscreenSeekBar.value = percentage;
    fullscreenCurrentTime.textContent = formatTime(audio.currentTime);
    fullscreenDuration.textContent = formatTime(audio.duration);
    updateRange(seekBar, percentage);
    updateRange(fullscreenSeekBar, percentage);
    if ("mediaSession" in navigator &&
        Number.isFinite(audio.duration) && audio.duration > 0) {
        try {
            navigator.mediaSession.setPositionState({
                duration: audio.duration, playbackRate: audio.playbackRate,
                    position: Math.min(audio.currentTime, audio.duration),
            });
        }
        catch { }
    }
});
audio.addEventListener("waiting", () => {
    schedulePlaybackHealthCheck(1800);
});
audio.addEventListener("stalled", () => {
    schedulePlaybackHealthCheck(1100);
});
audio.addEventListener("error", () => {
    recoverCurrentTrackPlayback("error").catch(console.error);
});
audio.addEventListener("ended", () => {
    resetPlaybackRecovery();
    document.body.classList.remove("is-playing");
    if (repeat) {
        audio.currentTime = 0;
        audio.play().catch(console.error);
        return;
    }
    nextTrack();
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
updateRange(volumeBar, audio.volume * 100);
updateRange(fullscreenSeekBar, 0);
if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => audio.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("previoustrack", prevTrack);
    navigator.mediaSession.setActionHandler("nexttrack", nextTrack);
}
$("#playAllBtn").addEventListener("click", () => {
    const first = visibleTracks[0] || tracks[0];
    if (first) {
        playTrack(first);
    }
});
document
    .querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
        document
            .getElementById(button.dataset.close)?.close();
    });
});
[
    uploadModal, createPlaylistModal, trackActionsModal, accountModal,
].forEach((modal) => {
    modal.addEventListener("click", (event) => {
        const rect = modal.getBoundingClientRect();
        const clickedOutside = event.clientX < rect.left ||
            event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
        if (clickedOutside) {
            modal.close();
        }
    });
});

initAuth({
    auth,
    db,
    gateAuthForm,
    accountModal,
    adminEmail: ADMIN_EMAIL,
    suggestionRefs: {
        suggestionUserEmail,
        suggestionList,
        suggestionTotal,
        suggestionBadge,
    },
    uiRefs: {
        authGate: $("#authGate"),
        appRoot: $("#appRoot"),
        profileLabel: $("#profileLabel"),
        avatar: $("#avatar"),
        accountEmail: $("#accountEmail"),
    },
    helpers: {
        $,
        initials,
        escapeHtml,
        showToast,
        updateAdminUI,
        isOwner,
        migrateLegacyTrack: (track) => migrateLegacyTrack(
            track,
            (migratedTrack) => showToast(`Dados de “${migratedTrack.title}” organizados.`),
        ),
    },
    actions: {
        renderHome,
        renderLibrary,
        refreshCurrentTrack,
        updatePlayerUI,
        renderSuggestions: null,
        setTracks: (nextTracks) => {
            tracks = nextTracks;
        },
        setPlaylists: (nextPlaylists) => {
            playlists = nextPlaylists;
        },
        setSavedTrackIds: (nextSavedTrackIds) => {
            savedTrackIds = nextSavedTrackIds;
        },
        clearSavedTrackIds: () => {
            savedTrackIds.clear();
        },
        setCurrentTrack: (track) => {
            currentTrack = track;
        },
        pauseAndResetAudio: () => {
            audio.pause();
            audio.removeAttribute("src");
        },
    },
});

initScrollbar({
    $,
});

initPWA({
    installButton: $("#installAppBtn"),
    onInstalled: () => showToast("RedBeat instalado no dispositivo."),
    onError: () => showToast("Não foi possível preparar a instalação do app.", "error"),
});

setGenreSelectValue(trackGenreSelect?.value || "");

window.addEventListener("beforeunload", () => {
    revokeAllAssetUrls();
    if (localCoverPreviewUrl) {
        URL.revokeObjectURL(localCoverPreviewUrl);
    }
});
renderHome();
renderLibrary();
updatePlayerUI();
updateAppBackButton();


