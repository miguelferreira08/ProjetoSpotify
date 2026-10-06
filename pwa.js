let deferredInstallPrompt = null;

function isStandalone() {
    return window.matchMedia?.("(display-mode: standalone)").matches
        || window.navigator.standalone === true;
}

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
