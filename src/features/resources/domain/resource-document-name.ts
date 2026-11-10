export function resourceDocumentName(title?: string | null, original?: string | null): string {
  const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const source = clean(original ?? '');
  const extension = source.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? '.pdf';
  const label = clean(title ?? '') || source || 'Recurso';
  let stem = label;
  while (stem.toLowerCase().endsWith(extension.toLowerCase())) stem = stem.slice(0, -extension.length).trim();
  return `${Array.from(stem || 'Recurso').slice(0, 255 - extension.length).join('').trim()}${extension}`;
}
