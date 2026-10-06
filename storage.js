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

// ============================================================================
// STORAGE.JS — CAMADA DE ARMAZENAMENTO BINÁRIO DO REDBEAT
// ============================================================================
//
// POR QUE EXISTEM CHUNKS?
// ----------------------
// O RedBeat está usando Firestore para armazenar a mídia sem Firebase Storage.
// Como um documento Firestore possui limite de tamanho, um MP3 não pode ser
// colocado inteiro em um único documento. Então o arquivo comprimido é dividido.
//
// ESTRUTURA ATUAL
// ---------------
// tracks/{trackId}                         -> metadados da faixa
// tracks/{trackId}/audioChunks/000000      -> primeiro pedaço do áudio
// tracks/{trackId}/audioChunks/000001      -> segundo pedaço
// tracks/{trackId}/coverChunks/000000      -> pedaço da capa
//
// FLUXO DE GRAVAÇÃO
// Uint8Array comprimido -> splitBytes() -> writeBatch() -> subcoleção de chunks.
//
// FLUXO DE REPRODUÇÃO
// getDocs(orderBy index) -> une chunks -> gunzipBytes() -> Blob -> Object URL.
//
// CACHE EM MEMÓRIA
// ----------------
// Object URLs já montadas ficam em Maps para que tocar a mesma faixa/capa de
// novo não obrigue outra leitura completa do Firestore durante a mesma sessão.
// `assetLoading` também evita duas reconstruções simultâneas do mesmo recurso.
// ============================================================================

// URLs temporárias já prontas são indexadas pelo ID da faixa. `assetLoading`
// guarda Promises em andamento: se dois componentes pedirem a mesma capa ao
// mesmo tempo, ambos aguardam a MESMA operação. `migrationAttempted` impede
// repetir migração antiga em loop dentro da mesma sessão.
const coverUrlCache = new Map();
const audioUrlCache = new Map();
const assetLoading = new Map();
const migrationAttempted = new Set();

/**
 * Divide um Uint8Array em pedaços de no máximo CHUNK_SIZE.
 *
 * `slice()` cria cada segmento mantendo a ordem original. O índice do array
 * depois será usado como índice persistido no documento Firestore.
 */
function splitBytes(bytes) {
    const chunks = [];

    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_SIZE) {
        chunks.push(bytes.slice(offset, Math.min(offset + CHUNK_SIZE, bytes.byteLength)));
    }

    return chunks;
}

/**
 * Grava todos os chunks de áudio ou capa em uma subcoleção.
 *
 * Parâmetros:
 * - `trackRef`: referência de tracks/{trackId};
 * - `name`: "audioChunks" ou "coverChunks";
 * - `bytes`: arquivo comprimido completo em Uint8Array;
 * - `onBytes`: callback opcional que recebe quantos bytes acabaram de ser salvos.
 *
 * Os chunks são enviados em pequenos writeBatch() de 6 documentos. Cada doc
 * recebe `index`, `byteLength` e `data` (Firestore Bytes). O nome `000000`,
 * `000001` etc. também mantém organização visual no console.
 *
 * Retorno: quantidade total de chunks criada, salva depois no documento da faixa.
 */
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

/**
 * Reconstrói o arquivo comprimido a partir da subcoleção atual.
 *
 * A query usa orderBy("index", "asc") porque a ordem é crítica: trocar dois
 * pedaços corromperia o MP3/imagem. Depois calcula o tamanho total, cria um único
 * Uint8Array e copia cada chunk na posição correta usando `offset`.
 */
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

/**
 * Verifica a integridade do upload antes de marcar a faixa como `ready`.
 *
 * A função relê capa e áudio diretamente do Firestore, reconstrói os bytes e
 * compara com os arrays originais usando sameBytes(). Isso testa o caminho real
 * de persistência, não apenas os dados ainda presentes na memória do navegador.
 *
 * Qualquer diferença lança `verify-failed`; o catch do upload no app.js então
 * executa a limpeza dos dados parciais.
 */
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

