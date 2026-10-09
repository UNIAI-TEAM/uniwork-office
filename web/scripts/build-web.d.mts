export declare const WEB_MODULE_NAMES: string[]
export declare function parseArgs(
  argv: readonly string[],
  env?: Record<string, string | undefined>,
): { modules: string[]; viteArgs: string[] }
