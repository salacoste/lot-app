const translitMap = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd',
  'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i',
  'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
  'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't',
  'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch',
  'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '',
  'э': 'e', 'ю': 'yu', 'я': 'ya',
  ' ': '-', '.': '-', ',': '-', ':': '-', '/': '-',
  '№': 'n', '×': 'x',
};

/**
 * @param {string} text
 * @returns {string}
 */
export function generateSlug(text) {
  if (!text) return 'lot';

  let slug = '';
  const lowerText = text.toLowerCase();

  for (let i = 0; i < lowerText.length; i++) {
    const char = lowerText[i];

    if (translitMap[char] !== undefined) {
      slug += translitMap[char];
    } else if (/[a-z0-9\-]/.test(char)) {
      slug += char;
    }
  }

  slug = slug.replace(/-+/g, '-');
  slug = slug.replace(/^-|-$/g, '');

  const maxLength = 85;
  if (slug.length > maxLength) {
    const lastDashIndex = slug.lastIndexOf('-', maxLength);
    slug = lastDashIndex > 0
      ? slug.substring(0, lastDashIndex)
      : slug.substring(0, maxLength);
  }

  slug = slug.replace(/-+$/, '');
  slug = slug.replace(/-(i|v|s|k|o|u|na|po|za|do)$/, '');
  return slug || 'lot';
}
