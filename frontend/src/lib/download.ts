/** Hands the browser a blob to save under `name`. The link is attached while
 *  it is clicked and the URL released a tick later, which is what every
 *  browser needs to start the download. */
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** One CSV cell: a number as it is, text quoted with its quotes doubled. */
export function csvCell(value: string | number | null | undefined) {
  return typeof value === 'number' ? String(value) : `"${(value ?? '').replaceAll('"', '""')}"`
}
