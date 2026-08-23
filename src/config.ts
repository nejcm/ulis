/**
 * Default names for user-controlled source and output directories.
 */
export const ULIS_SOURCE_DIRNAME = ".ulis" as const;
export const ULIS_GENERATED_DIRNAME = "generated" as const;
export const ULIS_PRESETS_DIRNAME = "presets" as const;

/**
 * Name of the provenance marker written inside each remote-authored `generated/<platform>/` tree.
 * `runInstall` reads the selected platforms' markers so a later `--skip-rebuild` run can tell it is
 * looking at remote-authored output even though it resolved no presets of its own.
 */
export const ULIS_PROVENANCE_FILENAME = ".ulis-provenance.json" as const;

/**
 * Prefix of the temp directory a remote source is cloned into. Shared so the installer can tell a
 * cloned tree from one the user wrote, without importing the cloner (which imports the installer).
 */
export const REMOTE_CLONE_DIRNAME_PREFIX = "ulis-remote-" as const;
