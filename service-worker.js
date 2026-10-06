// ============================================================================
// SERVICE-WORKER.JS — CACHE OFFLINE DO APP SHELL
// ============================================================================
//
// IMPORTANTE: este arquivo NÃO roda dentro da página e não tem acesso direto
// ao DOM. O navegador o executa como um worker separado, capaz de interceptar
// requisições de rede dentro do seu escopo.
//
// OBJETIVO NO REDBEAT
// -------------------
// Manter disponível o "app shell": HTML, CSS, JavaScript, ícones e imagens dos
// gêneros. Assim a interface básica pode abrir mesmo quando a conexão falhar.
//
// O áudio armazenado no Firestore NÃO entra automaticamente neste cache.
// O player reconstrói MP3s a partir dos chunks durante a sessão. Um verdadeiro
// recurso de "baixar música para ouvir offline" exigiria armazenamento próprio,
// por exemplo IndexedDB, com uma política separada de espaço e remoção.
//
// CICLO DE VIDA
// -------------
// install  -> pré-carrega APP_SHELL.
// activate -> remove versões antigas de cache.
// fetch    -> decide entre cache e rede para cada GET local.
// ============================================================================

// Nome/versionamento lógico do cache. Quando arquivos funcionais do app shell
// mudarem, incrementar a versão força a fase `activate` a remover o cache antigo.
const CACHE_NAME = "redbeat-app-v24";

// Lista fechada de arquivos que devem estar disponíveis logo após a instalação.
// `cache.addAll()` falha se um item obrigatório não puder ser baixado; por isso
// todos os caminhos precisam existir na publicação.
const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css?v=24",
    "./app.js?v=24",
    "./auth.js",
    "./config.js",
    "./firebase.js",
    "./media.js",
    "./storage.js",
    "./scrollbar.js",
    "./utils.js",
    "./pwa.js",
    "./manifest.webmanifest",
    "./favicon.svg?v=24",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-512.png",
    "./icons/apple-touch-icon.png",
    "./assets/genres/eletronica.png",
    "./assets/genres/rock.png",
    "./assets/genres/funk.png",
    "./assets/genres/pagode.png",
    "./assets/genres/sertanejo.png",
    "./assets/genres/trap.png",
    "./assets/genres/pop.png",
    "./assets/genres/regional.png",
    "./assets/genres/reggae.png",
    "./assets/genres/jazz.png",
    "./assets/genres/hiphop.png",
    "./assets/genres/outros.png"
];

// --------------------------------------------------------------------------
// INSTALL
// --------------------------------------------------------------------------
// `event.waitUntil()` informa ao navegador que a instalação só deve ser
// considerada concluída depois que a Promise do cache terminar. `skipWaiting()`
// permite que a nova versão avance sem ficar aguardando indefinidamente uma aba
// antiga ser fechada.
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

// --------------------------------------------------------------------------
// ACTIVATE
// --------------------------------------------------------------------------
// Lista todos os caches do domínio, seleciona apenas caches do RedBeat com nome
// diferente do atual e os exclui. `clients.claim()` faz esta versão assumir as
// páginas abertas dentro do escopo assim que possível.
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names
                    .filter((name) => name.startsWith("redbeat-app-") && name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

// --------------------------------------------------------------------------
// FETCH
// --------------------------------------------------------------------------
// Intercepta requisições GET do mesmo domínio.
//
// Estratégia para NAVEGAÇÃO: network-first.
// Tenta buscar a página atualizada; se a rede falhar, devolve index.html em cache.
//
// Estratégia para ARQUIVOS ESTÁTICOS: cache-first.
// Se CSS/JS/imagem estiver no cache, responde imediatamente. Caso contrário,
// busca na rede e, se a resposta for válida, guarda uma cópia para próximas vezes.
//
// Requisições Firebase/gstatic possuem outro origin e não são interceptadas.
self.addEventListener("fetch", (event) => {
    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);

    // Firebase e outros módulos externos continuam usando a rede normalmente.
    if (url.origin !== self.location.origin) {
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((response) => response)
                .catch(() => caches.match("./index.html"))
        );
        return;
    }

    event.respondWith(
        caches.match(request)
            .then((cached) => {
                if (cached) {
                    return cached;
                }

                return fetch(request).then((response) => {
                    if (!response || response.status !== 200 || response.type !== "basic") {
                        return response;
                    }

                    const copy = response.clone();
                    caches.open(CACHE_NAME)
                        .then((cache) => cache.put(request, copy))
                        .catch(console.warn);

                    return response;
                });
            })
    );
});