/**
 * Monta a referência de um chunk no formato usado pelas versões antigas.
 * Esse layout existia diretamente dentro de `tracks` e é mantido apenas para
 * compatibilidade/migração de músicas cadastradas anteriormente.
 */
function legacyChunkRef(trackId, type, index) {
    const typeCode = type === "audio" ? "a" : "c";
    const chunkId = String(index).padStart(6, "0");
    return doc(db, "tracks", `${trackId}__${typeCode}__${chunkId}`);
}

/**
 * Lê uma faixa ainda armazenada no layout legado.
 *
 * Como o documento principal guarda a quantidade esperada de chunks antigos,
 * a função busca cada referência por índice. Se um único pedaço estiver ausente,
 * interrompe a reconstrução em vez de produzir um arquivo silenciosamente ruim.
 */
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

/**
 * Seleciona automaticamente qual leitor usar conforme `storageLayout` da faixa.
 * Isso permite que player/capas usem uma API única sem conhecer a versão do dado.
 */
async function readStoredBytes(track, type) {
    if (track.storageLayout === "subcollections-v2") {
        return readSubcollectionChunks(track, type);
    }

    return readLegacyChunks(track, type);
}

/**
 * Converte a mídia armazenada no Firestore em uma URL utilizável pelo navegador.
 *
 * Fluxo detalhado:
 * 1. escolhe o cache de áudio ou capa;
 * 2. se a URL já existir, retorna imediatamente sem nova leitura;
 * 3. se outra chamada já estiver reconstruindo o mesmo recurso, reutiliza sua
 *    Promise através de `assetLoading`;
 * 4. readStoredBytes() lê o layout atual ou legado;
 * 5. se `audioCompression/coverCompression` for "gzip", gunzipBytes() restaura;
 * 6. cria `Blob` com MIME apropriado;
 * 7. URL.createObjectURL() gera uma URL temporária local;
 * 8. armazena a URL em cache e remove a Promise de `assetLoading` no finally.
 *
 * Essa URL é atribuída a `audio.src` ou `background-image` pelo app.js.
 */
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

/** Retorna a Object URL já montada, sem provocar leitura no Firestore. */
export function getCachedAssetUrl(trackId, type = "audio") {
    const cache = type === "audio" ? audioUrlCache : coverUrlCache;
    return cache.get(trackId) || "";
}

/**
 * Revoga e remove uma Object URL específica.
 * Necessário para liberar memória e também para forçar reconstrução quando o
 * player detecta que uma URL pode estar problemática.
 */
export function revokeCachedAssetUrl(trackId, type = "audio") {
    const cache = type === "audio" ? audioUrlCache : coverUrlCache;
    const cached = cache.get(trackId);

    if (cached) {
        URL.revokeObjectURL(cached);
        cache.delete(trackId);
    }
}

/** Limpa simultaneamente os caches de áudio e capa de uma faixa. */
export function clearCachedTrackAssets(trackId) {
    revokeCachedAssetUrl(trackId, "audio");
    revokeCachedAssetUrl(trackId, "cover");
}

/**
 * Revoga todas as Object URLs criadas na sessão e esvazia os Maps.
 * É chamada antes de sair/descarregar a página para liberar memória do browser.
 */
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

/**
 * Exclui todos os documentos de uma subcoleção de chunks.
 *
 * Firestore não apaga subcoleções automaticamente quando o pai é excluído.
 * Por isso esta função lê os docs e cria batches de até 300 exclusões antes de
 * remover tracks/{id}. Também é usada no rollback de uploads que falharam.
 */
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

/**
 * Migra chunks do formato antigo para as subcoleções atuais.
 *
 * 1. evita repetir a tentativa usando migrationAttempted;
 * 2. consulta documentos antigos cujo parentTrackId aponta para a faixa;
 * 3. identifica se cada chunk é capa ou áudio;
 * 4. grava o mesmo Bytes no novo caminho e apaga o documento antigo no batch;
 * 5. ao final marca `storageLayout: "subcollections-v2"` no documento principal;
 * 6. chama `onMigrated` para que a interface possa informar o administrador.
 *
 * Falhas são registradas como warning para não impedir o restante do catálogo.
 */
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
