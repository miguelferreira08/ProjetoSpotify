// ============================================================================
// CONFIG.JS — CONFIGURAÇÕES COMPARTILHADAS
// ============================================================================
//
// Este arquivo não executa ações no Firebase nem manipula HTML. Ele exporta
// valores estáticos usados por vários módulos. Centralizar essas constantes
// evita que diferentes partes do projeto trabalhem com limites/listas diferentes.
//
// Se um gênero for adicionado no futuro, por exemplo, a lista abaixo deve ser
// atualizada e as Firestore Rules também precisam aceitar o mesmo valor.
// ============================================================================

// Tamanho máximo de cada pedaço binário salvo em um documento de chunk.
// 480 KiB deixa margem abaixo do limite de tamanho de documento do Firestore,
// porque o documento ainda possui campos auxiliares como índice e byteLength.
export const CHUNK_SIZE = 480 * 1024;
// Limites definidos pelo próprio RedBeat antes do upload. Eles evitam iniciar
// compressão/gravação de arquivos acima do tamanho que o projeto decidiu aceitar.
export const MAX_AUDIO_SIZE = 25 * 1024 * 1024;
export const MAX_COVER_SIZE = 10 * 1024 * 1024;
// E-mail usado pela interface para identificar a conta administrativa.
// ATENÇÃO: isso NÃO deve ser tratado como segurança suficiente. As regras do
// Firestore repetem a autorização no servidor e são a barreira real de escrita.
export const ADMIN_EMAIL = "miguelfer0808@gmail.com";

// Fonte única dos gêneros reconhecidos pelo JavaScript. A lista alimenta
// validação do upload, seletor personalizado, filtros e contadores da Home.
export const MUSIC_GENRES = [
    "Eletrônica",
    "Rock",
    "Funk",
    "Pagode",
    "Sertanejo",
    "Trap",
    "Pop",
    "Regional",
    "Reggae",
    "Jazz",
    "Hip-Hop/Rap",
    "Outros",
];
