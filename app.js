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
// ============================================================================
// APP.JS — CONTROLADOR PRINCIPAL DA INTERFACE DO REDBEAT
// ============================================================================
//
// PAPEL DESTE ARQUIVO
// -------------------
// Este é o ponto central da interface do RedBeat. Ele não faz tudo sozinho:
// tarefas especializadas foram separadas em outros módulos. O app.js coordena
// esses módulos e mantém o estado que precisa ser refletido na tela.
//
// MÓDULOS UTILIZADOS
// ------------------
// firebase.js   -> entrega as conexões `auth` e `db` já inicializadas.
// config.js     -> concentra limites, gêneros permitidos e configuração do admin.
// utils.js      -> funções pequenas de texto, tempo, tamanho e normalização.
// media.js      -> lê duração, comprime áudio e otimiza capas.
// storage.js    -> grava/lê chunks do Firestore e cria URLs temporárias de mídia.
// auth.js       -> controla login, cadastro, logout e listeners da conta.
// scrollbar.js  -> controla a barra de rolagem personalizada.
// pwa.js        -> registra o Service Worker e controla a instalação da PWA.
//
// FLUXO GERAL DE EXECUÇÃO
// -----------------------
// 1. O navegador carrega index.html.
// 2. O <script type="module"> carrega este app.js.
// 3. Os imports acima carregam os módulos especializados.
// 4. O código obtém referências dos elementos HTML que serão manipulados.
// 5. O estado inicial é criado: músicas, playlists, faixa atual, filtros etc.
// 6. Os event listeners são registrados para cliques, formulários e player.
// 7. No fim do arquivo, initAuth(), initScrollbar() e initPWA() são chamados.
// 8. auth.js observa a sessão Firebase. Quando existe um usuário autenticado,
//    ele inicia listeners em tempo real do Firestore e envia os novos dados
//    de volta para este arquivo por callbacks.
// 9. Este arquivo atualiza `tracks`, `playlists` e `savedTrackIds` e chama as
//    funções renderHome(), renderLibrary() e updatePlayerUI().
// 10. Quando o usuário toca uma faixa, storage.js reconstrói o arquivo de áudio
//     a partir dos chunks e o elemento <audio> realiza a reprodução.
//
// IMPORTANTE SOBRE ESTADO
// ----------------------
// O HTML não é a fonte principal dos dados. Variáveis como `tracks`,
// `savedTrackIds`, `currentTrack` e `playlists` guardam o estado atual.
// As funções `render...()` pegam esse estado e redesenham a interface.
// ============================================================================

// Atalho para buscar elementos no DOM.
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
const editTrackModal = $("#editTrackModal");
const accountModal = $("#accountModal");
const uploadForm = $("#uploadForm");
const editTrackForm = $("#editTrackForm");
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
// ============================================================================
// ESTADO DO APLICATIVO
// ============================================================================
// Estas variáveis funcionam como a "memória em execução" da página.
// Elas não substituem o Firestore: representam apenas a cópia atual dos dados
// necessária para montar a interface e controlar a reprodução.
//
// `tracks`               -> catálogo completo recebido do Firestore.
// `visibleTracks`        -> subconjunto de tracks após busca/filtro de gênero.
// `currentTrack`         -> objeto da música atualmente selecionada.
// `currentIndex`         -> posição da faixa atual dentro da lista em reprodução.
// `playlists`            -> playlists pertencentes ao usuário autenticado.
// `savedTrackIds`        -> Set com IDs das músicas salvas; Set torna a consulta
//                           `savedTrackIds.has(id)` rápida e simples.
// `activeView`           -> qual tela principal está visível: home/library/etc.
// `libraryMode`          -> visão geral, salvas ou uma playlist específica.
// `selectedPlaylist`     -> playlist aberta no momento.
// `currentLibraryTracks` -> faixas mostradas no detalhe da Biblioteca.
// `selectedActionTrack`  -> faixa cujo menu de ações está aberto.
// `isAdminUser`          -> controla apenas a interface administrativa; a
//                           autorização real continua nas regras do Firestore.
// `activeGenre`          -> gênero usado como filtro na Home.
// `repeat` / `shuffle`   -> opções do player.
// `selectedDurationSeconds` -> duração detectada do arquivo antes do upload.
// `playbackRequestId`    -> evita corrida entre dois carregamentos de áudio.
// ============================================================================
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
// ============================================================================
// UTILITÁRIOS DA INTERFACE
// ============================================================================
// Funções pequenas usadas somente por esta página. Diferente de utils.js,
// estas funções conhecem elementos do DOM ou o estado do RedBeat e, por isso,
// permanecem aqui.
// ============================================================================

