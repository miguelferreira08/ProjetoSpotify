// ============================================================================
// SCROLLBAR.JS — BARRA DE ROLAGEM VISUAL PERSONALIZADA
// ============================================================================
//
// O conteúdo real rola em #pageScrollContainer. A barra vermelha exibida na
// lateral não é a scrollbar nativa: ela apenas REPRESENTA e CONTROLA o mesmo
// scrollTop do container.
//
// Fluxo de sincronização:
// container scroll -> calcula proporção -> move thumb visual.
// arrastar thumb    -> calcula proporção inversa -> altera container.scrollTop.
// ResizeObserver    -> recalcula tamanhos quando conteúdo/login/app muda.
//
// A scrollbar aparece somente quando scrollHeight > clientHeight e ganha uma
// classe temporária de atividade durante rolagem/arrasto.
// ============================================================================

/**
 * Inicializa a scrollbar customizada e registra todos os listeners necessários.
 * Recebe apenas `$` para localizar elementos, mantendo o módulo desacoplado do
 * restante do estado do RedBeat.
 */
export function initScrollbar(ctx) {
    const { $ } = ctx;

    const pageScrollContainer = $("#pageScrollContainer");
    const siteScrollbar = $("#siteScrollbar");
    const siteScrollbarTrack = $("#siteScrollbarTrack");
    const siteScrollThumb = $("#siteScrollThumb");

    let siteScrollRaf = 0;
    let siteScrollIdleTimer = 0;
    let siteScrollDragging = false;
    let siteScrollDragStartY = 0;
    let siteScrollDragStartTop = 0;

    /**
     * Mede altura total, viewport, limite máximo e posição atual do container.
     * Esses quatro valores formam a base matemática para converter scrollTop
     * em posição do thumb e vice-versa.
     */
    function getPageScrollMetrics() {
        if (!pageScrollContainer) {
            return {
                scrollHeight: 0,
                viewportHeight: 0,
                maxScroll: 0,
                scrollTop: 0,
            };
        }

        const scrollHeight = pageScrollContainer.scrollHeight;
        const viewportHeight = pageScrollContainer.clientHeight;
        const maxScroll = Math.max(0, scrollHeight - viewportHeight);

        return {
            scrollHeight,
            viewportHeight,
            maxScroll,
            scrollTop: Math.min(maxScroll, Math.max(0, pageScrollContainer.scrollTop)),
        };
    }

    /**
     * Recalcula tamanho e posição do thumb.
     *
     * O tamanho é proporcional à fração visível da página, com mínimo de 52 px
     * para continuar fácil de clicar. A posição usa a mesma proporção existente
     * entre scrollTop/maxScroll e thumbTop/maxThumbTop.
     */
    function updateSiteScrollbar() {
        siteScrollRaf = 0;

        if (!pageScrollContainer || !siteScrollbar || !siteScrollbarTrack || !siteScrollThumb) {
            return;
        }

        const metrics = getPageScrollMetrics();
        const trackHeight = siteScrollbarTrack.clientHeight;
        const needsScrollbar = metrics.maxScroll > 2 && trackHeight > 0;

        siteScrollbar.classList.toggle("is-needed", needsScrollbar);

        if (!needsScrollbar) {
            siteScrollThumb.style.height = "0px";
            siteScrollThumb.style.transform = "translate3d(0,0,0)";
            return;
        }

        const proportionalHeight = trackHeight * (metrics.viewportHeight / metrics.scrollHeight);
        const thumbHeight = Math.max(52, Math.min(trackHeight, proportionalHeight));
        const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
        const scrollRatio = metrics.maxScroll ? metrics.scrollTop / metrics.maxScroll : 0;
        const thumbTop = maxThumbTop * scrollRatio;

        siteScrollThumb.style.height = `${thumbHeight}px`;
        siteScrollThumb.style.transform = `translate3d(0,${thumbTop}px,0)`;
    }

    /**
     * Agenda atualização para o próximo frame com requestAnimationFrame().
     * Isso agrupa muitos eventos de scroll rápidos e evita recalcular layout
     * dezenas de vezes dentro do mesmo frame de pintura.
     */
    function requestSiteScrollbarUpdate() {
        if (siteScrollRaf) {
            return;
        }

        siteScrollRaf = requestAnimationFrame(updateSiteScrollbar);
    }

    /**
     * Torna a barra visível/ativa temporariamente e inicia temporizador de repouso.
     * Durante arrasto ela permanece ativa mesmo após o timer.
     */
    function wakeSiteScrollbar() {
        if (!siteScrollbar) {
            return;
        }

        siteScrollbar.classList.add("is-active");
        clearTimeout(siteScrollIdleTimer);

        siteScrollIdleTimer = setTimeout(() => {
            if (!siteScrollDragging) {
                siteScrollbar.classList.remove("is-active");
            }
        }, 850);
    }

    /**
     * Converte uma coordenada vertical do thumb em scrollTop do conteúdo.
     * Limita a posição ao trilho, calcula a proporção e chama scrollTo().
     */
    function scrollFromThumbTop(thumbTop) {
        if (!pageScrollContainer) {
            return;
        }

        const metrics = getPageScrollMetrics();
        const trackHeight = siteScrollbarTrack.clientHeight;
        const thumbHeight = siteScrollThumb.offsetHeight;
        const maxThumbTop = Math.max(1, trackHeight - thumbHeight);
        const clampedTop = Math.min(maxThumbTop, Math.max(0, thumbTop));
        const ratio = clampedTop / maxThumbTop;

        pageScrollContainer.scrollTo({
            top: ratio * metrics.maxScroll,
            behavior: "auto",
        });
    }

    pageScrollContainer?.addEventListener("scroll", () => {
        requestSiteScrollbarUpdate();
        wakeSiteScrollbar();
    }, { passive: true });

    window.addEventListener("resize", requestSiteScrollbarUpdate, { passive: true });
    window.addEventListener("load", requestSiteScrollbarUpdate, { once: true });
    document.addEventListener("DOMContentLoaded", requestSiteScrollbarUpdate, { once: true });

    if ("ResizeObserver" in window && pageScrollContainer) {
        const siteResizeObserver = new ResizeObserver(requestSiteScrollbarUpdate);
        siteResizeObserver.observe(pageScrollContainer);
        [$("#authGate"), $("#appRoot")].forEach((element) => {
            if (element) {
                siteResizeObserver.observe(element);
            }
        });
    }

    // Clique diretamente no trilho: centraliza o thumb perto do ponto clicado
    // e converte essa nova posição em rolagem da página.
    siteScrollbarTrack?.addEventListener("pointerdown", (event) => {
        if (event.target.closest(".site-scrollbar-thumb")) {
            return;
        }

        const rect = siteScrollbarTrack.getBoundingClientRect();
        const thumbHeight = siteScrollThumb.offsetHeight;
        const targetTop = event.clientY - rect.top - thumbHeight / 2;

        scrollFromThumbTop(targetTop);
        wakeSiteScrollbar();
    });

    // Início do arrasto: guarda Y inicial e posição atual do thumb. Pointer
    // capture permite continuar recebendo movimento mesmo se o cursor sair dele.
    siteScrollThumb?.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 && event.pointerType === "mouse") {
            return;
        }

        event.preventDefault();
        siteScrollDragging = true;
        siteScrollDragStartY = event.clientY;

        const transform = new DOMMatrixReadOnly(getComputedStyle(siteScrollThumb).transform);
        siteScrollDragStartTop = transform.m42 || 0;

        siteScrollbar.classList.add("is-dragging", "is-active");
        siteScrollThumb.setPointerCapture?.(event.pointerId);
    });

    siteScrollThumb?.addEventListener("pointermove", (event) => {
        if (!siteScrollDragging) {
            return;
        }

        const deltaY = event.clientY - siteScrollDragStartY;
        scrollFromThumbTop(siteScrollDragStartTop + deltaY);
    });

    /** Finaliza o arrasto, libera pointer capture e volta ao modo de repouso. */
    function finishSiteScrollDrag(event) {
        if (!siteScrollDragging) {
            return;
        }

        siteScrollDragging = false;
        siteScrollbar.classList.remove("is-dragging");

        if (event?.pointerId != null) {
            try {
                siteScrollThumb.releasePointerCapture?.(event.pointerId);
            } catch {}
        }

        wakeSiteScrollbar();
    }

    siteScrollThumb?.addEventListener("pointerup", finishSiteScrollDrag);
    siteScrollThumb?.addEventListener("pointercancel", finishSiteScrollDrag);

    requestSiteScrollbarUpdate();
}
