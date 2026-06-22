import { readFileSync } from "node:fs";

/**
 * The interactive view, served as the `ui://` resource the host renders in a
 * sandboxed iframe. This is the Prefab-renderer analog — except it's plain
 * HTML/JS you author directly instead of a Python component tree.
 */
export const WIDGET_HTML = readFileSync(new URL("./widget.html", import.meta.url), "utf-8");
