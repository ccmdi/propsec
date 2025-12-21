// Build-time constant injected by esbuild
declare const __DEV__: boolean;

/**
 * Debug logging utility - only logs in development builds
 * In production builds, __DEV__ is replaced with `false` by esbuild,
 * and the entire function body is tree-shaken away.
 */
export function debug(...args: unknown[]): void {
    if (__DEV__) {
        console.debug("[Propsec]", ...args);
    }
}
