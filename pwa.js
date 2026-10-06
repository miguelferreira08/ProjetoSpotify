// ============================================================================
// PWA.JS — INSTALAÇÃO DO REDBEAT COMO APLICATIVO
// ============================================================================
//
// Este módulo cuida da PARTE DE INTERFACE da PWA. O cache offline em si fica no
// service-worker.js, que roda em um contexto separado do JavaScript da página.
//
// FLUXO
// -----
// 1. A página termina de carregar.
// 2. registerServiceWorker() registra ./service-worker.js.
// 3. Se Chrome/Edge considerar o site instalável, dispara `beforeinstallprompt`.
// 4. O evento é guardado em `deferredInstallPrompt` e o botão de instalar aparece.
// 5. O prompt nativo só é aberto quando o usuário clica no botão.
// 6. `appinstalled` confirma a instalação e o botão é ocultado.
//
// Observação: Safari/iOS não usa exatamente o mesmo beforeinstallprompt; nesses
// ambientes a instalação pode ocorrer pelo menu "Adicionar à Tela de Início".
// ============================================================================

let deferredInstallPrompt = null;

/**
 * Detecta se a página já está rodando no modo standalone.
 *
 * O primeiro teste atende navegadores modernos via media query. O segundo é
 * uma compatibilidade usada em versões do Safari/iOS.
 */
function isStandalone() {
    return window.matchMedia?.("(display-mode: standalone)").matches
        || window.navigator.standalone === true;
}

/**
 * Registra o Service Worker no escopo atual do site.
 *
 * Se `serviceWorker` não existir, retorna null sem quebrar o site: PWA é uma
 * melhoria progressiva, não requisito para o player funcionar. Em caso de erro,
 * chama o callback fornecido pelo app.js para mostrar feedback.
 */
async function registerServiceWorker(onError) {
    if (!("serviceWorker" in navigator)) {
        return null;
    }

    try {
        return await navigator.serviceWorker.register("./service-worker.js", {
            scope: "./",
        });
    }
    catch (error) {
        console.error("Service Worker:", error);
        onError?.(error);
        return null;
    }
}

/**
 * Conecta todos os eventos relacionados à instalação da PWA.
 *
 * Parâmetros opcionais:
 * - installButton: botão da conta que será mostrado quando houver prompt;
 * - onInstalled: callback executado após `appinstalled`;
 * - onError: callback de falha no registro/prompt.
 *
 * `beforeinstallprompt` é preventDefault() porque queremos controlar o momento
 * do prompt. O objeto do evento não pode ser recriado manualmente, por isso é
 * armazenado em `deferredInstallPrompt` até o clique do usuário.
 */
export function initPWA({ installButton, onInstalled, onError } = {}) {
    const hideInstallButton = () => {
        installButton?.classList.add("hidden");
    };

    const showInstallButton = () => {
        if (!isStandalone()) {
            installButton?.classList.remove("hidden");
        }
    };

    if (isStandalone()) {
        hideInstallButton();
    }

    window.addEventListener("load", () => {
        registerServiceWorker(onError);
    }, { once: true });

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        showInstallButton();
    });

    installButton?.addEventListener("click", async () => {
        if (!deferredInstallPrompt) {
            return;
        }

        installButton.disabled = true;

        try {
            deferredInstallPrompt.prompt();
            const choice = await deferredInstallPrompt.userChoice;

            if (choice.outcome === "accepted") {
                hideInstallButton();
            }
        }
        catch (error) {
            console.error("Instalação PWA:", error);
            onError?.(error);
        }
        finally {
            deferredInstallPrompt = null;
            installButton.disabled = false;
        }
    });

    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        hideInstallButton();
        onInstalled?.();
    });

    window.matchMedia?.("(display-mode: standalone)")
        .addEventListener?.("change", (event) => {
            if (event.matches) {
                hideInstallButton();
            }
        });
}
