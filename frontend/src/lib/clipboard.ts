/**
 * Putting formatted content on the clipboard so it survives the paste.
 *
 * A message app and a mail client want different things from the same copy:
 * Mail, Outlook and Gmail paste the `text/html` flavour and keep the headings
 * and tables; iMessage, WhatsApp and SMS take the `text/plain` flavour and want
 * it already laid out with spaces, because they will not render markup. Writing
 * both flavours in a single clipboard item lets one button serve both, with the
 * receiving app choosing.
 *
 * Three things routinely defeat the modern API, so each has a fallback:
 * an insecure origin, an embedding page that withholds clipboard permission,
 * and Safari's rule that the write must happen in the same turn as the click.
 * The last one is why every payload here is built *before* the click rather
 * than fetched during it.
 */

export interface Dispatch {
  /** Rich flavour, for mail clients. A styled fragment, not a whole document. */
  html: string;
  /** Plain flavour, for message apps. Already laid out with spaces and rules. */
  text: string;
}

export type CopyOutcome =
  /** Both flavours are on the clipboard — formatting will survive a paste into mail. */
  | 'rich'
  /** Only the plain text made it. Still sendable, just without the formatting. */
  | 'plain'
  /** Nothing could be written; the caller should show the text for manual copying. */
  | 'manual';

/** Last-resort copy for browsers or frames where the async API is unavailable. */
function copyViaSelection(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    // Off-screen but focusable — `display:none` would make the selection empty.
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length); // iOS ignores select() alone
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export async function copyDispatch(d: Dispatch): Promise<CopyOutcome> {
  const ClipboardItemCtor = (
    window as unknown as { ClipboardItem?: typeof ClipboardItem }
  ).ClipboardItem;

  if (navigator.clipboard?.write && ClipboardItemCtor) {
    try {
      await navigator.clipboard.write([
        new ClipboardItemCtor({
          'text/html': new Blob([d.html], { type: 'text/html' }),
          'text/plain': new Blob([d.text], { type: 'text/plain' }),
        }),
      ]);
      return 'rich';
    } catch {
      /* permission withheld, or not in a user gesture — try the simpler paths */
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(d.text);
      return 'plain';
    } catch {
      /* fall through */
    }
  }

  return copyViaSelection(d.text) ? 'plain' : 'manual';
}

/**
 * Copy a picture itself, so it can be pasted straight into a message.
 *
 * Everything is redrawn through a canvas as PNG because that is the only image
 * type browsers reliably accept on the clipboard — a JPEG blob is refused.
 * Redrawing also caps the dimensions: a seal plate is several megapixels, and
 * some message apps choke on a clipboard image that large.
 */
export async function copyImage(src: string, maxEdge = 1400): Promise<boolean> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    await img.decode();

    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) return false;

    const ClipboardItemCtor = (
      window as unknown as { ClipboardItem?: typeof ClipboardItem }
    ).ClipboardItem;
    if (!navigator.clipboard?.write || !ClipboardItemCtor) return false;

    await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shrink an image to a data URI so it can be embedded in the rich flavour.
 *
 * A pasted `<img src="https://…">` only shows for as long as this server is
 * reachable by the recipient, which for a working copy is often not at all.
 * Inlining the bytes makes the mail self-contained. They are re-encoded small:
 * the plates are ~400 KB each on disk, and a clipboard payload of several
 * megabytes is refused or silently truncated by some mail clients.
 */
export async function inlineImage(src: string, maxEdge = 460, quality = 0.72): Promise<string | null> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    await img.decode();

    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}
