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

    function requestSiteScrollbarUpdate() {
        if (siteScrollRaf) {
            return;
        }

        siteScrollRaf = requestAnimationFrame(updateSiteScrollbar);
    }

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
