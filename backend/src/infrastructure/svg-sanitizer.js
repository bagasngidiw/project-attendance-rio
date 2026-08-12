/**
 * SVG sanitizer (FR-002) — strips scripts, event handlers, javascript: URLs
 * and foreignObject/style payloads so uploaded SVGs are safe to serve.
 *
 * Conservative regex-based v1: it removes dangerous constructs; a full XML
 * parser can replace it without changing call sites.
 */

const DANGEROUS_TAGS = ["script", "foreignobject", "iframe", "object", "embed", "link"];

/**
 * @param {string} xml raw SVG source
 * @returns {string} sanitized SVG source
 */
function sanitizeSvg(xml) {
  let out = String(xml ?? "");

  // Remove dangerous element trees (case-insensitive).
  for (const tag of DANGEROUS_TAGS) {
    out = out.replace(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, "gi"), "");
    out = out.replace(new RegExp(`<${tag}[^>]*/>`, "gi"), "");
  }

  // Remove <style> blocks entirely (may embed url()/scripts).
  out = out.replace(/<style[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<style[^>]*\/>/gi, "");

  // Remove comments (can hide payloads).
  out = out.replace(/<!--[\s\S]*?-->/g, "");

  // Strip all event-handler attributes (on*).
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, " ");

  // Strip javascript:/data: URLs in href/xlink:href/src.
  out = out.replace(/(href|xlink:href|src)\s*=\s*("|')\s*javascript:[^"']*("|')/gi, "$1=$2$3");
  out = out.replace(/(href|xlink:href|src)\s*=\s*("|')\s*data:[^"']*("|')/gi, "$1=$2$3");

  return out.trim();
}

module.exports = { sanitizeSvg };
