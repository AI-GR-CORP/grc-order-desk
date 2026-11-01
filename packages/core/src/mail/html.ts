import { convert } from 'html-to-text';

/** HTML → readable text. Gmail/Outlook quote containers are skipped so replies stay short. */
export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    preserveNewlines: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'blockquote', format: 'skip' },
      { selector: 'div.gmail_quote', format: 'skip' },
      { selector: 'div.gmail_extra', format: 'skip' },
      { selector: 'div#divRplyFwdMsg', format: 'skip' },
      { selector: 'div#appendonsend', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'table', format: 'dataTable' },
    ],
  });
}
