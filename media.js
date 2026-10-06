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
