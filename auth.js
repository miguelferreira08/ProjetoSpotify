import {
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
    collection,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    where,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// ============================================================================
// AUTH.JS — AUTENTICAÇÃO E SINCRONIZAÇÃO EM TEMPO REAL
// ============================================================================
//
// RESPONSABILIDADES DESTE MÓDULO
// ------------------------------
// 1. Alternar a tela de entrada entre login e cadastro.
// 2. Executar login/cadastro/logout pelo Firebase Authentication.
// 3. Observar permanentemente mudanças de sessão com onAuthStateChanged().
// 4. Criar/atualizar users/{uid} para a conta autenticada.
// 5. Abrir listeners onSnapshot() para catálogo, salvas e playlists.
// 6. Se a conta for admin, abrir também o listener de sugestões.
// 7. Entregar os dados recebidos ao app.js através de callbacks/setters.
//
// POR QUE initAuth(ctx) RECEBE TANTAS REFERÊNCIAS?
// -----------------------------------------------
// auth.js precisa atualizar partes da interface e do estado principal, mas não
// importa app.js. Se ambos se importassem mutuamente, teríamos uma dependência
// circular difícil de manter. Por isso app.js injeta elementos e funções no
// objeto `ctx`; auth.js usa essas dependências sem conhecer a implementação.
//
// FLUXO DE LOGIN
// --------------
// formulário -> signInWithEmailAndPassword() -> Firebase valida credenciais
// -> onAuthStateChanged() recebe o usuário -> interface é liberada ->
// subscribeAccountData() inicia sincronização em tempo real.
// ============================================================================

/**
 * Inicializa todo o subsistema de autenticação.
 *
 * Entrada:
 * `ctx` contém conexões Firebase, elementos do DOM, helpers e callbacks do app.
 *
 * Saída:
 * Não retorna os dados da conta. Em vez disso, registra listeners que permanecem
 * ativos durante a sessão e chamam callbacks sempre que algo muda.
 */
export function initAuth(ctx) {
    const {
        auth,
        db,
        gateAuthForm,
        accountModal,
        adminEmail,
        suggestionRefs,
        uiRefs,
        helpers,
        actions,
    } = ctx;

    const {
        suggestionUserEmail,
        suggestionList,
        suggestionTotal,
        suggestionBadge,
    } = suggestionRefs;

    const {
        authGate,
        appRoot,
        profileLabel,
        avatar,
        accountEmail,
    } = uiRefs;

    const {
        $, initials, escapeHtml, showToast, updateAdminUI, isOwner, migrateLegacyTrack,
    } = helpers;

    const {
        renderHome,
        renderLibrary,
        refreshCurrentTrack,
        updatePlayerUI,
        setTracks,
        setPlaylists,
        setSavedTrackIds,
        clearSavedTrackIds,
        setCurrentTrack,
        pauseAndResetAudio,
    } = actions;

    let authMode = "login";
    let unsubscribeTracks = null;
    let unsubscribeSaved = null;
    let unsubscribePlaylists = null;
    let unsubscribeSuggestions = null;
    let suggestions = [];

    /**
     * Converte códigos técnicos do Firebase Auth em mensagens amigáveis.
     *
     * O Firebase retorna erros como `auth/invalid-credential`. Exibir o código
     * puro não ajuda a maioria dos usuários, então esta função mapeia os casos
     * conhecidos e mantém um fallback com o código original para diagnóstico.
     */
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

    /**
     * Alterna o mesmo formulário entre modo login e modo cadastro.
     *
     * Além do texto do botão/título, troca o `autocomplete` da senha para que
     * o gerenciador de senhas do navegador saiba se está preenchendo uma senha
     * existente (`current-password`) ou criando uma nova (`new-password`).
     */
    function setGateMode(mode) {
        authMode = mode;
        const login = mode === "login";
        $("#gateTitle").textContent = login ? "Entrar no RedBeat" : "Criar conta";
        $("#gateCopy").textContent = login
            ? "Entre com sua conta para acessar músicas, biblioteca e playlists."
            : "Crie sua conta para sincronizar sua biblioteca em todos os dispositivos.";
        $("#gateSubmit").textContent = login ? "Entrar" : "Criar conta";
        $("#gateToggle").textContent = login ? "Criar uma conta" : "Já tenho uma conta";
        $("#gatePassword").autocomplete = login ? "current-password" : "new-password";
        $("#gateError").classList.add("hidden");
    }

    /**
     * Garante a existência de users/{uid} para a conta autenticada.
     *
     * O Authentication guarda credenciais; o Firestore guarda dados do app.
     * Este documento funciona como raiz para savedTracks e playlists.
     * `merge: true` é importante porque atualiza e-mail/data sem apagar outros
     * campos que possam ser adicionados ao perfil no futuro.
     */
    async function ensureUserProfile(user) {
        await setDoc(doc(db, "users", user.uid), {
            email: user.email || "",
            updatedAt: serverTimestamp(),
        }, { merge: true });
    }

    /**
     * Encerra todos os listeners Firestore da sessão anterior.
     *
     * onSnapshot() retorna uma função de cancelamento. Guardamos essas funções
     * em `unsubscribe...` e chamamos todas antes de iniciar uma nova sessão.
     * Isso impede leituras duplicadas, atualizações repetidas e vazamento de
     * dados de uma conta para a interface de outra após logout/login.
     */
    function stopSubscriptions() {
        unsubscribeTracks?.();
        unsubscribeSaved?.();
        unsubscribePlaylists?.();
        unsubscribeSuggestions?.();
        unsubscribeTracks = null;
        unsubscribeSaved = null;
        unsubscribePlaylists = null;
        unsubscribeSuggestions = null;
    }

    /**
     * Converte um Timestamp do Firestore para data/hora pt-BR.
     * Se o servidor ainda não tiver resolvido serverTimestamp(), usa "agora".
     */
    function formatSuggestionDate(timestamp) {
        if (!timestamp?.toDate) {
            return "agora";
        }

        return new Intl.DateTimeFormat("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        }).format(timestamp.toDate());
    }

    /**
     * Renderiza a área de sugestões conforme o papel da conta.
     *
     * Usuário comum:
     * - recebe apenas seu e-mail preenchido no formulário;
     * - não recebe a lista global de sugestões.
     *
     * Administrador:
     * - vê badge, quantidade e todos os cards já carregados em `suggestions`.
     *
     * A restrição de leitura também precisa existir nas Firestore Rules; esta
     * função apenas controla o que é exibido no navegador.
     */
    function renderSuggestions(isAdminUser) {
        const user = auth.currentUser;

        if (suggestionUserEmail) {
            suggestionUserEmail.value = user?.email || "";
        }

        if (!isAdminUser) {
            suggestionBadge?.classList.add("hidden");
            return;
        }

        const count = suggestions.length;
        suggestionTotal.textContent = `${count} ${count === 1 ? "sugestão" : "sugestões"}`;
        suggestionBadge.textContent = String(count);
        suggestionBadge.classList.toggle("hidden", count === 0);

        if (!count) {
            suggestionList.innerHTML = `
                <div class="suggestion-empty">
                    <strong>Nenhuma sugestão recebida</strong>
                    <span>As sugestões dos usuários aparecerão aqui.</span>
                </div>
            `;
            return;
        }

        suggestionList.innerHTML = suggestions.map((suggestion) => `
            <article class="suggestion-card" data-suggestion-id="${suggestion.id}">
                <div class="suggestion-card-main">
                    <strong class="suggestion-card-title">${escapeHtml(suggestion.songName || "Música sem nome")}</strong>
                    <span class="suggestion-card-artist">${escapeHtml(suggestion.artist || "Artista não informado")}</span>
                    <div class="suggestion-card-meta">
                        <span>${escapeHtml(suggestion.senderEmail || "Usuário")}</span>
                        <span>${escapeHtml(formatSuggestionDate(suggestion.createdAt))}</span>
                    </div>
                </div>
                <button
                    class="suggestion-remove"
                    type="button"
                    data-action="remove-suggestion"
                    aria-label="Excluir sugestão"
                    title="Excluir sugestão"
                >×</button>
            </article>
        `).join("");
    }

    /**
     * Abre a assinatura em tempo real de `suggestions` somente para admin.
     *
     * Antes de criar uma nova assinatura, cancela a antiga e limpa a lista.
     * A query ordena pela data decrescente. Cada snapshot substitui o array
     * local e chama renderSuggestions(true).
     */
    function subscribeSuggestionsIfAdmin(isAdminUser) {
        unsubscribeSuggestions?.();
        unsubscribeSuggestions = null;
        suggestions = [];
        renderSuggestions(isAdminUser);

        if (!isAdminUser) {
            return;
        }

        const suggestionsQuery = query(
            collection(db, "suggestions"),
            orderBy("createdAt", "desc"),
        );

        unsubscribeSuggestions = onSnapshot(
            suggestionsQuery,
            (snapshot) => {
                suggestions = snapshot.docs.map((document) => ({
                    id: document.id,
                    ...document.data(),
                }));
                renderSuggestions(true);
            },
            (error) => {
                console.error("Sugestões:", error);
                showToast("Não foi possível carregar as sugestões.", "error");
            },
        );
    }

    /**
     * Inicia os três listeners Firestore essenciais da conta.
     *
     * CATÁLOGO (`tracks`):
     * - recebe somente documentos cujo recordType é "track";
     * - remove status "uploading" para não expor upload incompleto;
     * - ordena em memória pela data de criação;
     * - entrega o array ao app.js e manda renderizar.
     *
     * SALVAS (`users/{uid}/savedTracks`):
     * - transforma IDs em Set;
     * - atualiza Home, Biblioteca e coração do player.
     *
     * PLAYLISTS (`users/{uid}/playlists`):
     * - transforma documentos em objetos;
     * - ordena por criação;
     * - atualiza a Biblioteca.
     *
     * O listener do catálogo também identifica dados no layout antigo e pede
     * ao storage.js uma migração quando a conta possui permissão administrativa.
     */
    function subscribeAccountData(user) {
        stopSubscriptions();

        const tracksQuery = query(collection(db, "tracks"), where("recordType", "==", "track"));
        unsubscribeTracks = onSnapshot(tracksQuery, (snapshot) => {
            const nextTracks = snapshot.docs
                .map((document) => ({
                    id: document.id,
                    ...document.data(),
                }))
                .filter((track) => track.status !== "uploading")
                .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

            setTracks(nextTracks);
            renderHome();
            renderLibrary();
            refreshCurrentTrack();

            for (const track of nextTracks) {
                const hasLegacyChunks = Number(track.audioChunks || 0) > 0
                    || Number(track.coverChunks || 0) > 0;

                if (
                    isOwner(track)
                    && track.storageLayout !== "subcollections-v2"
                    && hasLegacyChunks
                ) {
                    migrateLegacyTrack(track);
                }
            }
        }, (error) => {
            console.error(error);
            showToast("Não foi possível carregar as músicas.", "error");
        });

        unsubscribeSaved = onSnapshot(collection(db, "users", user.uid, "savedTracks"), (snapshot) => {
            setSavedTrackIds(new Set(snapshot.docs.map((document) => document.id)));
            renderHome();
            renderLibrary();
            updatePlayerUI();
        });

        unsubscribePlaylists = onSnapshot(collection(db, "users", user.uid, "playlists"), (snapshot) => {
            const nextPlaylists = snapshot.docs
                .map((document) => ({
                    id: document.id,
                    ...document.data(),
                }))
                .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

            setPlaylists(nextPlaylists);
            renderLibrary();
        });
    }

    // ------------------------------------------------------------------------
    // OBSERVADOR CENTRAL DA SESSÃO
    // ------------------------------------------------------------------------
    // Firebase chama este callback na carga inicial e sempre que login/logout
    // muda. Ele é a "chave" que libera ou bloqueia o restante do aplicativo.
    //
    // COM USUÁRIO:
    // - garante users/{uid};
    // - esconde a tela de login e mostra o app;
    // - preenche nome/avatar/e-mail;
    // - identifica se é admin;
    // - inicia os listeners do Firestore.
    //
    // SEM USUÁRIO:
    // - cancela listeners;
    // - limpa estado pessoal e player;
    // - esconde o app;
    // - volta ao formulário de login.
    // ------------------------------------------------------------------------
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                await ensureUserProfile(user);
            } catch (error) {
                console.warn(error);
            }

            authGate.classList.add("hidden");
            appRoot.classList.remove("hidden");
            const name = user.email?.split("@")[0] || "Usuário";
            profileLabel.textContent = name;
            avatar.textContent = initials(name);
            accountEmail.textContent = user.email || "Usuário";
            updateAdminUI(user);
            subscribeAccountData(user);
            subscribeSuggestionsIfAdmin(Boolean(user?.email) && user.email.toLowerCase() === adminEmail);
            renderSuggestions(Boolean(user?.email) && user.email.toLowerCase() === adminEmail);
            return;
        }

        stopSubscriptions();
        updateAdminUI(null);
        suggestions = [];
        renderSuggestions(false);
        setTracks([]);
        setPlaylists([]);
        clearSavedTrackIds();
        pauseAndResetAudio();
        setCurrentTrack(null);
        appRoot.classList.add("hidden");
        authGate.classList.remove("hidden");
        setGateMode("login");
    });

    // ------------------------------------------------------------------------
    // FORMULÁRIO DE LOGIN / CADASTRO
    // ------------------------------------------------------------------------
    // O mesmo formulário possui dois modos. `authMode` decide entre
    // signInWithEmailAndPassword() e createUserWithEmailAndPassword().
    // O botão fica desabilitado durante o await para impedir envio duplicado.
    // O sucesso não precisa liberar a tela manualmente: a mudança de sessão
    // dispara onAuthStateChanged(), que executa todo o fluxo correto acima.
    // ------------------------------------------------------------------------
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
}