/**
 * Exibe uma mensagem temporária no canto da interface.
 *
 * Quando executa:
 * - após ações bem-sucedidas, como salvar/adicionar música;
 * - quando uma operação falha e o usuário precisa de retorno visual.
 *
 * Entrada:
 * - `message`: texto mostrado ao usuário;
 * - `type`: "success" por padrão ou "error" para aplicar o estilo de erro.
 *
 * Efeito:
 * Atualiza o elemento #toast, reinicia o temporizador e remove a mensagem
 * automaticamente após 3,4 segundos. Não grava nada no Firebase.
 */
function showToast(message, type = "success") {
    toast.textContent = message;
    toast.className = `toast show${type === "error" ? " error" : ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.className = "toast";
    }, 3400);
}

/**
 * Atualiza visualmente um <input type="range">.
 *
 * O valor real continua pertencendo ao input; esta função altera apenas o
 * `background` para pintar de vermelho a parte já percorrida. É usada nas
 * barras de progresso do player e no volume.
 */
function updateRange(input, percentage) {
    input.style.background = `linear-gradient( to right, #e50914 0%, #e50914 ${percentage}%, #393939 ${percentage}%, #393939 100%
  )`;
}

/**
 * Verifica se o usuário autenticado corresponde à conta administrativa.
 *
 * Esta verificação serve para decidir o que a INTERFACE deve mostrar.
 * Segurança real de gravação/exclusão continua obrigatoriamente nas regras
 * do Firestore, pois qualquer JavaScript executado no navegador pode ser lido.
 */
function isAdminAccount(user = auth.currentUser) {
    return Boolean(user?.email) && user.email.toLowerCase() === ADMIN_EMAIL;
}

function canManageCatalog() {
    return isAdminUser && isAdminAccount();
}

function isOwner() {
    return canManageCatalog();
}

/**
 * Sincroniza a interface com o papel da conta autenticada.
 *
 * Quando auth.js detecta login/logout, chama esta função. Ela atualiza
 * `isAdminUser`, mostra/oculta elementos `.admin-only` e altera a descrição
 * da conta. Não concede permissões no banco; apenas representa visualmente
 * as permissões que o Firestore deve validar novamente no servidor.
 */
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
// ============================================================================
// RENDERIZAÇÃO DA HOME, CATÁLOGO E CARDS
// ============================================================================
// "Renderizar" aqui significa transformar os dados guardados em JavaScript em
// HTML visível. Sempre que Firestore, busca, filtros ou player alteram o estado,
// alguma função desta seção é chamada para sincronizar a tela.
//
// As capas são carregadas em uma segunda etapa porque estão guardadas em chunks.
// Primeiro a linha/card aparece com uma inicial; depois hydrateCover() pede a
// imagem ao storage.js e substitui o placeholder quando a URL estiver pronta.
// ============================================================================

/**
 * Substitui o placeholder de uma capa pela imagem real da faixa.
 *
 * Entrada:
 * - `track`: documento da música contendo ID e informações de armazenamento;
 * - `container`: região do DOM onde a capa deve ser procurada.
 *
 * Processo:
 * 1. buildAssetUrl(track, "cover") pede a storage.js a capa reconstruída;
 * 2. storage.js lê os coverChunks, descomprime e cria uma Blob URL;
 * 3. esta função procura `[data-cover-id="..."]` dentro do container;
 * 4. a URL vira `background-image` do elemento.
 *
 * O carregamento é assíncrono para que a lista apareça rapidamente sem
 * esperar todas as imagens terminarem de ser reconstruídas.
 */
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

/**
 * Dispara a hidratação das capas de todas as faixas de uma lista.
 *
 * Não usa `await` em cada hydrateCover propositalmente: cada chamada começa
 * o próprio carregamento e a interface pode preencher as capas conforme elas
 * ficam prontas, sem bloquear a renderização das demais músicas.
 */
async function hydrateListCovers(list, container) {
    for (const track of list) {
        hydrateCover(track, container);
    }
}

/**
 * Compara o gênero salvo na faixa com o gênero do filtro.
 *
 * A comparação passa por normalizeSearchValue(), portanto diferenças de
 * maiúsculas/minúsculas e acentos não quebram o filtro.
 */
function genreMatches(track, genre) {
    return normalizeSearchValue(track.genre) === normalizeSearchValue(genre);
}

// Calcula quais músicas devem aparecer na Home.
// Primeiro aplica gênero; depois aplica a pesquisa por texto.
/**
 * Calcula a lista que deve aparecer no catálogo da Home.
 *
 * Ordem das regras:
 * 1. começa com o catálogo completo `tracks`;
 * 2. se `activeGenre` estiver definido, mantém apenas aquele gênero;
 * 3. lê o texto de #searchInput;
 * 4. compara a busca com título, artista, álbum e gênero;
 * 5. retorna uma NOVA lista para renderHome().
 *
 * Esta função não altera o Firestore nem `tracks`: apenas cria a visão filtrada.
 */
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

/**
 * Sincroniza o seletor visual de gênero com o <input/select> real usado no upload.
 *
 * A interface usa um menu personalizado para combinar com o tema. Mesmo assim,
 * o valor definitivo fica em #trackGenre, que é lido quando o formulário é
 * enviado. Aqui também são atualizados texto, classe visual e `aria-selected`.
 */
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

// --------------------------------------------------------------------------
// EVENTOS DO SELETOR PERSONALIZADO DE GÊNERO
// --------------------------------------------------------------------------
// O navegador não permite estilizar de forma consistente todos os <option>.
// Por isso o RedBeat usa um menu visual próprio. Os listeners abaixo mantêm
// mouse, teclado, acessibilidade e o valor real do formulário sincronizados.
// --------------------------------------------------------------------------
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

// Atualiza o contador de músicas de cada card de gênero e marca o filtro ativo.
/**
 * Atualiza os 12 cards de gênero da Home.
 *
 * Para cada gênero definido em MUSIC_GENRES, conta quantas faixas do catálogo
 * pertencem àquela categoria, atualiza o texto "X músicas" e marca visualmente
 * o card correspondente a `activeGenre`.
 */
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

/**
 * Ativa ou remove o filtro de gênero da Home.
 *
 * Ao escolher um gênero, a busca textual é limpa para evitar dois filtros
 * concorrentes. Depois renderHome() recalcula visibleTracks e a tela rola
 * suavemente até o catálogo para mostrar o resultado ao usuário.
 */
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

/**
 * Gera o HTML das linhas de música usadas no catálogo e na biblioteca.
 *
 * Entrada:
 * - `list`: array de músicas a mostrar;
 * - `context`: informa de qual tela a linha veio (home, saved, playlist...).
 *
 * Cada linha recebe `data-id` e botões com `data-action`. Mais tarde um único
 * listener consegue descobrir qual música e qual ação foram clicadas. Isso é
 * chamado de delegação de eventos e evita criar centenas de listeners.
 *
 * escapeHtml() é aplicado em textos vindos do banco para impedir que conteúdo
 * salvo seja interpretado como HTML executável.
 */
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

/**
 * Monta a seção "Adicionadas recentemente".
 *
 * `tracks` já chega ordenado por data em auth.js. Por isso `slice(0, 5)` pega
 * somente as cinco primeiras sem limitar o catálogo completo. Depois as capas
 * são hidratadas de forma assíncrona.
 */
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

/**
 * Atualiza saudação e contadores do painel superior da Home.
 *
 * Os números vêm do estado local já sincronizado com Firebase: quantidade de
 * tracks, tamanho do Set de salvas e quantidade de playlists.
 */
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

/**
 * Render principal da página inicial.
 *
 * Esta é uma das funções mais importantes da interface. Ela:
 * 1. chama getHomeTracks() e atualiza `visibleTracks`;
 * 2. detecta se há busca ou gênero ativo;
 * 3. altera título, subtítulo e indicadores da tela;
 * 4. gera as linhas do catálogo com trackRows();
 * 5. inicia o carregamento das capas;
 * 6. atualiza recentes, cards de gênero e dashboard;
 * 7. sincroniza o índice da faixa atual no player.
 *
 * Ela pode ser chamada várias vezes; não duplica dados no banco porque apenas
 * reconstrói HTML a partir do estado atual.
 */
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

/**
 * Redesenha a visão geral da Biblioteca.
 *
 * Usa `savedTrackIds` para o contador de músicas salvas e `playlists` para
 * criar os cards de playlists. Como esses estados vêm de listeners Firestore,
 * qualquer alteração remota refletida na conta reaparece aqui automaticamente.
 */
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

/**
 * Redesenha o conteúdo interno aberto na Biblioteca.
 *
 * Dependendo de `libraryMode`, currentLibraryTracks representa músicas salvas
 * ou itens de uma playlist. A função usa o mesmo gerador trackRows() para
 * manter o visual consistente entre catálogo e biblioteca.
 */
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

/**
 * Atualiza `currentTrack` quando o snapshot do catálogo é renovado.
 *
 * Firestore entrega novos objetos a cada snapshot. Se uma faixa que está
 * tocando teve metadados atualizados, esta função troca a referência antiga
 * pela versão nova com o mesmo ID. Se a faixa foi apagada, o player é limpo.
 */
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

/**
 * Descobre a posição da faixa atual dentro da lista usada pela Home.
 *
 * O índice é necessário para controles que dependem da ordem. Caso a faixa
 * atual não esteja presente na lista visível, o resultado é -1.
 */
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
// ============================================================================
// BIBLIOTECA, MÚSICAS SALVAS E PLAYLISTS
// ============================================================================
// Esta seção grava preferências pessoais dentro de users/{uid}.
// O catálogo é global, porém "salvar música" e playlists pertencem à conta.
// Isso permite entrar em outro dispositivo e recuperar a mesma biblioteca.
//
// Estrutura usada no Firestore:
// users/{uid}/savedTracks/{trackId}
// users/{uid}/playlists/{playlistId}
// users/{uid}/playlists/{playlistId}/items/{trackId}
// ============================================================================
// Lê o estado sincronizado da conta e monta "Músicas salvas" e playlists.
// As gravações são feitas em users/{uid}/... no Firestore.

/**
 * Adiciona ou remove uma faixa das músicas salvas da conta atual.
 *
 * A função consulta o Set local apenas para decidir a operação. A gravação real
 * acontece em users/{uid}/savedTracks/{trackId}. Não alteramos manualmente o
 * Set depois: o listener em auth.js recebe a mudança do Firestore e atualiza a
 * interface, mantendo uma única fonte de sincronização.
 */
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

/**
 * Cria uma nova playlist para o usuário autenticado.
 *
 * Gera um documento dentro de users/{uid}/playlists e grava nome/data.
 * O card aparece quando o listener de playlists em auth.js recebe o snapshot.
 */
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

/**
 * Remove uma playlist e seus itens.
 *
 * Primeiro exclui os documentos da subcoleção `items`; depois exclui o
 * documento principal. Isso é necessário porque excluir um documento pai no
 * Firestore não apaga automaticamente suas subcoleções.
 */
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

/**
 * Vincula uma faixa existente a uma playlist do usuário.
 *
 * A música não é duplicada: o item guarda referência/identificação da faixa.
 * Assim o catálogo global continua sendo a origem dos metadados e do áudio.
 */
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

/**
 * Carrega os IDs dos itens de uma playlist e converte em objetos de `tracks`.
 *
 * O resultado é salvo em currentLibraryTracks e usado por renderLibraryDetail().
 * Se uma faixa já não existir no catálogo global, ela é descartada da lista.
 */
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

// ============================================================================
// NAVEGAÇÃO INTERNA E BUSCA
// ============================================================================
// O RedBeat funciona como uma aplicação de página única: Home, Biblioteca e
// Sugestões já existem no mesmo index.html. Navegar significa ocultar uma
// seção e exibir outra, sem carregar uma nova página do servidor.
//
// O botão Voltar interno não usa o histórico do navegador para todos os casos;
// ele interpreta o estado atual (busca, gênero, detalhe da biblioteca etc.) e
// decide qual nível deve ser fechado primeiro.
// ============================================================================
// Controla qual seção do SPA está visível sem recarregar a página.
// O botão voltar também usa esse estado para decidir o destino.

/**
 * Informa se o botão Voltar interno tem algum nível para desfazer.
 *
 * Exemplos: fechar pesquisa, remover filtro de gênero, sair do detalhe de uma
 * playlist ou retornar de Biblioteca/Sugestões para Home.
 */
function canGoBackInsideApp() {
    if (activeView === "library") {
        return true;
    }
    if (activeView === "home" && (searchInput.value.trim() || activeGenre)) {
        return true;
    }
    return false;
}

/**
 * Habilita/desabilita visualmente o botão Voltar conforme canGoBackInsideApp().
 * Também atualiza atributos de acessibilidade para representar o mesmo estado.
 */
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

/**
 * Implementa a prioridade do botão Voltar do próprio RedBeat.
 *
 * A função fecha primeiro o contexto mais específico (detalhe, busca ou filtro)
 * e só depois muda de seção. Isso evita enviar o usuário diretamente à Home
 * quando ele apenas queria sair de uma playlist ou limpar uma pesquisa.
 */
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

/**
 * Troca a seção principal visível da aplicação.
 *
 * Em vez de navegar para outra URL, adiciona/remove `.hidden` das seções e
 * atualiza o botão ativo do menu. Também garante que estados específicos da
 * Home/Biblioteca sejam recalculados quando necessário.
 */
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
// --------------------------------------------------------------------------
// EVENTOS DE NAVEGAÇÃO, BUSCA E CARDS DA HOME
// --------------------------------------------------------------------------
// A partir daqui os elementos da interface são conectados às funções acima.
// O listener não contém a lógica inteira: normalmente ele apenas interpreta o
// clique/tecla e chama a função responsável, mantendo o código organizado.
// --------------------------------------------------------------------------
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
// ============================================================================
// AÇÕES DAS MÚSICAS E FORMULÁRIOS
// ============================================================================
// Esta seção centraliza interações como abrir o menu de uma faixa, adicionar
// a playlists, abrir o formulário administrativo e preparar arquivos para upload.
// Os listeners usam `data-action` e `data-id` para descobrir qual ação ocorreu
// sem precisar criar um event listener separado para cada música renderizada.
// ============================================================================
// Aqui ficam upload, exclusão, salvar/desfavoritar, sugestões e menu das faixas.

// ============================================================================
// EDIÇÃO DE MÚSICAS EXISTENTES
// ============================================================================
// A edição altera apenas os metadados do documento principal tracks/{trackId}.
// Os chunks de áudio e capa não são recriados, porque o objetivo desta tela é
// corrigir título, artista, álbum ou gênero sem reenviar arquivos grandes.
//
// Fluxo:
// 1. o administrador abre o menu "⋯" da música;
// 2. clica em "Editar música";
// 3. openEditTrackModal() copia os dados atuais para o formulário;
// 4. no submit, os campos são validados;
// 5. updateDoc() grava somente os campos alteráveis e updatedAt;
// 6. o listener em tempo real de auth.js recebe a alteração;
// 7. renderHome()/renderLibrary()/refreshCurrentTrack() refletem os novos dados.
//
// A interface oculta o recurso para ouvintes, mas a proteção real continua nas
// Firestore Rules, que permitem update em tracks somente para o administrador.
// ============================================================================

function openEditTrackModal(track) {
    if (!canManageCatalog()) {
        showToast("Somente o administrador pode editar músicas.", "error");
        return;
    }

    selectedActionTrack = track;
    $("#editTrackTitle").value = track.title || "";
    $("#editTrackArtist").value = track.artist || "";
    $("#editTrackAlbum").value = track.album || "";
    $("#editTrackGenre").value = MUSIC_GENRES.includes(track.genre)
        ? track.genre
        : "Outros";
    $("#editTrackCurrentName").textContent = `${track.title || "Faixa"} • ${track.artist || "Artista"}`;

    editTrackModal.showModal();
}

/**
 * Abre o modal de ações para uma faixa específica.
 *
 * Guarda a faixa em `selectedActionTrack`, preenche os dados do modal e ajusta
 * quais ações aparecem conforme conta, contexto e permissão administrativa.
 */
function openTrackActions(track) {
    selectedActionTrack = track;
    $("#actionTrackTitle").textContent = track.title;
    $("#actionSaveTrack").textContent = savedTrackIds.has(track.id)
        ? "Remover da biblioteca" : "Salvar na biblioteca";
    $("#actionEditTrack").classList.toggle("hidden", !canManageCatalog());
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
$("#actionEditTrack").addEventListener("click", () => {
    if (!selectedActionTrack) {
        return;
    }

    const track = selectedActionTrack;
    trackActionsModal.close();
    openEditTrackModal(track);
});

editTrackForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedActionTrack || !canManageCatalog()) {
        showToast("Somente o administrador pode editar músicas.", "error");
        editTrackModal.close();
        return;
    }

    const title = $("#editTrackTitle").value.trim();
    const artist = $("#editTrackArtist").value.trim();
    const album = $("#editTrackAlbum").value.trim();
    const genre = $("#editTrackGenre").value.trim();

    if (!title || !artist || !album || !MUSIC_GENRES.includes(genre)) {
        showToast("Preencha título, artista, álbum e gênero corretamente.", "error");
        return;
    }

    const submit = $("#editTrackSubmit");
    const trackId = selectedActionTrack.id;

    submit.disabled = true;
    submit.textContent = "Salvando…";

    try {
        await updateDoc(doc(db, "tracks", trackId), {
            title,
            artist,
            album,
            genre,
            updatedAt: serverTimestamp(),
        });

        editTrackModal.close();
        showToast("Música atualizada.");
    }
    catch (error) {
        console.error("Editar música:", error);
        showToast(`Não foi possível editar (${error.code || "erro"}).`, "error");
    }
    finally {
        submit.disabled = false;
        submit.textContent = "Salvar alterações";
    }
});

$("#actionDeleteTrack").addEventListener("click", async () => {
    if (selectedActionTrack) {
        trackActionsModal.close();
        await deleteTrack(selectedActionTrack);
    }
});

/**
 * Listener compartilhado para cliques nas listas de músicas.
 *
 * Ele usa delegação de eventos:
 * 1. encontra a `.track-row` mais próxima do clique;
 * 2. recupera `data-id` para achar a música no estado;
 * 3. lê `data-action` do botão pressionado;
 * 4. encaminha para playTrack(), toggleSaved() ou openTrackActions().
 *
 * Assim novas linhas criadas por renderizações já funcionam sem registrar
 * listeners adicionais.
 */
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
// ============================================================================
// UPLOAD DE MÚSICA — FLUXO COMPLETO
// ============================================================================
// Somente a conta administradora chega ao fluxo abaixo pela interface. Além
// disso, as regras do Firestore precisam autorizar as gravações: esconder o
// botão no navegador, sozinho, nunca seria uma proteção suficiente.
//
// Quando o formulário é enviado:
// 1. Confere usuário e permissão administrativa.
// 2. Lê áudio, capa e metadados digitados no formulário.
// 3. Valida gênero e tamanho máximo dos arquivos.
// 4. Lê a duração do áudio em media.js.
// 5. Otimiza a capa para WebP e comprime capa/áudio com GZIP.
// 6. Cria tracks/{id} com status "uploading". A consulta do catálogo ignora
//    esse status, então uma faixa incompleta não aparece aos usuários.
// 7. storage.js divide os bytes comprimidos e grava audioChunks/coverChunks.
// 8. verifyStoredTrackBytes() baixa os chunks novamente e compara byte a byte.
// 9. Se estiver íntegro, o documento vira status "ready".
// 10. Se algo falhar, o catch tenta apagar chunks e documento principal para
//     evitar deixar uma música parcialmente gravada no banco.
// ============================================================================
// Fluxo completo:
// 1. valida admin e formulário;
// 2. otimiza a capa;
// 3. comprime capa e áudio com GZIP;
// 4. cria o documento principal da faixa com status "uploading";
// 5. divide os arquivos e grava chunks;
// 6. lê os chunks novamente e verifica integridade;
// 7. muda status para "ready" para a música aparecer no catálogo.
// Se qualquer etapa falhar, o código tenta remover os dados parciais.
/**
 * EVENTO DE ENVIO DO FORMULÁRIO DE UPLOAD.
 *
 * O listener abaixo implementa na prática o fluxo de 10 etapas descrito no
 * cabeçalho desta seção. É `async` porque compressão, Firestore e verificação
 * de integridade são operações assíncronas que precisam ser aguardadas antes
 * de liberar o botão ou informar sucesso.
 */
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

/**
 * Exclui uma música do catálogo global (admin).
 *
 * Processo:
 * 1. confirma permissão e pede confirmação ao usuário;
 * 2. remove audioChunks e coverChunks;
 * 3. exclui o documento tracks/{id};
 * 4. remove Blob URLs em cache daquela faixa;
 * 5. caso ela estivesse tocando, limpa/avança o estado do player.
 *
 * As regras do Firestore precisam autorizar cada exclusão; esta checagem no
 * JavaScript serve apenas para fluxo de interface.
 */
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

// ============================================================================
// PLAYER, TELA CHEIA E RECUPERAÇÃO DE REPRODUÇÃO
// ============================================================================
// O elemento real que toca música é <audio id="audio"> do index.html.
// Este JavaScript controla qual fonte é entregue a ele e mantém a interface
// sincronizada com os eventos nativos do navegador (`play`, `pause`,
// `timeupdate`, `ended`, `waiting`, `stalled` e `error`).
//
// Fluxo para tocar uma música:
// usuário clica -> playTrack(track) -> storage.buildAssetUrl(track, "audio")
// -> chunks são lidos e unidos -> GZIP é desfeito -> Blob URL é criada
// -> `audio.src = url` -> `audio.play()`.
//
// A rotina de "playback health" observa travamentos. Se o tempo parar de
// avançar enquanto ainda existe música restante, o código invalida a URL em
// cache, reconstrói o áudio e tenta retomar aproximadamente no mesmo segundo.
// Isso reduz falhas causadas por Blob URL inválida ou leitura interrompida.
// ============================================================================
// O <audio> do HTML é o motor real de reprodução.
// O JavaScript apenas troca a fonte, controla tempo/volume e sincroniza a UI.
// buildAssetUrl() reconstrói o áudio armazenado em chunks antes de tocar.

let playbackHealthTimer = null;
const playbackRecoveryAttempts = new Map();

/**
 * Cancela o temporizador usado para detectar travamento do áudio.
 *
 * É chamado ao pausar, trocar de música ou iniciar uma nova verificação para
 * garantir que exista no máximo um teste de saúde pendente.
 */
function clearPlaybackHealthTimer() {
    clearTimeout(playbackHealthTimer);
    playbackHealthTimer = null;
}

/**
 * Reinicia o estado de recuperação automática de uma faixa.
 *
 * Remove a contagem de tentativas para o ID informado e cancela qualquer
 * verificação agendada. Uma reprodução que voltou ao normal começa "limpa".
 */
function resetPlaybackRecovery(trackId = currentTrack?.id) {
    if (trackId) {
        playbackRecoveryAttempts.delete(trackId);
    }

    clearPlaybackHealthTimer();
}

/**
 * Agenda uma verificação para saber se o áudio realmente avançou.
 *
 * Guarda o `currentTime`, espera alguns milissegundos e compara novamente.
 * Se o player deveria estar tocando, ainda há tempo restante e a posição não
 * avançou, considera a reprodução travada e chama recoverCurrentTrackPlayback().
 */
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

/**
 * Tenta reconstruir e retomar uma faixa que travou durante a reprodução.
 *
 * Estratégia:
 * 1. limita o número de recuperações por faixa para evitar loop infinito;
 * 2. memoriza o segundo atual e se o áudio deveria continuar tocando;
 * 3. revoga a Blob URL antiga no cache;
 * 4. pede a storage.js uma nova reconstrução do áudio;
 * 5. espera os metadados do novo source;
 * 6. reposiciona aproximadamente no mesmo instante;
 * 7. volta a reproduzir se a faixa estava em execução.
 */
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

/**
 * Torna uma faixa a seleção atual e atualiza a interface.
 *
 * Se a tela cheia estiver aberta e a música mudar, aplica classes de animação
 * de saída/entrada. A função seleciona a faixa; quem realmente inicia o áudio
 * é playTrack().
 */
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

// Seleciona uma faixa, reconstrói/obtém sua URL de áudio e inicia reprodução.
// `playbackRequestId` impede uma requisição antiga de substituir uma nova
// caso o usuário clique rapidamente em várias músicas.
/**
 * Carrega e inicia a reprodução de uma faixa.
 *
 * Fluxo detalhado:
 * 1. incrementa `playbackRequestId` para identificar esta tentativa;
 * 2. chama selectCurrentTrack() para atualizar o estado visual;
 * 3. usa URL externa quando disponível ou buildAssetUrl() para reconstruir os
 *    chunks do Firestore;
 * 4. antes de tocar, confirma que nenhuma outra música foi escolhida enquanto
 *    o download/reconstrução estava acontecendo;
 * 5. atribui `audio.src`, chama load() e depois play();
 * 6. atualiza Media Session para controles do sistema operacional.
 *
 * O requestId evita uma condição de corrida: uma faixa lenta não pode começar
 * a tocar depois que o usuário já clicou em outra.
 */
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

// Integra o player aos controles de mídia do sistema operacional/lock screen
// quando o navegador oferece a Media Session API.
/**
 * Envia metadados da música para a Media Session API quando disponível.
 *
 * Isso permite que título, artista, álbum e capa apareçam em controles de mídia
 * do sistema, tela bloqueada e alguns dispositivos Bluetooth. O recurso depende
 * do navegador/sistema; se não existir, o player normal continua funcionando.
 */
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

/**
 * Retorna a fila que os botões Anterior/Próxima devem utilizar.
 *
 * A fila depende do contexto atual: catálogo, músicas salvas ou playlist.
 * Dessa forma "Próxima" dentro de uma playlist continua na própria playlist.
 */
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

/**
 * Alterna entre tocar e pausar.
 *
 * Se nenhuma faixa foi selecionada ainda, escolhe a primeira da fila atual.
 * Caso já exista currentTrack, delega a ação ao elemento <audio> nativo.
 */
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

// Próxima faixa: respeita a lista atualmente visível e o modo aleatório.
/**
 * Escolhe a próxima faixa da fila atual.
 *
 * Com shuffle ativo, sorteia outra música evitando repetir a mesma quando há
 * mais de uma opção. Sem shuffle, avança circularmente e volta ao início no fim.
 */
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

/**
 * Escolhe a faixa anterior da fila atual, também de forma circular.
 * Se estiver na primeira posição, volta para a última.
 */
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

/**
 * Atualiza capa e fundo desfocado da tela cheia.
 *
 * Primeiro tenta usar a URL de capa já existente em cache. Caso não exista,
 * mostra uma inicial temporária e solicita buildAssetUrl(); quando a Promise
 * termina, confirma que a mesma faixa continua selecionada antes de aplicar.
 */
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

/**
 * Sincroniza todos os textos/controles da tela "Tocando agora" com currentTrack.
 * Também atualiza estado de curtida, botão play/pause e capa em tela cheia.
 */
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

/**
 * Abre a experiência de reprodução em tela cheia.
 *
 * Ela só é aberta quando existe uma faixa e o áudio está efetivamente tocando.
 * Classes CSS e `aria-hidden` controlam animação e acessibilidade.
 */
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

/**
 * Fecha a tela cheia com animação.
 *
 * Primeiro remove a classe visual; depois de 350 ms adiciona `.hidden`, tempo
 * suficiente para a transição CSS terminar sem cortar a animação.
 */
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

/**
 * Mantém o player inferior e a tela cheia sincronizados com o estado do áudio.
 *
 * Atualiza título, artista, coração, botão play/pause, capa e possibilidade de
 * abrir a tela cheia. A capa usa cache quando possível para evitar novas leituras.
 */
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
// --------------------------------------------------------------------------
// EVENTOS DO PLAYER
// --------------------------------------------------------------------------
// Estes listeners traduzem ações do usuário e eventos nativos do <audio> em
// mudanças de estado/interface. Observe que `play`/`pause` podem acontecer não
// só por clique no site, mas também por controles do sistema/Media Session.
// --------------------------------------------------------------------------
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
// Executado continuamente durante a reprodução.
// Atualiza relógio, barras de progresso e posição exibida pelo sistema.
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
    uploadModal, createPlaylistModal, trackActionsModal, editTrackModal, accountModal,
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

// ============================================================================
// INICIALIZAÇÃO FINAL DOS MÓDULOS
// ============================================================================
// Todo o código acima apenas DEFINE funções e registra listeners. Nesta parte
// conectamos os módulos que precisam começar a trabalhar quando a página abre.
//
// initAuth(): recebe referências/callbacks em vez de importar app.js. Isso
// evita dependência circular. Quando o Firestore muda, auth.js chama setters
// recebidos abaixo e o app.js continua sendo dono do estado visual.
//
// initScrollbar(): conecta a barra visual personalizada ao container rolável.
//
// initPWA(): registra o Service Worker e usa o botão #installAppBtn quando o
// navegador liberar o evento de instalação.
// ============================================================================
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

// Ativa a scrollbar personalizada.
initScrollbar({
    $,
});

// Registra a PWA e conecta o botão de instalação.
initPWA({
    installButton: $("#installAppBtn"),
    onInstalled: () => showToast("RedBeat instalado no dispositivo."),
    onError: () => showToast("Não foi possível preparar a instalação do app.", "error"),
});

setGenreSelectValue(trackGenreSelect?.value || "");

// Antes de a aba ser descarregada, todas as Blob URLs criadas com
// URL.createObjectURL() são revogadas. Isso libera memória que o navegador
// reservou para áudio/capas temporários durante a sessão.
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


