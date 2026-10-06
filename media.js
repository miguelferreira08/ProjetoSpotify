// ============================================================================
// MEDIA.JS — PREPARAÇÃO E COMPRESSÃO DE ÁUDIO/CAPA
// ============================================================================
//
// Este módulo trabalha com arquivos locais escolhidos no navegador ANTES de
// eles serem gravados no Firestore, e também com os bytes lidos DEPOIS.
//
// FLUXO NO UPLOAD
// arquivo de áudio -> readAudioDuration() -> gzipBlob() -> storage.js
// capa escolhida   -> optimizeCover() -> gzipBlob() -> storage.js
//
// FLUXO NA LEITURA
// storage.js une chunks comprimidos -> gunzipBytes() -> Blob original -> player
//
// CompressionStream/DecompressionStream são APIs nativas modernas. Quando não
// existem, o módulo importa Pako sob demanda, evitando baixar a biblioteca em
// navegadores que já possuem suporte nativo.
// ============================================================================

// Cria temporariamente um elemento <audio> somente para ler os metadados
// do arquivo escolhido e descobrir sua duração em segundos.
export function readAudioDuration(file) {
    return new Promise((resolve, reject) => {
        const audioElement = document.createElement("audio");
        const objectUrl = URL.createObjectURL(file);

        const cleanup = () => {
            URL.revokeObjectURL(objectUrl);
            audioElement.removeAttribute("src");
            audioElement.load();
        };

        audioElement.preload = "metadata";
        audioElement.addEventListener("loadedmetadata", () => {
            const seconds = Math.round(audioElement.duration);
            cleanup();

            if (Number.isFinite(seconds) && seconds > 0) {
                resolve(seconds);
            } else {
                reject(new Error("duration"));
            }
        }, { once: true });

        audioElement.addEventListener("error", () => {
            cleanup();
            reject(new Error("metadata"));
        }, { once: true });

        audioElement.src = objectUrl;
    });
}

/**
 * Comprime qualquer Blob com GZIP e retorna Uint8Array.
 *
 * O RedBeat guarda bytes no Firestore. Por isso o Blob precisa virar um array
 * binário. CompressionStream processa os dados como stream sem uma dependência
 * externa; Pako é usado apenas como fallback de compatibilidade.
 */
export async function gzipBlob(blob) {
    if ("CompressionStream" in globalThis) {
        const stream = blob
            .stream()
            .pipeThrough(new CompressionStream("gzip"));

        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    const { gzip } = await import("https://cdn.jsdelivr.net/npm/pako@2.1.0/+esm");
    return gzip(new Uint8Array(await blob.arrayBuffer()));
}

/**
 * Descomprime bytes GZIP lidos do Firestore.
 *
 * Entrada: Uint8Array comprimido.
 * Saída: Uint8Array com o conteúdo original que poderá formar um Blob de áudio
 * ou imagem. A estratégia nativa/Pako acompanha gzipBlob().
 */
export async function gunzipBytes(bytes) {
    if ("DecompressionStream" in globalThis) {
        const stream = new Blob([bytes])
            .stream()
            .pipeThrough(new DecompressionStream("gzip"));

        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    const { ungzip } = await import("https://cdn.jsdelivr.net/npm/pako@2.1.0/+esm");
    return ungzip(bytes);
}

/**
 * Otimiza a imagem de capa antes do armazenamento.
 *
 * Processo:
 * 1. decodifica o arquivo com createImageBitmap() quando disponível;
 * 2. calcula um fator que nunca amplia a imagem e limita o maior lado a 720 px;
 * 3. desenha a imagem em um canvas com suavização de alta qualidade;
 * 4. exporta WebP com qualidade 0.78;
 * 5. libera Bitmap/Object URL temporários no `finally`.
 *
 * Isso reduz custo de armazenamento/leitura e também acelera a exibição de capas.
 */
export async function optimizeCover(file) {
    let source = null;
    let cleanup = () => {};

    if ("createImageBitmap" in globalThis) {
        const bitmap = await createImageBitmap(file);
        source = {
            width: bitmap.width,
            height: bitmap.height,
            draw: (context, width, height) => {
                context.drawImage(bitmap, 0, 0, width, height);
            },
        };
        cleanup = () => bitmap.close?.();
    } else {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        source = {
            width: image.naturalWidth,
            height: image.naturalHeight,
            draw: (context, width, height) => {
                context.drawImage(image, 0, 0, width, height);
            },
        };
        cleanup = () => URL.revokeObjectURL(objectUrl);
    }

    try {
        const maxSide = 720;
        const ratio = Math.min(1, maxSide / Math.max(source.width, source.height));
        const width = Math.max(1, Math.round(source.width * ratio));
        const height = Math.max(1, Math.round(source.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d", { alpha: false });
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        source.draw(context, width, height);

        return await new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error("cover"));
                }
            }, "image/webp", 0.78);
        });
    } finally {
        cleanup();
    }
}
