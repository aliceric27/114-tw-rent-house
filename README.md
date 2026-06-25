# 社宅包租代管租金試算

## Cloudflare Pages

Build command:

```bash
npm run build
```

Build output directory:

```text
public
```

Pages Functions:

```text
functions/api/591-listing.js
```

The frontend calls `/api/591-listing?url=...` to parse supported 591 rent listing URLs.

## Local Preview

```bash
npm run build
npm run dev
```

Open `http://127.0.0.1:5173/`.
