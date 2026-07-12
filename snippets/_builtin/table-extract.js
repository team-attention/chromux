// Builtin helper for `chromux run`: extract a table as structured data
// without dumping HTML.
// Usage:
//   chromux run <s> --file snippets/_builtin/table-extract.js \
//     [--arg table='#prices'] [--arg maxRows=200]
// Returns { headers, rowCount, truncated, rows } — pair with --schema for
// validated extraction.
const tableSel = args.table || 'table';
const maxRows = Math.min(Number(args.maxRows) || 200, 2000);
return await js(`((sel, maxRows) => {
  const table = document.querySelector(sel);
  if (!table) throw new Error('No table matching: ' + sel);
  const headers = [...table.querySelectorAll('thead th, thead td')].map(cell => cell.textContent.trim());
  let bodyRows = [...table.querySelectorAll('tbody tr')];
  if (!bodyRows.length) bodyRows = [...table.querySelectorAll('tr')].filter(tr => !tr.querySelector('th'));
  const rows = bodyRows.slice(0, maxRows).map(tr => [...tr.querySelectorAll('td,th')].map(cell => cell.textContent.trim()));
  return { headers, rowCount: bodyRows.length, truncated: bodyRows.length > maxRows, rows };
})(${JSON.stringify(tableSel)}, ${maxRows})`);
