export function safeText(value = "") {
    return String(value ?? "");
}

export function normalizeSearchValue(value = "") {
    return safeText(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

export function wait(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

export function escapeHtml(value) {
    return safeText(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function initials(value = "R") {
    const text = safeText(value).trim();
    return text ? text[0].toUpperCase() : "R";
}

export function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "0:00";
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60)
        .toString()
        .padStart(2, "0");

    return `${minutes}:${remainingSeconds}`;
}

export function byteSizeLabel(bytes) {
    if (bytes < 1048576) {
        return `${(bytes / 1024).toFixed(0)} KB`;
    }

    return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function sameBytes(a, b) {
    if (!a || !b || a.byteLength !== b.byteLength) {
        return false;
    }

    for (let index = 0; index < a.byteLength; index += 1) {
        if (a[index] !== b[index]) {
            return false;
        }
    }

    return true;
}
