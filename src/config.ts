/**
 * Default names for user-controlled source and output directories.
 */
export const ULIS_SOURCE_DIRNAME = ".ulis" as const;
export const ULIS_GENERATED_DIRNAME = "generated" as const;
export const ULIS_PRESETS_DIRNAME = "presets" as const;

/**
 * Prefix of the temp directory a remote source is cloned into. Shared so the installer can tell a
 * cloned tree from one the user wrote, without importing the cloner (which imports the installer).
 */
export const REMOTE_CLONE_DIRNAME_PREFIX = "ulis-remote-" as const;
