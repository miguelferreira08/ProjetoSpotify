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
        $("#gateTitle").textContent = login ? "Entrar no RedBeat" : "Criar conta";
        $("#gateCopy").textContent = login
            ? "Entre com sua conta para acessar músicas, biblioteca e playlists."
            : "Crie sua conta para sincronizar sua biblioteca em todos os dispositivos.";
        $("#gateSubmit").textContent = login ? "Entrar" : "Criar conta";
        $("#gateToggle").textContent = login ? "Criar uma conta" : "Já tenho uma conta";
        $("#gatePassword").autocomplete = login ? "current-password" : "new-password";
        $("#gateError").classList.add("hidden");
    }

    async function ensureUserProfile(user) {
        await setDoc(doc(db, "users", user.uid), {
            email: user.email || "",
            updatedAt: serverTimestamp(),
        }, { merge: true });
    }

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
