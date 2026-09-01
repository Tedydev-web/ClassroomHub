/**
 * Handing a file the server built to the person who asked for it.
 *
 * The name comes from the response rather than being composed here. The server knows the
 * paper's title and who the file is for; this page knows neither reliably, and the last
 * attempt at composing it locally produced `undefined-bai-lam.csv` in every teacher's
 * downloads folder.
 */

/**
 * The name the server asked for, read out of `Content-Disposition`.
 *
 * Two spellings are sent: `filename*` carries the name percent-encoded as UTF-8 and is
 * preferred where it is present, because a Vietnamese title cannot survive the plain one.
 * The fallback exists for the case where a proxy strips the header entirely — a file with a
 * dull name still opens, and a download that fails does not.
 */
export function fileNameFromResponse(response: Response, fallback: string): string {
  const header = response.headers.get('content-disposition') ?? '';

  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // A malformed header is not worth failing a download over.
    }
  }

  const plain = /filename="([^"]+)"/iu.exec(header)?.[1];

  return plain ?? fallback;
}

/**
 * The anchor is attached before the click because Safari has ignored clicks on detached
 * ones, and the object URL is revoked on the next tick rather than this one, which would
 * race the download the click just began.
 */
export function downloadFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url));
}
