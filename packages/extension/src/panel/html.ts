/** Build the review panel HTML with a strict nonce CSP and VS Code CSS variables. */
export function getReviewPanelHtml(opts: {
  cspSource: string;
  styleHref: string;
  scriptHref: string;
  nonce: string;
}): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${opts.cspSource} data: blob:`,
    `style-src ${opts.cspSource} 'unsafe-inline'`,
    `font-src ${opts.cspSource}`,
    `script-src 'nonce-${opts.nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${opts.styleHref}" />
  <title>Read Receipt</title>
</head>
<body>
  <div id="app" class="rr-app"></div>
  <script nonce="${opts.nonce}" src="${opts.scriptHref}"></script>
</body>
</html>`;
}

export function createNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
