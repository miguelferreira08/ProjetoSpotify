import {
    Bytes,
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
    where,
    writeBatch,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase.js";
import { CHUNK_SIZE } from "./config.js";
import { gunzipBytes } from "./media.js";
import { sameBytes } from "./utils.js";

const coverUrlCache = new Map();
const audioUrlCache = new Map();
const assetLoading = new Map();
const migrationAttempted = new Set();

function splitBytes(bytes) {
    const chunks = [];

    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_SIZE) {
        chunks.push(bytes.slice(offset, Math.min(offset + CHUNK_SIZE, bytes.byteLength)));
    }

    return chunks;
}

export async function writeSubcollectionChunks(trackRef, name, bytes, onBytes) {
    const chunks = splitBytes(bytes);
    const chunksCollection = collection(trackRef, name);

    for (let start = 0; start < chunks.length; start += 6) {
        const batch = writeBatch(db);
        let batchBytes = 0;

        for (let index = start; index < Math.min(start + 6, chunks.length); index += 1) {
            const chunk = chunks[index];
            const chunkRef = doc(chunksCollection, String(index).padStart(6, "0"));

            batch.set(chunkRef, {
                index,
                byteLength: chunk.byteLength,
                data: Bytes.fromUint8Array(chunk),
            });

            batchBytes += chunk.byteLength;
        }

        await batch.commit();
        onBytes?.(batchBytes);
    }

    return chunks.length;
}

async function readSubcollectionChunks(track, type) {
    const collectionName = type === "audio" ? "audioChunks" : "coverChunks";
    const chunksCollection = collection(db, "tracks", track.id, collectionName);
    const snapshot = await getDocs(query(chunksCollection, orderBy("index", "asc")));

    if (snapshot.empty) {
        throw new Error(`Sem blocos ${type}`);
    }

    const chunks = snapshot.docs.map((document) => document.data().data.toUint8Array());
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const result = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return result;
}

export async function verifyStoredTrackBytes(trackId, coverBytes, audioBytes) {
    const storedTrack = {
        id: trackId,
        storageLayout: "subcollections-v2",
    };

    const [storedCover, storedAudio] = await Promise.all([
        readSubcollectionChunks(storedTrack, "cover"),
        readSubcollectionChunks(storedTrack, "audio"),
    ]);

    if (!sameBytes(storedCover, coverBytes) || !sameBytes(storedAudio, audioBytes)) {
        throw new Error("verify-failed");
    }
}

function legacyChunkRef(trackId, type, index) {
    const typeCode = type === "audio" ? "a" : "c";
    const chunkId = String(index).padStart(6, "0");
    return doc(db, "tracks", `${trackId}__${typeCode}__${chunkId}`);
}

async function readLegacyChunks(track, type) {
    const count = Number(type === "audio" ? track.audioChunks : track.coverChunks) || 0;

    if (!count) {
        throw new Error("Sem blocos antigos");
    }

    const chunks = [];

    for (let index = 0; index < count; index += 1) {
        const snapshot = await getDoc(legacyChunkRef(track.id, type, index));

        if (!snapshot.exists()) {
            throw new Error("Bloco antigo ausente");
        }

        chunks.push(snapshot.data().data.toUint8Array());
    }

    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const result = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return result;
}

async function readStoredBytes(track, type) {
    if (track.storageLayout === "subcollections-v2") {
        return readSubcollectionChunks(track, type);
    }

    return readLegacyChunks(track, type);
}

export async function buildAssetUrl(track, type) {
    const key = `${type}:${track.id}`;
    const cache = type === "audio" ? audioUrlCache : coverUrlCache;

    if (cache.has(track.id)) {
        return cache.get(track.id);
    }

    if (assetLoading.has(key)) {
        return assetLoading.get(key);
    }

    const promise = (async () => {
        const stored = await readStoredBytes(track, type);
        const compression = type === "audio" ? track.audioCompression : track.coverCompression;
        const raw = compression === "gzip" ? await gunzipBytes(stored) : stored;
        const mime = type === "audio"
            ? track.audioMime || "audio/mpeg"
            : track.coverMime || "image/webp";
        const url = URL.createObjectURL(new Blob([raw], { type: mime }));

        cache.set(track.id, url);
        return url;
    })();

    assetLoading.set(key, promise);

    try {
        return await promise;
    } finally {
        assetLoading.delete(key);
    }
}

export function getCachedAssetUrl(trackId, type = "audio") {
    const cache = type === "audio" ? audioUrlCache : coverUrlCache;
    return cache.get(trackId) || "";
}

export function revokeCachedAssetUrl(trackId, type = "audio") {
    const cache = type === "audio" ? audioUrlCache : coverUrlCache;
    const cached = cache.get(trackId);

    if (cached) {
        URL.revokeObjectURL(cached);
        cache.delete(trackId);
    }
}

export function clearCachedTrackAssets(trackId) {
    revokeCachedAssetUrl(trackId, "audio");
    revokeCachedAssetUrl(trackId, "cover");
}

export function revokeAllAssetUrls() {
    for (const url of audioUrlCache.values()) {
        URL.revokeObjectURL(url);
    }

    for (const url of coverUrlCache.values()) {
        URL.revokeObjectURL(url);
    }

    audioUrlCache.clear();
    coverUrlCache.clear();
}

export async function deleteSubcollection(trackRef, name) {
    const snapshot = await getDocs(collection(trackRef, name));

    for (let start = 0; start < snapshot.docs.length; start += 300) {
        const batch = writeBatch(db);

        for (const document of snapshot.docs.slice(start, start + 300)) {
            batch.delete(document.ref);
        }

        await batch.commit();
    }
}

export async function migrateLegacyTrack(track, onMigrated) {
    if (migrationAttempted.has(track.id) || track.storageLayout === "subcollections-v2") {
        return;
    }

    migrationAttempted.add(track.id);

    try {
        const legacy = await getDocs(
            query(collection(db, "tracks"), where("parentTrackId", "==", track.id)),
        );

        if (legacy.empty) {
            return;
        }

        for (let start = 0; start < legacy.docs.length; start += 150) {
            const batch = writeBatch(db);

            for (const document of legacy.docs.slice(start, start + 150)) {
                const chunk = document.data();
                const subcollection = chunk.chunkType === "cover"
                    ? "coverChunks"
                    : "audioChunks";
                const target = doc(
                    db,
                    "tracks",
                    track.id,
                    subcollection,
                    String(Number(chunk.index) || 0).padStart(6, "0"),
                );

                batch.set(target, {
                    index: Number(chunk.index) || 0,
                    byteLength: Number(chunk.byteLength) || 0,
                    data: chunk.data,
                });
                batch.delete(document.ref);
            }

            await batch.commit();
        }

        await updateDoc(doc(db, "tracks", track.id), {
            storageLayout: "subcollections-v2",
            migratedAt: serverTimestamp(),
        });

        onMigrated?.(track);
    } catch (error) {
        console.warn("Migração antiga ignorada:", error);
    }
}
