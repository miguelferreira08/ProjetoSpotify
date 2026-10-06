// ============================================================================
// UTILS.JS — FUNÇÕES PURAS E REUTILIZÁVEIS
// ============================================================================
//
// As funções deste arquivo não conhecem Firebase, player nem elementos da tela.
// Recebem valores, transformam e devolvem resultados. Isso facilita reutilização
// e evita repetir pequenas regras em vários módulos.
// ============================================================================

/** Converte qualquer valor em string segura para outras operações de texto. */
export function safeText(value = "") {
    return String(value ?? "");
}

/**
 * Normaliza texto usado em busca/filtros.
 * Remove acentos, converte para minúsculas e elimina espaços nas bordas.
 * Assim "Eletrônica", "eletronica" e " ELETRÔNICA " podem ser comparados.
 */
export function normalizeSearchValue(value = "") {
    return safeText(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

/**
 * Cria uma Promise que resolve após `milliseconds`.
 * Usada quando a interface precisa aguardar uma animação antes da próxima etapa.
 */
export function wait(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

/**
 * Escapa caracteres que possuem significado em HTML.
 *
 * Como títulos/artistas vêm do Firestore e são inseridos em template strings,
 * esta função evita que `<`, `>`, aspas e `&` sejam interpretados como marcação.
 */
export function escapeHtml(value) {
    return safeText(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/** Retorna a primeira letra de um texto para usar como placeholder visual. */
export function initials(value = "R") {
    const text = safeText(value).trim();
    return text ? text[0].toUpperCase() : "R";
}

/**
 * Converte segundos numéricos para o formato M:SS usado pelo player.
 * Valores inválidos/negativos retornam "0:00" para manter a UI consistente.
 */
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

/** Converte bytes para uma unidade legível (KB ou MB) usada no progresso. */
export function byteSizeLabel(bytes) {
    if (bytes < 1048576) {
        return `${(bytes / 1024).toFixed(0)} KB`;
    }

    return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Compara dois Uint8Array byte a byte.
 * É a base da verificação de integridade após o upload: qualquer diferença de
 * tamanho ou conteúdo faz a função retornar false.
 */
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
